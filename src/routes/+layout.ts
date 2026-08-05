import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { getToken } from '$lib/auth/storage';
import { isTokenValid, resolveGuardRedirect } from '$lib/auth/guard';
import type { LayoutLoad } from './$types';

// Pure client-side SPA: no server ever renders this app, and Entu JWTs are
// aud=IP-bound so only the browser can hold them. Disabling SSR here is what
// makes adapter-static emit a single fallback shell instead of prerendering.
export const ssr = false;

// Client-side route guard — replaces the old SSR `hooks.server.ts` cookie gate.
// Runs in the browser on every navigation (ssr = false), reads the localStorage
// JWT, and redirects unauthenticated visitors away from protected routes.
export const load: LayoutLoad = ({ url }) => {
	if (!browser) return { authenticated: false };

	const token = getToken();
	const target = resolveGuardRedirect({
		pathname: url.pathname,
		search: url.search,
		token,
		nowMs: Date.now()
	});
	if (target) redirect(302, target);

	return { authenticated: isTokenValid(token, Date.now()) };
};
