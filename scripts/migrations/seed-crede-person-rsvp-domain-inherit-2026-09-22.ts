// Data job from Mihkel (team console, 2026-09-22 10:14:18 UTC), relayed by
// team-lead, Gama opening the tracking issue: every `person` and every
// `rsvp` entity on crede must carry `_sharing: domain` and
// `_inheritrights: true`. Crede only.
//
// DOCS FIRST (entu-www, read via `git show origin/main:<path>` — the local
// checkout sits on `docs/sharing-not-inherited`, not main):
//
//   - `_sharing`/`_inheritrights` are RIGHTS-TYPE properties. `src/api/
//     properties/index.md` ("Deleting a Property" restrictions table):
//     "`_owner`, `_editor`, `_expander`, `_viewer`, `_noaccess`, `_sharing`,
//     `_inheritrights`, `_parent` | Requires `_owner` rights on the
//     entity." `docs/architecture/entu-rights-and-visibility-model.md`
//     ER-11 (this repo, sourced from entu-api's own code, not entu-www):
//     "Changing `_sharing` requires `_owner`: `_sharing` is a rights-type
//     property, and writing or deleting any rights-type property requires
//     the caller be in the entity's `_owner` list." So the rights preflight
//     below checks `_owner` ONLY — never `_editor` (unlike seed-233-s2's
//     `event_name` preflight, which checks either, because a PLAIN
//     property only needs `_editor`).
//
//   - What `domain` means: `src/overview/entities/index.md` ("Sharing"
//     table): "`domain` | All authenticated users in the database,
//     regardless of explicit rights." And: "`domain` and `public` sharing
//     only grants read access. Write access always requires explicit
//     `_editor` or `_owner` rights on the entity."
//
//   - REPLACE vs APPEND on POST: entu-www's generic property docs (`src/
//     api/properties/index.md`, "Adding a value") show POST as ADDING a
//     value for `list: true` custom properties, and are SILENT on whether
//     a rights-type property (not user-defined, not documented as
//     `list: true`) replaces on POST or appends alongside an existing
//     value. This repo's own prior empirical finding fills the gap:
//     `teams/mvox-dev/memory/architecture-decisions.md` "Entu mutation-op
//     wire shapes" (2026-05-20) — `POST boolean property` row: "Replace
//     semantics: DELETE existing value first then POST (same as UPDATE)."
//     "Empirically confirmed by Phase D sub-op 5 (commit 88595c7) — 6
//     successful `_inheritrights: false` flips on `organization`
//     instances." That precedent is specific to `_inheritrights`, a
//     non-reference boolean value, the same shape `_sharing` (a
//     non-reference string value) is. It does NOT extend the separate
//     "direct rights grants REPLACE by design" memory
//     (`project_entu_post_appends_multi_value`) — that exception is
//     specific to the four REFERENCE-bearing grant tiers (`_owner`/
//     `_editor`/`_viewer`/`_expander`, one direct tier per reference per
//     entity), not to `_sharing`/`_inheritrights`. So: for BOTH properties
//     here, when a prior value exists, DELETE it by `_id` first, THEN
//     POST the new value. When no prior value exists (both are legitimately
//     absent-by-default — `_sharing` absent reads as private,
//     `_inheritrights` absent reads as false, per this repo's own
//     `project_entu_sharing_create_time` / probe findings), POST alone is
//     correct — there is nothing to delete.
//
// Contract — `runSeedCredeDomainInherit(cfg, dryRun, fetchImpl,
// authorizedBy?)`, pinned by the paired `.spec.ts`. `assertLiveRunAuthorized`
// is the FIRST statement, before any census GET. TWO db-wide censuses (one
// per `_type.string`), `props=_sharing,_inheritrights,_owner,_editor`, no
// `_parent` scoping, hard-throw per type when the reported `count`
// disagrees with the entity count. A `_sharing` or `_inheritrights` holding
// MORE than one value on an entity is not classifiable (system rights
// properties are not documented as multi-valued; a live one would be a
// surprise) — collected as `multiValue`, non-empty list stops the whole
// run before any write, dry and live alike.
//
// Classification per entity: `alreadyDomain` (`_sharing` present, holds
// exactly `domain`) vs `needsSharing` (absent, or present with any other
// value — the prior value is recorded, never its `.string` on a REFERENCE
// prop, but `_sharing`'s own value string is the thing being changed, not
// PII, so it is safe to log); `alreadyInherit` vs `needsInherit`, same
// shape for the boolean. `noRights`: for every entity needing EITHER write,
// `cfg.userId` must appear in the entity's `_owner` references (ER-11) —
// absent → collected, non-empty list stops the run before any write
// (dry run runs this preflight too, per the seed-233-s2 precedent).
//
// LIVE write per entity needing it: for each of `_sharing`/`_inheritrights`
// that this entity needs, DELETE the prior value by `_id` if one exists,
// then POST the new value; after both applicable writes, ONE read-back GET
// `entity/{id}?props=_sharing,_inheritrights` asserts BOTH hold exactly one
// value, correct. Any check failing → entity recorded failed, ledger
// written, throw — never a false "written".
//
// Ledger: `sensitive: true` (persons are real PII) routes the instance file
// to gitignored `crede-instance/`; the committed twin is ids/counts/
// outcomes only via `COMMITTED_ALLOW` — never a name, email, or other
// DEFAULT_REDACT_FIELDS member (none of those are touched by this script
// anyway; the census requests no name-bearing prop).
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-crede-person-rsvp-domain-inherit-2026-09-22.ts        # DRY_RUN=true default
//   DRY_RUN=false AUTHORIZED_BY='...' node --import tsx \
//     --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-crede-person-rsvp-domain-inherit-2026-09-22.ts        # ONLY after dry-run verified + authorization

