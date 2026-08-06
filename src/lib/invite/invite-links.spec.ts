import { describe, expect, it } from 'vitest';
import { buildInviteProviderHref, buildInviteUrl } from './invite-links';

describe('buildInviteUrl', () => {
	it('builds `${origin}/invite/${token}`', () => {
		expect(buildInviteUrl('https://mvox.app', 'a.b.c')).toBe('https://mvox.app/invite/a.b.c');
	});

	it('URI-encodes the token path segment', () => {
		expect(buildInviteUrl('https://mvox.app', 'a b')).toBe('https://mvox.app/invite/a%20b');
	});

	it('throws on an empty origin (never fabricates a relative link for the admin)', () => {
		expect(() => buildInviteUrl('', 'a.b.c')).toThrow(/origin/i);
	});

	it('throws on an empty token (never fabricates a dead link)', () => {
		expect(() => buildInviteUrl('https://mvox.app', '')).toThrow(/token/i);
	});
});

describe('buildInviteProviderHref', () => {
	it('builds the OAuth-kickoff href with intent=invite, the invite token, and a return_to back to the landing', () => {
		const token = 'tok.abc.def';
		expect(buildInviteProviderHref('google', token)).toBe(
			`/auth/google?intent=invite&invite=${encodeURIComponent(token)}&return_to=${encodeURIComponent(`/invite/${token}`)}`
		);
	});

	it('URI-encodes the token in both the invite param and the return_to param', () => {
		const href = buildInviteProviderHref('smart-id', 'a/b');
		expect(href).toBe(
			`/auth/smart-id?intent=invite&invite=a%2Fb&return_to=${encodeURIComponent('/invite/a/b')}`
		);
	});
});
