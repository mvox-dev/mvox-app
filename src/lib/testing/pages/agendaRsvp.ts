// Root page RSVP harness: sign-in, agenda rows and the rights wire its specs had word for word.
import { cleanup, waitFor } from '@testing-library/svelte';
import { expect, vi } from 'vitest';
import type { AgendaItem } from '$lib/agenda/types';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { json } from '$lib/testing/entuFetchKit';
import { applyRsvpChangeMock } from '$lib/testing/mocks/events';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import { discoverMock } from '$lib/testing/routeMocks';
import { signIn } from '$lib/testing/session';

export function agendaEvent(id: string, startDatetime: string): AgendaItem {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	} as AgendaItem;
}

export const RIGHTS_URL = 'https://api.entu-test.invalid/sampledb/entity/person-p?props=_owner,_editor';

export type RightsAnswer = { body?: unknown; hold?: boolean; deferredResponse?: Promise<Response> };

export function agendaWith(events: AgendaItem[]) {
	return fullAgendaResult({
		seasons: [],
		upcoming: events,
		recent: [],
		seasonId: null,
		seasonConductors: [],
		seasonOwners: [],
		seasonEditors: []
	});
}

export function row(container: HTMLElement, id: string): HTMLElement | null {
	return container.querySelector(`[data-testid="agenda-row-${id}"]`);
}

export function setAuthed(dbs: Array<{ db: string; name: string }>) {
	signIn({ collectives: dbs.map((d) => ({ db: d.db, name: d.name, personId: 'person-p' })) });
	completionGateStore.set('complete');
}

export const SELF_EDITOR = {
	_id: 'person-p',
	_editor: [{ reference: 'person-p' }, { reference: 'someone-else' }]
};

export const E1 = agendaEvent('e1', '2026-06-15T09:00:00.000Z');

export async function waitForRow(container: HTMLElement, id: string): Promise<HTMLElement> {
	return waitFor(() => {
		const r = row(container, id);
		expect(r).not.toBeNull();
		return r!;
	});
}

export function stubWire(rights: Record<string, RightsAnswer>) {
	const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		for (const [rightsUrl, answer] of Object.entries(rights)) {
			if (url === rightsUrl) {
				if (answer.hold) return new Promise<Response>(() => {});
				if (answer.deferredResponse) return answer.deferredResponse;
				return json({ entity: answer.body });
			}
		}
		void init;
		return json({ entities: [] });
	});
	vi.stubGlobal('fetch', fetchStub);
	return fetchStub;
}

export function cleanupResetRsvpMocks(): void {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	applyRsvpChangeMock.mockReset();
	discoverMock.mockReset();
	resetAppState();
	resetGate();
}

// (*MVOX:Josquin*)
