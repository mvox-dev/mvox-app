import { clearAll } from '$lib/auth/storage';
import { authStore } from '$lib/auth/session';

/** Clear all auth state from localStorage/sessionStorage and reset the store. */
export function performLogout(): void {
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'anonymous' });
}

// (*MVOX:Josquin*)
