// #47 (#37-P3.5) — restrict the 3 empty-shell menu entries (repertoire_item,
// program_item, attendance — all 0 live instances per #41) to admin-only.
// Same mechanism as #45 step 1 (Applications): `DELETE /property/{sharingValueId}`
// on the menu row's own `_sharing` value, leaving it absent — matches the
// existing "Billing" admin-only entry's shape exactly.
//
// MEMBER-SEAT VERIFICATION — cannot be performed empirically this run. Per
// #44's finding, `ENTU_ADMIN_KEY` (the only non-db-root credential locally
// available) resolves to an ANONYMOUS FLOOR JWT (`accounts:[]`), not a real
// member/OAuth identity — there is no working member seat to verify against.
// This script instead computes the post-change menu-row-visibility model
// (which rows carry `_sharing:domain` vs absent) and states that computed
// model plainly as computed, not observed.
//
// KNOWN OPEN DISCREPANCY (from #37's own history, 2026-08-07 walkthrough,
// quoted verbatim rather than re-derived): "Member seat showed 11
// Polyphony-group entries; admin seat shows 18 ... computed menu visibility
// (22 of 23 rows domain) vs the 2026-08-07 walkthrough's observed 11
// member-visible entries. Mechanism unknown (candidate: menu-entity property
// bucketing)." This script's computed model will NOT resolve that mechanism —
// it is explicitly parked for Mihkel's real-browser verification per the
// issue's own instruction. Flagging, not diagnosing.

import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/seasons/entuSeasons';

export type MenuTarget = { name: string; typeQuery: string };
export const TARGETS: MenuTarget[] = [
	{ name: 'repertoire_item', typeQuery: '_type.string=repertoire_item' },
	{ name: 'program_item', typeQuery: '_type.string=program_item' },
	{ name: 'attendance', typeQuery: '_type.string=attendance' }
];

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export type VerifiedMenuTarget = {
	name: string;
	menuId: string;
	menuLabel: string;
	sharingValueId: string;
	currentSharing: string;
	referencedTypeInstanceCount: number;
};

export type FullMenuEntry = { id: string; label: string; group: string; currentSharing: string; isTarget: boolean };

export type VerifiedAll = {
	targets: VerifiedMenuTarget[];
	fullMenu: FullMenuEntry[];
};

/** Step-0 enumeration (READ-ONLY). Re-verifies each of the 3 target menu rows
 * live — current `_sharing`, the row's own `_id`, its `_sharing` value `_id`
 * (needed for the DELETE), and a live recount of its referenced type's
 * instance count (HALTs if no longer 0 — the "empty shell" premise must hold
 * live, not from #41 memory). Also captures the FULL live menu for the
 * post-change computed model. */
