// mvox-app#470 review finding — read-only probe, polyphony only, NO writes.
//
// Team-lead dispatch 2026-09-24: Bentham's #470 review found the roster fails
// to render on a member row that carries the same section id twice in
// `_parent`. Last session's live check may have written one. This probe only
// issues GETs — the standing live-mutation authorization gate (perotin.md
// "Authorization gate") does not apply; team-lead's dispatch names the exact
// query to run.
//
// PII discipline: the ledger (tracked, committed to git) carries ids only —
// `.string` is stripped at extraction per project_entu_reference_string_bakes_pii
// (ER-26). Human-readable names for the chat report are read from stdout by
// the caller, never persisted to the tracked artifact.

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';
import { writeLedger } from '../lib/ledger-writer';

interface RefValue {
	reference?: string;
	string?: string;
	[k: string]: unknown;
}

interface MemberRow {
	_id: string;
	person?: RefValue[];
	_parent?: RefValue[];
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	if (cfg.db !== 'polyphony') {
		throw new Error(`refusing: expected polyphony, got '${cfg.db}' — this probe is polyphony-only, no crede`);
	}

	const listRes = await entuFetch(
		cfg.db,
		'entity?_type.string=member&status.string=active&props=person,_parent&limit=2000',
		cfg.token
	);
	if (!listRes.ok) throw new Error(`list read failed: HTTP ${listRes.status}`);
	const listBody = (await listRes.json()) as { count?: number; entities?: MemberRow[] };
	const rows = listBody.entities ?? [];

	console.log(`list read: count=${listBody.count}, returned=${rows.length}`);
	if ((listBody.count ?? 0) > rows.length) {
		throw new Error(
			`incomplete read: count=${listBody.count} exceeds returned=${rows.length} at limit=2000 — raise the limit before trusting this sweep`
		);
	}

	const dupes: Array<{
		memberId: string;
		personRef?: string;
		personName?: string;
		sectionRef: string;
		sectionName?: string;
		occurrences: number;
	}> = [];

	for (const row of rows) {
		const parents = row._parent ?? [];
		const byRef = new Map<string, RefValue[]>();
		for (const p of parents) {
			if (!p.reference) continue;
			const group = byRef.get(p.reference) ?? [];
			group.push(p);
			byRef.set(p.reference, group);
		}
		for (const [ref, group] of byRef) {
			if (group.length > 1) {
				dupes.push({
					memberId: row._id,
					personRef: row.person?.[0]?.reference,
					personName: row.person?.[0]?.string,
					sectionRef: ref,
					sectionName: group[0].string,
					occurrences: group.length
				});
			}
		}
	}

	console.log(`\nduplicate _parent rows found: ${dupes.length}`);
	for (const d of dupes) {
		console.log(JSON.stringify(d));
	}

	const artifactPath = writeLedger({
		scriptName: 'probe-470-duplicate-parent-member',
		dryRun: false,
		db: cfg.db,
		sensitive: false,
		authorizedBy: 'team-lead dispatch 2026-09-24 — read-only GET, no mutation, no live-run authorization gate applicable',
		payload: {
			purpose:
				'mvox-app#470 review — find member rows whose _parent array carries the same section/org id more than once (roster render failure).',
			query: 'entity?_type.string=member&status.string=active&props=person,_parent&limit=2000',
			listCount: listBody.count,
			returned: rows.length,
			duplicateCount: dupes.length,
			duplicates: dupes.map(({ memberId, personRef, sectionRef, occurrences }) => ({
				memberId,
				personRef,
				sectionRef,
				occurrences
			}))
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});

// (*MVOX:Perotin*)
