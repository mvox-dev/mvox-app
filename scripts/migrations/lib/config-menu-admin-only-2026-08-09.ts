// #70 (#37) — restrict the 3 domain-shared Configuration menu entries
// (Entities, Menu, Plugins) to admin-only. Same mechanism as #47/#45's menu
// privatization: `DELETE /property/{sharingValueId}` on the menu row's own
// `_sharing` value, leaving it absent — matches "Billing"'s existing
// admin-only shape exactly (Billing has NO `_sharing` value at all, live-
// confirmed same group "Configuration").
//
// Unlike #68 (schema/meta entities self-owned by the database entity), menu
// row entities ARE db-root-owned (confirmed by #68 Phase 1's inventory: menu
// total=23, dbRootOwned=23, flagged=0) — writing `_sharing` here is NOT
// blocked by the #68 rights gap.

import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/seasons/entuSeasons';

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export const TARGET_NAMES = ['Entities', 'Menu', 'Plugins'] as const;
const EXPECTED_GROUP = 'Configuration';
const REFERENCE_ADMIN_ONLY_NAME = 'Billing';

export type VerifiedMenuTarget = { name: string; menuId: string; sharingValueId: string; currentSharing: string };
export type FullMenuEntry = { id: string; label: string; group: string; currentSharing: string; isTarget: boolean };

export type VerifiedAll = {
	targets: VerifiedMenuTarget[];
	referenceCheck: { name: string; menuId: string; currentSharing: string; isAlreadyAdminOnly: boolean };
	fullMenu: FullMenuEntry[];
};

/** Step-0 enumeration (READ-ONLY). Re-verifies each of the 3 target menu rows
 * live — current `_sharing=domain` (HALTs if it moved), group="Configuration"
 * (HALTs if a name match landed on the wrong row), and the row's `_sharing`
 * value `_id` (needed for the DELETE). Also re-verifies the "Billing"
 * reference row is still the admin-only shape we're matching (absent
 * `_sharing`), and captures the FULL live menu for the post-change computed
 * model. */
