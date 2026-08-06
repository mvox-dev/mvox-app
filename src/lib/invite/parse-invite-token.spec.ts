import { describe, expect, it } from 'vitest';
import { parseInviteToken } from './parse-invite-token';

// Build an unsigned JWT (base64url, no padding) — the invite token's middle
// segment is exactly this shape (entu-api utils/entity.js:462-468 payload:
// {db, entityId} + iat/exp added by jsonwebtoken).
function jwt(payload: object): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

const NOW = 2_000_000_000_000; // ms
const FUTURE_EXP = 2_000_000_100; // s → 2_000_000_100_000 ms > NOW
const PAST_EXP = 1_999_999_900; // s → 1_999_999_900_000 ms < NOW

describe('parseInviteToken — valid token', () => {
	it('returns ok with db, entityId, and expMs (exp seconds → ms)', () => {
		const token = jwt({ db: 'polyphony', entityId: 'p1', iat: 1, exp: FUTURE_EXP });
		expect(parseInviteToken(token, NOW)).toEqual({
			status: 'ok',
			db: 'polyphony',
			entityId: 'p1',
			expMs: FUTURE_EXP * 1000
		});
	});
});

describe('parseInviteToken — client-clock expiry (warning, NOT a verdict — the server is the authority)', () => {
	it('returns expired but KEEPS db/entityId/expMs so the landing can still offer the CTA', () => {
		const token = jwt({ db: 'polyphony', entityId: 'p1', exp: PAST_EXP });
		expect(parseInviteToken(token, NOW)).toEqual({
			status: 'expired',
			db: 'polyphony',
			entityId: 'p1',
			expMs: PAST_EXP * 1000
		});
	});

	it('treats exp exactly at nowMs as expired', () => {
		const token = jwt({ db: 'polyphony', entityId: 'p1', exp: NOW / 1000 });
		expect(parseInviteToken(token, NOW)).toMatchObject({ status: 'expired' });
	});
});

describe('parseInviteToken — invalid input', () => {
	it('returns invalid for garbage, empty, null and undefined input', () => {
		expect(parseInviteToken('not-a-jwt', NOW)).toEqual({ status: 'invalid' });
		expect(parseInviteToken('', NOW)).toEqual({ status: 'invalid' });
		expect(parseInviteToken(null, NOW)).toEqual({ status: 'invalid' });
		expect(parseInviteToken(undefined, NOW)).toEqual({ status: 'invalid' });
	});

	it('returns invalid when db is missing or not a string', () => {
		expect(parseInviteToken(jwt({ entityId: 'p1', exp: FUTURE_EXP }), NOW)).toEqual({
			status: 'invalid'
		});
		expect(parseInviteToken(jwt({ db: 42, entityId: 'p1', exp: FUTURE_EXP }), NOW)).toEqual({
			status: 'invalid'
		});
	});

	it('returns invalid when entityId is missing', () => {
		expect(parseInviteToken(jwt({ db: 'polyphony', exp: FUTURE_EXP }), NOW)).toEqual({
			status: 'invalid'
		});
	});

	it('returns invalid when exp is missing or not a number (never guesses a validity window)', () => {
		expect(parseInviteToken(jwt({ db: 'polyphony', entityId: 'p1' }), NOW)).toEqual({
			status: 'invalid'
		});
		expect(
			parseInviteToken(jwt({ db: 'polyphony', entityId: 'p1', exp: 'soon' }), NOW)
		).toEqual({ status: 'invalid' });
	});
});
