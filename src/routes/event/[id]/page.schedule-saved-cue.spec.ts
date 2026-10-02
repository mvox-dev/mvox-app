// @vitest-environment happy-dom
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '$lib/auth/storage';
import { deferred, json } from '$lib/testing/entuFetchKit';

const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
	setToken('jwt-editor');
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

const { gotoMock, discoverMock } = vi.hoisted(() => ({ gotoMock: vi.fn(), discoverMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { fillDateTime } from '$lib/testing/timeControls';

function eventEntity() {
	return {
		_id: 'ev1',
		event_name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
		event_type: [{ _id: 'val-type-1', string: 'rehearsal' }],
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ _id: 'val-dur-1', number: 90 }],
		location: [{ _id: 'val-loc-1', string: 'Rehearsal Hall' }],
		description: [{ _id: 'val-desc-1', string: 'Come 15 minutes early.' }],
		capacity: [{ _id: 'val-cap-1', number: 20 }],
		_editor: [{ reference: 'p-viewer' }],
		_parent: [
			{ reference: 'org1', entity_type: 'organization' },
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 'series1', entity_type: 'event_series' }
		]
	};
}

function seasonEntity() {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }],
		conductor: [{ reference: 'p-mihkel' }]
	};
}

function seriesEntity() {
	return {
		_id: 'series1',
		name: [{ string: 'Tuesday Series' }],
		duration_minutes: [{ number: 120 }]
	};
}

const PROFILES: Record<string, unknown[]> = {
	'p-mihkel': [
		{ _id: 'prof-m', name: [{ string: 'Mihkel Putrinš' }], _sharing: [{ string: 'domain' }] }
	]
};

function scheduleEntity(id: string, name: string, iso: string) {
	return {
		_id: id,
		name: [{ _id: `val-${id}-name`, string: name }],
		datetime: [{ _id: `val-${id}-dt`, datetime: iso }]
	};
}

function defaultScheduleEntities() {
	return [
		scheduleEntity('si1', 'kogunemine', '2026-09-01T14:30:00.000Z'), // 17:30 Tallinn
		scheduleEntity('si2', 'proov', '2026-09-01T15:00:00.000Z') // 18:00 Tallinn
	];
}

type WireControls = {
	failItemWrites: boolean;
	holdItemPost: Promise<void> | null;
};

function scheduleWireStub(controls: WireControls) {
	const event = eventEntity();
	const season = seasonEntity();
	const series = seriesEntity();
	let schedule: Array<Record<string, unknown>> = defaultScheduleEntities();
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (method === 'DELETE' && url.includes('/entity/')) {
			if (controls.failItemWrites) return json({ error: 'nope' }, 500);
			const id = url.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			schedule = schedule.filter((s) => s._id !== id);
			return json({ deleted: true });
		}
		if (url.includes('name.string=schedule_item')) {
			return json({ entities: [{ _id: 'type-schedule-item' }] });
		}
		if (url.includes('_type.string=schedule_item')) {
			return json({ entities: schedule });
		}
		if (method === 'POST' && /\/entity(\?|$)/.test(url)) {
			const props = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
			const name = props.find((p) => p.type === 'name');
			const datetime = props.find((p) => p.type === 'datetime');
			schedule = [
				...schedule,
				scheduleEntity('si-new', String(name?.string ?? ''), String(datetime?.datetime ?? ''))
			];
			return json({ _id: 'si-new' });
		}
		if (method === 'POST' && url.includes('/entity/')) {
			if (controls.holdItemPost) await controls.holdItemPost;
			if (controls.failItemWrites) return json({ error: 'nope' }, 500);
			const id = url.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			const props = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
			schedule = schedule.map((s) => {
				if (s._id !== id) return s;
				const next = { ...s };
				for (const prop of props) {
					const { type, ...valueParts } = prop;
					next[String(type)] = [{ _id: `val-${id}-${String(type)}-new`, ...valueParts }];
				}
				return next;
			});
			return json({});
		}
		if (url.includes('/entity/ev1')) return json({ entity: event });
		if (url.includes('/entity/si')) {
			const id = url.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			return json({ entity: schedule.find((s) => s._id === id) ?? {} });
		}
		if (url.includes('/entity/season1')) return json({ entity: season });
		if (url.includes('/entity/series1')) return json({ entity: series });
		if (url.includes('_type.string=profile')) {
			for (const [personId, list] of Object.entries(PROFILES)) {
				if (url.includes(personId) || url.includes(encodeURIComponent(personId)))
					return json({ entities: list });
			}
			return json({ entities: [] });
		}
		if (url.includes('_type.string=season')) return json({ entities: [season] });
		if (url.includes('_type.string=event_series')) return json({ entities: [series] });
		if (url.includes('_type.string=event')) return json({ entities: [event] });
		return json({ entities: [] });
	});
	return stub;
}

