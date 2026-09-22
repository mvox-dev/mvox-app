// mvox-app#445 — every `person` and every `rsvp` entity on crede gets
// `_sharing: domain` and `_inheritrights: true`. Mihkel's ruling (team
// console, 2026-09-22 10:14:18 UTC, confirmed on #445): "yes, this is my
// ruling. we have all persons and rsvp's domain shared". Crede only.
//
// DOCS FIRST (entu-www, read via `git show origin/main:<path>` — the local
// checkout sits on `docs/sharing-not-inherited`, not main):
//
//   - `_sharing`/`_inheritrights` are RIGHTS-TYPE properties. `src/api/
//     properties/index.md` ("Deleting a Property" restrictions table):
//     "`_owner`, `_editor`, `_expander`, `_viewer`, `_noaccess`, `_sharing`,
//     `_inheritrights`, `_parent` | Requires `_owner` rights on the
//     entity." `docs/architecture/entu-rights-and-visibility-model.md`
//     ER-11 (this repo, sourced from entu-api's own code): "Changing
//     `_sharing` requires `_owner`: `_sharing` is a rights-type property,
//     and writing or deleting any rights-type property requires the caller
//     be in the entity's `_owner` list." So the rights preflight below
//     checks `_owner` ONLY — never `_editor` (unlike seed-233-s2's
//     `event_name` preflight, a PLAIN property, owner-or-editor).
//
//   - What `domain` means: `src/overview/entities/index.md` ("Sharing"
//     table): "`domain` | All authenticated users in the database,
//     regardless of explicit rights."
//
//   - PROPERTY-LEVEL VISIBILITY (#445 body, "what each move makes
//     visible"): an entity's own `_sharing` is only ONE of a 3-gate AND —
//     `src/configuration/entity-types/index.md`: the TYPE-DEF's `_sharing`
//     is a CAP ("not set | No properties are projected into domain or
//     public views, regardless of property definition settings"; "domain |
//     Properties set to `domain` are exposed to domain users. Properties
//     set to `public` are automatically capped to `domain`."), and each
//     PROP-DEF carries its own `_sharing` tier. So "which properties become
//     member-visible" when an entity moves to `domain` = the type-def's cap
//     allows domain/public projection AND the prop-def's own tier is
//     `domain` or `public`. Both reads are schema metadata (prop-def
//     NAMES and tiers), never instance data — safe to log and commit.
//
//   - REPLACE vs APPEND on POST: entu-www's generic property docs are
//     SILENT on this for rights-type properties (their one worked example
//     is a `list: true` custom prop). This repo's own prior empirical
//     finding fills the gap: `teams/mvox-dev/memory/architecture-
//     decisions.md` "Entu mutation-op wire shapes" (2026-05-20) — `POST
//     boolean property` row: "Replace semantics: DELETE existing value
//     first then POST (same as UPDATE)." Empirically confirmed by Phase D
//     sub-op 5 (commit 88595c7) — 6 successful `_inheritrights: false`
//     flips. That precedent is specific to `_inheritrights`, a
//     non-reference boolean, the same shape `_sharing` (a non-reference
//     string) is — it does NOT extend the separate "direct rights grants
//     REPLACE by design" memory, which is specific to the four REFERENCE-
//     bearing grant tiers. So: DELETE the prior value by `_id` first when
//     one exists, THEN POST; when absent (both properties' legitimate
//     default state), POST alone — nothing to delete.
//
// SCOPE FENCE (#445 body): "Profiles are not in scope and must not be swept
// in. A `profile` is a child of a person and is deliberately created with
// `_inheritrights: false`... A sweep that reaches them by walking children
// would undo the profile privacy model." This script NEVER walks children —
// both censuses are flat `_type.string=person` / `_type.string=rsvp` GETs,
// no `_parent` scoping. As a second, independent fence, a read-only
// `_type.string=profile&props=_id` census runs alongside, and the write
// plan is asserted disjoint from it before any write — belt-and-suspenders
// against a future edit accidentally widening the census filter.
//
// MOVING-SET EXPECTATION (Gama, #445 comment, relaying Mihkel: "I expect
// the changes to touch my person and rsvp's only"; "any wider exposure
// would be a surprise"): `rsvp` is a child of `person` (`_parent.reference`
// — src/lib/rsvp/rsvpData.ts), so every rsvp census row carries `_parent`,
// letting the moving set be checked against this expectation WITHOUT a
// second per-rsvp GET. If the union of (moving persons) and (moving rsvps'
// parent person ids) is not exactly ONE person, the run aborts before any
// write — dry run included — and reports the full moving set (ids + type +
// prior tier, never a name) rather than proceeding on a wider sweep. Only a
// human lifts that stop.
//
// Contract — `runSeed445(cfg, dryRun, fetchImpl, authorizedBy?)`, pinned by
// the paired `.spec.ts`. `assertLiveRunAuthorized` is the FIRST statement.
// TWO db-wide instance censuses (person, rsvp; rsvp's also carries
// `_parent`), hard-throw per type on count mismatch. A `_sharing` or
// `_inheritrights` holding more than one value is not classifiable —
// collected as `multiValue`, stops the run before any write. Then, in
// order: profile-overlap check, moving-set-scope check, ER-11 rights
// preflight (`_owner` only) — each a hard abort with its own ledger outcome
// when non-empty, all three running on the dry run too.
//
// LIVE write per entity needing it: for each of `_sharing`/`_inheritrights`
// this entity needs, DELETE the prior value by `_id` if one exists, then
// POST the new value; after both applicable writes, ONE read-back GET
// `entity/{id}?props=_sharing,_inheritrights` asserts BOTH hold exactly one
// value, correct. Any check failing → entity recorded failed, ledger
// written, throw — never a false "written".
//
// Ledger: `sensitive: true` (persons are real PII) routes the instance file
// to gitignored `crede-instance/`; the committed twin is ids/counts/tiers/
// prop-def-names only via `COMMITTED_ALLOW` — never a member value.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-445-person-rsvp-domain-inherit-crede.ts        # DRY_RUN=true default
//   DRY_RUN=false AUTHORIZED_BY='...' node --import tsx \
//     --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-445-person-rsvp-domain-inherit-crede.ts        # ONLY after dry-run verified + authorization

