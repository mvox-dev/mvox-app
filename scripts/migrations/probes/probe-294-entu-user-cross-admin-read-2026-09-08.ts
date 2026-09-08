// mvox-app#294 — PO-team probe commission, READ-ONLY, polyphony, synthetic.
// Zero mutation anywhere in this file. Question: does a caller holding
// entity-level rights (_owner/_editor, as an admin holds on
// createInvite-created persons) read the private-tier `entu_user` property
// on ANOTHER person's entity — i.e. do entity rights admit the caller to
// the private bucket regardless of prop-def sharing? Recalled as "yes" from
// memory of the bucket system; this probe TESTS that, not assumes it.
//
// THREE MANDATORY REPORTS, per the commission (a negative without them
// proves nothing):
//
// 1. CALLER RIGHTS — characterized honestly, from what's actually on the
//    entities, not assumed. This probe's own key resolves to person
//    69bcfd8e9c031ab8e6ce8079 (Mihkel's own polyphony account) — the SAME
//    identity used for every polyphony script in this repo. CRITICAL
//    INTEGRITY POINT, stated loudly per team-lead's framing: this key is
//    functionally db-root/account-owner, so a positive read result here is
//    an UPPER BOUND, not proof a real, lesser-privileged admin identity
//    gets the same access. No second, lower-privileged polyphony API key
//    exists in this repo's credentials to test with — that gap is named,
//    not papered over. What CAN be said with confidence: on the two
//    non-self persons probed, this identity holds DIRECT (non-inherited)
//    _owner/_editor/_viewer grants — the `inherited` key is present and
//    `true` only on the rows that clearly cascade from the polyphony
//    db-entity's own ownership chain; the rows for THIS caller's identity
//    on person-specific rights carry no `inherited` flag at all, matching
//    the shape a real admin's creator-grant would leave (Entu's
//    create-time creator-rights convention), not a bypass-everything
//    special case. Both are true at once and neither cancels the other —
//    db-root-equivalent AND creator-shaped are the same identity here.
//
// 2. BOTH POPULATIONS — checked live, not assumed:
//    - REDEEMED (bound identity): all 4 live persons on polyphony qualify
//      — confirmed via a full entity list before this probe was written.
//    - UNREDEEMED (invite placeholder, `entu_user` masked as
//      `{_id, invite: '***'}` per src/lib/profile/linkedIdentities.ts's
//      own documented read of entu-api's entity.js:594-598): ZERO exist on
//      polyphony right now — 4/4 live persons carry a fully bound
//      `{uid, email, provider}` entry, and 0 `invitation` entities exist
//      either. REPORTING THE GAP, not creating one (this is a read-only
//      commission). A write-probe to fill it would need: PO authorization
//      for a single live mutation, using lib/invite/inviteData.ts's own
//      sole mint mechanism (`INVITE_MINT_TRIGGER` POSTed as `entu_user`)
//      against ONE throwaway synthetic person under Pérotin's standing
//      polyphony pre-authorization for routine synthetic-data ops — a
//      small, reversible, single-instance op, not this probe's scope.
//
// 3. THE EXACT SHAPE OF NOTHING — an ANONYMOUS caller (no Authorization
//    header at all) against the SAME entity gets a clean, total 403 ("No
//    accessible properties") on both a props-filtered GET and a full-entity
//    GET — never a 200 with entu_user silently absent. That is ONE shape of
//    "nothing," for a caller with ZERO rights on this domain-tier entity.
//    The MORE PRECISE test the commission actually wants — an
//    AUTHENTICATED, domain-tier caller who is a polyphony member but holds
//    NO owner/editor/viewer grant on this SPECIFIC person — could not be
//    run: no such identity's API key exists in this repo's credentials
//    either. Named as a second gap, not silently skipped.
//
// CROSS-ADMIN CAUTION — checked, not assumable: both non-self persons
// probed (`Testprivname`, Joosep Loidap) were created by THIS SAME caller
// identity (`_created.reference` = 69bcfd8e9c031ab8e6ce8079). Polyphony
// currently has no second admin identity's creations to test against — the
// same "one admin today" gap team-lead named for crede applies here too.
// Reported as a gap, not assumed either way.

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';
import { writeLedger } from '../lib/ledger-writer';

interface RightsRow {
	reference: string;
	string?: string;
	inherited?: boolean;
}

