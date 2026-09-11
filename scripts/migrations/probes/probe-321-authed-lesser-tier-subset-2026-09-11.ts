// mvox-app#321 follow-up — authenticated-lesser-tier half of the count-vs-
// rights question, team-lead-authorized live run ("I authorize this run",
// 2026-09-11), polyphony only. Completes the half the read-only
// probe-321-list-count-semantics-2026-09-11.ts explicitly left
// [unverified]: for a caller whose rights admit a SUBSET of a real
// collection (not "everything" like db-root, not "nothing" like the
// genuinely anonymous tier already confirmed clean), does the server's
// `count` report the caller's own visible subset, or does it leak the raw
// total?
//
// Rig (minimal footprint, `_probe_321_*` naming per team-lead's ask):
//   - 1 container entity (`_probe_321_container`, person-typed for zero
//     schema footprint, `_sharing: private`, parented at the db entity)
//   - 3 children under it (`_probe_321_child_{1,2,3}`, same type/sharing)
//   - 1 throwaway tester person (`_probe_321_tester`, parented DIRECTLY at
//     the db entity — NOT under the container, so it is never itself a
//     sibling the collection query would count)
//   - a fresh `entu_api_key` minted on the tester (wire-shape note from
//     probe-294: `{type:'entu_api_key', string:''}`, NOT a bare
//     `{type:'entu_api_key'}` — that 400s live; raw key never logged)
//   - a DIRECT `_viewer` grant on child 1 and child 2 ONLY — child 3 gets
//     no grant of any kind for the tester. This is the actual subset: the
//     tester should see exactly 2 of the 3 children if rights are honored
//     at the entity-admission level, and the collection's raw total is 3.
//
// Query asked as BOTH callers: `_type.string=person&_parent.reference=
// <containerId>&props=name&limit=50` — the same `_parent.reference`-scoped
// shape already confirmed truncation-safe in the sibling probe. The
// db-root read is the control (must show count=3, entities=3, all
// children). The tester read is the actual test: count=2 (respects the
// grant-admitted subset, matches the already-clean anonymous-tier finding)
// vs count=3 (raw total leaking the existence of child 3 to a caller who
// cannot read it).
//
// Teardown: DELETE all 5 created entities (children, container, tester —
// order doesn't matter, DELETE /entity/{id} removes the entity and every
// property on it, including the rights grants, in one call). Independently
// re-verified via fresh GETs on all 5 ids after cleanup (expect 404 each).
// No `_viewer` grant needs a separate DELETE — deleting the graded child
// entity outright removes it.

import { entuFetch } from '$lib/entu/request';
import { resolveTypeId } from '$lib/seasons/entuSeasons';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { loadCfg } from '../lib/creds';
import { readDryRun } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';

const DRY_RUN = readDryRun();

interface ReadResult {
	query: string;
	status: number;
	count: number | undefined;
	entities: Array<{ _id: string; name?: Array<{ string?: string }> }>;
}

async function readAs(db: string, token: string, query: string): Promise<ReadResult> {
	const res = await entuFetch(db, `entity?${query}`, token);
	const body = (await res.json().catch(() => null)) as { count?: number; entities?: Array<{ _id: string; name?: Array<{ string?: string }> }> } | null;
	return { query, status: res.status, count: body?.count, entities: body?.entities ?? [] };
}

