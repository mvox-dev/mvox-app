// Unverified client-side decode of an Entu invite JWT (T4.5, #31).
//
// The invite token is a standard JWS whose middle segment is unsigned-readable
// base64url JSON — the same unverified read the API itself performs via
// `jwt.decode` (entu-api routes/auth/index.get.js:126-129). Payload fields are
// exactly `db`, `entityId`, `iat`, `exp` (minted at entu-api utils/entity.js:462-468).
//
// LIMITS (by construction, not by omission):
// - The signature CANNOT be verified client-side (HS256, server-secret only) —
//   the server stays the authority; `expired` here is a client-clock warning, not
//   a verdict.
// - There is NO email in the token — entu-api deletes the email string at mint
//   time (utils/entity.js:466-467), so nothing here can name the invitee.

import { decodeJwtPayload } from '$lib/auth/guard';

export type ParsedInvite =
	| { status: 'ok'; db: string; entityId: string; expMs: number }
	| { status: 'expired'; db: string; entityId: string; expMs: number }
	| { status: 'invalid' };

export function parseInviteToken(token: string | null | undefined, nowMs: number): ParsedInvite {
	const payload = decodeJwtPayload(token);
	if (!payload) return { status: 'invalid' };

	const { db, entityId, exp } = payload;
	// Every field is required — a token missing any of them is not an Entu invite
	// JWT, and we never guess a validity window.
	if (typeof db !== 'string' || !db) return { status: 'invalid' };
	if (typeof entityId !== 'string' || !entityId) return { status: 'invalid' };
	if (typeof exp !== 'number') return { status: 'invalid' };

	const expMs = exp * 1000;
	if (expMs <= nowMs) return { status: 'expired', db, entityId, expMs };
	return { status: 'ok', db, entityId, expMs };
}

