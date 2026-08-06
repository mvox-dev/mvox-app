// Shared OAuth provider list — extracted (verbatim) from the login page's local
// constant so the invite landing (T4.5) can render the same provider CTAs without
// duplicating the list. Slice-1 acceptance is Google sign-in; the rest are wired
// for parity and cost nothing.

export interface AuthProvider {
	id: string;
	label: string;
}

export const AUTH_PROVIDERS: ReadonlyArray<AuthProvider> = [
	{ id: 'google', label: 'Continue with Google' },
	{ id: 'smart-id', label: 'Smart-ID' },
	{ id: 'mobile-id', label: 'Mobile-ID' },
	{ id: 'id-card', label: 'ID-card' },
	{ id: 'apple', label: 'Apple' },
	{ id: 'e-mail', label: 'E-mail' }
];

