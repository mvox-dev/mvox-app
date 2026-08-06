// Invite URL builders (T4.5, #31). Pure string helpers — no fetch, no storage.
// The invite token is a BEARER SECRET: these helpers only shape URLs, they never
// log or persist the token.

/** Absolute invite-landing URL shown once to the admin. Throws on empty args. */
export function buildInviteUrl(origin: string, token: string): string {
	if (!origin) throw new Error('buildInviteUrl: origin is required — never fabricate a relative invite link');
	if (!token) throw new Error('buildInviteUrl: token is required — never fabricate a dead invite link');
	return `${origin}/invite/${encodeURIComponent(token)}`;
}

/**
 * Landing-page CTA href into the existing OAuth kickoff route, carrying the
 * invite via an explicit `?invite=` param (plus `intent=invite` and a
 * `return_to` back to the landing).
 */
export function buildInviteProviderHref(providerId: string, token: string): string {
	if (!providerId) throw new Error('buildInviteProviderHref: providerId is required');
	if (!token) throw new Error('buildInviteProviderHref: token is required');
	return `/auth/${providerId}?intent=invite&invite=${encodeURIComponent(token)}&return_to=${encodeURIComponent(`/invite/${token}`)}`;
}