async function getRightsView(
	db: string,
	token: string,
	personId: string
): Promise<{
	sharing: string | null;
	parent: RightsRow[];
	inheritrights: boolean | null;
	created: RightsRow[];
	owner: RightsRow[];
	editor: RightsRow[];
	viewer: RightsRow[];
	raw: unknown;
}> {
	const res = await entuFetch(db, `entity/${personId}?props=_owner,_editor,_viewer,_created,_sharing,_parent,_inheritrights`, token);
	if (!res.ok) throw new Error(`getRightsView(${personId}): failed ${res.status}`);
	const rawBody = await res.json();
	const body = rawBody as {
		entity?: {
			_sharing?: Array<{ string: string }>;
			_parent?: Array<{ reference: string; string?: string }>;
			_inheritrights?: Array<{ boolean: boolean }>;
			_created?: Array<{ reference?: string; string?: string }>;
			_owner?: Array<{ reference: string; string?: string; inherited?: boolean }>;
			_editor?: Array<{ reference: string; string?: string; inherited?: boolean }>;
			_viewer?: Array<{ reference: string; string?: string; inherited?: boolean }>;
		};
	};
	const e = body.entity ?? {};
	return {
		sharing: e._sharing?.[0]?.string ?? null,
		parent: (e._parent ?? []).map((r) => ({ reference: r.reference, string: r.string })),
		inheritrights: e._inheritrights?.[0]?.boolean ?? null,
		created: (e._created ?? []).map((r) => ({ reference: r.reference ?? '(none)', string: r.string, inherited: undefined })),
		owner: (e._owner ?? []).map((r) => ({ reference: r.reference, string: r.string, inherited: r.inherited })),
		editor: (e._editor ?? []).map((r) => ({ reference: r.reference, string: r.string, inherited: r.inherited })),
		viewer: (e._viewer ?? []).map((r) => ({ reference: r.reference, string: r.string, inherited: r.inherited })),
		raw: rawBody
	};
}