import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
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
	/** Written rows where a hidden pre-existing value was found and self-healed mid-write. LIVE runs only; absent on a dry run. */
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
	/** Delayed re-read of every row this run wrote — [] on a dry run (nothing written) or an abort before any write. */
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
	// #445 failure-diagnostics fields — ids/statuses/structure only; the
	// writer's own blanket rule excludes 'string' from the committed twin
	// regardless (rights-tier text, not PII, but the full detail survives
	// in the gitignored instance ledger either way).
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
	// #445 (team-lead, 2nd round) — the readback/recheck bodies nest Entu's
	// own wire-shape keys, which need their own allowlist entries: the
	// generic 'body'/'entity' names above only admit the CONTAINER, not
	// these leaf property names. Fixes a real gap in round 1: without
	// these, filterByAllowlist silently dropped `_sharing`/`_inheritrights`
	// out of every readback/probe body in the committed twin (though the
	// full detail always survived in the gitignored instance ledger).
	'_sharing',
	'_inheritrights',
	// #445 (team-lead, 2nd round) — every written row's returned property
	// ids, and the delayed post-run recheck that catches a reversion.
	'writtenPropertyIds',
	'sharingPropertyId',
	'inheritPropertyId',
	'postRunRecheck',
	'stillCorrect',
	// #445 (team-lead, 3rd round) — hidden-pre-existing-value self-heal.
	'preExistingHiddenIds',
	'preExistingHidden',
	'sharingSelfHealDelete',
	'inheritSelfHealDelete',
	'selfHealReadback'
] as const;

/** Parse a Response body as JSON, tolerating a non-JSON or empty body — the
 * diagnostic paths below must never themselves throw while building a
 * failure record. */
async function safeJson(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		return null;
	}
}

/** The property `_id` a POST response returned for `propType`, if any — shared by the success path (writtenPropertyIds) and the failure path's diagnostic probe. */
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

/**
 * #445 (team-lead, 2nd round) — a delayed re-read of every row THIS RUN
 * wrote, after `delayMs` (30s in production), so a reversion that only
 * shows up moments after a passing read-back (exactly what happened live
 * to 6a9c3d37...292) is caught and dated by the script itself, not
 * discovered by a human minutes later. Runs regardless of whether the loop
 * that called it went on to succeed or throw — `writtenIds` only ever
 * contains rows this run actually wrote and verified at write-time.
 */
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

