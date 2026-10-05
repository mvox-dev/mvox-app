// Event page specs: the Entu wire stubs, fixtures and setup their files share.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';
import Page from '../../../routes/event/[id]/+page.svelte';
import { resetAppState } from '$lib/testing/appReset';
import { localeMock } from '$lib/testing/mocks/session';
import { pageStub } from '$lib/testing/mocks/events';
import { editorTokenAtNow, setAuthedWithSampledb } from '$lib/testing/pages/event';

export type AppLocale = 'en' | 'et' | 'lv' | 'uk';

export function setAppLocale(locale: AppLocale): void {
	localeMock.state?.set('locale', locale);
}

export function eventEntity(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		event_name: [{ string: 'Tuesday Rehearsal' }],
		event_type: [{ string: 'rehearsal' }],
		start_datetime: [{ datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ number: 90 }],
		location: [{ string: 'Rehearsal Hall' }],
		description: [{ string: 'Come 15 minutes early for warm-ups.' }],
		capacity: [{ number: 20 }],
		_parent: [
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 'series1', entity_type: 'event_series' }
		],
		...over
	};
}

export function seasonEntity(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }],
		conductor: [{ reference: 'p-mihkel' }, { reference: 'p-alice' }],
		...over
	};
}

export function seriesEntity(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'series1',
		name: [{ string: 'Tuesday Series' }],
		duration_minutes: [{ number: 120 }],
		default_location: [{ string: 'Church Hall' }],
		default_description: [{ string: 'Series default note.' }],
		...over
	};
}

export const PROFILES: Record<string, unknown[]> = {
	'p-mihkel': [
		{ _id: 'prof-m', name: [{ string: 'Mihkel Putrinš' }], _sharing: [{ string: 'domain' }] }
	],
	'p-alice': [
		{ _id: 'prof-a-priv', name: [{ string: 'Alice Hidden' }], _sharing: [{ string: 'private' }] },
		{ _id: 'prof-a-pub', name: [{ string: 'Alice Smith' }], _sharing: [{ string: 'public' }] }
	],
	'p-guest': [
		{ _id: 'prof-g', name: [{ string: 'Guest Conductor' }], _sharing: [{ string: 'domain' }] }
	],
	'p-nameless': [{ _id: 'prof-n', name: [], _sharing: [{ string: 'domain' }] }]
};

export type Fixtures = {
	event?: Record<string, unknown>;
	season?: Record<string, unknown>;
	series?: Record<string, unknown>;
	profiles?: Record<string, unknown[]>;
};

export function entuFetchStub(fixtures: Fixtures = {}) {
	const event = fixtures.event ?? eventEntity();
	const season = fixtures.season ?? seasonEntity();
	const series = fixtures.series ?? seriesEntity();
	const profiles = fixtures.profiles ?? PROFILES;
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/entity/p-viewer') && url.includes('props=_owner')) {
			return json({ entity: { _id: 'p-viewer', _editor: [{ reference: 'p-viewer' }] } });
		}
		if (url.includes('/entity/ev1')) return json({ entity: event });
		if (url.includes('/entity/season1')) return json({ entity: season });
		if (url.includes('/entity/series1')) return json({ entity: series });
		if (url.includes('_type.string=profile')) {
			for (const [personId, list] of Object.entries(profiles)) {
				if (url.includes(personId) || url.includes(encodeURIComponent(personId)))
					return json({ entities: list });
			}
			return json({ entities: [] });
		}
		if (url.includes('_type.string=season')) return json({ entities: [season] });
		if (url.includes('_type.string=event_series')) return json({ entities: [series] });
		if (url.includes('_type.string=member') && url.includes('status.string=active')) {
			return json({ entities: activeMemberEntitiesForEv1() });
		}
		if (url.includes('_type.string=event')) return json({ entities: [event] });
		return json({ entities: [] });
	});
}

export function allRsvpsForEv1(): unknown[] {
	const rows: unknown[] = [
		{ _id: 'rsvp-77', member: [{ reference: 'member-1' }], status: [{ string: 'going' }] }
	];
	for (let i = 0; i < 11; i++)
		rows.push({ _id: `rsvp-g${i}`, member: [{ reference: `m-g${i}` }], status: [{ string: 'going' }] });
	for (let i = 0; i < 2; i++)
		rows.push({
			_id: `rsvp-n${i}`,
			member: [{ reference: `m-n${i}` }],
			status: [{ string: 'not_going' }]
		});
	rows.push({ _id: 'rsvp-m0', member: [{ reference: 'm-m0' }], status: [{ string: 'maybe' }] });
	return rows;
}

