// The landing page's OAuth href; the token is a bearer secret, shaped here and never logged.
export function buildInviteProviderHref(providerId: string, token: string): string {
	if (!providerId) throw new Error('buildInviteProviderHref: providerId is required');
	if (!token) throw new Error('buildInviteProviderHref: token is required');
	return `/auth/${providerId}?intent=invite&invite=${encodeURIComponent(token)}&return_to=${encodeURIComponent(`/invite/${token}`)}`;
}
