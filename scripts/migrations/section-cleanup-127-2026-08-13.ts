// #127 — Section Data Cleanup (Phase 2 execution)
//
// Investigation (Phase 1): issue #127 comment
// https://github.com/mvox-dev/mvox-app/issues/127#issuecomment-5272879201
//
// PO rulings (Mihkel via Gama, 2026-08-13, relayed by team-lead):
//   - Baritone (RAM + TAM): KEEP standalone, untouched — no EFK equivalent voice part.
//   - "Admin" section (EFK, 6a7cc04e23dc1d97bb8f203b): LEAVE untouched — system fixture,
//     not a voice part, not in scope for any of the 3 steps below.
//
// Three steps, run in this order (member reassignment before section deletion,
// per team-lead's dispatch):
//
//   A. CONSOLIDATE — for each RETIRE-target section, move every member currently
//      linked to it onto the corresponding SURVIVOR section:
//        RAM Bass      -> EFK Bass       (24 raw links; 14 already dual-linked to EFK
//                                          Bass from an earlier partial by-hand attempt
//                                          — those just need the old RAM-Bass link
//                                          removed, not a new POST)
//        TAM I Tenor   -> RAM I Tenor    (2 raw links)
//        TAM II Tenor  -> RAM II Tenor   (0 links — no-op reassignment, section deleted
//                                          directly in step B)
//        TAM Bass      -> EFK Bass       (0 links — no-op reassignment, section deleted
//                                          directly in step B)
//      Per member: if they don't already have a _parent link to the survivor, POST
//      one; then DELETE the _parent link to the retiring section. Org-parent links
//      are untouched — org affiliation is orthogonal to voice-section assignment and
//      stays as-is.
//
//   C. FIX HIERARCHY — nest the 6 surviving sub-sections under their new EFK-anchored
//      parent section by ADDING a _parent link (multi-parent: org-parent link stays,
//      new section-parent link is additive, matching the existing member multi-parent
//      pattern):
//        Sireen Soprano I/II  -> parent = EFK Soprano
//        Sireen Alto I/II     -> parent = EFK Alto
//        RAM I Tenor/II Tenor -> parent = EFK Tenor
//
//   B. REMOVE ORPHANS — after step A confirms zero remaining member links, DELETE the
//      4 retiring section entities (RAM Bass, TAM I Tenor, TAM II Tenor, TAM Bass).
//      Hard-aborts per-section if a live re-check finds any member still linked —
//      never deletes a section with members still attached.
//
// Frozen section IDs (verified live 2026-08-13, re-verified by name+org at Phase 0
// below before any write — fail loud on drift):
//   EFK Soprano      69c7f8728489bfcb0e81b07b   (survivor, top-level)
//   EFK Alto         69c7f8748489bfcb0e81b0cd   (survivor, top-level)
//   EFK Tenor        69c7f8758489bfcb0e81b113   (survivor, top-level)
//   EFK Bass         69c7f8768489bfcb0e81b163   (survivor, top-level — absorbs RAM+TAM Bass)
//   Sireen Soprano I  69c7f8788489bfcb0e81b1bf  (survivor, nests under EFK Soprano)
//   Sireen Soprano II 69c7f8798489bfcb0e81b207  (survivor, nests under EFK Soprano)
//   Sireen Alto I     69c7f87b8489bfcb0e81b257  (survivor, nests under EFK Alto)
//   Sireen Alto II    69c7f87c8489bfcb0e81b2a7  (survivor, nests under EFK Alto)
//   RAM I Tenor       69c7f87e8489bfcb0e81b2fa  (survivor, nests under EFK Tenor — absorbs TAM I Tenor)
//   RAM II Tenor      69c7f8808489bfcb0e81b374  (survivor, nests under EFK Tenor — absorbs TAM II Tenor)
//   RAM Baritone      69c7f8828489bfcb0e81b3ec  (UNTOUCHED — PO ruling)
//   RAM Bass          69c7f8848489bfcb0e81b46e  (RETIRE -> EFK Bass)
//   TAM I Tenor       69c7f8878489bfcb0e81b506  (RETIRE -> RAM I Tenor)
//   TAM II Tenor      69c7f8888489bfcb0e81b544  (RETIRE -> RAM II Tenor)
//   TAM Baritone      69c7f8898489bfcb0e81b580  (UNTOUCHED — PO ruling)
//   TAM Bass          69c7f88a8489bfcb0e81b5bc  (RETIRE -> EFK Bass)
//   Admin             6a7cc04e23dc1d97bb8f203b  (UNTOUCHED — PO ruling, out of scope)
//
// End state: 16 voice sections -> 12 (10 consolidated survivors + 2 untouched Baritone)
// + 1 untouched Admin = 13 total section entities (down from 17).
//
// DRY_RUN=true by default. Set DRY_RUN=false ONLY after the dry-run ledger has been
// reviewed and team-lead has sent explicit "I authorize this run".
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/section-cleanup-127-2026-08-13.ts                # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/section-cleanup-127-2026-08-13.ts                # ONLY after authorization

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import { readDryRun } from './lib/script-runner';
import { writeLedger as writeLedgerShared } from './lib/ledger-writer';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = readDryRun();

