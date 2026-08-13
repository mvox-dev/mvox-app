// #127 follow-up — Consolidate Baritone, then nest under Bass
//
// SUPERSEDES the first version of this script (committed bb7cfd9, never run live — only
// a dry-run ledger exists). That version added an additive _parent link from BOTH
// Baritone sections to Bass/EFK, keeping two surviving Baritone sections. PO correction
// (Mihkel via Gama, relayed by team-lead, 2026-08-13): that's wrong — consolidate first,
// then nest. One surviving Baritone, not two additive links.
//
// Revised sequence (same A -> C -> B pattern as section-cleanup-127-2026-08-13.ts):
//   A. CONSOLIDATE — RAM Baritone is the target (18 members vs TAM's 2 — natural pick,
//      same reasoning as the original script's "pick the larger org's section" choices).
//      Reassign TAM Baritone's members onto RAM Baritone (POST new link if not already
//      present, DELETE the TAM-Baritone link, read-back verify).
//   C. NEST — add an additive _parent link from the surviving RAM Baritone to Bass/EFK
//      (org-parent link on RAM Baritone stays untouched — same pattern as Soprano I/II
//      under Soprano etc.).
//   B. DELETE — after step A confirms zero members remain linked to TAM Baritone, DELETE
//      the TAM Baritone section entity. Gated on a live re-check finding it empty —
//      refuses to delete if any member is still linked.
//
// Result: one Baritone section (RAM's, id 69c7f8828489bfcb0e81b3ec), nested under Bass/EFK,
// holding all 20 Baritone members (18 original + 2 moved from TAM).
//
//   RAM Baritone (survivor) 69c7f8828489bfcb0e81b3ec -> nest under Bass/EFK 69c7f8768489bfcb0e81b163
//   TAM Baritone (retire)   69c7f8898489bfcb0e81b580 -> members move to RAM Baritone, then delete
//
// DRY_RUN=true by default. Set DRY_RUN=false ONLY after the dry-run ledger has been
// reviewed and team-lead has sent explicit "I authorize this run".
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/section-cleanup-127-baritone-nest-2026-08-13.ts                # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/section-cleanup-127-baritone-nest-2026-08-13.ts                # ONLY after authorization

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

interface SectionRef {
	id: string;
	name: string;
	org: string;
}

const BASS_EFK: SectionRef = { id: '69c7f8768489bfcb0e81b163', name: 'Bass', org: 'Eesti Filharmoonia Kammerkoor' };
const RAM_BARITONE: SectionRef = { id: '69c7f8828489bfcb0e81b3ec', name: 'Baritone', org: 'Eesti Rahvusmeeskoor' };
const TAM_BARITONE: SectionRef = { id: '69c7f8898489bfcb0e81b580', name: 'Baritone', org: 'Tartu Akadeemiline Meeskoor' };

// -- Wire types -----------------------------------------------------------------

interface ParentValue {
	_id: string;
	reference: string;
	entity_type?: string;
	string?: string;
}

interface MemberEntity {
	_id: string;
	_parent?: ParentValue[];
	person?: Array<{ string?: string }>;
}

interface EntityListResponse<T> {
	count: number;
	entities: T[];
}

interface LedgerEntry {
	phase: 'phase0-verify' | 'A-reassign' | 'C-nest' | 'B-delete-section';
	action: string;
	targetId: string;
	targetLabel: string;
	status: 'ok' | 'skipped-already-done' | 'skipped-no-op' | 'failed' | 'dry-run' | 'aborted-not-empty';
	detail?: string;
	error?: string;
}

const ledger: LedgerEntry[] = [];

function writeLedger(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'ledgers');
	const filename = `section-cleanup-127-baritone-nest-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

// -- Phase 0: verify frozen IDs against live data -----------------------------------

async function verifySection(cfg: EntuCfg, ref: SectionRef, label: string): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${ref.id}?props=name,_parent`, cfg.token);
	if (!res.ok) throw new Error(`Phase 0 verify ${label} (${ref.id}): GET failed ${res.status}`);
	const body = (await res.json()) as {
		entity: { name?: Array<{ string: string }>; _parent?: ParentValue[] };
	};
	const liveName = body.entity.name?.[0]?.string;
	const liveOrg = body.entity._parent?.find((p) => p.entity_type === 'organization')?.string;
	if (liveName !== ref.name || liveOrg !== ref.org) {
		throw new Error(
			`Phase 0 verify ${label} (${ref.id}): DRIFT — expected name=${JSON.stringify(ref.name)} org=${JSON.stringify(ref.org)}, ` +
				`found name=${JSON.stringify(liveName)} org=${JSON.stringify(liveOrg)}. Refusing to proceed.`
		);
	}
	ledger.push({
		phase: 'phase0-verify',
		action: 'verify-section',
		targetId: ref.id,
		targetLabel: label,
		status: 'ok',
		detail: `name=${liveName} org=${liveOrg}`
	});
}

// -- Step A: consolidate (move TAM Baritone members onto RAM Baritone) --------------

