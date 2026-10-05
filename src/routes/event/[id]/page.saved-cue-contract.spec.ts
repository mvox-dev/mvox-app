// @vitest-environment happy-dom
// Each write surface on the event page says "saved" only for its own settled write.
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import {
	PROFILES,
	cleanupRealTimersResetTypes,
	editorTokenAtNow,
	flushMicrotasks,
	scheduleEntity,
	seasonEntity,
	setAuthed
} from '$lib/testing/pages/event';
import { MY_RSVP_ROW } from '$lib/testing/pages/eventRsvp';
import { seriesEntity } from '$lib/testing/pages/eventFixtures';
import { q } from '$lib/testing/pages/dom';
import { rowByName } from '$lib/testing/pages/seasonRepertoire';
import { reaches } from '$lib/testing/pageReach';
import { findSourceFiles } from '$lib/testing/soleLiteralGuard';

const SAVED = /\bm\.[a-z_]+_saved\(/;

type Write = { hold: Promise<void> | null; fail: boolean };
type Route = (url: string, method: string, init: RequestInit | undefined, write: Write) => Promise<Response | undefined>;

type Surface = {
	component: string;
	persistent: boolean;
	/** A cue still on screen after a collective switch; that case is expected to fail. */
	staysAfterSwitch?: boolean;
	event: Record<string, unknown>;
	route: Route;
	ready: (container: HTMLElement) => Promise<unknown>;
	write: (container: HTMLElement) => Promise<unknown>;
	status: string;
	saved: string;
	error: string;
};

const settled = async (write: Write, ok: () => Response) => {
	if (write.hold) await write.hold;
	return write.fail ? json({ error: 'nope' }, 500) : ok();
};

const until = (container: HTMLElement, testid: string) =>
	waitFor(() => {
		expect(q(container, testid), testid).not.toBeNull();
		return q(container, testid)!;
	});

function editableEvent(over: Record<string, unknown> = {}) {
	return {
		_id: 'ev1',
		event_name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
		event_type: [{ _id: 'val-type-1', string: 'rehearsal' }],
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ _id: 'val-dur-1', number: 90 }],
		location: [{ _id: 'val-loc-1', string: 'Rehearsal Hall' }],
		_editor: [{ reference: 'p-viewer' }],
		_parent: [
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 'series1', entity_type: 'event_series' }
		],
		...over
	};
}

const MEMBERS: Record<string, string> = { m1: 'pp-1', m2: 'pp-2' };

