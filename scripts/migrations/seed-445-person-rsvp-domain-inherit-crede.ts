// #445: every crede `person` and `rsvp` gets `_sharing: domain` and `_inheritrights: true`.
// Authorized by Mihkel's ruling, 2026-09-22 10:14 UTC (team console, confirmed on #445).
// Censuses are flat, never walking children, so profiles (`_inheritrights: false`) stay private.

// Writing a rights-type property needs `_owner`, so the rights preflight checks `_owner` only.
// A prior value is DELETEd by `_id` before the POST: these properties replace, not append.
// The run stops, dry run too, unless the moving set is exactly one person and their rsvps.

// Dry-run first: node --import tsx --import ./scripts/migrations/lib/register-loader.mjs <file>
// Live: DRY_RUN=false AUTHORIZED_BY='...', only after a verified dry run and authorization.

import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';
import { resolveMetaTypeIds, resolveTypeIdByName } from './lib/ensure-schema-type';
import { readDryRun, loadCredeCfg, readAuthorizedBy } from './lib/script-runner';
import { writeLedger as writeLedgerShared, assertLiveRunAuthorized } from './lib/ledger-writer';

type EntityType = 'person' | 'rsvp';
type Tier = 'private' | 'public' | 'domain' | 'absent';

interface CensusEntity {
	_id: string;
	_sharing?: Array<{ _id: string; string?: string }>;
	_inheritrights?: Array<{ _id: string; boolean?: boolean }>;
	_owner?: Array<{ reference?: string }>;
	_editor?: Array<{ reference?: string }>;
	_parent?: Array<{ reference?: string }>;
}

interface Classified {
	id: string;
	type: EntityType;
	parentId?: string; // rsvp only
	sharingValueId?: string;
	currentSharing: Tier;
	needsSharing: boolean;
	inheritValueId?: string;
	currentInherit: boolean | 'absent';
	needsInherit: boolean;
}

export interface TypeVisibility {
	typeCap: Tier;
	capBlocksProjection: boolean;
	domainVisiblePropDefNames: string[];
}

export interface TypeCounts {
	total: number;
	alreadyDomain: number;
	needsSharing: number;
	fromPrivate: number;
	fromPublic: number;
	fromAbsent: number;
	alreadyInherit: number;
	needsInherit: number;
	toWrite: number;
	written?: number;
	wouldWrite?: number;
	failed: number;
	/** Written rows where a hidden earlier value was found and self-healed. Live runs only. */
	preExistingHidden?: number;
}

export interface RunSeed445Counts {
	person: TypeCounts;
	rsvp: TypeCounts;
}

export interface MovingRow {
	id: string;
	type: EntityType;
	fromSharing: Tier;
}

export interface RunSeed445Result {
	counts: RunSeed445Counts;
	visibility: { person: TypeVisibility; rsvp: TypeVisibility };
	movingSet: MovingRow[];
	movingPersonIdentityCount: number;
	widerThanExpected: boolean;
	rerun: boolean;
	ledgerPath: string;
	/** Delayed re-read of every row this run wrote; [] when nothing was written. */
	postRunRecheck: RecheckRow[];
}

