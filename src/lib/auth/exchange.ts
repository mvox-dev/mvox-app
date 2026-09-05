import { ENTU_API_BASE } from '../entu-config';
import type { EntuUser } from './storage';

// One account entry from the Entu `/auth` exchange response. Kept as a loose shape
// because T3 does not consume it — the db-selection (T4) reads the person-id-per-db
// map straight off the JWT claims (`accounts`), not this response array.
interface EntuAccount {
	_id: string;
	name?: string;
	[key: string]: unknown;
}

interface ExchangeSuccess {
	ok: true;
	token: string;
	accounts: EntuAccount[];
	user: EntuUser;
}

interface ExchangeFailure {
	ok: false;
	error: 'missing_session_token' | 'entu_auth_failed';
}

/**
 * Exchange the short-lived OAuth session token (returned in the callback `key=`)
 * for a full Entu JWT.
 *
 * DB-LESS BY DESIGN (T3): we call `/auth` WITHOUT a `?db=` param. Entu then
 * enumerates every db on the platform and returns a token whose `accounts` map
 * spans EVERY collective-db in which this identity has a real `person` entity
 * (see entu-rights-and-visibility-model.md §4). T4 picks the db from that map.
 * Hard-scoping the exchange to one db here would leave T4 with nothing to select.
 *
 * Runs browser-direct: the token Entu mints is aud=IP-bound to the caller, so only
 * this browser can subsequently use it.
 */
export async function exchangeSession({
	sessionToken,
}: {
	sessionToken: string;
}): Promise<ExchangeSuccess | ExchangeFailure> {
	if (!sessionToken) {
		return { ok: false, error: 'missing_session_token' };
	}

	try {
		const res = await fetch(`${ENTU_API_BASE}auth`, {
			headers: {
				Authorization: `Bearer ${sessionToken}`,
				Accept: 'application/json',
			},
		});

		if (!res.ok) {
			return { ok: false, error: 'entu_auth_failed' };
		}

		const data = (await res.json()) as {
			token?: string;
			accounts?: EntuAccount[];
			user?: EntuUser;
		};

		if (!data.token) {
			return { ok: false, error: 'entu_auth_failed' };
		}

		return {
			ok: true,
			token: data.token,
			accounts: data.accounts ?? [],
			user: data.user ?? ({ _id: '' } as EntuUser),
		};
	} catch {
		return { ok: false, error: 'entu_auth_failed' };
	}
}

// (*MVOX:Josquin*)
