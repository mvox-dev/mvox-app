import { endSession } from '$lib/auth/session';

/** Clear all auth state from localStorage/sessionStorage and reset the store.
 *  Shares `endSession` with the 401 recovery path so the two teardowns cannot
 *  drift (#107 review F1) — this one drops the remembered provider too, since
 *  an explicit sign-out is not an invitation to silently re-auth. */
export function performLogout(): void {
	endSession({ preserveProvider: false });
}

// (*MVOX:Josquin*)
