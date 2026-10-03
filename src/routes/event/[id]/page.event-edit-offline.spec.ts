// @vitest-environment happy-dom
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '$lib/auth/storage';
import { json } from '$lib/testing/entuFetchKit';

const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
	setToken('jwt-editor');
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

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
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	expectVisibleReason,
	nonGetCalls
} from '$lib/testing/networkSignal';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function eventEntity(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		event_name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
		event_type: [{ _id: 'val-type-1', string: 'rehearsal' }],
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ _id: 'val-dur-1', number: 90 }],
		location: [{ _id: 'val-loc-1', string: 'Rehearsal Hall' }],
		description: [{ _id: 'val-desc-1', string: 'Come 15 minutes early for warm-ups.' }],
		capacity: [{ _id: 'val-cap-1', number: 20 }],
		_parent: [
			{ reference: 'org1', entity_type: 'organization' },
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 'series1', entity_type: 'event_series' }
		],
		...over
	};
}

function editorEvent(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({ _editor: [{ reference: 'p-viewer' }], ...over });
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
		duration_minutes: [{ number: 120 }],
		default_location: [{ string: 'Church Hall' }],
		default_description: [{ string: 'Series default note.' }]
	};
}

const PROFILES: Record<string, unknown[]> = {
	'p-mihkel': [
		{ _id: 'prof-m', name: [{ string: 'Mihkel Putrinš' }], _sharing: [{ string: 'domain' }] }
	]
};

type EditWireOpts = {
	failEditPosts?: number;
	holdEditPost?: boolean;
};

function editWireStub(eventOver?: Record<string, unknown>, opts: EditWireOpts = {}) {
	const event: Record<string, unknown> = eventOver ?? eventEntity();
	const season = seasonEntity();
	const series = seriesEntity();
	let failsLeft = opts.failEditPosts ?? 0;
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => {
		release = r;
	});
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/ev1') && method === 'POST') {
			if (opts.holdEditPost) await gate;
			if (failsLeft > 0) {
				failsLeft -= 1;
				return json({ message: 'boom' }, 500);
			}
			const props = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
			for (const prop of props) {
				const { type, ...valueParts } = prop;
				event[String(type)] = [{ _id: `val-${String(type)}-new`, ...valueParts }];
			}
			return json({});
		}
		if (url.includes('/entity/ev1')) return json({ entity: event });
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
	return { stub, release: () => release() };
}

function setAuthedWithSampledb() {
	signIn({
		token: 'jwt-editor',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }]
	});
}

function renderEditPage(eventOver?: Record<string, unknown>, opts: EditWireOpts = {}) {
	const { stub, release } = editWireStub(eventOver, opts);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
	const rendered = render(Page);
	return { ...rendered, fetchStub: stub, release };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetAppState();
});

function editPosts(fetchStub: ReturnType<typeof vi.fn>) {
	return fetchStub.mock.calls.filter(
		(c) =>
			((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST' &&
			String(c[0]).includes('/entity/ev1')
	);
}

const REASON = '[write_unavailable_no_signal]';

afterEach(() => {
	resetOnLine();
});

function pencils(container: HTMLElement): HTMLButtonElement[] {
	return Array.from(container.querySelectorAll('[data-testid^="event-edit-btn-"]'));
}

async function renderEditable() {
	await goOnline();
	const rendered = renderEditPage(editorEvent());
	await waitFor(() => {
		expect(pencils(rendered.container).length).toBe(6);
		for (const b of pencils(rendered.container)) expect(b.disabled).toBe(false);
	});
	return rendered;
}

describe('/event/[id] — inline editing while offline (#434 slice 6)', () => {
	it('offline: all six pencils are disabled and the reason is visible', async () => {
		const { container } = await renderEditable();
		await goOffline();

		await waitFor(() => {
			for (const b of pencils(container)) expect(b.disabled, b.dataset.testid).toBe(true);
		});
		expectVisibleReason(container, 'event-edit-write-unavailable', REASON);
		expect(container.querySelectorAll('[data-testid="event-edit-write-unavailable"]')).toHaveLength(1);
	});

	it('offline: tapping a pencil opens no input and issues no fetch', async () => {
		const { container, fetchStub } = await renderEditable();
		await goOffline();
		await settle();
		const callsBefore = fetchStub.mock.calls.length;

		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-name"]')!);
		await settle();

		expect(container.querySelector('[data-testid="event-edit-input-name"]')).toBeNull();
		expect(fetchStub.mock.calls.length).toBe(callsBefore);
	});

	it('an edit open when the signal drops cannot commit: blur writes nothing', async () => {
		const { container, fetchStub } = await renderEditable();
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-name"]')!);
		const input = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-edit-input-name"]');
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		});
		await fireEvent.input(input, { target: { value: 'Autumn Sing' } });
		await goOffline();

		await fireEvent.blur(input);
		await settle();

		expect(nonGetCalls(fetchStub)).toEqual([]);
		expect(editPosts(fetchStub)).toEqual([]);
	});

	it('a signal drop mid-edit KEEPS the typed text — the draft is not discarded', async () => {
		const { container, fetchStub } = await renderEditable();
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-name"]')!);
		const input = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-edit-input-name"]');
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		});
		await fireEvent.input(input, { target: { value: 'Autumn Sing' } });
		await goOffline();

		await fireEvent.keyDown(input, { key: 'Enter' });
		await settle();

		const still = container.querySelector<HTMLInputElement>('[data-testid="event-edit-input-name"]');
		expect(still, 'the editor stays open on her text').not.toBeNull();
		expect(still!.value).toBe('Autumn Sing');
		expect(editPosts(fetchStub)).toEqual([]);
		expectVisibleReason(container, 'event-edit-held-offline', '[write_held_no_signal]');
	});

	it('the held draft commits on one more Enter once the signal is back (still nothing queued)', async () => {
		const { container, fetchStub } = await renderEditable();
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-name"]')!);
		const input = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-edit-input-name"]');
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		});
		await fireEvent.input(input, { target: { value: 'Autumn Sing' } });
		await goOffline();
		await fireEvent.keyDown(input, { key: 'Enter' });
		await settle();
		expect(editPosts(fetchStub)).toEqual([]);

		await goOnline();
		await settle();
		expect(editPosts(fetchStub)).toEqual([]);
		expect(container.querySelector('[data-testid="event-edit-held-offline"]')).toBeNull();

		const held = container.querySelector<HTMLInputElement>('[data-testid="event-edit-input-name"]')!;
		expect(held.value).toBe('Autumn Sing');
		await fireEvent.keyDown(held, { key: 'Enter' });

		await waitFor(() => expect(editPosts(fetchStub).length).toBe(1));
		expect(JSON.stringify(editPosts(fetchStub))).toContain('Autumn Sing');
	});

	it('back online: pencils enabled, reason gone, and an edit commits', async () => {
		const { container, fetchStub } = await renderEditable();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			for (const b of pencils(container)) expect(b.disabled, b.dataset.testid).toBe(false);
		});
		expect(container.querySelector('[data-testid="event-edit-write-unavailable"]')).toBeNull();
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-name"]')!);
		const input = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-edit-input-name"]');
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		});
		await fireEvent.input(input, { target: { value: 'Autumn Sing' } });
		await fireEvent.blur(input);
		await waitFor(() => expect(editPosts(fetchStub).length).toBe(1));
	});
});

// (*MVOX:Tallis*)
