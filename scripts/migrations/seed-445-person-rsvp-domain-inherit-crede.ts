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
}

// ids/counts/tiers/prop-def-names only — no DEFAULT_REDACT_FIELDS member,
// no `string` (the Entu wrapper key), never a member value.
const COMMITTED_ALLOW = [
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
	'profileOverlap'
] as const;

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
	authorizedBy?: string
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
					: { written: writtenIds.filter((id) => toWriteRows.some((r) => r.id === id)).length })
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
				...(dryRun || aborted ? { wouldWriteIds: toWriteList().map((c) => c.id) } : { writtenIds }),
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
			ledgerPath
		};
	}

	for (const entity of toWriteList()) {
		try {
			if (entity.needsSharing) {
				if (entity.sharingValueId) {
					const delRes = await entuFetch(cfg.db, `property/${entity.sharingValueId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
					if (!delRes.ok) throw new Error(`DELETE _sharing property/${entity.sharingValueId} failed: ${delRes.status}`);
				}
				const postRes = await entuFetch(
					cfg.db,
					`entity/${entity.id}`,
					cfg.token,
					{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ type: '_sharing', string: 'domain' }]) },
					fetchImpl
				);
				if (!postRes.ok) throw new Error(`POST _sharing entity/${entity.id} failed: ${postRes.status}`);
			}
			if (entity.needsInherit) {
				if (entity.inheritValueId) {
					const delRes = await entuFetch(cfg.db, `property/${entity.inheritValueId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
					if (!delRes.ok) throw new Error(`DELETE _inheritrights property/${entity.inheritValueId} failed: ${delRes.status}`);
				}
				const postRes = await entuFetch(
					cfg.db,
					`entity/${entity.id}`,
					cfg.token,
					{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ type: '_inheritrights', boolean: true }]) },
					fetchImpl
				);
				if (!postRes.ok) throw new Error(`POST _inheritrights entity/${entity.id} failed: ${postRes.status}`);
			}

			const readRes = await entuFetch(cfg.db, `entity/${entity.id}?props=_sharing,_inheritrights`, cfg.token, {}, fetchImpl);
			if (!readRes.ok) throw new Error(`read-back GET for ${entity.id} failed: ${readRes.status}`);
			const readBody = (await readRes.json()) as {
				entity?: { _sharing?: Array<{ string?: string }>; _inheritrights?: Array<{ boolean?: boolean }> };
			};
			const sharingVals = readBody.entity?._sharing ?? [];
			const inheritVals = readBody.entity?._inheritrights ?? [];
			if (sharingVals.length !== 1 || sharingVals[0]?.string !== 'domain') {
				throw new Error(`READ-BACK _sharing mismatch for ${entity.id}: ${JSON.stringify(sharingVals)}`);
			}
			if (inheritVals.length !== 1 || inheritVals[0]?.boolean !== true) {
				throw new Error(`READ-BACK _inheritrights mismatch for ${entity.id}: ${JSON.stringify(inheritVals)}`);
			}

			writtenIds.push(entity.id);
		} catch (err) {
			failedIds.push(entity.id);
			writeLedgerNow();
			throw err;
		}
	}

	const ledgerPath = writeLedgerNow();
	return {
		counts: buildCounts(),
		visibility: { person: personVisibility, rsvp: rsvpVisibility },
		movingSet: buildMovingSet(),
		movingPersonIdentityCount: identityCount,
		widerThanExpected: identityCount > 1,
		rerun: isRerun(),
		ledgerPath
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