export function activeMemberEntitiesForEv1(): unknown[] {
	const memberIds = new Set<string>(
		allRsvpsForEv1().map((row) => (row as { member: Array<{ reference: string }> }).member[0].reference)
	);
	return [...memberIds].map((id) => ({ _id: id, person: [{ reference: `p-${id}` }] }));
}

export function rsvpWireStub(fixtures: Fixtures = {}, opts: { myRsvp?: boolean } = {}) {
	const base = entuFetchStub(fixtures);
	const myRsvp = opts.myRsvp ?? true;
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/')) return json({ deleted: true });
		if (url.includes('/entity/rsvp-77')) {
			if (method === 'POST') return json({});
			return json({
				entity: {
					_id: 'rsvp-77',
					status: [{ _id: 'val-status-1' }],
					event: [{ reference: 'ev1' }],
					going_ref: [{ _id: 'val-sentinel-1' }]
				}
			});
		}
		if (url.includes('_type.string=member') && url.includes('person.reference=p-viewer'))
			return json({ entities: [{ _id: 'member-1' }] });
		if (url.includes('_type.string=rsvp')) {
			if (url.includes('_parent.reference=p-viewer'))
				return json({
					entities: myRsvp
						? [{ _id: 'rsvp-77', event: [{ reference: 'ev1' }], status: [{ string: 'going' }] }]
						: []
				});
			if (url.includes('event.reference=ev1')) return json({ entities: allRsvpsForEv1() });
			return json({ entities: [] });
		}
		return base(input);
	});
}

