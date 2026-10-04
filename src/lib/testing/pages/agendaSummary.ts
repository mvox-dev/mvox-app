// Root page season summary harness: the agenda row and the reset its specs had word for word.
import { cleanup } from '@testing-library/svelte';
import { vi } from 'vitest';
import { resetGate } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';

export function agendaItem(id: string, startDatetime: string) {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	};
}

export function cleanupClearResetGate(): void {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	resetGate();
}

// (*MVOX:Josquin*)