// -- Frozen section map -----------------------------------------------------------

interface SectionRef {
	id: string;
	name: string;
	org: string;
}

const SECTIONS = {
	EFK_SOPRANO: { id: '69c7f8728489bfcb0e81b07b', name: 'Soprano', org: 'Eesti Filharmoonia Kammerkoor' },
	EFK_ALTO: { id: '69c7f8748489bfcb0e81b0cd', name: 'Alto', org: 'Eesti Filharmoonia Kammerkoor' },
	EFK_TENOR: { id: '69c7f8758489bfcb0e81b113', name: 'Tenor', org: 'Eesti Filharmoonia Kammerkoor' },
	EFK_BASS: { id: '69c7f8768489bfcb0e81b163', name: 'Bass', org: 'Eesti Filharmoonia Kammerkoor' },
	SIREEN_SOPRANO_I: { id: '69c7f8788489bfcb0e81b1bf', name: 'Soprano I', org: 'Kammernaiskoor Sireen' },
	SIREEN_SOPRANO_II: { id: '69c7f8798489bfcb0e81b207', name: 'Soprano II', org: 'Kammernaiskoor Sireen' },
	SIREEN_ALTO_I: { id: '69c7f87b8489bfcb0e81b257', name: 'Alto I', org: 'Kammernaiskoor Sireen' },
	SIREEN_ALTO_II: { id: '69c7f87c8489bfcb0e81b2a7', name: 'Alto II', org: 'Kammernaiskoor Sireen' },
	RAM_I_TENOR: { id: '69c7f87e8489bfcb0e81b2fa', name: 'I Tenor', org: 'Eesti Rahvusmeeskoor' },
	RAM_II_TENOR: { id: '69c7f8808489bfcb0e81b374', name: 'II Tenor', org: 'Eesti Rahvusmeeskoor' },
	RAM_BASS: { id: '69c7f8848489bfcb0e81b46e', name: 'Bass', org: 'Eesti Rahvusmeeskoor' },
	TAM_I_TENOR: { id: '69c7f8878489bfcb0e81b506', name: 'I Tenor', org: 'Tartu Akadeemiline Meeskoor' },
	TAM_II_TENOR: { id: '69c7f8888489bfcb0e81b544', name: 'II Tenor', org: 'Tartu Akadeemiline Meeskoor' },
	TAM_BASS: { id: '69c7f88a8489bfcb0e81b5bc', name: 'Bass', org: 'Tartu Akadeemiline Meeskoor' }
} as const satisfies Record<string, SectionRef>;

/** Untouched per PO ruling — listed for the Phase 0 drift check only, never written. */
const UNTOUCHED = {
	RAM_BARITONE: { id: '69c7f8828489bfcb0e81b3ec', name: 'Baritone', org: 'Eesti Rahvusmeeskoor' },
	TAM_BARITONE: { id: '69c7f8898489bfcb0e81b580', name: 'Baritone', org: 'Tartu Akadeemiline Meeskoor' },
	ADMIN: { id: '6a7cc04e23dc1d97bb8f203b', name: 'Admin', org: 'Eesti Filharmoonia Kammerkoor' }
} as const satisfies Record<string, SectionRef>;

/** RETIRE-target -> SURVIVOR-target for member reassignment (step A) + entity deletion (step B). */
const RETIRE_TO_SURVIVOR: Array<{ retire: SectionRef; survivor: SectionRef }> = [
	{ retire: SECTIONS.RAM_BASS, survivor: SECTIONS.EFK_BASS },
	{ retire: SECTIONS.TAM_I_TENOR, survivor: SECTIONS.RAM_I_TENOR },
	{ retire: SECTIONS.TAM_II_TENOR, survivor: SECTIONS.RAM_II_TENOR },
	{ retire: SECTIONS.TAM_BASS, survivor: SECTIONS.EFK_BASS }
];

/** Sub-section -> new parent section for hierarchy nesting (step C). Additive — org-parent link stays. */
const NEST_UNDER: Array<{ child: SectionRef; parent: SectionRef }> = [
	{ child: SECTIONS.SIREEN_SOPRANO_I, parent: SECTIONS.EFK_SOPRANO },
	{ child: SECTIONS.SIREEN_SOPRANO_II, parent: SECTIONS.EFK_SOPRANO },
	{ child: SECTIONS.SIREEN_ALTO_I, parent: SECTIONS.EFK_ALTO },
	{ child: SECTIONS.SIREEN_ALTO_II, parent: SECTIONS.EFK_ALTO },
	{ child: SECTIONS.RAM_I_TENOR, parent: SECTIONS.EFK_TENOR },
	{ child: SECTIONS.RAM_II_TENOR, parent: SECTIONS.EFK_TENOR }
];

// -- Ledger -------------------------------------------------------------------------

interface LedgerEntry {
	phase: 'phase0-verify' | 'A-reassign' | 'B-delete-section' | 'C-nest';
	action: string;
	targetId: string;
	targetLabel: string;
	status: 'ok' | 'skipped-already-done' | 'skipped-no-op' | 'failed' | 'dry-run' | 'aborted-not-empty';
	detail?: string;
	error?: string;
}

