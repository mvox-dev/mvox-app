// The sign-in providers in the one order every picker shows; labels are Paraglide messages.
import { m } from '$lib/paraglide/messages.js';

interface AuthProvider {
	id: string;
	label: () => string;
	// The account's string is a personal ID code: shown nowhere (#1030 ruling a).
	idCode?: true;
}

export const AUTH_PROVIDERS: ReadonlyArray<AuthProvider> = [
	{ id: 'smart-id', label: m.auth_provider_smart_id, idCode: true },
	{ id: 'mobile-id', label: m.auth_provider_mobile_id, idCode: true },
	{ id: 'id-card', label: m.auth_provider_id_card, idCode: true },
	{ id: 'e-mail', label: m.auth_provider_e_mail },
	{ id: 'google', label: m.auth_provider_google },
	{ id: 'apple', label: m.auth_provider_apple },
	{ id: 'passkey', label: m.auth_provider_passkey }
];

export function isIdCodeProvider(id: string): boolean {
	return AUTH_PROVIDERS.some((p) => p.id === id && p.idCode);
}

// Unknown ids fall back to the capitalised id.
export function providerLabel(id: string | null): string {
	if (!id) return '';
	const provider = AUTH_PROVIDERS.find((p) => p.id === id);
	if (provider) return provider.label();
	return id.charAt(0).toUpperCase() + id.slice(1);
}
