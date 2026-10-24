import { describe, expect, it } from 'vitest';
import { buildInviteProviderHref } from './invite-links';

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