/** Schema metadata only — type-def's own `_sharing` cap, and every prop-def's own `_sharing`, under one type. */
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
	// #445 (team-lead, post-abort diagnosis) — closes the ledger gap: the
	// FIRST live run's failure carried no record of what the POSTs actually
	// returned, only the thrown message. One entry per failed entity: the
	// exact request body sent for each property this entity needed, the
	// POST response (status + body, including any new property `_id` it
	// returned), the read-back response, and — ONLY when a POST response
	// carried a property `_id` — a diagnostic `GET /property/{id}` on that
	// exact id, so a "POST said ok, but nothing persisted" gap (exactly
	// what happened on 6a9c3d38...29b) is visible from the ledger alone,
	// no separate live probe needed next time. Ids/statuses/structure only
	// — no member value ever named in a report; `string`/`boolean` payload
	// values are rights-tier text (domain/private/public, true/false), not
	// PII, but `string` is still excluded from the COMMITTED twin below
	// (the writer's own blanket rule) — the full detail survives in the
	// gitignored instance ledger regardless.
	const failureDiagnostics: Array<Record<string, unknown>> = [];
	// #445 (team-lead, 2nd round) — every WRITTEN row's returned property
	// ids, one entry per entity, ids only.
	const writtenPropertyIds: Array<{ id: string; sharingPropertyId?: string; inheritPropertyId?: string }> = [];
	// #445 (team-lead, 3rd round) — rows where a hidden pre-existing value
	// was found and self-healed mid-write (see the write loop's own
	// comment). A subset of writtenIds, listed separately so the ledger
	// shows the anomaly without treating it as a failure.
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

	// Scope fence 2/2 — Mihkel's stated expectation, and the live-run
	// authorization's own stop condition: the moving set must resolve to
	// exactly one person identity (that person plus that person's own
	// rsvps). Anything wider is a surprise, reported and stopped, not
	// executed — dry run included.
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
		// Populated as each step completes; attached to the ledger verbatim
		// (ids/statuses/structure — see the accumulator's own comment above)
		// if this entity ends up in the catch block below.
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

			// #445 (team-lead, 3rd round) — a HIDDEN pre-existing value: the
			// census and this row's own pre-write checks all reported a
			// property absent, but a PRIOR write (this row's own history —
			// e.g. an earlier aborted run) had actually persisted invisibly,
			// and only reappears once this run's fresh POST lands beside it.
			// Observed live twice (6a9c3d37...292, 6a9c3d38...729b): every
			// read from the first write until a SECOND write landed showed
			// the property absent; the first write's value then reappeared.
			// Self-heal: delete the id THIS RUN's own POST response
			// returned — never guess which of two values is "the
			// pre-existing one," only the id we minted ourselves is certain
			// — re-read, and let the checks below decide correctness on
			// whatever's left. `selfHealed` drives the outcome classification
			// ('pre-existing-hidden' vs a plain write) below.
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

			// Diagnostic property probe — ONLY for a property whose POST
			// response actually returned a new `_id`: GET /property/{that id}
			// and record status+body, so "the POST said ok but nothing
			// persisted" is visible from the ledger without a separate live
			// probe next time.
			async function probeIfIdReturned(postField: 'sharingPost' | 'inheritPost', probeField: string, propType: string): Promise<void> {
				const newId = extractPostedPropertyId(diag, postField, propType);
				if (!newId) return;
				const probeRes = await entuFetch(cfg.db, `property/${newId}`, cfg.token, {}, fetchImpl);
				diag[probeField] = { propertyId: newId, status: probeRes.status, body: await safeJson(probeRes) };
			}
			await probeIfIdReturned('sharingPost', 'sharingPropertyProbe', '_sharing');
			await probeIfIdReturned('inheritPost', 'inheritPropertyProbe', '_inheritrights');

			failureDiagnostics.push(diag);
			// #445 (team-lead, 2nd round) — delayed recheck of every row THIS
			// RUN wrote so far, even though the run is about to abort: a prior
			// row can pass its own read-back and still revert later (exactly
			// what happened live to 6a9c3d37...292), so the abort ledger must
			// carry the same recheck the healthy path does.
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