async function fetchMembersLinkedTo(cfg: EntuCfg, sectionId: string): Promise<MemberEntity[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=member&_parent.reference=${sectionId}&props=_parent,person&limit=300`,
		cfg.token
	);
	if (!res.ok) throw new Error(`fetchMembersLinkedTo(${sectionId}): query failed ${res.status}`);
	const body = (await res.json()) as EntityListResponse<MemberEntity>;
	if (body.count !== body.entities.length) {
		throw new Error(
			`fetchMembersLinkedTo(${sectionId}): census truncated — count=${body.count} entities=${body.entities.length}. Raise limit.`
		);
	}
	return body.entities;
}

async function reassignMember(cfg: EntuCfg, member: MemberEntity, retire: SectionRef, survivor: SectionRef): Promise<void> {
	const personName = member.person?.[0]?.string ?? '(unknown person)';
	const label = `member ${member._id} (${personName}): ${retire.name}/${retire.org} -> ${survivor.name}/${survivor.org}`;

	const parents = member._parent ?? [];
	const retireLink = parents.find((p) => p.reference === retire.id);
	const survivorLink = parents.find((p) => p.reference === survivor.id);

	if (!retireLink) {
		ledger.push({
			phase: 'A-reassign',
			action: 'reassign-member',
			targetId: member._id,
			targetLabel: label,
			status: 'skipped-no-op',
			detail: 'member has no _parent link to the retiring section (stale census — skip)'
		});
		return;
	}

	if (DRY_RUN) {
		ledger.push({
			phase: 'A-reassign',
			action: 'reassign-member',
			targetId: member._id,
			targetLabel: label,
			status: 'dry-run',
			detail: survivorLink
				? 'already has survivor link — would only DELETE the retiring link'
				: 'would POST new survivor link, then DELETE the retiring link'
		});
		return;
	}

	try {
		if (!survivorLink) {
			const postRes = await entuFetch(cfg.db, `entity/${member._id}`, cfg.token, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([{ type: '_parent', reference: survivor.id }])
			});
			if (!postRes.ok) {
				const text = await postRes.text().catch(() => '(no body)');
				throw new Error(`POST survivor link failed: ${postRes.status} — ${text}`);
			}
		}

		const delRes = await entuFetch(cfg.db, `property/${retireLink._id}`, cfg.token, { method: 'DELETE' });
		if (!delRes.ok) {
			const text = await delRes.text().catch(() => '(no body)');
			throw new Error(`DELETE retiring link failed: ${delRes.status} — ${text}`);
		}

		const verifyRes = await entuFetch(cfg.db, `entity/${member._id}?props=_parent`, cfg.token);
		if (!verifyRes.ok) throw new Error(`read-back verify GET failed: ${verifyRes.status}`);
		const verifyBody = (await verifyRes.json()) as { entity: { _parent?: ParentValue[] } };
		const nowParents = verifyBody.entity._parent ?? [];
		const stillHasRetire = nowParents.some((p) => p.reference === retire.id);
		const hasSurvivor = nowParents.some((p) => p.reference === survivor.id);
		if (stillHasRetire || !hasSurvivor) {
			throw new Error(
				`read-back verify FAILED: stillHasRetireLink=${stillHasRetire} hasSurvivorLink=${hasSurvivor} — apparent-success trap`
			);
		}

		ledger.push({
			phase: 'A-reassign',
			action: 'reassign-member',
			targetId: member._id,
			targetLabel: label,
			status: 'ok',
			detail: survivorLink ? 'deduped stray dual-link' : 'moved to survivor, verified'
		});
	} catch (err) {
		ledger.push({
			phase: 'A-reassign',
			action: 'reassign-member',
			targetId: member._id,
			targetLabel: label,
			status: 'failed',
			error: err instanceof Error ? err.message : String(err)
		});
	}
}

async function stepA_consolidate(cfg: EntuCfg): Promise<void> {
	const members = await fetchMembersLinkedTo(cfg, TAM_BARITONE.id);
	console.log(`[A] ${TAM_BARITONE.name}/${TAM_BARITONE.org} (${TAM_BARITONE.id}): ${members.length} member(s) linked -> ${RAM_BARITONE.name}/${RAM_BARITONE.org}`);
	for (const member of members) {
		await reassignMember(cfg, member, TAM_BARITONE, RAM_BARITONE);
	}
}

// -- Step C: nest surviving RAM Baritone under Bass/EFK -----------------------------

async function nestSection(cfg: EntuCfg, child: SectionRef, parent: SectionRef): Promise<void> {
	const label = `${child.name}/${child.org} -> parent ${parent.name}/${parent.org}`;
	const res = await entuFetch(cfg.db, `entity/${child.id}?props=_parent`, cfg.token);
	if (!res.ok) throw new Error(`nestSection(${child.id}): GET failed ${res.status}`);
	const body = (await res.json()) as { entity: { _parent?: ParentValue[] } };
	const alreadyNested = (body.entity._parent ?? []).some((p) => p.reference === parent.id);

	if (alreadyNested) {
		ledger.push({ phase: 'C-nest', action: 'nest-section', targetId: child.id, targetLabel: label, status: 'skipped-already-done' });
		return;
	}

	if (DRY_RUN) {
		ledger.push({ phase: 'C-nest', action: 'nest-section', targetId: child.id, targetLabel: label, status: 'dry-run' });
		return;
	}

	try {
		const postRes = await entuFetch(cfg.db, `entity/${child.id}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: '_parent', reference: parent.id }])
		});
		if (!postRes.ok) {
			const text = await postRes.text().catch(() => '(no body)');
			throw new Error(`POST parent link failed: ${postRes.status} — ${text}`);
		}
		const verifyRes = await entuFetch(cfg.db, `entity/${child.id}?props=_parent`, cfg.token);
		if (!verifyRes.ok) throw new Error(`read-back verify GET failed: ${verifyRes.status}`);
		const verifyBody = (await verifyRes.json()) as { entity: { _parent?: ParentValue[] } };
		const nowNested = (verifyBody.entity._parent ?? []).some((p) => p.reference === parent.id);
		if (!nowNested) throw new Error('read-back verify FAILED: parent link not present after POST — apparent-success trap');
		ledger.push({ phase: 'C-nest', action: 'nest-section', targetId: child.id, targetLabel: label, status: 'ok' });
	} catch (err) {
		ledger.push({
			phase: 'C-nest',
			action: 'nest-section',
			targetId: child.id,
			targetLabel: label,
			status: 'failed',
			error: err instanceof Error ? err.message : String(err)
		});
	}
}