import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { readDryRun, loadCredeCfg, readAuthorizedBy } from './lib/script-runner';
import { writeLedger as writeLedgerShared, assertLiveRunAuthorized } from './lib/ledger-writer';

type EntityType = 'person' | 'rsvp';

interface CensusEntity {
	_id: string;
	_sharing?: Array<{ _id: string; string?: string }>;
	_inheritrights?: Array<{ _id: string; boolean?: boolean }>;
	_owner?: Array<{ reference?: string }>;
	_editor?: Array<{ reference?: string }>;
}

interface Classified {
	id: string;
	type: EntityType;
	sharingValueId?: string;
	currentSharing: string | 'absent';
	needsSharing: boolean;
	inheritValueId?: string;
	currentInherit: boolean | 'absent';
	needsInherit: boolean;
}

export interface TypeCounts {
	total: number;
	alreadyDomain: number;
	needsSharing: number;
	alreadyInherit: number;
	needsInherit: number;
	/** union of needsSharing || needsInherit for this type */
	toWrite: number;
	written?: number;
	wouldWrite?: number;
	failed: number;
}

export interface RunSeedCredeDomainInheritCounts {
	person: TypeCounts;
	rsvp: TypeCounts;
}

export interface RunSeedCredeDomainInheritResult {
	counts: RunSeedCredeDomainInheritCounts;
	rerun: boolean;
	ledgerPath: string;
}

// ids/counts/outcomes only — no DEFAULT_REDACT_FIELDS member, no `string`.
// `authorizedBy` deliberately absent: writeLedger injects it into the
// committed envelope itself; the guard fence rejects an allow entry for it.
const COMMITTED_ALLOW = [
	'dryRun',
	'rerun',
	'counts',
	'person',
	'rsvp',
	'total',
	'alreadyDomain',
	'needsSharing',
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
	'currentSharing',
	'currentInherit',
	'noRights',
	'multiValue',
	'sharingCount',
	'inheritCount'
] as const;

