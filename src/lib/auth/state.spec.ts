// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
	consumeNonce,
	createNonce,
	decodeState,
	encodeState,
	storeNonce,
	verifyNonce
} from './state';

beforeEach(() => {
	sessionStorage.clear();
});

describe('OAuth state', () => {
	it('createNonce returns a UUID-shaped string', () => {
		expect(createNonce()).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		);
	});

	it('round-trips a state payload through encode/decode', () => {
		const payload = {
			nonce: 'abc',
			return_to: '/agenda?q=foo',
			intent: 'login' as const,
			provider: 'google'
		};
		expect(decodeState(encodeState(payload))).toEqual(payload);
	});

	it('encoded state is base64url-safe (no +, /, =)', () => {
		const encoded = encodeState({
			nonce: '?+/=&',
			return_to: '/p?with&special=chars',
			intent: 'reauth',
			provider: 'smart-id'
		});
		expect(encoded).not.toMatch(/[+/=]/);
	});

	it('verifyNonce matches a stored nonce once, then consumes it', () => {
		const n = createNonce();
		storeNonce(n);
		expect(verifyNonce(n)).toBe(true);
		expect(verifyNonce(n)).toBe(false); // consumed
	});

	it('consumeNonce returns null when none stored', () => {
		expect(consumeNonce()).toBeNull();
	});
});

describe('OAuth state — invite intent (T4.5/#31)', () => {
	it('round-trips an invite-intent payload (db + bearer token ride the localStorage blob, never the OAuth URL)', () => {
		const payload = {
			nonce: 'n1',
			return_to: '/invite/tok.a.b',
			intent: 'invite' as const,
			provider: 'google',
			invite: { db: 'polyphony', token: 'tok.a.b' }
		};
		expect(decodeState(encodeState(payload))).toEqual(payload);
	});

	it('still decodes a legacy blob without the invite field (codec unchanged)', () => {
		const legacy = {
			nonce: 'n1',
			return_to: '/agenda',
			intent: 'login' as const,
			provider: 'google'
		};
		const decoded = decodeState(encodeState(legacy));
		expect(decoded).toEqual(legacy);
		expect(decoded.invite).toBeUndefined();
	});
});
