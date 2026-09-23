// mvox-app#468 review finding F2 — read-only probe, polyphony only, NO writes.
// Team-lead dispatch 2026-09-23: does a member LIST read fold inherited
// `_owner` grants into each row, and does the shape differ from a
// single-entity GET? This probe only issues GETs — the standing live-
// mutation authorization gate (perotin.md "Authorization gate") does not
// apply; team-lead's dispatch itself names the exact queries to run.
//
// Tree note: current working tree sits on feat/468-picker-owner-gate. Per
// team-lead's instruction this script is written but deliberately left
// UNCOMMITTED — team-lead folds it in at the next seam.
//
// Caller identity: db-root token from loadCfg() (creds.ts doc comment —
// resolves to person …8079 / Mihkel). Decoded straight from the JWT
// payload (`accounts[db]`) rather than a second API call.
//
// PII discipline: every _owner value reported here has `.string` stripped
// at extraction — ids only, per project_entu_reference_string_bakes_pii.

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';
import { writeLedger } from '../lib/ledger-writer';

interface OwnerValue {
	reference?: string;
	string?: string;
	[k: string]: unknown;
}

interface MemberRow {
	_id: string;
	person?: Array<{ reference?: string; string?: string }>;
	_owner?: OwnerValue[];
}

function decodeJwtPersonId(jwt: string, db: string): string | undefined {
	const parts = jwt.split('.');
	if (parts.length < 2) return undefined;
	const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
		accounts?: Record<string, string>;
	};
	return payload.accounts?.[db];
}

/** Strip `.string` from a reported owner value; keep every other key so an
 * `inherited` flag (or anything else Entu attaches) is visible if present. */
function stripString(owners: OwnerValue[] | undefined): Array<Record<string, unknown>> {
	return (owners ?? []).map(({ string: _string, ...rest }) => rest);
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	if (cfg.db !== 'polyphony') {
		throw new Error(`refusing: expected polyphony, got '${cfg.db}' — this probe is polyphony-only, no crede`);
	}

	const callerId = decodeJwtPersonId(cfg.token, cfg.db);
	console.log(`caller person id (JWT accounts.${cfg.db}): ${callerId ?? '(none — could not decode)'}`);

	const listRes = await entuFetch(
		cfg.db,
		'entity?_type.string=member&status.string=active&props=person,_owner&limit=5',
		cfg.token
	);
	if (!listRes.ok) throw new Error(`list read failed: HTTP ${listRes.status}`);
	const listBody = (await listRes.json()) as { count?: number; entities?: MemberRow[] };

	if (!listBody.entities || listBody.entities.length === 0) {
		console.log(
			`NO active member rows found under _type.string=member on polyphony (count=${listBody.count ?? 0}). Stopping here — crede not touched.`
		);
		return;
	}

	console.log(`list read: count=${listBody.count}, returned=${listBody.entities.length}`);

	const rows = listBody.entities.map((row) => {
		const owners = stripString(row._owner);
		const ownerRefs = owners.map((o) => o.reference).filter(Boolean) as string[];
		return {
			memberId: row._id,
			personRef: row.person?.[0]?.reference,
			owners,
			callerAppearsInOwner: callerId ? ownerRefs.includes(callerId) : undefined
		};
	});

	for (const r of rows) console.log(JSON.stringify(r));

	const firstId = listBody.entities[0]._id;
	const singleRes = await entuFetch(cfg.db, `entity/${firstId}?props=_owner`, cfg.token);
	if (!singleRes.ok) throw new Error(`single read failed: HTTP ${singleRes.status}`);
	const singleBody = (await singleRes.json()) as { entity?: MemberRow };
	const singleOwners = stripString(singleBody.entity?._owner);

	console.log(`single read (${firstId}) _owner: ${JSON.stringify(singleOwners)}`);
	const shapeMatch = JSON.stringify(rows[0].owners) === JSON.stringify(singleOwners) ? 'IDENTICAL' : 'DIFFERS';
	console.log(`list-vs-single shape match: ${shapeMatch}`);

	const artifactPath = writeLedger({
		scriptName: 'probe-468-member-owner-list-vs-single',
		dryRun: false,
		db: cfg.db,
		sensitive: false,
		authorizedBy: 'team-lead dispatch 2026-09-23 — read-only GETs, no mutation, no live-run authorization gate applicable',
		payload: {
			purpose:
				'mvox-app#468 review finding F2 — does a member LIST read fold inherited _owner grants into each row, and does the shape differ from a single-entity GET?',
			query: 'entity?_type.string=member&status.string=active&props=person,_owner&limit=5',
			callerId,
			callerRole: 'db-root',
			listCount: listBody.count,
			rows,
			singleReadId: firstId,
			singleOwners,
			shapeMatch
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});

// (*MVOX:Perotin*)
