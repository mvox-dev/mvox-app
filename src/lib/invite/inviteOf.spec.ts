// isPendingInvite: Entu reads a pending invite back as `true`; a self-mint write returns the token.
import { describe, expect, it } from 'vitest';
import { inviteOf, isPendingInvite } from './inviteOf';

type Entry = { _id: string; string?: string; provider?: string; invite?: unknown };

describe('isPendingInvite (#1026)', () => {
	it.each<[string, Entry, boolean]>([
		['the read shape, invite: true', { _id: 'eu-1', string: 'a@b.ee', invite: true }, true],
		['a string token', { _id: 'eu-2', invite: 'tok.abc' }, true],
		['a bound identity, no invite key', { _id: 'eu-3', string: 'a@b.ee', provider: 'google' }, false],
		['invite: false', { _id: 'eu-4', invite: false }, false],
		['an empty string', { _id: 'eu-5', invite: '' }, false]
	])('%s', (_label, entry, expected) => {
		expect(isPendingInvite(entry)).toBe(expected);
	});

	it('inviteOf still yields only a real token, never `true`', () => {
		expect(inviteOf({ invite: true })).toBeUndefined();
		expect(inviteOf({ invite: 'tok.abc' })).toBe('tok.abc');
	});
});

// (*MVOX:Josquin*)