const SURFACES: Record<string, Surface> = {
	rsvp: {
		component: 'src/lib/components/agenda/RsvpControl.svelte',
		persistent: true,
		event: editableEvent(),
		route: async (url, method, _init, write) => {
			if (url.includes('/entity/p-viewer') && url.includes('props=_owner')) {
				return json({ entity: { _id: 'p-viewer', _editor: [{ reference: 'p-viewer' }] } });
			}
			if (url.includes('/entity/rsvp-77')) {
				if (method === 'POST') return settled(write, () => json({}));
				return json({
					entity: { _id: 'rsvp-77', status: [{ _id: 'val-status-1' }], event: [{ reference: 'ev1' }] }
				});
			}
			if (url.includes('_type.string=member') && url.includes('person.reference=p-viewer')) {
				return json({ entities: [{ _id: 'member-1' }] });
			}
			if (url.includes('_type.string=rsvp') && url.includes('event.reference=ev1')) {
				return json({ entities: url.includes('_parent.reference=p-viewer') ? [MY_RSVP_ROW] : [] });
			}
			return undefined;
		},
		ready: (c) =>
			waitFor(() => {
				const going = q<HTMLButtonElement>(c, 'rsvp-btn-going');
				expect(going?.getAttribute('aria-pressed')).toBe('true');
				expect(going?.disabled).toBe(false);
			}),
		write: (c) => fireEvent.click(q(c, 'rsvp-btn-not_going')!),
		status: 'rsvp-saved-status',
		saved: '[rsvp_saved]',
		error: 'rsvp-save-failed'
	},
	attendance: {
		component: 'src/lib/components/attendance/AttendanceSurface.svelte',
		persistent: true,
		event: editableEvent({ start_datetime: [{ _id: 'val-start-1', datetime: '2026-08-19T16:00:00.000Z' }] }),
		route: async (url, method, _init, write) => {
			if (method === 'POST' && /\/entity(\?|$)/.test(url)) return settled(write, () => json({ _id: 'att-new' }));
			if (url.includes('name.string=attendance')) return json({ entities: [{ _id: 'type-attendance' }] });
			if (url.includes('_type.string=member') && url.includes('person.reference')) {
				return json({ entities: [{ _id: 'm1' }] });
			}
			if (url.includes('_type.string=member')) {
				return json({
					entities: Object.entries(MEMBERS).map(([id, person]) => ({ _id: id, person: [{ reference: person }] }))
				});
			}
			if (url.includes('_type.string=profile')) {
				const person = /_parent\.reference=([^&]+)/.exec(url)?.[1] ?? '';
				return json({
					entities: [{ _id: `prof-${person}`, name: [{ string: `Name ${person}` }], _sharing: [{ string: 'domain' }] }]
				});
			}
			if (url.includes('/entity/season1')) {
				return json({ entity: { ...seasonEntity(), conductor: [{ reference: 'p-viewer' }] } });
			}
			return undefined;
		},
		ready: async (c) => {
			await fireEvent.click(await until(c, 'take-attendance-btn'));
			await until(c, 'attendance-toggle-m1-present');
		},
		write: (c) => fireEvent.click(q(c, 'attendance-toggle-m1-present')!),
		status: 'attendance-saved-status-m1',
		saved: '[attendance_saved]',
		error: 'attendance-save-failed-m1'
	},
	'event field': {
		component: 'src/lib/events/EventFieldEdit.svelte',
		persistent: true,
		event: editableEvent(),
		route: async (url, method, _init, write) =>
			url.includes('/entity/ev1') && method === 'POST' ? settled(write, () => json({})) : undefined,
		ready: (c) => until(c, 'event-edit-btn-name'),
		write: async (c) => {
			await fireEvent.click(q(c, 'event-edit-btn-name')!);
			const input = await until(c, 'event-edit-input-name');
			await fireEvent.input(input, { target: { value: 'Thursday Rehearsal' } });
			await fireEvent.blur(input);
		},
		status: 'event-edit-status',
		saved: '[event_edit_saved]',
		error: 'event-edit-error-name'
	},
	schedule: {
		component: 'src/lib/events/EventScheduleSection.svelte',
		persistent: true,
		event: editableEvent(),
		route: async (url, method, _init, write) => {
			if (url.includes('name.string=schedule_item')) return json({ entities: [{ _id: 'type-schedule-item' }] });
			if (url.includes('_type.string=schedule_item')) {
				return json({ entities: [scheduleEntity('si1', 'kogunemine', '2026-09-01T14:30:00.000Z')] });
			}
			if (url.includes('/entity/si1')) {
				if (method === 'POST') return settled(write, () => json({}));
				return json({ entity: scheduleEntity('si1', 'kogunemine', '2026-09-01T14:30:00.000Z') });
			}
			return undefined;
		},
		ready: (c) => until(c, 'event-schedule-edit-si1'),
		write: async (c) => {
			await fireEvent.click(q(c, 'event-schedule-edit-si1')!);
			const input = await until(c, 'event-schedule-edit-name-si1');
			await fireEvent.input(input, { target: { value: 'kutse' } });
			await fireEvent.blur(input);
		},
		status: 'event-schedule-status',
		saved: '[event_schedule_saved]',
		error: 'event-schedule-error-si1'
	},
	works: {
		component: 'src/lib/events/EventWorksSection.svelte',
		persistent: true,
		event: editableEvent({ _parent: [{ reference: 'season1', entity_type: 'season' }] }),
		route: async (url, method, _init, write) => {
			if (url.includes('/entity/ri-1') && method === 'POST') return settled(write, () => json({ _id: 'ri-1' }));
			if (url.includes('/entity/ri-1?props=status')) return json({ entity: { status: [{ _id: 'val-status-ri-1' }] } });
			if (url.includes('/entity/season1')) {
				return json({ entity: { ...seasonEntity(), _editor: [{ reference: 'p-viewer' }] } });
			}
			if (url.includes('_type.string=repertoire_item')) {
				return json({
					entities: [
						{
							_id: 'ri-1',
							name: [{ string: 'Bogoróditse Djévo' }],
							work: [{ reference: 'w-1' }],
							status: [{ string: 'active' }]
						}
					]
				});
			}
			if (url.includes('_type.string=work')) {
				return json({ entities: [{ _id: 'w-1', name: [{ string: 'Bogoróditse Djévo' }], composer: [{ string: 'Arvo Pärt' }] }] });
			}
			return undefined;
		},
		ready: (c) =>
			waitFor(() => {
				const section = q(c, 'event-detail-works');
				expect(q(rowByName(section!, 'Bogoróditse Djévo'), 'work-status-retired')).not.toBeNull();
			}),
		write: (c) => fireEvent.click(q(rowByName(q(c, 'event-detail-works')!, 'Bogoróditse Djévo'), 'work-status-retired')!),
		status: 'repertoire-manage-status',
		saved: '[repertoire_manage_saved]',
		error: 'repertoire-manage-error'
	},
	series: {
		component: 'src/lib/events/EventSeriesPicker.svelte',
		// Its region mounts with the message (#304), not before the write like the others (#328).
		persistent: false,
		staysAfterSwitch: true,
		event: editableEvent({
			description: [{ _id: 'val-desc-1', string: 'Own note.' }],
			_editor: [],
			_owner: [{ reference: 'p-viewer' }],
			_parent: [
				{ _id: 'pv-season', reference: 'season1', entity_type: 'season' },
				{ _id: 'pv-series', reference: 'series1', entity_type: 'event_series' }
			]
		}),
		route: async (url, method, _init, write) => {
			if (url.includes('/entity/ev1') && method === 'POST') return settled(write, () => json({}));
			if (url.includes('_type.string=event_series')) {
				return json({
					entities: [
						{ _id: 'series1', name: [{ string: 'Tuesday Series' }] },
						{ _id: 'series2', name: [{ string: 'Wednesday Series' }] }
					]
				});
			}
			if (url.includes('/entity/series2')) return json({ entity: { _id: 'series2', name: [{ string: 'Wednesday Series' }] } });
			return undefined;
		},
		ready: (c) => waitFor(() => expect(q(c, 'event-series-select')?.querySelectorAll('option').length).toBeGreaterThan(1)),
		write: (c) => fireEvent.change(q(c, 'event-series-select')!, { target: { value: 'series2' } }),
		status: 'event-series-status',
		saved: '[event_detail_series_saved]',
		error: 'event-series-error'
	}
};

