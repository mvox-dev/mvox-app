// #371 — grantSelfEditor: the shared bulk-provisioning primitive.
//
// A newly created person's create-time grant goes to the CREATOR (the admin
// key that ran the creation); the person themselves gets nothing. The invite
// path knows this and grants self-`_editor` right after create
// (src/lib/invite/inviteData.ts:255-265); seed-178 did not — 19 crede members
// could not answer an RSVP (#369). This primitive is FORWARD-ONLY: every
// future bulk-person script calls it right after person-create. It patches no
// existing row (remedy-369 already fixed the live population, 24/24 read-back,
// 2026-09-15).
//
// Contract (pinned by grant-self-editor.spec.ts):
//   1. Read-before-write: fresh read of all five rights tiers. Direct self-
//      `_editor` already present -> skip-and-return, no write (the remedy-369
//      check-first discipline, scripts/migrations/probes/
//      remedy-369-crede-self-editor-grant-2026-09-15.ts).
//   2. A DIFFERENT direct self-tier present (worst: `_owner`) -> REFUSE, throw
//      naming the tier. ER-6/ER-9: one active direct tier per reference per
//      entity — a self-`_editor` POST would SILENTLY RETIRE it (downgrade), so
//      the primitive must never issue that write.
//   3. Write: POST entity/{personId} body [{type:'_editor',reference:personId}]
//      — wire-identical to the invite path. Non-2xx -> throw, status surfaced.
//   4. Read-back proof (#369 class: payload said yes, rights said no): re-READ
//      the entity's `_editor` and assert the DIRECT self grant is present —
//      never inferred from the write's echo. Missing -> throw loudly.
//
// CONSUMERS: every future bulk-person-creation script, called immediately
// after person-create (parity with the invite path's post-create grant) —
// #369 is exactly the defect that shipped when a bulk-seed skipped this step.
//
// This primitive itself never prints or ledgers the rights bodies it reads —
// nothing here to strip. A CALLER that logs or ledgers what this returns (or
// the rights bodies it read to get there) MUST strip `.string` at the point
// of extraction first (ER-26: every reference a read returns carries the
// referenced person's name+email baked into `.string`, regardless of the
// `props` requested).

import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export type GrantSelfEditorResult =
	| { action: 'granted'; personId: string }
	| { action: 'skip-already-granted'; personId: string };

const RIGHTS_TYPES = ['_owner', '_editor', '_viewer', '_expander', '_noaccess'] as const;

interface RawRef {
	reference?: string;
	inherited?: boolean;
}

/** The DIRECT (non-inherited) rights tier `personId` holds on itself, if any
 *  — ER-6/ER-9: at most one active direct tier per reference per entity. */
function directSelfTier(
	entity: Record<string, RawRef[] | undefined>,
	personId: string
): string | null {
	for (const tier of RIGHTS_TYPES) {
		const entries = entity[tier] ?? [];
		for (const e of entries) {
			if (e.reference === personId && !e.inherited) return tier;
		}
	}
	return null;
}

export async function grantSelfEditor(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<GrantSelfEditorResult> {
	// ── 1. Read-before-write: fresh read of all five rights tiers.
	const preReadRes = await entuFetch(
		cfg.db,
		`entity/${personId}?props=_owner,_editor,_viewer,_expander,_noaccess`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!preReadRes.ok) {
		throw new Error(
			`grantSelfEditor: pre-write read for ${personId} failed: HTTP ${preReadRes.status}`
		);
	}
	const preReadBody = (await preReadRes.json()) as {
		entity?: Record<string, RawRef[] | undefined>;
	};
	const existingTier = directSelfTier(preReadBody.entity ?? {}, personId);

	if (existingTier === '_editor') {
		return { action: 'skip-already-granted', personId };
	}
	if (existingTier !== null) {
		// ER-6/ER-9 downgrade trap: a self-_editor POST would silently retire
		// whatever direct tier is already held. Never issue that write.
		throw new Error(
			`grantSelfEditor: person ${personId} already holds a direct self-${existingTier} — a self-_editor grant would silently retire it (ER-6/ER-9); refusing to write`
		);
	}

	// ── 2. Write — wire-identical to the invite path (inviteData.ts:255-265).
	const grantRes = await entuFetch(
		cfg.db,
		`entity/${personId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: '_editor', reference: personId }])
		},
		fetchImpl
	);
	if (!grantRes.ok) {
		throw new Error(
			`grantSelfEditor: self-_editor grant on person ${personId} failed: HTTP ${grantRes.status} — the person exists WITHOUT self-edit rights`
		);
	}

	// ── 3. Read-back proof (#369 class: payload said yes, rights said no) —
	// never trust the write's own echo.
	const readBackRes = await entuFetch(
		cfg.db,
		`entity/${personId}?props=_editor`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!readBackRes.ok) {
		throw new Error(
			`grantSelfEditor: read-back read for ${personId} failed: HTTP ${readBackRes.status}`
		);
	}
	const readBackBody = (await readBackRes.json()) as { entity?: { _editor?: RawRef[] } };
	const nowHasSelfEditor = (readBackBody.entity?._editor ?? []).some(
		(e) => e.reference === personId && !e.inherited
	);
	if (!nowHasSelfEditor) {
		throw new Error(
			`grantSelfEditor: write succeeded but the read-back for ${personId} does not show a direct self-_editor grant — do not trust the write's own echo, investigate before treating this person as fixed`
		);
	}

	return { action: 'granted', personId };
}

// (*MVOX:Josquin*)
