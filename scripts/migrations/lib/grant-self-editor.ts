// #371 grantSelfEditor: grants a newly created person `_editor` on themselves.

// A create-time grant goes to the creator, not the person; skipping this step left 19 crede
// members unable to RSVP (#369). Every bulk-person script calls it right after person-create.
// Forward-only: remedy-369 fixed the live crede population on 2026-09-15.

// A caller that logs what this reads must strip `.string` first: references carry name and email.

import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';

export type GrantSelfEditorResult =
	| { action: 'granted'; personId: string }
	| { action: 'skip-already-granted'; personId: string };

const RIGHTS_TYPES = ['_owner', '_editor', '_viewer', '_expander', '_noaccess'] as const;

interface RawRef {
	reference?: string;
	inherited?: boolean;
}

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
		// A self-_editor POST would silently retire whatever direct tier is already held.
		throw new Error(
			`grantSelfEditor: person ${personId} already holds a direct self-${existingTier} — a self-_editor grant would silently retire it (ER-6/ER-9); refusing to write`
		);
	}

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

	// Read back the grant; the write's own echo is not proof.
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