const ledger: LedgerEntry[] = [];

// mvox-app#274 — writeLedger now goes through the shared, redaction-aware
// writer, landing in seed-results/ instead of the retired ledgers/ dir;
// `sensitive: false` (polyphony is synthetic, and this ledger carries only
// ids/status/sharing metadata regardless).
function writeLedger(payload: Record<string, unknown>): string {
	return writeLedgerShared({ scriptName: 'section-cleanup-127-2026-08-13', dryRun: DRY_RUN, db: process.env.ENTU_DATABASE ?? 'polyphony', sensitive: false, payload });
}

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

// -- Phase 0: verify every frozen ID still resolves to the expected name+org -------

async function verifySection(cfg: EntuCfg, ref: SectionRef, label: string): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${ref.id}?props=name,_parent`, cfg.token);
	if (!res.ok) {
		throw new Error(`Phase 0 verify ${label} (${ref.id}): GET failed ${res.status}`);
	}
	const body = (await res.json()) as {
		entity: { name?: Array<{ string: string }>; _parent?: ParentValue[] };
	};
	const liveName = body.entity.name?.[0]?.string;
	const liveOrg = body.entity._parent?.find((p) => p.entity_type === 'organization')?.string;
	if (liveName !== ref.name || liveOrg !== ref.org) {
		throw new Error(
			`Phase 0 verify ${label} (${ref.id}): DRIFT — expected name=${JSON.stringify(ref.name)} org=${JSON.stringify(ref.org)}, ` +
				`found name=${JSON.stringify(liveName)} org=${JSON.stringify(liveOrg)}. Refusing to proceed — re-run investigation.`
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

async function verifyAllSections(cfg: EntuCfg): Promise<void> {
	for (const [key, ref] of Object.entries(SECTIONS)) await verifySection(cfg, ref, key);
	for (const [key, ref] of Object.entries(UNTOUCHED)) await verifySection(cfg, ref, `${key} (untouched)`);
}

// -- Step A: consolidate member section-parent links ------------------------------

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

async function reassignMember(
	cfg: EntuCfg,
	member: MemberEntity,
	retire: SectionRef,
	survivor: SectionRef
): Promise<void> {
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

		// Read-back verify.
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
			status: survivorLink ? 'ok' : 'ok',
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
	for (const { retire, survivor } of RETIRE_TO_SURVIVOR) {
		const members = await fetchMembersLinkedTo(cfg, retire.id);
		console.log(`[A] ${retire.name}/${retire.org} (${retire.id}): ${members.length} member(s) linked -> ${survivor.name}/${survivor.org}`);
		for (const member of members) {
			await reassignMember(cfg, member, retire, survivor);
		}
	}
}

// -- Step C: nest sub-sections under their new parent section ----------------------

async function nestSection(cfg: EntuCfg, child: SectionRef, parent: SectionRef): Promise<void> {
	const label = `${child.name}/${child.org} -> parent ${parent.name}/${parent.org}`;
	const res = await entuFetch(cfg.db, `entity/${child.id}?props=_parent`, cfg.token);
	if (!res.ok) throw new Error(`nestSection(${child.id}): GET failed ${res.status}`);
	const body = (await res.json()) as { entity: { _parent?: ParentValue[] } };
	const alreadyNested = (body.entity._parent ?? []).some((p) => p.reference === parent.id);

	if (alreadyNested) {
		ledger.push({
			phase: 'C-nest',
			action: 'nest-section',
			targetId: child.id,
			targetLabel: label,
			status: 'skipped-already-done'
		});
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

async function stepC_nestHierarchy(cfg: EntuCfg): Promise<void> {
	for (const { child, parent } of NEST_UNDER) {
		console.log(`[C] nesting ${child.name}/${child.org} under ${parent.name}`);
		await nestSection(cfg, child, parent);
	}
}

// -- Step B: delete now-empty retiring sections -------------------------------------

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
		// Verify: subsequent GET should 404.
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

async function stepB_removeOrphans(cfg: EntuCfg): Promise<void> {
	for (const { retire } of RETIRE_TO_SURVIVOR) {
		console.log(`[B] checking ${retire.name}/${retire.org} is empty before delete`);
		await deleteRetiredSection(cfg, retire);
	}
}

// -- Main -----------------------------------------------------------------------

async function main(): Promise<void> {
	console.log(`#127 section cleanup — DRY_RUN=${DRY_RUN}`);
	const cfg = await loadCfg();

	console.log('\n== Phase 0: verify frozen section IDs against live data ==');
	await verifyAllSections(cfg);

	console.log('\n== Step A: consolidate (member reassignment) ==');
	await stepA_consolidate(cfg);

	console.log('\n== Step C: fix hierarchy (nest sub-sections) ==');
	await stepC_nestHierarchy(cfg);

	console.log('\n== Step B: remove orphans (delete now-empty retiring sections) ==');
	await stepB_removeOrphans(cfg);

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
