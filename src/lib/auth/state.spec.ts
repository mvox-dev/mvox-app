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