export function renderWithFetch(fetchStub: ReturnType<typeof vi.fn>) {
	vi.stubGlobal('fetch', fetchStub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
	const rendered = render(Page);
	return { ...rendered, fetchStub };
}

export function pastEventEntity(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({
		start_datetime: [{ datetime: '2026-08-19T16:00:00.000Z' }],
		...over
	});
}

export const VIEWER_PROFILE: Record<string, unknown[]> = {
	'p-viewer': [
		{ _id: 'prof-v', name: [{ string: 'Viewer Vera' }], _sharing: [{ string: 'domain' }] }
	]
};

export function repertoireItemsFixture(): unknown[] {
	return [
		{
			_id: 'ri-1',
			name: [{ string: 'Bogoróditse Djévo' }],
			work: [{ reference: 'w-1' }],
			status: [{ string: 'active' }]
		},
		{
			_id: 'ri-2',
			name: [{ string: 'Locus iste' }],
			work: [{ reference: 'w-2' }],
			status: [{ string: 'learning' }]
		}
	];
}

export function libraryWorksFixture(): unknown[] {
	return [
		{ _id: 'w-1', name: [{ string: 'Bogoróditse Djévo' }], composer: [{ string: 'Arvo Pärt' }] },
		{ _id: 'w-2', name: [{ string: 'Locus iste' }], composer: [{ string: 'Anton Bruckner' }] }
	];
}

export function activeMembersFixture(): unknown[] {
	return [
		{ _id: 'member-1', person: [{ reference: 'p-viewer' }] },
		{ _id: 'member-2', person: [{ reference: 'p-mihkel' }] },
		{ _id: 'member-3', person: [{ reference: 'p-alice' }] },
		{ _id: 'member-4', person: [{ reference: 'p-guest' }] }
	];
}

export type AttendanceRaw = {
	_id: string;
	member?: Array<{ reference: string }>;
	status?: Array<{ string: string }>;
};

export function attendanceForEv1(): AttendanceRaw[] {
	return [
		{ _id: 'att-1', member: [{ reference: 'member-1' }], status: [{ string: 'present' }] },
		{ _id: 'att-2', member: [{ reference: 'member-2' }], status: [{ string: 'present' }] },
		{ _id: 'att-3', member: [{ reference: 'member-3' }], status: [{ string: 'absent' }] },
		{ _id: 'att-4', member: [{ reference: 'member-4' }], status: [{ string: 'late' }] }
	];
}

export type ComposeFixtures = Fixtures & {
	programItems?: unknown[];
	repertoireItems?: unknown[];
	works?: unknown[];
	editions?: unknown[];
	copies?: unknown[];
	members?: unknown[];
	workCount?: number;
	editionCount?: number;
	memberCount?: number;
	attendance?: AttendanceRaw[];
	realNames?: boolean | 'off';
};

export const RN_DB_ENTITY = 'db-ent-fence';

export const RN_RECORD_NAMES: Record<string, string> = {
	'p-viewer': 'Zoe Zeta',
	'p-mihkel': 'Aaron Aardvark',
	'p-alice': 'Yuri Yew',
	'p-guest': 'Bruno Birch'
};

export function composeWireStub(fixtures: ComposeFixtures = {}) {
	const profiles = { ...PROFILES, ...VIEWER_PROFILE, ...(fixtures.profiles ?? {}) };
	const base = rsvpWireStub({
		event: fixtures.event,
		season: fixtures.season,
		series: fixtures.series,
		profiles
	});
	const programItems = fixtures.programItems ?? [];
	const repertoireItems = fixtures.repertoireItems ?? repertoireItemsFixture();
	const works = fixtures.works ?? libraryWorksFixture();
	const editions = fixtures.editions ?? [];
	const copies = fixtures.copies ?? [];
	const members = fixtures.members ?? activeMembersFixture();
	const attendance = fixtures.attendance ?? attendanceForEv1();
	const myAttendance = attendance
		.filter((r) => r.member?.[0]?.reference === 'member-1')
		.map((r) => ({ _id: r._id, _parent: [{ reference: 'ev1' }], status: r.status }));
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (fixtures.realNames) {
			if (url.includes('_type.string=admin_member_record')) {
				return json({
					entities: Object.entries(RN_RECORD_NAMES).map(([personId, name]) => ({
						_id: `rec-${personId}`,
						person: [{ reference: personId }],
						name: [{ string: name }]
					}))
				});
			}
			if (url.includes('_type.string=database')) {
				return json({ entities: [{ _id: RN_DB_ENTITY }] });
			}
			if (url.includes(`entity/${RN_DB_ENTITY}`) && url.includes('roster_show_real_names')) {
				return json({
					entity: {
						_id: RN_DB_ENTITY,
						roster_show_real_names: [
							{ _id: 'v-toggle', boolean: fixtures.realNames !== 'off' }
						]
					}
				});
			}
		}
		if (url.includes('_type.string=program_item')) return json({ entities: programItems });
		if (url.includes('_type.string=repertoire_item')) return json({ entities: repertoireItems });
		if (url.includes('_type.string=work'))
			return json(
				fixtures.workCount === undefined
					? { entities: works }
					: { count: fixtures.workCount, entities: works }
			);
		if (url.includes('_type.string=edition'))
			return json(
				fixtures.editionCount === undefined
					? { entities: editions }
					: { count: fixtures.editionCount, entities: editions }
			);
		if (url.includes('_type.string=copy')) return json({ entities: copies });
		if (url.includes('_type.string=member') && !url.includes('person.reference'))
			return json(
				fixtures.memberCount === undefined
					? { entities: members }
					: { count: fixtures.memberCount, entities: members }
			);
		if (url.includes('_type.string=attendance')) {
			if (url.includes('_parent.reference=ev1')) return json({ entities: attendance });
			if (url.includes('member.reference=member-1')) return json({ entities: myAttendance });
			return json({ entities: [] });
		}
		return base(input, init);
	});
}

export function renderComposePage(fixtures: ComposeFixtures = {}) {
	return renderWithFetch(composeWireStub(fixtures));
}

export const DOUBLED_PROFILES: Record<string, unknown[]> = {
	...PROFILES,
	'p-ada': [{ _id: 'prof-ada', name: [{ string: 'Ada Lovelace' }], _sharing: [{ string: 'domain' }] }],
	'p-grace': [
		{ _id: 'prof-grace', name: [{ string: 'Grace Hopper' }], _sharing: [{ string: 'domain' }] }
	],
	'p-other-ada': [
		{ _id: 'prof-other-ada', name: [{ string: 'Ada Lovelace' }], _sharing: [{ string: 'domain' }] }
	]
};

export const DOUBLED_SEASON_CONDUCTORS = [
	{ reference: 'p-ada' },
	{ reference: 'p-ada' },
	{ reference: 'p-grace' }
];

export function useEventPage(): void {
	beforeEach(editorTokenAtNow);

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.useRealTimers();
		resetAppState();
		setAppLocale('en');
	});
}

// (*MVOX:Tallis*) (*MVOX:Josquin*)
