// Event page RSVP fixtures (no page import): the setup its specs had word for word.
import { waitFor } from '@testing-library/svelte';
import { expect } from 'vitest';
import { signIn } from '$lib/testing/session';

export function seasonEntity() {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }]
	};
}

export function setAuthed() {
	signIn({
		token: 'jwt-editor',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }]
	});
}

// The exact enablement read for this viewer, pinned byte for byte.
export const RIGHTS_URL =
	'https://api.entu-test.invalid/sampledb/entity/p-viewer?props=_owner,_editor';
export const SELF_EDITOR = { _id: 'p-viewer', _editor: [{ reference: 'p-viewer' }] };

// Rights live on the person entity; a no-grant caller reads no rights props at all.
export const NO_GRANT = { _id: 'p-viewer' };

export async function waitForRsvpSection(container: HTMLElement): Promise<HTMLElement> {
	return waitFor(() => {
		const section = container.querySelector('[data-testid="event-detail-rsvp"]');
		expect(section).not.toBeNull();
		return section as HTMLElement;
	});
}

export const MY_RSVP_ROW = {
	_id: 'rsvp-77',
	event: [{ reference: 'ev1' }],
	status: [{ string: 'going' }]
};

// (*MVOX:Josquin*)
