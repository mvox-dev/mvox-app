// The roster's invite: Entu emails the link to the person's own email; no token reaches mvox.
import type { EntuCfg } from '$lib/entu/cfg';

export class SendInviteError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SendInviteError';
	}
}

export type SendInviteResult = { sent: true; email: string } | { sent: false };

export async function sendInvite(
	_cfg: EntuCfg,
	_personId: string,
	_fetchImpl: typeof fetch = fetch
): Promise<SendInviteResult> {
	throw new Error('sendInvite: not implemented');
}

// (*MVOX:Josquin*)
