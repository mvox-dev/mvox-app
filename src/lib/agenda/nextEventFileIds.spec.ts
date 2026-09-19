// #409 RED — nextEventFileIds: THE one definition of "the next event's
// parts", as file-property ids. Exported as its own pure helper because two
// issues consume the SAME set — #409 (prefetch these on app open) and #410
// (exempt these from storage-pressure eviction) — and the set must never be
// defined twice.
//
// Pinned contract:
//   - "The next event" is agendaItems[0] and NOTHING else: agendaItems is
//     chronological-ascending, soonest upcoming first (+page.svelte's own
//     `agendaItems = upcoming` assignment; agendaData.ts sorts). No date
//     arithmetic re-happens here.
//   - Its parts are worksByEventId[agendaItems[0].id]'s rows' non-empty
//     fileId values, IN ROW ORDER (the programme order the conductor set —
//     the order a sequential prefetch should walk).
//   - Empty agenda, or no rows resolved for the next event → [] — never a
//     throw, never undefined.
import { describe, expect, it } from 'vitest';

import { nextEventFileIds } from './nextEventFileIds';
import type { AgendaItem } from './types';
import type { WorkRow } from '$lib/repertoire/types';

function agendaItem(id: string, daysAhead: number): AgendaItem {
	return {
		id,
		name: `Event ${id}`,
		startDatetime: new Date(Date.now() + daysAhead * 24 * 3600 * 1000).toISOString(),
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	};
}

function workRow(id: string, fileId: string): WorkRow {
	return {
		id,
		kind: 'repertoire',
		workId: `work-${id}`,
		editionId: `ed-${id}`,
		workName: `Work ${id}`,
		composer: '',
		status: 'active',
		editionName: '',
		ordinal: null,
		fileId,
		fileName: fileId === '' ? '' : `${fileId}.pdf`,
		externalLinks: [],
		canBorrow: false,
		notes: ''
	};
}

describe('#409 — nextEventFileIds', () => {
	it('an empty agenda answers [] — even when the works map still holds rows from a previous load', () => {
		expect(nextEventFileIds([], { 'ev-stale': [workRow('r1', 'file-1')] })).toEqual([]);
	});

	it("answers the FIRST upcoming event's fileIds in row order, dropping rows with no file", () => {
		const agenda = [agendaItem('ev-1', 7)];
		const works = {
			'ev-1': [
				workRow('r1', 'file-b'),
				workRow('r2', ''), // an edition with no uploaded score — not a part
				workRow('r3', 'file-a')
			]
		};
		// Row order, NOT sorted: the programme order is the walk order.
		expect(nextEventFileIds(agenda, works)).toEqual(['file-b', 'file-a']);
	});

	it('consults agendaItems[0] ONLY — a later event’s parts never leak into the set', () => {
		const agenda = [agendaItem('ev-1', 7), agendaItem('ev-2', 14)];
		const works = {
			'ev-1': [workRow('r1', 'file-first')],
			'ev-2': [workRow('r2', 'file-second'), workRow('r3', 'file-third')]
		};
		const ids = nextEventFileIds(agenda, works);
		expect(ids).toEqual(['file-first']);
		expect(ids).not.toContain('file-second');
		expect(ids).not.toContain('file-third');
	});

	it('a next event whose rows have not resolved (no map entry) answers [] — never a throw', () => {
		expect(nextEventFileIds([agendaItem('ev-1', 7)], {})).toEqual([]);
	});
});

// (*MVOX:Tallis*)