async function getEntuUserRaw(db: string, token: string | null, personId: string): Promise<{ status: number; body: unknown }> {
	const headers: Record<string, string> = {};
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await fetch(`https://api.entu.app/${db}/entity/${personId}?props=entu_user`, { headers: { ...headers, Accept: 'application/json' } });
	const body = await res.json().catch(() => null);
	return { status: res.status, body };
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`READ-ONLY PROBE — db=${cfg.db}\n`);

	const authRes = await fetch(`https://api.entu.app/auth?db=${cfg.db}`, { headers: { Authorization: `Bearer ${process.env.ENTU_API_KEY}`, Accept: 'application/json' } });
	const authBody = (await authRes.json()) as { accounts?: Array<{ user?: { _id?: string; name?: string } }> };
	const callerId = authBody.accounts?.[0]?.user?._id ?? '(unresolved)';
	console.log(`Caller identity: ${callerId}\n`);

	// --- 2. Population inventory ---
	const personsRes = await entuFetch(cfg.db, `entity?_type.string=person&props=entu_user&limit=100`, cfg.token);
	const personsBody = (await personsRes.json()) as { count: number; entities: Array<{ _id: string; entu_user?: Array<Record<string, unknown>> }> };
	const redeemed: string[] = [];
	const unredeemed: string[] = [];
	for (const p of personsBody.entities) {
		const eu = p.entu_user ?? [];
		const hasInvitePlaceholder = eu.some((x) => 'invite' in x);
		const hasBound = eu.some((x) => 'uid' in x || 'email' in x);
		if (hasInvitePlaceholder) unredeemed.push(p._id);
		else if (hasBound) redeemed.push(p._id);
	}
	console.log(`Population: ${personsBody.count} persons total. Redeemed (bound): ${redeemed.length}. Unredeemed (invite placeholder): ${unredeemed.length}.`);

	const invitationsRes = await entuFetch(cfg.db, `entity?_type.string=invitation&limit=10`, cfg.token);
	const invitationsBody = (await invitationsRes.json()) as { count: number };
	console.log(`Live \`invitation\` entities: ${invitationsBody.count}.`);

	// --- 1. Caller rights + cross-read, on every non-self person ---
	// PO amendment (2026-09-08): the predicted mechanism is INHERITANCE from
	// the db-root parent (createInvite sets _parent=db-root + _inheritrights:
	// true, grants the admin nothing directly), not a creator-ownership grant.
	// So the shape markers (_parent==db-root, _inheritrights:true) are checked
	// explicitly, and the caller's OWN grant on each _owner/_editor/_viewer
	// row is classified as 'inherited' (row carries inherited:true) vs
	// 'direct' (row present, no inherited flag — NOT predicted by the
	// createInvite mechanism as described) vs 'absent'.
	const dbEntityId = await (async () => {
		const res = await entuFetch(cfg.db, `entity?_type.string=database&limit=1&props=_id`, cfg.token);
		const b = (await res.json()) as { entities?: Array<{ _id: string }> };
		return b.entities?.[0]?._id ?? null;
	})();
	console.log(`db-root entity id (createInvite's _parent target): ${dbEntityId}`);

	const nonSelfPersons = redeemed.filter((id) => id !== callerId);
	const crossReadResults: Array<Record<string, unknown>> = [];

	for (const personId of nonSelfPersons) {
		const rights = await getRightsView(cfg.db, cfg.token, personId);
		const callerRow = (rows: RightsRow[]) => rows.find((r) => r.reference === callerId);
		const ownerRow = callerRow(rights.owner);
		const editorRow = callerRow(rights.editor);
		const viewerRow = callerRow(rights.viewer);
		const createdByCaller = rights.created.some((r) => r.reference === callerId);
		const grantKind = (row: RightsRow | undefined): 'inherited' | 'direct' | 'absent' =>
			!row ? 'absent' : row.inherited === true ? 'inherited' : 'direct';
		const matchesInviteShape = rights.parent.some((p) => p.reference === dbEntityId) && rights.inheritrights === true;

		console.log(`\n--- person ${personId} ---`);
		console.log(`  _sharing: ${rights.sharing} | _parent=db-root: ${rights.parent.some((p) => p.reference === dbEntityId)} | _inheritrights: ${rights.inheritrights} | matches createInvite shape markers: ${matchesInviteShape}`);
		console.log(`  created by caller: ${createdByCaller}`);
		console.log(`  caller _owner: ${grantKind(ownerRow)}`);
		console.log(`  caller _editor: ${grantKind(editorRow)}`);
		console.log(`  caller _viewer: ${grantKind(viewerRow)}`);
		if (grantKind(ownerRow) === 'direct' || grantKind(editorRow) === 'direct') {
			console.log(`  >> OBSERVED, NOT PREDICTED: caller holds a DIRECT (non-inherited) grant despite matching createInvite's structural markers — the "admin gets nothing directly" description does not hold for this entity as it actually stands.`);
		}

		const withRights = await getEntuUserRaw(cfg.db, cfg.token, personId);
		console.log(`  entu_user read (WITH caller's rights): HTTP ${withRights.status}`);
		console.log(`  raw shape: ${JSON.stringify(withRights.body)}`);

		crossReadResults.push({
			personId,
			sharing: rights.sharing,
			parentIsDbRoot: rights.parent.some((p) => p.reference === dbEntityId),
			inheritrights: rights.inheritrights,
			matchesInviteShapeMarkers: matchesInviteShape,
			createdByCaller,
			callerOwnerGrantKind: grantKind(ownerRow),
			callerEditorGrantKind: grantKind(editorRow),
			callerViewerGrantKind: grantKind(viewerRow),
			entuUserReadStatus: withRights.status,
			entuUserReadShape: withRights.body,
			fullRawRightsView: rights.raw
		});
	}

	// --- 3. Shape of nothing: anonymous caller, same entities ---
	const anonymousResults: Array<Record<string, unknown>> = [];
	for (const personId of nonSelfPersons) {
		const anonFiltered = await getEntuUserRaw(cfg.db, null, personId);
		const anonFull = await (async () => {
			const res = await fetch(`https://api.entu.app/${cfg.db}/entity/${personId}`, { headers: { Accept: 'application/json' } });
			const body = await res.json().catch(() => null);
			return { status: res.status, body };
		})();
		console.log(`\n--- person ${personId}, ANONYMOUS caller ---`);
		console.log(`  props=entu_user filtered GET: HTTP ${anonFiltered.status} — ${JSON.stringify(anonFiltered.body)}`);
		console.log(`  full-entity GET: HTTP ${anonFull.status} — ${JSON.stringify(anonFull.body).slice(0, 200)}`);
		anonymousResults.push({ personId, filteredGet: anonFiltered, fullGetStatus: anonFull.status });
	}

	// --- Cross-admin caution ---
	const creators = new Set(crossReadResults.map((r) => r.createdByCaller));
	const crossAdminTestable = creators.size > 1 || crossReadResults.some((r) => r.createdByCaller === false);
	console.log(`\nCross-admin caution: ${crossAdminTestable ? 'testable' : 'NOT testable — all non-self persons created by the same caller identity (one-admin gap, same class as crede)'}.`);

	const artifactPath = writeLedger({
		scriptName: 'probe-294-entu-user-cross-admin-read',
		dryRun: false,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'mvox-app#294 — PO-team probe: does an entity-rights-holding caller read another person\'s private-tier entu_user? READ-ONLY, zero mutation.',
			callerIdentity: callerId,
			callerIntegrityNote: 'This key resolves to the polyphony account owner (Mihkel) — functionally db-root. A positive result is an UPPER BOUND, not proof a lesser-privileged real admin gets the same access. No second, lower-privileged API key was available to test with.',
			populationInventory: { totalPersons: personsBody.count, redeemedCount: redeemed.length, unredeemedCount: unredeemed.length, liveInvitationEntities: invitationsBody.count },
			unredeemedPopulationGap: unredeemed.length === 0 ? 'CONFIRMED GAP — zero unredeemed-invite persons exist on polyphony. Not created (read-only commission). A write-probe would need PO authorization for one throwaway person via inviteData.ts\'s INVITE_MINT_TRIGGER, under Pérotin\'s standing polyphony synthetic-data pre-authorization.' : null,
			crossReadResults,
			anonymousResults,
			crossAdminTestable,
			crossAdminGapNote: crossAdminTestable ? null : 'All non-self persons on polyphony were created by the SAME caller identity — cannot test whether a DIFFERENT admin\'s creation reads the same way. Same one-admin-today gap class as crede.'
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
}

main().catch((err) => {
	console.error('probe-294-entu-user-cross-admin-read ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