export async function verifyAll(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<VerifiedAll> {
	const menuRes = await entuFetch(cfg.db, `entity?_type.string=menu&props=name,group,query,_sharing&limit=100`, cfg.token, {}, fetchImpl);
	if (!menuRes.ok) throw new Error(`verifyAll: menu list GET failed: ${menuRes.status}`);
	type MenuEntity = {
		_id: string;
		name?: Array<{ string: string; language?: string }>;
		group?: Array<{ string: string }>;
		query?: Array<{ string: string }>;
		_sharing?: Array<{ _id: string; string: string }>;
	};
	const menuBody = (await menuRes.json()) as { entities: MenuEntity[] };

	const targets: VerifiedMenuTarget[] = [];
	for (const t of TARGETS) {
		const entry = menuBody.entities.find((e) => (e.query?.[0]?.string ?? '').includes(t.typeQuery));
		if (!entry) throw new Error(`verifyAll: no menu entry found for ${t.name} (query containing '${t.typeQuery}') — refuse to proceed`);
		const sharing = entry._sharing?.[0];
		if (!sharing?._id || sharing.string !== 'domain') {
			throw new Error(`verifyAll: menu entry for ${t.name} (${entry._id}) has _sharing=${JSON.stringify(sharing?.string ?? null)} (expected 'domain' with a readable _id) — live state moved, refuse to proceed`);
		}
		const countRes = await entuFetch(cfg.db, `entity?${t.typeQuery}&props=_id&limit=5`, cfg.token, {}, fetchImpl);
		if (!countRes.ok) throw new Error(`verifyAll: instance count GET for ${t.name} failed: ${countRes.status}`);
		const countBody = (await countRes.json()) as { count: number };
		if (countBody.count !== 0) {
			throw new Error(`verifyAll: ${t.name} now has ${countBody.count} live instance(s) — the "empty shell" premise no longer holds, refuse to proceed, re-verify manually`);
		}
		targets.push({
			name: t.name,
			menuId: entry._id,
			menuLabel: entry.name?.find((n) => n.language === 'en')?.string ?? entry.name?.[0]?.string ?? '(unnamed)',
			sharingValueId: sharing._id,
			currentSharing: sharing.string,
			referencedTypeInstanceCount: countBody.count
		});
	}

	const targetIds = new Set(targets.map((t) => t.menuId));
	const fullMenu: FullMenuEntry[] = menuBody.entities.map((e) => ({
		id: e._id,
		label: e.name?.find((n) => n.language === 'en')?.string ?? e.name?.[0]?.string ?? '(unnamed)',
		group: e.group?.[0]?.string ?? '(none)',
		currentSharing: e._sharing?.[0]?.string ?? '(absent)',
		isTarget: targetIds.has(e._id)
	}));

	return { targets, fullMenu };
}

export type PrivatizeLedgerEntry = { menuId: string; name: string; status: 'privatized' | 'failed'; message?: string };

/** Same mechanic as #45 step 1: DELETE the menu row's `_sharing` value,
 * leaving it absent. Read-back-confirms absence. */
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
	lines.push('#47 (#37-P3.5) — menu empty-shells to admin-only DRY-RUN plan (NO writes issued)');
	lines.push('');
	lines.push('── Targets (3, all re-verified live: _sharing=domain, referenced type has 0 live instances)');
	for (const t of v.targets) {
		lines.push(`   "${t.menuLabel}" (${t.menuId}) → ${t.name}, instances=${t.referencedTypeInstanceCount}. WOULD: DELETE /property/${t.sharingValueId}.`);
	}
	lines.push('');
	const domainBefore = v.fullMenu.filter((e) => e.currentSharing === 'domain').length;
	const domainAfter = v.fullMenu.filter((e) => e.currentSharing === 'domain' && !e.isTarget).length;
	lines.push(`── Computed post-change menu-row visibility model (menu row's OWN _sharing only — see caveat below)`);
	lines.push(`   Before this change: ${domainBefore}/${v.fullMenu.length} rows domain-tier.`);
	lines.push(`   After this change (computed): ${domainAfter}/${v.fullMenu.length} rows domain-tier.`);
	for (const e of v.fullMenu) {
		const willBe = e.isTarget ? 'absent (this run)' : e.currentSharing;
		lines.push(`     ${e.label.padEnd(16)} [${e.group}] currently=${e.currentSharing} → after=${willBe}`);
	}
	lines.push('');
	lines.push('── MEMBER-SEAT VERIFICATION: NOT PERFORMED, cannot be performed with locally available credentials.');
	lines.push('   ENTU_ADMIN_KEY (the only non-db-root credential locally available) resolves to an ANONYMOUS FLOOR');
	lines.push('   JWT (accounts:[]) per #44\'s confirmed finding — there is no working member seat to verify against.');
	lines.push('   The above is a COMPUTED model (menu row\'s own _sharing only), not an OBSERVED one.');
	lines.push('');
	lines.push('── KNOWN OPEN DISCREPANCY (quoted from #37\'s own history, 2026-08-07 walkthrough, NOT re-derived here):');
	lines.push('   "Member seat showed 11 Polyphony-group entries; admin seat shows 18 ... computed menu visibility');
	lines.push('   (22 of 23 rows domain) vs the 2026-08-07 walkthrough\'s observed 11 member-visible entries.');
	lines.push('   Mechanism unknown (candidate: menu-entity property bucketing)." This dry-run\'s computed model does');
	lines.push('   NOT resolve that mechanism — flagging for Mihkel\'s real-browser verification, not diagnosing here.');
	lines.push('');
	lines.push(`Totals: ${v.targets.length} menu-row privatize-writes planned. Writes issued this run: 0.`);
	return lines.join('\n');
}
