import { ENTU_API_BASE } from '$lib/entu-config';
import { createNonce, encodeState, OAUTH_STATE_KEY } from '$lib/auth/state';

export const LAB_ENTU_PATH = '/lab/entu';

// No provider in the path: Entu asks which one. Entu's sign-in pages speak et and en only.
export function entuSignInHref(origin: string, appLocale: string): string {
	const params = new URLSearchParams({
		next: `${origin}/auth/callback?key=`,
		lang: appLocale === 'et' ? 'et' : 'en'
	});
	return `${ENTU_API_BASE}auth?${params.toString()}`;
}

export function rememberSignInStarted(): void {
	const state = encodeState({
		nonce: createNonce(),
		return_to: LAB_ENTU_PATH,
		intent: 'login',
		provider: 'entu'
	});
	localStorage.setItem(OAUTH_STATE_KEY, state);
}

export function entuAddPasskeyHref(db: string): string {
	return `https://entu.app/${encodeURIComponent(db)}/passkey`;
}

// (*MVOX:Josquin*)
