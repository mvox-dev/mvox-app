// The sign-in providers in the one order every picker shows; labels are Paraglide messages.
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
	{ id: 'apple', label: m.auth_provider_apple },
	{ id: 'passkey', label: m.auth_provider_passkey }
];

// A passkey is added on Entu's own page (/profile's "Add a passkey"), not by an OAuth link.
export const LINKABLE_PROVIDERS = AUTH_PROVIDERS.filter((p) => p.id !== 'passkey');

// Unknown ids fall back to the capitalised id.
export function providerLabel(id: string | null): string {
	if (!id) return '';
	const provider = AUTH_PROVIDERS.find((p) => p.id === id);
	if (provider) return provider.label();
	return id.charAt(0).toUpperCase() + id.slice(1);
}