export async function verifyAll(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<VerifiedAll> {
	const menuRes = await entuFetch(cfg.db, `entity?_type.string=menu&props=name,group,_sharing&limit=100`, cfg.token, {}, fetchImpl);
	if (!menuRes.ok) throw new Error(`verifyAll: menu list GET failed: ${menuRes.status}`);
	type MenuEntity = {
		_id: string;
		name?: Array<{ string: string; language?: string }>;
		group?: Array<{ string: string; language?: string }>;
		_sharing?: Array<{ _id: string; string: string }>;
	};
	const menuBody = (await menuRes.json()) as { entities: MenuEntity[] };

	function englishName(e: MenuEntity): string {
		return e.name?.find((n) => n.language === 'en')?.string ?? e.name?.[0]?.string ?? '(unnamed)';
	}
	function englishGroup(e: MenuEntity): string {
		return e.group?.find((g) => g.language === 'en')?.string ?? e.group?.[0]?.string ?? '(none)';
	}

	const targets: VerifiedMenuTarget[] = [];
	for (const name of TARGET_NAMES) {
		const entry = menuBody.entities.find((e) => englishName(e) === name);
		if (!entry) throw new Error(`verifyAll: no menu entry found named "${name}" — refuse to proceed`);
		const group = englishGroup(entry);
		if (group !== EXPECTED_GROUP) throw new Error(`verifyAll: menu entry "${name}" (${entry._id}) is in group "${group}", expected "${EXPECTED_GROUP}" — wrong row, refuse to proceed`);
		const sharing = entry._sharing?.[0];
		if (!sharing?._id || sharing.string !== 'domain') {
			throw new Error(`verifyAll: menu entry "${name}" (${entry._id}) has _sharing=${JSON.stringify(sharing?.string ?? null)} (expected 'domain' with a readable _id) — live state moved, refuse to proceed`);
		}
		targets.push({ name, menuId: entry._id, sharingValueId: sharing._id, currentSharing: sharing.string });
	}

	const refEntry = menuBody.entities.find((e) => englishName(e) === REFERENCE_ADMIN_ONLY_NAME);
	if (!refEntry) throw new Error(`verifyAll: reference row "${REFERENCE_ADMIN_ONLY_NAME}" not found — refuse to proceed without the known-good shape to match`);
	const refSharing = refEntry._sharing?.[0]?.string ?? null;
	const referenceCheck = { name: REFERENCE_ADMIN_ONLY_NAME, menuId: refEntry._id, currentSharing: refSharing ?? '(absent)', isAlreadyAdminOnly: refSharing === null };
	if (!referenceCheck.isAlreadyAdminOnly) {
		throw new Error(`verifyAll: reference row "${REFERENCE_ADMIN_ONLY_NAME}" (${refEntry._id}) is NOT admin-only (has _sharing=${JSON.stringify(refSharing)}) — the shape we're matching against has moved, refuse to proceed`);
	}

	const targetIds = new Set(targets.map((t) => t.menuId));
	const fullMenu: FullMenuEntry[] = menuBody.entities.map((e) => ({
		id: e._id,
		label: englishName(e),
		group: englishGroup(e),
		currentSharing: e._sharing?.[0]?.string ?? '(absent)',
		isTarget: targetIds.has(e._id)
	}));

	return { targets, referenceCheck, fullMenu };
}

export type PrivatizeLedgerEntry = { menuId: string; name: string; status: 'privatized' | 'failed'; message?: string };

/** Same mechanic as #45/#47: DELETE the menu row's `_sharing` value, leaving
 * it absent. Read-back confirms absence. */
export async function privatizeMenuEntries(cfg: EntuCfg, targets: VerifiedMenuTarget[], fetchImpl: typeof fetch = fetch): Promise<PrivatizeLedgerEntry[]> {
	const entries: PrivatizeLedgerEntry[] = [];
	for (const t of targets) {
		try {
			const res = await entuFetch(cfg.db, `property/${t.sharingValueId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
			if (!res.ok) {
				entries.push({ menuId: t.menuId, name: t.name, status: 'failed', message: `DELETE /property/${t.sharingValueId} failed: ${res.status}` });
				continue;
			}
		} catch (err) {
			entries.push({ menuId: t.menuId, name: t.name, status: 'failed', message: errMsg(err) });
			continue;
		}
		const getRes = await entuFetch(cfg.db, `entity/${t.menuId}?props=_sharing`, cfg.token, {}, fetchImpl);
		if (!getRes.ok) {
			entries.push({ menuId: t.menuId, name: t.name, status: 'failed', message: `read-back GET failed: ${getRes.status}` });
			continue;
		}
		const body = (await getRes.json()) as { entity?: { _sharing?: Array<{ string: string }> } };
		if (body.entity?._sharing && body.entity._sharing.length > 0) {
			entries.push({ menuId: t.menuId, name: t.name, status: 'failed', message: `read-back still shows a _sharing value (${body.entity._sharing[0].string}) — deletion did not land` });
			continue;
		}
		entries.push({ menuId: t.menuId, name: t.name, status: 'privatized' });
	}
	return entries;
}

export function renderPlan(v: VerifiedAll): string {
	const lines: string[] = [];
	lines.push('#70 (#37) — Configuration menu admin-only restriction DRY-RUN plan (NO writes issued)');
	lines.push('');
	lines.push(`── Reference shape: "${v.referenceCheck.name}" (${v.referenceCheck.menuId}) is already admin-only (_sharing=${v.referenceCheck.currentSharing}) — the 3 targets will match this shape.`);
	lines.push('');
	lines.push('── Targets (3, all re-verified live: group=Configuration, _sharing=domain)');
	for (const t of v.targets) {
		lines.push(`   "${t.name}" (${t.menuId}). WOULD: DELETE /property/${t.sharingValueId}.`);
	}
	lines.push('');
	const domainBefore = v.fullMenu.filter((e) => e.currentSharing === 'domain').length;
	const domainAfter = v.fullMenu.filter((e) => e.currentSharing === 'domain' && !e.isTarget).length;
	lines.push(`── Computed post-change member menu model (menu row's OWN _sharing only)`);
	lines.push(`   Before: ${domainBefore}/${v.fullMenu.length} rows domain-tier.`);
	lines.push(`   After (computed): ${domainAfter}/${v.fullMenu.length} rows domain-tier — Configuration group would carry ZERO domain rows (Billing already absent, the 3 targets moving to absent).`);
	for (const e of v.fullMenu) {
		const willBe = e.isTarget ? 'absent (this run)' : e.currentSharing;
		lines.push(`     ${e.label.padEnd(16)} [${e.group}] currently=${e.currentSharing} → after=${willBe}`);
	}
	lines.push('');
	lines.push('── MEMBER-SEAT VERIFICATION: NOT PERFORMED, cannot be performed with locally available credentials (per #44/#47\'s standing finding — no working member-seat credential exists locally). Acceptance item 3 stages this for the next Mihkel sitting.');
	lines.push('');
	lines.push(`Totals: ${v.targets.length} menu-row privatize-writes planned. Writes issued this run: 0.`);
	return lines.join('\n');
}