async function censusType(
	cfg: EntuCfg,
	type: EntityType,
	fetchImpl: typeof fetch
): Promise<CensusEntity[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=${type}&props=_sharing,_inheritrights,_owner,_editor&limit=10000`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`runSeedCredeDomainInherit: census GET for '${type}' failed: ${res.status}`);
	const body = (await res.json()) as { count: number; entities: CensusEntity[] };
	if (body.count !== body.entities.length) {
		throw new Error(
			`runSeedCredeDomainInherit: census truncated for '${type}' -- count=${body.count} entities=${body.entities.length}. Raise limit.`
		);
	}
	return body.entities;
}

export async function runSeedCredeDomainInherit(
	cfg: EntuCfg & { userId: string },
	dryRun: boolean,
	fetchImpl: typeof fetch = fetch,
	authorizedBy?: string
): Promise<RunSeedCredeDomainInheritResult> {
	// mvox-app#417 — before any census GET, before any request leaves the script.
	assertLiveRunAuthorized(dryRun, authorizedBy);

	const personEntities = await censusType(cfg, 'person', fetchImpl);
	const rsvpEntities = await censusType(cfg, 'rsvp', fetchImpl);

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
			const currentSharing: string | 'absent' = sharingValue?.string ?? 'absent';
			const currentInherit: boolean | 'absent' = inheritValue?.boolean ?? 'absent';
			classified.push({
				id: entity._id,
				type,
				sharingValueId: sharingValue?._id,
				currentSharing,
				needsSharing: currentSharing !== 'domain',
				inheritValueId: inheritValue?._id,
				currentInherit,
				needsInherit: currentInherit !== true
			});
		}
	}

	function buildCounts(): RunSeedCredeDomainInheritCounts {
		function forType(type: EntityType): TypeCounts {
			const rows = classified.filter((c) => c.type === type);
			const toWriteRows = rows.filter((c) => c.needsSharing || c.needsInherit);
			return {
				total: rows.length + multiValue.filter((m) => m.type === type).length,
				alreadyDomain: rows.filter((c) => !c.needsSharing).length,
				needsSharing: rows.filter((c) => c.needsSharing).length,
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

	const writtenIds: string[] = [];
	const failedIds: string[] = [];
	let aborted = false;

	function writeLedgerNow(extra: Record<string, unknown> = {}): string {
		const toWriteAll = classified.filter((c) => c.needsSharing || c.needsInherit);
		return writeLedgerShared({
			scriptName: 'seed-crede-person-rsvp-domain-inherit',
			dryRun,
			db: cfg.db,
			sensitive: true,
			authorizedBy,
			committed: { allow: COMMITTED_ALLOW },
			payload: {
				dryRun,
				rerun: isRerun(),
				counts: buildCounts(),
				...(dryRun || aborted ? { wouldWriteIds: toWriteAll.map((c) => c.id) } : { writtenIds }),
				failedIds,
				...extra
			}
		});
	}

	function isRerun(): boolean {
		const toWriteAll = classified.filter((c) => c.needsSharing || c.needsInherit);
		const writeCount = dryRun ? toWriteAll.length : writtenIds.length;
		return writeCount === 0 && failedIds.length === 0 && classified.length + multiValue.length > 0;
	}

	if (multiValue.length > 0) {
		aborted = true;
		const path = writeLedgerNow({ outcome: 'aborted-multi-value', multiValue });
		throw new Error(
			`runSeedCredeDomainInherit: ${multiValue.length} entity(ies) hold more than one _sharing/_inheritrights value -- stopping before any write: ${multiValue.map((m) => m.id).join(', ')} (ledger: ${path})`
		);
	}

	// ER-11 rights preflight — _owner ONLY (rights-type property writes
	// require _owner, not _editor). Runs on the dry run too, so the report
	// shows missing grants before authorization is sought.
	const toWrite = classified.filter((c) => c.needsSharing || c.needsInherit);
	const noRights: Array<{ id: string; type: EntityType }> = [];
	for (const entity of toWrite) {
		const source = (entity.type === 'person' ? personEntities : rsvpEntities).find((e) => e._id === entity.id);
		const ownerRefs = (source?._owner ?? []).map((r) => r.reference);
		if (!ownerRefs.includes(cfg.userId)) {
			noRights.push({ id: entity.id, type: entity.type });
		}
	}
	if (noRights.length > 0) {
		aborted = true;
		const path = writeLedgerNow({ outcome: 'aborted-rights', noRights });
		throw new Error(
			`runSeedCredeDomainInherit: rights preflight failed for ${noRights.length} entity(ies) -- the runner is absent from _owner -- stopping before any write: ${noRights.map((n) => n.id).join(', ')} (ledger: ${path})`
		);
	}

	if (dryRun) {
		const ledgerPath = writeLedgerNow();
		return { counts: buildCounts(), rerun: isRerun(), ledgerPath };
	}

	for (const entity of toWrite) {
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
	return { counts: buildCounts(), rerun: isRerun(), ledgerPath };
}

async function main(): Promise<void> {
	const DRY_RUN = readDryRun();
	const AUTHORIZED_BY = readAuthorizedBy();
	const cfg = await loadCredeCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const result = await runSeedCredeDomainInherit(cfg, DRY_RUN, fetch, AUTHORIZED_BY);

	for (const type of ['person', 'rsvp'] as const) {
		const c = result.counts[type];
		const writeLine = DRY_RUN ? `wouldWrite=${c.wouldWrite}` : `written=${c.written}`;
		console.log(
			`${type}: total=${c.total} alreadyDomain=${c.alreadyDomain} needsSharing=${c.needsSharing} ` +
				`alreadyInherit=${c.alreadyInherit} needsInherit=${c.needsInherit} toWrite=${c.toWrite} ${writeLine} failed=${c.failed}`
		);
	}
	console.log(`rerun=${result.rerun}`);
	console.log(`Ledger: ${result.ledgerPath}`);
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((err) => {
		console.error('seed-crede-person-rsvp-domain-inherit ABORTED:', err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}

// (*MVOX:Perotin*)
