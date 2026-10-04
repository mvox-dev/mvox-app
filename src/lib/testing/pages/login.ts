// Login page harness: the reset its specs had word for word; imports nothing that reads $env.
import { cleanup } from '@testing-library/svelte';
import { gotoMock } from '$lib/testing/routeMocks';

export function cleanupResetGotoStorage(): void {
	cleanup();
	gotoMock.mockReset();
	localStorage.clear();
	sessionStorage.clear();
}

// (*MVOX:Josquin*)