// ids/counts/tiers/prop-def-names only — no DEFAULT_REDACT_FIELDS member,
// no `string` (the Entu wrapper key), never a member value.
export const COMMITTED_ALLOW = [
	'dryRun',
	'rerun',
	'counts',
	'person',
	'rsvp',
	'total',
	'alreadyDomain',
	'needsSharing',
	'fromPrivate',
	'fromPublic',
	'fromAbsent',
	'alreadyInherit',
	'needsInherit',
	'toWrite',
	'written',
	'wouldWrite',
	'failed',
	'writtenIds',
	'wouldWriteIds',
	'failedIds',
	'outcome',
	'id',
	'type',
	'fromSharing',
	'currentSharing',
	'currentInherit',
	'noRights',
	'multiValue',
	'sharingCount',
	'inheritCount',
	'visibility',
	'typeCap',
	'capBlocksProjection',
	'domainVisiblePropDefNames',
	'movingSet',
	'movingPersonIdentityCount',
	'widerThanExpected',
	'profileOverlap',
	// Failure-diagnostic fields: ids, statuses and structure only. 'string' is excluded from the
	// committed twin regardless; full detail stays in the gitignored instance ledger.
	'failureDiagnostics',
	'entityId',
	'sharingPost',
	'inheritPost',
	'readback',
	'sharingPropertyProbe',
	'inheritPropertyProbe',
	'requestBody',
	'status',
	'body',
	'propertyId',
	'properties',
	'_id',
	'entity',
	'created',
	'at',
	'by',
	'boolean',
	// Entu's own leaf keys inside readback/recheck bodies: 'body'/'entity' admit only the
	// container, so without these the twin would drop `_sharing`/`_inheritrights`.
	'_sharing',
	'_inheritrights',
	// Each written row's returned property ids, and the delayed recheck that catches a reversion.
	'writtenPropertyIds',
	'sharingPropertyId',
	'inheritPropertyId',
	'postRunRecheck',
	'stillCorrect',
	// Rows where a hidden earlier value was self-healed.
	'preExistingHiddenIds',
	'preExistingHidden',
	'sharingSelfHealDelete',
	'inheritSelfHealDelete',
	'selfHealReadback'
] as const;

/** Parse a body as JSON, tolerating non-JSON: diagnostics must never throw themselves. */
async function safeJson(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		return null;
	}
}

/** The property `_id` a POST response returned for `propType`, if any. */
function extractPostedPropertyId(diag: Record<string, unknown>, postField: 'sharingPost' | 'inheritPost', propType: string): string | undefined {
	const post = diag[postField] as { body?: { properties?: Array<{ _id?: string; type?: string }> } } | undefined;
	return post?.body?.properties?.find((p) => p.type === propType)?._id;
}

/** Real by default; injectable so the spec never actually waits. */
function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RecheckRow {
	id: string;
	status: number;
	_sharing: unknown;
	_inheritrights: unknown;
	stillCorrect: boolean;
}

// Re-reads every row this run wrote after `delayMs`, catching a reversion that shows up
// moments after a passing read-back. Runs whether the calling loop succeeded or threw.
async function recheckWrittenRows(
	cfg: EntuCfg,
	ids: string[],
	fetchImpl: typeof fetch,
	delayMs: number,
	sleepFn: (ms: number) => Promise<void>
): Promise<RecheckRow[]> {
	if (ids.length === 0) return [];
	await sleepFn(delayMs);
	const rows: RecheckRow[] = [];
	for (const id of ids) {
		const res = await entuFetch(cfg.db, `entity/${id}?props=_sharing,_inheritrights`, cfg.token, {}, fetchImpl);
		const body = (await safeJson(res)) as {
			entity?: { _sharing?: Array<{ string?: string }>; _inheritrights?: Array<{ boolean?: boolean }> };
		} | null;
		const sharing = body?.entity?._sharing ?? [];
		const inheritrights = body?.entity?._inheritrights ?? [];
		const stillCorrect = sharing.length === 1 && sharing[0]?.string === 'domain' && inheritrights.length === 1 && inheritrights[0]?.boolean === true;
		rows.push({ id, status: res.status, _sharing: sharing, _inheritrights: inheritrights, stillCorrect });
	}
	return rows;
}

function tierOf(sharingString: string | undefined): Tier {
	if (sharingString === 'domain' || sharingString === 'public' || sharingString === 'private') return sharingString;
	return 'absent';
}

async function censusType(cfg: EntuCfg, type: EntityType, fetchImpl: typeof fetch): Promise<CensusEntity[]> {
	const props = type === 'rsvp' ? '_sharing,_inheritrights,_owner,_editor,_parent' : '_sharing,_inheritrights,_owner,_editor';
	const res = await entuFetch(cfg.db, `entity?_type.string=${type}&props=${props}&limit=10000`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`runSeed445: census GET for '${type}' failed: ${res.status}`);
	const body = (await res.json()) as { count: number; entities: CensusEntity[] };
	if (body.count !== body.entities.length) {
		throw new Error(`runSeed445: census truncated for '${type}' -- count=${body.count} entities=${body.entities.length}. Raise limit.`);
	}
	return body.entities;
}

