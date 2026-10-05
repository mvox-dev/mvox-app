// Event page fixtures shared word for word: bare series and event, a work row, tally sign-in.
import { signIn } from '$lib/testing/session';

export function seriesEntity() {
	return {
		_id: 'series1',
		name: [{ string: 'Tuesday Series' }],
		duration_minutes: [{ number: 120 }]
	};
}

export function workRow(id: string, workName: string, fileId: string) {
	return {
		id,
		kind: 'repertoire' as const,
		workId: `work-${id}`,
		editionId: `ed-${id}`,
		workName,
		composer: 'Thomas Tallis',
		status: 'active' as const,
		editionName: 'Vocal score',
		ordinal: null,
		fileId,
		fileName: fileId === '' ? '' : `${fileId}.pdf`,
		externalLinks: [],
		canBorrow: false,
		notes: ''
	};
}

export function setAuthedWithSampledb() {
	signIn({
		token: 'jwt-token',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }]
	});
}

export function eventEntity() {
	return {
		_id: 'ev1',
		name: [{ string: 'Tuesday Rehearsal' }],
		event_type: [{ string: 'rehearsal' }],
		start_datetime: [{ datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ number: 90 }],
		location: [{ string: 'Rehearsal Hall' }],
		_parent: [{ reference: 'season1', entity_type: 'season' }]
	};
}

// (*MVOX:Josquin*)
