// The roster's invite: Entu emails the link to the person's own email; no token reaches mvox.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';

export class SendInviteError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SendInviteError';
	}
}

export type SendInviteResult = { sent: true; email: string } | { sent: false };

// The person's own email, not a profile's: that is where Entu sends (Mihkel ruling 2026-10-22).
// `_viewer` shares the private bucket, so its absence means withheld, never "no email".
async function readPersonEmail(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch
): Promise<string> {
	const path = `entity/${personId}?props=email,_viewer`;
	const res = await entuFetch(cfg.db, path, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new SendInviteError(`send-invite: person read failed: HTTP ${res.status}`);
	const body = (await res.json()) as {
		entity?: { email?: Array<{ string?: string }>; _viewer?: unknown[] };
	};
	if (!body.entity?._viewer?.length) throw new SendInviteError('send-invite: person read withheld');
	return body.entity.email?.find((e) => e.string)?.string ?? '';
}

export async function sendInvite(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<SendInviteResult> {
	const email = await readPersonEmail(cfg, personId, fetchImpl);
	if (!email) return { sent: false };
	const res = await entuFetch(
		cfg.db,
		`entity/${personId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'entu_user', string: 'send-invite' }])
		},
		fetchImpl
	);
	if (!res.ok) throw new SendInviteError(`send-invite refused: HTTP ${res.status}`);
	return { sent: true, email };
}

// (*MVOX:Josquin*)