/** Read-only: the ids of every `profile` entity — the scope fence's second, independent check. */
async function censusProfileIds(cfg: EntuCfg, fetchImpl: typeof fetch): Promise<Set<string>> {
	const res = await entuFetch(cfg.db, `entity?_type.string=profile&props=_id&limit=10000`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`runSeed445: profile census GET failed: ${res.status}`);
	const body = (await res.json()) as { count: number; entities: Array<{ _id: string }> };
	if (body.count !== body.entities.length) {
		throw new Error(`runSeed445: profile census truncated -- count=${body.count} entities=${body.entities.length}. Raise limit.`);
	}
	return new Set(body.entities.map((e) => e._id));
}

/** Schema metadata only: the type-def's `_sharing` cap and each prop-def's `_sharing`. */
async function readTypeVisibility(
	cfg: EntuCfg,
	propertyMetaTypeId: string,
	typeId: string,
	fetchImpl: typeof fetch
): Promise<TypeVisibility> {
	const capRes = await entuFetch(cfg.db, `entity/${typeId}?props=_sharing`, cfg.token, {}, fetchImpl);
	if (!capRes.ok) throw new Error(`runSeed445: type-def _sharing GET failed for ${typeId}: ${capRes.status}`);
	const capBody = (await capRes.json()) as { entity?: { _sharing?: Array<{ string?: string }> } };
	const typeCap = tierOf(capBody.entity?._sharing?.[0]?.string);
	const capBlocksProjection = typeCap !== 'domain' && typeCap !== 'public';

	const propDefsRes = await entuFetch(
		cfg.db,
		`entity?_type.reference=${propertyMetaTypeId}&_parent.reference=${typeId}&props=name,_sharing&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!propDefsRes.ok) throw new Error(`runSeed445: prop-def list GET failed for type ${typeId}: ${propDefsRes.status}`);
	const propDefsBody = (await propDefsRes.json()) as {
		entities?: Array<{ name?: Array<{ string?: string }>; _sharing?: Array<{ string?: string }> }>;
	};
	const propDefs = propDefsBody.entities ?? [];
	const domainVisiblePropDefNames = capBlocksProjection
		? []
		: propDefs
				.filter((p) => {
					const t = tierOf(p._sharing?.[0]?.string);
					return t === 'domain' || t === 'public';
				})
				.map((p) => p.name?.[0]?.string)
				.filter((n): n is string => !!n)
				.sort();

	return { typeCap, capBlocksProjection, domainVisiblePropDefNames };
}

export async function runSeed445(
	cfg: EntuCfg & { userId: string },
	dryRun: boolean,
	fetchImpl: typeof fetch = fetch,
	authorizedBy?: string,
	recheckDelayMs = 30_000,
	sleepFn: (ms: number) => Promise<void> = defaultSleep
): Promise<RunSeed445Result> {
	// mvox-app#417 — before any census GET, before any request leaves the script.
	assertLiveRunAuthorized(dryRun, authorizedBy);

	const { entityMetaTypeId, propertyMetaTypeId } = await resolveMetaTypeIds(cfg, fetchImpl);
	const personTypeId = await resolveTypeIdByName(cfg, entityMetaTypeId, 'person', fetchImpl);
	const rsvpTypeId = await resolveTypeIdByName(cfg, entityMetaTypeId, 'rsvp', fetchImpl);
	const personVisibility = await readTypeVisibility(cfg, propertyMetaTypeId, personTypeId, fetchImpl);
	const rsvpVisibility = await readTypeVisibility(cfg, propertyMetaTypeId, rsvpTypeId, fetchImpl);

	const personEntities = await censusType(cfg, 'person', fetchImpl);
	const rsvpEntities = await censusType(cfg, 'rsvp', fetchImpl);
	const profileIds = await censusProfileIds(cfg, fetchImpl);

	const multiValue: Array<{ id: string; type: EntityType; sharingCount: number; inheritCount: number }> = [];
	const classified: Classified[] = [];

	for (const [type, entities] of [
		['person', personEntities],
		['rsvp', rsvpEntities]
	] as const) {
		for (const entity of entities) {
			const sharingValues = entity._sharing ?? [];
			const inheritValues = entity._inheritrights ?? [];
			if (sharingValues.length > 1 || inheritValues.length > 1) {
				multiValue.push({ id: entity._id, type, sharingCount: sharingValues.length, inheritCount: inheritValues.length });
				continue;
			}
			const sharingValue = sharingValues[0];
			const inheritValue = inheritValues[0];
			const currentSharing = tierOf(sharingValue?.string);
			const currentInherit: boolean | 'absent' = inheritValue?.boolean ?? 'absent';
			classified.push({
				id: entity._id,
				type,
				parentId: type === 'rsvp' ? entity._parent?.[0]?.reference : undefined,
				sharingValueId: sharingValue?._id,
				currentSharing,
				needsSharing: currentSharing !== 'domain',
				inheritValueId: inheritValue?._id,
				currentInherit,
				needsInherit: currentInherit !== true
			});
		}
	}

	const writtenIds: string[] = [];
	const failedIds: string[] = [];
	// One entry per failed entity: request bodies, POST and read-back responses, and a GET of any
	// property `_id` a POST returned, so "POST said ok but nothing persisted" shows in the ledger.
	// Ids, statuses and structure only.
	const failureDiagnostics: Array<Record<string, unknown>> = [];
	// Every written row's returned property ids.
	const writtenPropertyIds: Array<{ id: string; sharingPropertyId?: string; inheritPropertyId?: string }> = [];
	// Rows where a hidden earlier value was self-healed mid-write: a subset of writtenIds, listed
	// apart so the ledger shows the anomaly without calling it a failure.
	const preExistingHiddenIds: string[] = [];
	let aborted = false;

	function toWriteList(): Classified[] {
		return classified.filter((c) => c.needsSharing || c.needsInherit);
	}

	function buildCounts(): RunSeed445Counts {
		function forType(type: EntityType): TypeCounts {
			const rows = classified.filter((c) => c.type === type);
			const needsSharingRows = rows.filter((c) => c.needsSharing);
			const toWriteRows = rows.filter((c) => c.needsSharing || c.needsInherit);
			return {
				total: rows.length + multiValue.filter((m) => m.type === type).length,
				alreadyDomain: rows.filter((c) => !c.needsSharing).length,
				needsSharing: needsSharingRows.length,
				fromPrivate: needsSharingRows.filter((c) => c.currentSharing === 'private').length,
				fromPublic: needsSharingRows.filter((c) => c.currentSharing === 'public').length,
				fromAbsent: needsSharingRows.filter((c) => c.currentSharing === 'absent').length,
				alreadyInherit: rows.filter((c) => !c.needsInherit).length,
				needsInherit: rows.filter((c) => c.needsInherit).length,
				toWrite: toWriteRows.length,
				failed: failedIds.filter((id) => toWriteRows.some((r) => r.id === id)).length,
				...(dryRun || aborted
					? { wouldWrite: toWriteRows.length }
					: {
							written: writtenIds.filter((id) => toWriteRows.some((r) => r.id === id)).length,
							preExistingHidden: preExistingHiddenIds.filter((id) => toWriteRows.some((r) => r.id === id)).length
						})
			};
		}
		return { person: forType('person'), rsvp: forType('rsvp') };
	}

	function buildMovingSet(): MovingRow[] {
		return toWriteList().map((c) => ({ id: c.id, type: c.type, fromSharing: c.currentSharing }));
	}

	function movingPersonIdentities(): Set<string> {
		const set = new Set<string>();
		for (const c of toWriteList()) {
			if (c.type === 'person') set.add(c.id);
			else if (c.parentId) set.add(c.parentId);
		}
		return set;
	}

	function isRerun(): boolean {
		const writeCount = dryRun ? toWriteList().length : writtenIds.length;
		return writeCount === 0 && failedIds.length === 0 && classified.length + multiValue.length > 0;
	}

	function writeLedgerNow(extra: Record<string, unknown> = {}): string {
		const identities = movingPersonIdentities();
		return writeLedgerShared({
			scriptName: 'seed-445-person-rsvp-domain-inherit-crede',
			dryRun,
			db: cfg.db,
			sensitive: true,
			authorizedBy,
			committed: { allow: COMMITTED_ALLOW },
			payload: {
				dryRun,
				rerun: isRerun(),
				counts: buildCounts(),
				visibility: { person: personVisibility, rsvp: rsvpVisibility },
				movingSet: buildMovingSet(),
				movingPersonIdentityCount: identities.size,
				widerThanExpected: identities.size > 1,
				...(dryRun || aborted
					? { wouldWriteIds: toWriteList().map((c) => c.id) }
					: { writtenIds, writtenPropertyIds, preExistingHiddenIds }),
				failedIds,
				...extra
			}
		});
	}

	if (multiValue.length > 0) {
		aborted = true;
		const path = writeLedgerNow({ outcome: 'aborted-multi-value', multiValue });
		throw new Error(
			`runSeed445: ${multiValue.length} entity(ies) hold more than one _sharing/_inheritrights value -- stopping before any write: ${multiValue.map((m) => m.id).join(', ')} (ledger: ${path})`
		);
	}

	// Scope fence 1/2 — profile entities must never appear in the write plan,
	// even though the census never queries `_type.string=profile` at all.
	const toWriteIdsNow = toWriteList().map((c) => c.id);
	const profileOverlap = toWriteIdsNow.filter((id) => profileIds.has(id));
	if (profileOverlap.length > 0) {
		aborted = true;
		const path = writeLedgerNow({ outcome: 'aborted-profile-overlap', profileOverlap });
		throw new Error(
			`runSeed445: ${profileOverlap.length} entity(ies) in the write plan are ALSO profile ids -- refusing to proceed: ${profileOverlap.join(', ')} (ledger: ${path})`
		);
	}

	// Scope fence 2/2 — Mihkel's stated expectation: the moving set is exactly one person and
	// their rsvps. Anything wider is reported and stopped, dry run included.
	const identityCount = movingPersonIdentities().size;
	if (identityCount > 1) {
		aborted = true;
		const path = writeLedgerNow({ outcome: 'aborted-wider-than-expected' });
		throw new Error(
			`runSeed445: the moving set spans ${identityCount} distinct person identities -- Mihkel expects exactly one (his own person + his own rsvps) -- stopping before any write, reporting the moving set (ledger: ${path})`
		);
	}

	// ER-11 rights preflight — _owner ONLY (rights-type property writes
	// require _owner, not _editor). Runs on the dry run too.
	const noRights: Array<{ id: string; type: EntityType }> = [];
	const personById = new Map(personEntities.map((e) => [e._id, e]));
	const rsvpById = new Map(rsvpEntities.map((e) => [e._id, e]));
	for (const entity of toWriteList()) {
		const source = entity.type === 'person' ? personById.get(entity.id) : rsvpById.get(entity.id);
		const ownerRefs = (source?._owner ?? []).map((r) => r.reference);
		if (!ownerRefs.includes(cfg.userId)) noRights.push({ id: entity.id, type: entity.type });
	}
	if (noRights.length > 0) {
		aborted = true;
		const path = writeLedgerNow({ outcome: 'aborted-rights', noRights });
		throw new Error(
			`runSeed445: rights preflight failed for ${noRights.length} entity(ies) -- the runner is absent from _owner -- stopping before any write: ${noRights.map((n) => n.id).join(', ')} (ledger: ${path})`
		);
	}

	if (dryRun) {
		const ledgerPath = writeLedgerNow();
		return {
			counts: buildCounts(),
			visibility: { person: personVisibility, rsvp: rsvpVisibility },
			movingSet: buildMovingSet(),
			movingPersonIdentityCount: identityCount,
			widerThanExpected: identityCount > 1,
			rerun: isRerun(),
			ledgerPath,
			postRunRecheck: []
		};
	}

	for (const entity of toWriteList()) {
		// Filled as each step completes; attached to the ledger if this entity fails.
		const diag: Record<string, unknown> = { entityId: entity.id };
		try {
			if (entity.needsSharing) {
				const requestBody = [{ type: '_sharing', string: 'domain' }];
				if (entity.sharingValueId) {
					const delRes = await entuFetch(cfg.db, `property/${entity.sharingValueId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
					if (!delRes.ok) throw new Error(`DELETE _sharing property/${entity.sharingValueId} failed: ${delRes.status}`);
				}
				const postRes = await entuFetch(
					cfg.db,
					`entity/${entity.id}`,
					cfg.token,
					{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) },
					fetchImpl
				);
				const postBody = await safeJson(postRes);
				diag.sharingPost = { requestBody, status: postRes.status, body: postBody };
				if (!postRes.ok) throw new Error(`POST _sharing entity/${entity.id} failed: ${postRes.status}`);
			}
			if (entity.needsInherit) {
				const requestBody = [{ type: '_inheritrights', boolean: true }];
				if (entity.inheritValueId) {
					const delRes = await entuFetch(cfg.db, `property/${entity.inheritValueId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
					if (!delRes.ok) throw new Error(`DELETE _inheritrights property/${entity.inheritValueId} failed: ${delRes.status}`);
				}
				const postRes = await entuFetch(
					cfg.db,
					`entity/${entity.id}`,
					cfg.token,
					{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) },
					fetchImpl
				);
				const postBody = await safeJson(postRes);
				diag.inheritPost = { requestBody, status: postRes.status, body: postBody };
				if (!postRes.ok) throw new Error(`POST _inheritrights entity/${entity.id} failed: ${postRes.status}`);
			}

			const readRes = await entuFetch(cfg.db, `entity/${entity.id}?props=_sharing,_inheritrights`, cfg.token, {}, fetchImpl);
			type ReadBody = { entity?: { _sharing?: Array<{ _id?: string; string?: string }>; _inheritrights?: Array<{ _id?: string; boolean?: boolean }> } } | null;
			const readBody = (await safeJson(readRes)) as ReadBody;
			diag.readback = { status: readRes.status, body: readBody };
			if (!readRes.ok) throw new Error(`read-back GET for ${entity.id} failed: ${readRes.status}`);
			let sharingVals = readBody?.entity?._sharing ?? [];
			let inheritVals = readBody?.entity?._inheritrights ?? [];

			// A hidden earlier value: a prior write persisted invisibly and reappears beside this run's
			// POST (seen live twice). Delete only the id this run's own POST returned, re-read, and let
			// the checks below judge what's left.
			let selfHealed = false;
			if (sharingVals.length > 1) {
				const postedId = extractPostedPropertyId(diag, 'sharingPost', '_sharing');
				if (postedId) {
					selfHealed = true;
					const delRes = await entuFetch(cfg.db, `property/${postedId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
					diag.sharingSelfHealDelete = { propertyId: postedId, status: delRes.status };
				}
			}
			if (inheritVals.length > 1) {
				const postedId = extractPostedPropertyId(diag, 'inheritPost', '_inheritrights');
				if (postedId) {
					selfHealed = true;
					const delRes = await entuFetch(cfg.db, `property/${postedId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
					diag.inheritSelfHealDelete = { propertyId: postedId, status: delRes.status };
				}
			}
			if (selfHealed) {
				const reReadRes = await entuFetch(cfg.db, `entity/${entity.id}?props=_sharing,_inheritrights`, cfg.token, {}, fetchImpl);
				const reReadBody = (await safeJson(reReadRes)) as ReadBody;
				diag.selfHealReadback = { status: reReadRes.status, body: reReadBody };
				if (!reReadRes.ok) throw new Error(`self-heal re-read GET for ${entity.id} failed: ${reReadRes.status}`);
				sharingVals = reReadBody?.entity?._sharing ?? [];
				inheritVals = reReadBody?.entity?._inheritrights ?? [];
			}

			if (sharingVals.length !== 1 || sharingVals[0]?.string !== 'domain') {
				throw new Error(`READ-BACK _sharing mismatch for ${entity.id}: ${JSON.stringify(sharingVals)}`);
			}
			if (inheritVals.length !== 1 || inheritVals[0]?.boolean !== true) {
				throw new Error(`READ-BACK _inheritrights mismatch for ${entity.id}: ${JSON.stringify(inheritVals)}`);
			}

			writtenIds.push(entity.id);
			if (selfHealed) preExistingHiddenIds.push(entity.id);
			writtenPropertyIds.push({
				id: entity.id,
				sharingPropertyId: extractPostedPropertyId(diag, 'sharingPost', '_sharing'),
				inheritPropertyId: extractPostedPropertyId(diag, 'inheritPost', '_inheritrights')
			});
		} catch (err) {
			failedIds.push(entity.id);

			// Only for a property whose POST returned a new `_id`: GET it, so "POST said ok but nothing
			// persisted" shows in the ledger.
			async function probeIfIdReturned(postField: 'sharingPost' | 'inheritPost', probeField: string, propType: string): Promise<void> {
				const newId = extractPostedPropertyId(diag, postField, propType);
				if (!newId) return;
				const probeRes = await entuFetch(cfg.db, `property/${newId}`, cfg.token, {}, fetchImpl);
				diag[probeField] = { propertyId: newId, status: probeRes.status, body: await safeJson(probeRes) };
			}
			await probeIfIdReturned('sharingPost', 'sharingPropertyProbe', '_sharing');
			await probeIfIdReturned('inheritPost', 'inheritPropertyProbe', '_inheritrights');

			failureDiagnostics.push(diag);
			// Recheck every row written so far even on abort: a row can pass its read-back and still
			// revert later, so the abort ledger carries the same recheck as the healthy path.
			const postRunRecheck = await recheckWrittenRows(cfg, writtenIds, fetchImpl, recheckDelayMs, sleepFn);
			writeLedgerNow({ failureDiagnostics, postRunRecheck });
			throw err;
		}
	}

	const postRunRecheck = await recheckWrittenRows(cfg, writtenIds, fetchImpl, recheckDelayMs, sleepFn);
	const ledgerPath = writeLedgerNow({ postRunRecheck });
	return {
		counts: buildCounts(),
		visibility: { person: personVisibility, rsvp: rsvpVisibility },
		movingSet: buildMovingSet(),
		movingPersonIdentityCount: identityCount,
		widerThanExpected: identityCount > 1,
		rerun: isRerun(),
		ledgerPath,
		postRunRecheck
	};
}

async function main(): Promise<void> {
	const DRY_RUN = readDryRun();
	const AUTHORIZED_BY = readAuthorizedBy();
	const cfg = await loadCredeCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const result = await runSeed445(cfg, DRY_RUN, fetch, AUTHORIZED_BY);

	for (const type of ['person', 'rsvp'] as const) {
		const c = result.counts[type];
		const writeLine = DRY_RUN ? `wouldWrite=${c.wouldWrite}` : `written=${c.written}`;
		console.log(
			`${type}: total=${c.total} alreadyDomain=${c.alreadyDomain} needsSharing=${c.needsSharing} ` +
				`(fromPrivate=${c.fromPrivate} fromPublic=${c.fromPublic} fromAbsent=${c.fromAbsent}) ` +
				`alreadyInherit=${c.alreadyInherit} needsInherit=${c.needsInherit} toWrite=${c.toWrite} ${writeLine} failed=${c.failed}`
		);
	}
	for (const type of ['person', 'rsvp'] as const) {
		const v = result.visibility[type];
		console.log(
			`${type} visibility: typeCap=${v.typeCap} capBlocksProjection=${v.capBlocksProjection} domainVisiblePropDefNames=${JSON.stringify(v.domainVisiblePropDefNames)}`
		);
	}
	console.log(`movingPersonIdentityCount=${result.movingPersonIdentityCount} widerThanExpected=${result.widerThanExpected}`);
	console.log(`movingSet: ${JSON.stringify(result.movingSet)}`);
	console.log(`rerun=${result.rerun}`);
	if (result.postRunRecheck.length > 0) {
		console.log(`postRunRecheck (delayed re-read of every written row):`);
		for (const row of result.postRunRecheck) {
			console.log(`  ${row.id}: HTTP ${row.status} stillCorrect=${row.stillCorrect}`);
		}
	}
	console.log(`Ledger: ${result.ledgerPath}`);
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((err) => {
		console.error('seed-445-person-rsvp-domain-inherit-crede ABORTED:', err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}

// (*MVOX:Perotin*)