function renderSurface(surface: Surface, dbs: string[] = ['sampledb']) {
	const write: Write = { hold: null, fail: false };
	const wire = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const own = await surface.route(url, method, init, write);
		if (own) return own;
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/ev1')) return json({ entity: surface.event });
		if (url.includes('/entity/season1')) return json({ entity: seasonEntity() });
		if (url.includes('/entity/series1')) return json({ entity: seriesEntity() });
		if (url.includes('_type.string=profile')) {
			const found = Object.entries(PROFILES).find(([person]) => url.includes(person));
			return json({ entities: found?.[1] ?? [] });
		}
		return json({ entities: [] });
	});
	vi.stubGlobal('fetch', wire);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed(dbs);
	return { ...render(Page), write, wire };
}

const statusText = (container: HTMLElement, surface: Surface) =>
	q(container, surface.status)?.textContent?.trim() ?? '';

beforeEach(editorTokenAtNow);

afterEach(cleanupRealTimersResetTypes);

describe('the saved cue, on every write surface of the event page', () => {
	it('the table covers every component on the event page that says saved', () => {
		const saysSaved = (file: string) => file.endsWith('.svelte') && SAVED.test(readFileSync(file, 'utf-8'));
		const found = [...new Set(findSourceFiles('src', ['.svelte']))].filter(
			(file) => saysSaved(file) && reaches('src/routes/event/[id]/+page.svelte', file)
		);
		expect(found.sort()).toEqual(Object.values(SURFACES).map((s) => s.component).sort());
	});

	const persistent = Object.keys(SURFACES).filter((name) => SURFACES[name].persistent);
	it.each(persistent)('%s: a blank role=status region is there before any write', async (name) => {
		const surface = SURFACES[name];
		const { container } = renderSurface(surface);
		await surface.ready(container);

		const region = q(container, surface.status);
		expect(region?.getAttribute('role')).toBe('status');
		expect(region?.getAttribute('aria-live')).toBe('polite');
		expect(statusText(container, surface)).toBe('');
		expect(container.querySelectorAll(`[data-testid="${surface.status}"]`)).toHaveLength(1);
	});

	it.each(Object.keys(SURFACES))('%s: says nothing while the write is in flight, then saved once it settles', async (name) => {
		const surface = SURFACES[name];
		const { container, write } = renderSurface(surface);
		await surface.ready(container);
		const held = deferred<void>();
		write.hold = held.promise;

		await surface.write(container);
		await flushMicrotasks();
		expect(statusText(container, surface)).toBe('');

		held.resolve();
		await waitFor(() => expect(statusText(container, surface)).toContain(surface.saved));
		expect(q(container, surface.error)).toBeNull();
	});

	it.each(Object.keys(SURFACES))('%s: a failed write raises role=alert and no saved cue', async (name) => {
		const surface = SURFACES[name];
		const { container, write, wire } = renderSurface(surface);
		await surface.ready(container);
		write.fail = true;

		await surface.write(container);

		await waitFor(() => expect(q(container, surface.error)?.getAttribute('role')).toBe('alert'));
		expect(wire.mock.calls.some(([, init]) => (init?.method ?? 'GET') === 'POST')).toBe(true);
		expect(statusText(container, surface)).toBe('');
		expect(container.textContent).not.toContain(surface.saved);
	});

	it.each(Object.keys(SURFACES))('%s: a write that settles after a collective switch never paints the cue', async (name) => {
		const surface = SURFACES[name];
		const { container, write, wire } = renderSurface(surface, ['sampledb', 'other-choir']);
		await surface.ready(container);
		const held = deferred<void>();
		write.hold = held.promise;
		await surface.write(container);

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => expect(wire.mock.calls.some(([url]) => String(url).includes('/other-choir/'))).toBe(true));
		await surface.ready(container);
		held.resolve();
		await flushMicrotasks();

		expect(statusText(container, surface)).toBe('');
		expect(container.textContent).not.toContain(surface.saved);
	});

	async function settledThenSwitch(name: string) {
		const surface = SURFACES[name];
		const { container, wire } = renderSurface(surface, ['sampledb', 'other-choir']);
		await surface.ready(container);
		await surface.write(container);
		await waitFor(() => expect(statusText(container, surface)).toContain(surface.saved));

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => expect(wire.mock.calls.some(([url]) => String(url).includes('/other-choir/'))).toBe(true));
		await surface.ready(container);

		expect(statusText(container, surface)).toBe('');
	}

	const names = Object.keys(SURFACES);
	it.each(names.filter((name) => !SURFACES[name].staysAfterSwitch))(
		'%s: a settled cue does not follow the viewer to the next collective',
		settledThenSwitch
	);
	it.fails.each(names.filter((name) => SURFACES[name].staysAfterSwitch))(
		'%s: known gap, the settled cue follows the viewer to the next collective',
		settledThenSwitch
	);
});

// (*MVOX:Josquin*)