function setAuthed(dbs: string[] = ['sampledb']) {
	authStore.set({
		status: 'authenticated',
		personIdByDb: Object.fromEntries(dbs.map((db) => [db, 'p-viewer'])),
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: dbs.map((db) => ({ db, name: db, personId: 'p-viewer' })),
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(dbs[0]);
}

function renderSchedulePage(dbs: string[] = ['sampledb']) {
	const controls: WireControls = { failItemWrites: false, holdItemPost: null };
	const stub = scheduleWireStub(controls);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed(dbs);
	const rendered = render(Page);
	return { ...rendered, fetchStub: stub, controls };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetTypeIdCache();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function scheduleSection(container: HTMLElement): HTMLElement | null {
	return q(container, 'event-detail-schedule');
}

async function waitReady(container: HTMLElement) {
	await waitFor(() => {
		expect(q(container, 'event-detail-name')?.textContent).toContain('Tuesday Rehearsal');
	});
}

async function openRowEditor(container: HTMLElement, id: string): Promise<void> {
	await waitFor(() => {
		expect(q(container, `event-schedule-edit-${id}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `event-schedule-edit-${id}`)!);
	await waitFor(() => {
		expect(q(container, `event-schedule-edit-name-${id}`)).not.toBeNull();
	});
}

async function commitRowNameEdit(container: HTMLElement, id: string, value: string): Promise<void> {
	await openRowEditor(container, id);
	const nameInput = q(container, `event-schedule-edit-name-${id}`)!;
	await fireEvent.input(nameInput, { target: { value } });
	await fireEvent.blur(nameInput);
}

describe('#328 schedule items — the saved-cue region exists from first render', () => {
	it('editor view: a PERSISTENT empty role="status" aria-live="polite" region (event-schedule-status) is mounted BEFORE any write, exactly one', async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(scheduleSection(container)).not.toBeNull();
		});

		const status = q(container, 'event-schedule-status');
		expect(status, 'expected the persistent event-schedule-status region').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.getAttribute('aria-live')).toBe('polite');
		expect(status!.textContent?.trim()).toBe('');
		expect(container.querySelectorAll('[data-testid="event-schedule-status"]')).toHaveLength(1);
	});

	it('one node per SURFACE (Gama’s ruling): event-schedule-status, event-edit-status and #324’s repertoire-manage-status are three DISTINCT nodes on this one page', async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(q(container, 'event-schedule-status')).not.toBeNull();
			expect(q(container, 'event-edit-status')).not.toBeNull();
			expect(q(container, 'repertoire-manage-status')).not.toBeNull();
		});
		const nodes = [
			q(container, 'event-schedule-status'),
			q(container, 'event-edit-status'),
			q(container, 'repertoire-manage-status')
		];
		expect(new Set(nodes).size, 'three queues, three regions — never a shared node').toBe(3);
	});
});

describe('#328 schedule items — a write that reconciles announces saved', () => {
	it('row name edit: NOTHING announced while the POST is held open; the settle sets event_schedule_saved into event-schedule-status; no row alert', async () => {
		const { container, controls } = renderSchedulePage();
		await waitReady(container);

		const g = deferred();
		controls.holdItemPost = g.promise;
		await commitRowNameEdit(container, 'si1', 'kutse');

		await new Promise((r) => setTimeout(r, 10));
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');

		g.resolve();
		controls.holdItemPost = null;
		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});
		expect(q(container, 'event-schedule-error-si1')).toBeNull();
	});

	it('ADD: submitting the add form announces once the create reconciles (the refetch-and-close reconcile path announces too)', async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(q(container, 'event-schedule-add')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-schedule-add')!);
		await waitFor(() => {
			expect(q(container, 'event-schedule-add-name')).not.toBeNull();
		});
		await fireEvent.input(q(container, 'event-schedule-add-name')!, {
			target: { value: 'kontsert' }
		});
		await fillDateTime(container, 'event-schedule-add-datetime', '2026-09-01', '19:00');
		await fireEvent.click(q(container, 'event-schedule-add-submit')!);

		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});
		await waitFor(() => {
			expect(scheduleSection(container)!.textContent).toContain('kontsert');
		});
		expect(q(container, 'event-schedule-add-name')).toBeNull();
	});

	it('REMOVE: confirming a removal announces once the delete reconciles', async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(q(container, 'event-schedule-remove-si2')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-schedule-remove-si2')!);
		await waitFor(() => {
			expect(q(container, 'event-schedule-remove-confirm-si2')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-schedule-remove-confirm-si2')!);

		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});
		await waitFor(() => {
			expect(scheduleSection(container)!.textContent).not.toContain('proov');
		});
	});
});

describe('#328 schedule items — failure handling stays byte-identical', () => {
	it('a rejected name edit still rolls the row back and renders event-schedule-error-si1 role="alert" (event_schedule_save_error) — and event-schedule-status announces NOTHING', async () => {
		const { container, controls } = renderSchedulePage();
		await waitReady(container);
		controls.failItemWrites = true;

		await commitRowNameEdit(container, 'si1', 'kutse');
		await waitFor(() => {
			const alert = q(container, 'event-schedule-error-si1');
			expect(alert, 'the #262 per-row alert must stand, unchanged').not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('[event_schedule_save_error]');
		});
		expect(scheduleSection(container)!.textContent).toContain('kogunemine');
		expect(scheduleSection(container)!.textContent).not.toContain('kutse');
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');
	});

	it('PER-ROW + latest-write: si1’s standing alert survives si2’s successful edit, which announces saved; a NEXT attempt starts with the region blank again', async () => {
		const { container, controls } = renderSchedulePage();
		await waitReady(container);

		controls.failItemWrites = true;
		await commitRowNameEdit(container, 'si1', 'kutse');
		await waitFor(() => {
			expect(q(container, 'event-schedule-error-si1')).not.toBeNull();
		});

		controls.failItemWrites = false;
		await commitRowNameEdit(container, 'si2', 'peaproov');
		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});
		expect(
			q(container, 'event-schedule-error-si1'),
			'another row’s reconcile must not clear this row’s alert'
		).not.toBeNull();

		const g = deferred();
		controls.holdItemPost = g.promise;
		await commitRowNameEdit(container, 'si2', 'kindralproov');
		await new Promise((r) => setTimeout(r, 10));
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');
		g.resolve();
		controls.holdItemPost = null;
		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});
	});
});

describe('#328 schedule items — a late settle never announces onto the NEXT event', () => {
	it('a row name edit still IN FLIGHT when the editor switches collectives announces NOTHING when it lands: the region stays blank', async () => {
		const { container, controls } = renderSchedulePage(['sampledb', 'crede']);
		await waitReady(container);
		await waitFor(() => {
			expect(scheduleSection(container)?.textContent).toContain('kogunemine');
		});

		const g = deferred();
		controls.holdItemPost = g.promise;
		await commitRowNameEdit(container, 'si1', 'sissejuhatus');
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');

		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(scheduleSection(container)?.textContent).toContain('kogunemine');
		});
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');

		controls.holdItemPost = null;
		g.resolve();
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		expect(
			q(container, 'event-schedule-status')?.textContent?.trim(),
			'a late settle must not announce “saved” onto the event the editor has moved to'
		).toBe('');
		expect(q(container, 'event-schedule-error-si1')).toBeNull();
	});
});

describe('#328 schedule items — a pre-write refusal clears the region', () => {
	it('#328 review R2-F2 — an emptied row name is REFUSED before any write, and the region no longer reads “saved” from the earlier write beside it', async () => {
		const { container, fetchStub } = renderSchedulePage();
		await waitReady(container);

		await commitRowNameEdit(container, 'si1', 'sissejuhatus');
		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});
		const postsBefore = fetchStub.mock.calls.filter(
			(c) => (c[1] as RequestInit | undefined)?.method === 'POST'
		).length;

		await commitRowNameEdit(container, 'si2', '   ');
		await waitFor(() => {
			expect(q(container, 'event-schedule-error-si2')?.textContent).toContain(
				'[event_schedule_name_required]'
			);
		});
		expect(
			fetchStub.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')
		).toHaveLength(postsBefore);
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');
	});

	it('#328 review R2-F2 — the ADD form’s own refusals clear the region the same way', async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);

		await commitRowNameEdit(container, 'si1', 'sissejuhatus');
		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});

		await fireEvent.click(q(container, 'event-schedule-add')!);
		await waitFor(() => {
			expect(q(container, 'event-schedule-add-name')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-schedule-add-submit')!);
		await waitFor(() => {
			expect(q(container, 'event-schedule-add-error')?.textContent).toContain(
				'[event_schedule_name_required]'
			);
		});
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');
	});
});

// (*MVOX:Tallis* — #328 RED; late-settle + refusal cases *MVOX:Byrd* — #328 review R2)