// -- Step B: delete now-empty TAM Baritone -------------------------------------------

async function deleteRetiredSection(cfg: EntuCfg, retire: SectionRef): Promise<void> {
	const label = `${retire.name}/${retire.org}`;
	const remaining = await fetchMembersLinkedTo(cfg, retire.id);
	if (remaining.length > 0) {
		ledger.push({
			phase: 'B-delete-section',
			action: 'delete-section',
			targetId: retire.id,
			targetLabel: label,
			status: 'aborted-not-empty',
			detail: `${remaining.length} member(s) still linked — step A did not fully clear this section. Refusing to delete.`
		});
		return;
	}

	if (DRY_RUN) {
		ledger.push({ phase: 'B-delete-section', action: 'delete-section', targetId: retire.id, targetLabel: label, status: 'dry-run' });
		return;
	}

	try {
		const delRes = await entuFetch(cfg.db, `entity/${retire.id}`, cfg.token, { method: 'DELETE' });
		if (!delRes.ok) {
			const text = await delRes.text().catch(() => '(no body)');
			throw new Error(`DELETE /entity/${retire.id} failed: ${delRes.status} — ${text}`);
		}
		const verifyRes = await entuFetch(cfg.db, `entity/${retire.id}`, cfg.token);
		if (verifyRes.status !== 404) {
			throw new Error(`read-back verify FAILED: GET after DELETE returned ${verifyRes.status}, expected 404`);
		}
		ledger.push({ phase: 'B-delete-section', action: 'delete-section', targetId: retire.id, targetLabel: label, status: 'ok' });
	} catch (err) {
		ledger.push({
			phase: 'B-delete-section',
			action: 'delete-section',
			targetId: retire.id,
			targetLabel: label,
			status: 'failed',
			error: err instanceof Error ? err.message : String(err)
		});
	}
}

// -- Main -----------------------------------------------------------------------

async function main(): Promise<void> {
	console.log(`#127 baritone consolidate+nest — DRY_RUN=${DRY_RUN}`);
	const cfg = await loadCfg();

	console.log('\n== Phase 0: verify frozen section IDs against live data ==');
	await verifySection(cfg, BASS_EFK, 'BASS_EFK (target parent)');
	await verifySection(cfg, RAM_BARITONE, 'RAM_BARITONE (survivor)');
	await verifySection(cfg, TAM_BARITONE, 'TAM_BARITONE (retire)');

	console.log('\n== Step A: consolidate (TAM Baritone members -> RAM Baritone) ==');
	await stepA_consolidate(cfg);

	console.log('\n== Step C: nest RAM Baritone under Bass/EFK ==');
	await nestSection(cfg, RAM_BARITONE, BASS_EFK);

	console.log('\n== Step B: remove orphan (delete now-empty TAM Baritone) ==');
	await deleteRetiredSection(cfg, TAM_BARITONE);

	const summary = {
		ok: ledger.filter((e) => e.status === 'ok').length,
		skipped: ledger.filter((e) => e.status.startsWith('skipped')).length,
		dryRun: ledger.filter((e) => e.status === 'dry-run').length,
		failed: ledger.filter((e) => e.status === 'failed').length,
		aborted: ledger.filter((e) => e.status === 'aborted-not-empty').length
	};
	console.log('\n== Summary ==', summary);

	const path = writeLedger({ dryRun: DRY_RUN, generatedAt: new Date().toISOString(), summary, ledger });
	console.log(`Ledger written: ${path}`);

	if (summary.failed > 0 || summary.aborted > 0) {
		console.error(`\n${summary.failed} failed, ${summary.aborted} aborted — see ledger for detail.`);
		process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exitCode = 1;
});

// (*MVOX:Perotin*)
