// Minting an invite onto an existing person, and withdrawing the un-redeemed ones.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { INVITE_MINT_TRIGGER } from './inviteConstants';
import { inviteOf } from './inviteOf';

// Redemption takes the FIRST value carrying `invite`, so stale placeholders go before a mint.
// A value carrying `uid` is a bound identity and is never touched.

type SelfLinkMintPhase = 'identity-read' | 'stale-invite-cleanup' | 'mint';
type SelfLinkMintReason = 'http' | 'contract' | 'missing-self-editor';

export class SelfLinkMintError extends Error {
	readonly phase: SelfLinkMintPhase;
	readonly reason: SelfLinkMintReason;

	constructor(message: string, opts: { phase: SelfLinkMintPhase; reason: SelfLinkMintReason }) {
		super(message);
		this.name = 'SelfLinkMintError';
		this.phase = opts.phase;
		this.reason = opts.reason;
	}
}

interface StoredEntuUserEntry {
	_id: string;
	uid?: string;
	provider?: string;
	email?: string;
	invite?: string;
}

type SweepPhase = 'identity-read' | 'stale-invite-cleanup';

class InvitePlaceholderSweepError extends Error {
	readonly phase: SweepPhase;

	constructor(message: string, phase: SweepPhase) {
		super(message);
		this.name = 'InvitePlaceholderSweepError';
		this.phase = phase;
	}
}

// All-or-report: a placeholder that survives a reported failure is a live credential.
async function sweepStaleInvitePlaceholders(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch
): Promise<{ sweptCount: number }> {
	const readRes = await entuFetch(
		cfg.db,
		`entity/${personId}?props=entu_user`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!readRes.ok) {
		throw new InvitePlaceholderSweepError(
			`invite placeholder sweep: identity read failed: HTTP ${readRes.status}`,
			'identity-read'
		);
	}
	const readBody = (await readRes.json()) as {
		entity?: { entu_user?: StoredEntuUserEntry[] };
	};
	const entries = readBody.entity?.entu_user ?? [];
	const stalePlaceholders = entries.filter((e) => inviteOf(e) !== undefined);

	for (const stale of stalePlaceholders) {
		const delRes = await entuFetch(
			cfg.db,
			`property/${stale._id}`,
			cfg.token,
			{ method: 'DELETE' },
			fetchImpl
		);
		if (!delRes.ok) {
			throw new InvitePlaceholderSweepError(
				`invite placeholder sweep: cleanup failed: HTTP ${delRes.status} on property ${stale._id} — aborting (a surviving placeholder after a reported failure is a live credential)`,
				'stale-invite-cleanup'
			);
		}
	}
	return { sweptCount: stalePlaceholders.length };
}

type InviteWithdrawPhase = SweepPhase;

export class InviteWithdrawError extends Error {
	readonly phase: InviteWithdrawPhase;

	constructor(message: string, phase: InviteWithdrawPhase) {
		super(message);
		this.name = 'InviteWithdrawError';
		this.phase = phase;
	}
}

// A revocation: an un-redeemed link binds whoever clicks it. Withdrawn leaves no marker.
export async function withdrawInvite(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	try {
		await sweepStaleInvitePlaceholders(cfg, personId, fetchImpl);
	} catch (e) {
		if (e instanceof InvitePlaceholderSweepError) {
			throw new InviteWithdrawError(e.message, e.phase);
		}
		throw e;
	}
}

// Also the roster's invite and resend: Entu allows the mint on another person only for `_owner`.
export async function mintSelfLinkInvite(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<{ inviteToken: string }> {
	try {
		await sweepStaleInvitePlaceholders(cfg, personId, fetchImpl);
	} catch (e) {
		if (e instanceof InvitePlaceholderSweepError) {
			throw new SelfLinkMintError(e.message, { phase: e.phase, reason: 'http' });
		}
		throw e;
	}

	const mintRes = await entuFetch(
		cfg.db,
		`entity/${personId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'entu_user', string: INVITE_MINT_TRIGGER }])
		},
		fetchImpl
	);
	if (!mintRes.ok) {
		if (mintRes.status === 403) {
			throw new SelfLinkMintError(
				`self-link mint refused: HTTP 403 — the person lacks self-_editor`,
				{ phase: 'mint', reason: 'missing-self-editor' }
			);
		}
		throw new SelfLinkMintError(`self-link mint failed: HTTP ${mintRes.status}`, {
			phase: 'mint',
			reason: 'http'
		});
	}
	const mintBody = (await mintRes.json()) as {
		properties?: Array<{ type?: string; invite?: string }>;
	};
	const inviteToken = (mintBody.properties ?? [])
		.filter((p) => p.type === 'entu_user')
		.map(inviteOf)
		.find((token) => token !== undefined);
	if (!inviteToken) {
		throw new SelfLinkMintError(
			`self-link mint on person ${personId} returned 2xx without an invite token — API contract drift; do not retry blindly, inspect the person entity`,
			{ phase: 'mint', reason: 'contract' }
		);
	}

	return { inviteToken };
}

// (*MVOX:Josquin*)
