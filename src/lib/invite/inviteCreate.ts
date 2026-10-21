// The admin invite create: person with a minted invite, the self-_editor grant, then the member.
import { entuFetch } from '$lib/entu/request';
import { resolveTypeId } from '$lib/seasons/entuSeasons';
import type { EntuCfg } from '$lib/entu/cfg';
import { resolveDatabaseEntityId, DatabaseEntityLookupError } from '$lib/collective/databaseEntity';
import { INVITE_MINT_TRIGGER } from './inviteConstants';
import { inviteOf } from './inviteOf';

// Fail loud: partial failures name the orphaned person and are never rolled back,
// since a compensating delete can itself fail and hide the true state.

type InviteCreatePhase =
	| 'type-resolve'
	| 'person-parent-resolve'
	| 'org-resolve'
	| 'person-create'
	| 'invite-mint'
	| 'editor-grant'
	| 'member-create';

type InviteCreateReason = 'not-visible' | 'http' | 'contract';

export class InviteCreateError extends Error {
	readonly phase: InviteCreatePhase;
	readonly reason: InviteCreateReason;
	readonly personId?: string;

	constructor(
		message: string,
		opts: { phase: InviteCreatePhase; reason: InviteCreateReason; personId?: string }
	) {
		super(message);
		this.name = 'InviteCreateError';
		this.phase = opts.phase;
		this.reason = opts.reason;
		this.personId = opts.personId;
	}
}

export interface CreateInviteInput {
	dbEntityId: string;
}

interface CreateInviteResult {
	personId: string;
	memberId: string;
	inviteToken: string;
}

async function resolveDbEntityOrInviteFail(
	cfg: EntuCfg,
	phase: InviteCreatePhase,
	messages: { http: (detail: string) => string; notVisible: string },
	fetchImpl: typeof fetch
): Promise<string> {
	let dbEntityId: string | null;
	try {
		dbEntityId = await resolveDatabaseEntityId(cfg, fetchImpl);
	} catch (e) {
		if (e instanceof DatabaseEntityLookupError) {
			throw new InviteCreateError(messages.http(e.message), { phase, reason: 'http' });
		}
		throw e;
	}
	if (!dbEntityId) {
		throw new InviteCreateError(messages.notVisible, { phase, reason: 'not-visible' });
	}
	return dbEntityId;
}

// The database entity is the person parent; `add_user` is never read, so it cannot re-arm #22.
export function resolvePersonParentId(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	return resolveDbEntityOrInviteFail(
		cfg,
		'person-parent-resolve',
		{
			http: (detail) => `resolving the person parent failed: ${detail}`,
			notVisible:
				'no database entity is readable — creating invites requires rights on the database entity that this account does not appear to have'
		},
		fetchImpl
	);
}

export function resolveInviteParentId(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	return resolveDbEntityOrInviteFail(
		cfg,
		'org-resolve',
		{
			http: (detail) => `resolving the invite collective failed: ${detail}`,
			notVisible: `no database entity is readable in db '${cfg.db}' — inviting requires visibility into the collective`
		},
		fetchImpl
	);
}

export async function createInvite(
	cfg: EntuCfg,
	input: CreateInviteInput,
	fetchImpl: typeof fetch = fetch
): Promise<CreateInviteResult> {
	if (!input.dbEntityId) {
		throw new Error('createInvite: dbEntityId must not be empty');
	}

	let personTypeId: string;
	let memberTypeId: string;
	try {
		personTypeId = await resolveTypeId(cfg, 'person', fetchImpl);
		memberTypeId = await resolveTypeId(cfg, 'member', fetchImpl);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		throw new InviteCreateError(`type resolution failed: ${message}`, {
			phase: 'type-resolve',
			reason: /failed: \d+/.test(message) ? 'http' : 'not-visible'
		});
	}
	const personParentId = await resolvePersonParentId(cfg, fetchImpl);

	type Prop = { type: string; reference?: string; string?: string };

	const personProps: Prop[] = [
		{ type: '_type', reference: personTypeId },
		{ type: '_parent', reference: personParentId },
		{ type: 'entu_user', string: INVITE_MINT_TRIGGER }
	];
	const personRes = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(personProps)
		},
		fetchImpl
	);
	if (!personRes.ok) {
		// A 400 here is Entu's parent-rights check refusing the account: the real admin gate.
		throw new InviteCreateError(`person create failed: HTTP ${personRes.status}`, {
			phase: 'person-create',
			reason: 'http'
		});
	}
	const personBody = (await personRes.json()) as {
		_id?: string;
		properties?: Array<{ type?: string; invite?: string }>;
	};
	if (!personBody._id) {
		throw new InviteCreateError(
			'person create returned 2xx without _id (apparent-success trap) — never treated as a completed create',
			{ phase: 'person-create', reason: 'contract' }
		);
	}
	const personId = personBody._id;

	// The create response is the only read of the token; every later GET masks it as '***'.
	const inviteToken = (personBody.properties ?? [])
		.filter((p) => p.type === 'entu_user')
		.map(inviteOf)
		.find((token) => token !== undefined);
	if (!inviteToken) {
		throw new InviteCreateError(
			`person ${personId} was created but the create response carried no invite token — API contract drift; do not retry blindly, inspect the person entity`,
			{ phase: 'invite-mint', reason: 'contract', personId }
		);
	}

	// Parity with Entu's native auto-create; later creates need her in her own `_expander` set.
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
		throw new InviteCreateError(
			`self-_editor grant on person ${personId} failed: HTTP ${grantRes.status} — the person exists WITHOUT self-edit rights; repair in Entu before sending any link`,
			{ phase: 'editor-grant', reason: 'http', personId }
		);
	}

	const memberProps: Prop[] = [
		{ type: '_type', reference: memberTypeId },
		{ type: '_parent', reference: input.dbEntityId },
		{ type: 'person', reference: personId },
		{ type: 'status', string: 'active' }
	];
	const memberRes = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(memberProps)
		},
		fetchImpl
	);
	if (!memberRes.ok) {
		throw new InviteCreateError(
			`member create failed: HTTP ${memberRes.status} — person ${personId} already exists and carries a live invite token; repair or remove it in Entu before retrying`,
			{ phase: 'member-create', reason: 'http', personId }
		);
	}
	const memberBody = (await memberRes.json()) as { _id?: string };
	if (!memberBody._id) {
		throw new InviteCreateError(
			`member create returned 2xx without _id (apparent-success trap) — person ${personId} already exists; inspect both in Entu before retrying`,
			{ phase: 'member-create', reason: 'contract', personId }
		);
	}

	return { personId, memberId: memberBody._id, inviteToken };
}

// (*MVOX:Josquin*)
