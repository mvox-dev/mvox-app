// @vitest-environment happy-dom
// The event page's data read: loadEventDetail's header, inheritance, conductors and rights.
import { describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { loadEventDetail, type EventDetail } from '$lib/events/eventDetail';
import { cfg } from '$lib/testing/pages/event';
import {
	DOUBLED_PROFILES,
	DOUBLED_SEASON_CONDUCTORS,
	entuFetchStub,
	eventEntity,
	seasonEntity,
	useEventPage
} from '$lib/testing/pages/eventDetail';

useEventPage();

describe('loadEventDetail — full header shape', () => {
	it('fetches the event and maps the FULL EventDetail shape (event conductor empty → inherits season conductors)', async () => {
		const fetchImpl = entuFetchStub();
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail).toEqual({
			id: 'ev1',
			name: 'Tuesday Rehearsal',
			eventType: 'rehearsal',
			startDatetime: '2026-09-01T16:00:00.000Z',
			durationMinutes: 90,
			location: 'Rehearsal Hall',
			description: 'Come 15 minutes early for warm-ups.',
			conductorIds: ['p-mihkel', 'p-alice'],
			conductorNames: ['Mihkel Putrinš', 'Alice Smith'],
			capacity: 20,
			ownerIds: [],
			editorIds: [],
			seasonId: 'season1',
			seasonOwnerIds: [],
			seasonEditorIds: [],
			seriesId: 'series1',
			inheritedFields: []
		});
	});

	it('carries the parent season id and its rights tiers — asked for on the ONE season read, no second GET', async () => {
		const fetchImpl = entuFetchStub({
			season: seasonEntity({
				_owner: [{ reference: 'p-boss' }],
				_editor: [{ reference: 'p-viewer' }]
			})
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.seasonId).toBe('season1');
		expect(detail.seasonOwnerIds).toEqual(['p-boss']);
		expect(detail.seasonEditorIds).toEqual(['p-viewer']);
		const seasonUrls = fetchImpl.mock.calls
			.map((c) => String(c[0]))
			.filter((u) => u.includes('/entity/season1'));
		expect(seasonUrls).toHaveLength(1);
		expect(seasonUrls[0]).toContain('_owner');
		expect(seasonUrls[0]).toContain('_editor');
		expect(
			fetchImpl.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/entity/ev1'))
		).toHaveLength(1);
	});

	it('seasonId is null (and the season rights empty) when the event has no season parent', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({ _parent: [] })
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.seasonId).toBeNull();
		expect(detail.seasonOwnerIds).toEqual([]);
		expect(detail.seasonEditorIds).toEqual([]);
	});

	it('season and series are read by type, not position: series listed first', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({
				_parent: [
					{ reference: 'series1', entity_type: 'event_series' },
					{ reference: 'season1', entity_type: 'season' }
				]
			})
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.seasonId).toBe('season1');
		expect(detail.seriesId).toBe('series1');
	});

	it('the event GET asks for event_name and NEVER the retired bare name (#420 — no fallback read)', async () => {
		const fetchImpl = entuFetchStub();
		await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		const evUrl = fetchImpl.mock.calls
			.map((c) => String(c[0]))
			.find((u) => u.includes('/entity/ev1'))!;
		const props = (/[?&]props=([^&]*)/.exec(evUrl)?.[1] ?? '').split(',');
		expect(props).toContain('event_name');
		expect(props).not.toContain('name');
	});

	it('throws on a non-2xx event response (fail loud, no silent empty detail)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(
			loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch)
		).rejects.toThrow();
	});
});

describe('loadEventDetail — series inheritance (read-time merge, verbatim listEvents semantics)', () => {
	it('missing name/duration/location/description fall back to the parent series values', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({
				event_name: undefined,
				duration_minutes: undefined,
				location: undefined,
				description: undefined
			})
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail).toMatchObject({
			name: 'Tuesday Series',
			durationMinutes: 120,
			location: 'Church Hall',
			description: 'Series default note.'
		});
	});

	it('explicit event values ALWAYS win over series defaults', async () => {
		const fetchImpl = entuFetchStub(); // full event + full series
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail).toMatchObject({
			name: 'Tuesday Rehearsal',
			durationMinutes: 90,
			location: 'Rehearsal Hall',
			description: 'Come 15 minutes early for warm-ups.'
		});
	});

	it('no series parent → event values only, absent fields default to 0/"" (no throw)', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({
				description: undefined,
				_parent: [{ reference: 'season1', entity_type: 'season' }]
			})
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail).toMatchObject({
			name: 'Tuesday Rehearsal',
			durationMinutes: 90,
			location: 'Rehearsal Hall',
			description: ''
		});
	});
});