async function createEntity(db: string, token: string, name: string, typeId: string, parentId: string): Promise<string> {
	const res = await entuFetch(db, 'entity', token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify([
			{ type: '_type', reference: typeId },
			{ type: '_parent', reference: parentId },
			{ type: 'name', string: name },
			{ type: '_sharing', string: 'private' }
		])
	});
	if (!res.ok) throw new Error(`createEntity(${name}) failed: HTTP ${res.status}`);
	const body = (await res.json()) as { _id?: string };
	if (!body._id) throw new Error(`createEntity(${name}) returned 2xx with no _id`);
	return body._id;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const ledger: Array<{ step: string; outcome: string; [k: string]: unknown }> = [];

	const personTypeId = await resolveTypeId(cfg, 'person');
	const dbEntityId = await resolveDatabaseEntityId(cfg);
	if (!dbEntityId) throw new Error('no database entity readable — cannot proceed');
	console.log(`person type-def: ${personTypeId}, db entity: ${dbEntityId}`);

	if (DRY_RUN) {
		console.log('\nWould create 1 container + 3 children (all _sharing:private) + 1 tester person, mint an entu_api_key on the tester, grant DIRECT _viewer on children 1+2 only (child 3 gets nothing), read the container\'s children as db-root (control) and as the tester (test), then delete all 5 entities and re-verify gone.');
		ledger.push({ step: 'dry-run', outcome: 'dry-run-would-run' });
	} else {
		const createdIds: string[] = [];
		try {
			const containerId = await createEntity(cfg.db, cfg.token, '_probe_321_container', personTypeId, dbEntityId);
			createdIds.push(containerId);
			console.log(`container: ${containerId}`);
			ledger.push({ step: 'create-container', outcome: 'created', id: containerId });

			const childIds: string[] = [];
			for (let i = 1; i <= 3; i++) {
				const id = await createEntity(cfg.db, cfg.token, `_probe_321_child_${i}`, personTypeId, containerId);
				createdIds.push(id);
				childIds.push(id);
				console.log(`  child ${i}: ${id}`);
			}
			ledger.push({ step: 'create-children', outcome: 'created', ids: childIds });

			const testerId = await createEntity(cfg.db, cfg.token, '_probe_321_tester', personTypeId, dbEntityId);
			createdIds.push(testerId);
			console.log(`tester: ${testerId}`);
			ledger.push({ step: 'create-tester', outcome: 'created', id: testerId });

			// Mint entu_api_key on the tester. Wire-shape per probe-294:
			// a bare {type:'entu_api_key'} 400s ("must have at least one
			// value") — {type:'entu_api_key', string:''} works and the
			// server ignores the empty string, generating the real key.
			const keyRes = await entuFetch(cfg.db, `entity/${testerId}`, cfg.token, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([{ type: 'entu_api_key', string: '' }])
			});
			if (!keyRes.ok) throw new Error(`api-key mint failed: HTTP ${keyRes.status}`);
			const keyBody = (await keyRes.json()) as { properties?: Array<{ type?: string; string?: string }> };
			const rawKey = (keyBody.properties ?? []).find((p) => p.type === 'entu_api_key')?.string;
			if (!rawKey) throw new Error('api-key mint: 2xx with no key in response — apparent-success trap');
			console.log('entu_api_key minted on tester (never logged/persisted)');
			ledger.push({ step: 'mint-tester-key', outcome: 'minted', testerId, note: 'raw key never logged' });

			// Grant DIRECT _viewer on children 1+2 ONLY — child 3 gets nothing.
			for (const childId of [childIds[0], childIds[1]]) {
				const grantRes = await entuFetch(cfg.db, `entity/${childId}`, cfg.token, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify([{ type: '_viewer', reference: testerId }])
				});
				if (!grantRes.ok) throw new Error(`grant _viewer on ${childId} failed: HTTP ${grantRes.status}`);
			}
			console.log(`_viewer granted to tester on child 1 (${childIds[0]}) + child 2 (${childIds[1]}) ONLY — child 3 (${childIds[2]}) gets no grant.`);
			ledger.push({ step: 'grant-viewer-subset', outcome: 'granted', grantedTo: [childIds[0], childIds[1]], notGranted: childIds[2] });

			// Exchange tester's key for a JWT.
			const authRes = await fetch(`https://api.entu.app/auth?db=${cfg.db}`, { headers: { Authorization: `Bearer ${rawKey}`, Accept: 'application/json' } });
			const authBody = (await authRes.json()) as { token?: string };
			if (!authBody.token) throw new Error('tester auth exchange failed or returned no token');
			const testerToken = authBody.token;
			ledger.push({ step: 'tester-auth-exchange', outcome: authRes.ok ? 'ok' : 'failed', status: authRes.status });

			const query = `_type.string=person&_parent.reference=${containerId}&props=name&limit=50`;

			// Control: db-root read — must show the raw total (3, all children).
			const rootRead = await readAs(cfg.db, cfg.token, query);
			console.log(`\nCONTROL (db-root) — query: ${query}`);
			console.log(`  HTTP ${rootRead.status}  count=${rootRead.count}  entities=[${rootRead.entities.map((e) => e._id).join(', ')}] (len=${rootRead.entities.length})`);
			ledger.push({ step: 'read-as-db-root', outcome: String(rootRead.status), query, count: rootRead.count, entityIds: rootRead.entities.map((e) => e._id), entitiesLength: rootRead.entities.length });

			// Test: tester read — direct _viewer on exactly 2 of 3.
			const testerRead = await readAs(cfg.db, testerToken, query);
			console.log(`\nTEST (tester, direct _viewer on 2 of 3) — same query`);
			console.log(`  HTTP ${testerRead.status}  count=${testerRead.count}  entities=[${testerRead.entities.map((e) => e._id).join(', ')}] (len=${testerRead.entities.length})`);
			ledger.push({ step: 'read-as-tester', outcome: String(testerRead.status), query, count: testerRead.count, entityIds: testerRead.entities.map((e) => e._id), entitiesLength: testerRead.entities.length });

			const respectsSubset = testerRead.count === testerRead.entities.length && testerRead.count === 2;
			const leaksRawTotal = testerRead.count === rootRead.count && rootRead.count !== testerRead.entities.length;
			const verdict = respectsSubset && !leaksRawTotal ? 'CONFIRMED-NO-LEAK-count-matches-caller-visible-subset' : leaksRawTotal ? 'LEAK-CONFIRMED-count-is-raw-total' : 'UNEXPECTED-SHAPE';
			console.log(`\nVERDICT: ${verdict}`);
			console.log(verdict.startsWith('CONFIRMED')
				? '>> For a caller whose rights admit a SUBSET of a collection, count reports the CALLER-VISIBLE subset (2), never the raw total (3). A "showing N of count" notice is safe to display real numbers for a member-tier viewer under this same mechanism.'
				: verdict.startsWith('LEAK')
					? '>> LEAK: count reported the raw total (3) even though the tester could only see 2 entities — a partial notice built on count would disclose the existence of rows the viewer has no rights to read.'
					: '>> Shape did not match either expected outcome — see raw read results.');
			ledger.push({ step: 'verdict', outcome: verdict, control: { count: rootRead.count, entitiesLength: rootRead.entities.length }, tester: { count: testerRead.count, entitiesLength: testerRead.entities.length } });

			// ─── Teardown ──────────────────────────────────────────────────
			console.log('\n=== Teardown ===');
			for (const id of createdIds) {
				const delRes = await entuFetch(cfg.db, `entity/${id}`, cfg.token, { method: 'DELETE' });
				console.log(`  DELETE ${id}: ${delRes.ok ? 'OK' : `FAILED (${delRes.status})`}`);
				ledger.push({ step: `delete-${id}`, outcome: delRes.ok ? 'deleted' : 'delete-failed', status: delRes.status });
			}
			console.log('\n=== Independent re-verify (fresh GETs, expect 404 on all) ===');
			let allGone = true;
			for (const id of createdIds) {
				const verifyRes = await entuFetch(cfg.db, `entity/${id}`, cfg.token, {});
				const gone = verifyRes.status === 404;
				allGone = allGone && gone;
				console.log(`  GET ${id}: HTTP ${verifyRes.status} (expect 404) — ${gone ? 'gone' : 'STILL PRESENT'}`);
				ledger.push({ step: `verify-gone-${id}`, outcome: String(verifyRes.status), expected: 404, gone });
			}
			console.log(allGone ? '\nAll 5 fixtures confirmed gone — zero residue.' : '\n!! ORPHAN DETECTED — see verify-gone entries above.');
			ledger.push({ step: 'teardown-summary', outcome: allGone ? 'zero-residue' : 'ORPHAN-DETECTED' });
		} catch (err) {
			console.error('FATAL mid-run — attempting best-effort cleanup of anything created so far:', err);
			for (const id of createdIds) {
				await entuFetch(cfg.db, `entity/${id}`, cfg.token, { method: 'DELETE' }).catch(() => {});
			}
			throw err;
		}
	}

	const artifactPath = writeLedger({
		scriptName: 'probe-321-authed-lesser-tier-subset',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'mvox-app#321 — authenticated-lesser-tier half: for a caller whose rights admit a SUBSET of a real collection (direct _viewer on 2 of 3 children), does count report the caller-visible subset or the raw total? Completes the [unverified] half left open by probe-321-list-count-semantics-2026-09-11.ts (anonymous tier was already confirmed clean).',
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
