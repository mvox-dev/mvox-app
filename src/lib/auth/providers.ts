// Shared OAuth provider list — extracted (verbatim) from the login page's local
// constant so the invite landing (T4.5) can render the same provider CTAs without
// duplicating the list. Slice-1 acceptance is Google sign-in; the rest are wired
// for parity and cost nothing.
//
// #218 — labels resolve through Paraglide. Each entry's `label` IS the
// auth_provider_<id> message function itself (a static reference, never a
// computed key access), so `provider.label()` always renders in the active
// locale. Gama copy ruling (2026-09-02): six bare-noun keys; the Google entry
// reads plain 'Google' like its siblings — the 'Continue with Google' framing
// is retired.
import { m } from '$lib/paraglide/messages.js';

interface AuthProvider {
	id: string;
	label: () => string;
}

export const AUTH_PROVIDERS: ReadonlyArray<AuthProvider> = [
	{ id: 'smart-id', label: m.auth_provider_smart_id },
	{ id: 'mobile-id', label: m.auth_provider_mobile_id },
	{ id: 'id-card', label: m.auth_provider_id_card },
	{ id: 'e-mail', label: m.auth_provider_e_mail },
	{ id: 'google', label: m.auth_provider_google },
	{ id: 'apple', label: m.auth_provider_apple }
];

// The one provider-label resolution every consumer shares (#218) — replaces
// the profile page's local PROVIDER_LABELS map (from #60, predates #193).
// Unknown ids keep the capitalised-id fallback that map used to implement.
export function providerLabel(id: string | null): string {
	if (!id) return '';
	const provider = AUTH_PROVIDERS.find((p) => p.id === id);
	if (provider) return provider.label();
	return id.charAt(0).toUpperCase() + id.slice(1);
}