describe('loadEventDetail — conductor resolution (#77 model via resolveConductors)', () => {
	it('event conductor OVERLAPPING the season list → override: event list only', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({ conductor: [{ reference: 'p-mihkel' }] })
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.conductorIds).toEqual(['p-mihkel']);
		expect(detail.conductorNames).toEqual(['Mihkel Putrinš']);
	});

	it('event conductor with NO overlap → merge: season list + guests, in that order', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({ conductor: [{ reference: 'p-guest' }] })
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.conductorIds).toEqual(['p-mihkel', 'p-alice', 'p-guest']);
		expect(detail.conductorNames).toEqual(['Mihkel Putrinš', 'Alice Smith', 'Guest Conductor']);
	});

	it('a conductor with no domain/public name is DROPPED from conductorNames (never a raw id, never a private-tier name)', async () => {
		const fetchImpl = entuFetchStub({
			season: seasonEntity({
				conductor: [{ reference: 'p-mihkel' }, { reference: 'p-nameless' }]
			})
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.conductorIds).toEqual(['p-mihkel', 'p-nameless']);
		expect(detail.conductorNames).toEqual(['Mihkel Putrinš']);
	});
});

type EventDetailTe2 = EventDetail & {
	capacity: number | null;
	ownerIds: string[];
	editorIds: string[];
};

describe('loadEventDetail — TE.2 capacity + _editor rights (contract extension)', () => {
	it('maps event.capacity and the visible _editor refs into capacity/editorIds', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({ _editor: [{ reference: 'p-viewer' }, { reference: 'p-other' }] })
		});
		const detail = (await loadEventDetail(
			cfg,
			'ev1',
			fetchImpl as unknown as typeof fetch
		)) as EventDetailTe2;
		expect(detail.capacity).toBe(20);
		expect(detail.editorIds).toEqual(['p-viewer', 'p-other']);
	});

	it('capacity is null (never 0) when the event carries none; editorIds [] when _editor is invisible', async () => {
		const fetchImpl = entuFetchStub({ event: eventEntity({ capacity: undefined }) });
		const detail = (await loadEventDetail(
			cfg,
			'ev1',
			fetchImpl as unknown as typeof fetch
		)) as EventDetailTe2;
		expect(detail.capacity).toBeNull();
		expect(detail.ownerIds).toEqual([]);
		expect(detail.editorIds).toEqual([]);
	});

	it('reads BOTH rights tiers and maps _owner into ownerIds (owner-or-editor is one rule, not two)', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({
				_owner: [{ reference: 'p-viewer' }],
				_editor: [{ reference: 'p-other' }]
			})
		});
		const detail = (await loadEventDetail(
			cfg,
			'ev1',
			fetchImpl as unknown as typeof fetch
		)) as EventDetailTe2;
		expect(detail.ownerIds).toEqual(['p-viewer']);
		expect(detail.editorIds).toEqual(['p-other']);
		const eventUrl = fetchImpl.mock.calls
			.map((c) => String(c[0]))
			.find((u) => u.includes('/entity/ev1'));
		expect(eventUrl).toContain('_owner');
	});
});

describe('#483 loadEventDetail — a doubled conductor reference resolves to each person ONCE', () => {
	it('season conductors [ada, ada, grace], no event conductor → conductorIds [ada, grace], conductorNames aligned', async () => {
		const fetchImpl = entuFetchStub({
			season: seasonEntity({ conductor: DOUBLED_SEASON_CONDUCTORS }),
			profiles: DOUBLED_PROFILES
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.conductorIds).toEqual(['p-ada', 'p-grace']);
		expect(detail.conductorNames).toEqual(['Ada Lovelace', 'Grace Hopper']);
	});

	it('the doubled person is resolved (profile read) ONCE — the dedupe happens before names are resolved', async () => {
		const fetchImpl = entuFetchStub({
			season: seasonEntity({ conductor: DOUBLED_SEASON_CONDUCTORS }),
			profiles: DOUBLED_PROFILES
		});
		await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		const profileReadsFor = (personId: string) =>
			fetchImpl.mock.calls
				.map((c) => String(c[0]))
				.filter(
					(u) => u.includes('_type.string=profile') && u.includes(`_parent.reference=${personId}&`)
				);
		expect(profileReadsFor('p-ada').length).toBe(1);
		expect(profileReadsFor('p-grace').length).toBe(1);
	});

	it('event conductor values [ada, ada] (overriding a season that holds ada) → conductorIds [ada]', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({ conductor: [{ reference: 'p-ada' }, { reference: 'p-ada' }] }),
			season: seasonEntity({ conductor: [{ reference: 'p-ada' }, { reference: 'p-grace' }] }),
			profiles: DOUBLED_PROFILES
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.conductorIds).toEqual(['p-ada']);
		expect(detail.conductorNames).toEqual(['Ada Lovelace']);
	});

	it('two DIFFERENT people sharing a display name both stay — distinct by id, never by name', async () => {
		const fetchImpl = entuFetchStub({
			season: seasonEntity({
				conductor: [{ reference: 'p-ada' }, { reference: 'p-other-ada' }, { reference: 'p-ada' }]
			}),
			profiles: DOUBLED_PROFILES
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.conductorIds).toEqual(['p-ada', 'p-other-ada']);
		expect(detail.conductorNames).toEqual(['Ada Lovelace', 'Ada Lovelace']);
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
