// @vitest-environment happy-dom
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, json } from '$lib/testing/entuFetchKit';

beforeEach(editorTokenAtNow);

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
import { commitDateTime, fillDateTime } from '$lib/testing/timeControls';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { signIn } from '$lib/testing/session';
import {
	PROFILES,
	cleanupRealTimersReset,
	editorTokenAtNow,
	seasonEntity
} from '$lib/testing/pages/event';
import { seriesEntity } from '$lib/testing/pages/eventFixtures';
import { q } from '$lib/testing/pages/dom';

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

function credeEventEntity() {
	return { ...eventEntity(), event_name: [{ _id: 'cval-name-1', string: 'Crede Rehearsal' }] };
}

type WireControls = {
	holdEditPost: Promise<void> | null;
	failEditPost: boolean;
};

function editWireStub(controls: WireControls) {
	const event: Record<string, unknown> = eventEntity();
	const season = seasonEntity();
	const series = seriesEntity();
	const crede: Record<string, unknown> = credeEventEntity();
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/crede/')) {
			if (url.includes('/entity/ev1')) return json({ entity: crede });
			if (url.includes('/entity/season1')) return json({ entity: season });
			if (url.includes('/entity/series1')) return json({ entity: series });
			if (url.includes('_type.string=event')) return json({ entities: [crede] });
			return json({ entities: [] });
		}
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/ev1') && method === 'POST') {
			if (controls.holdEditPost) await controls.holdEditPost;
			if (controls.failEditPost) return json({ message: 'boom' }, 500);
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
	return stub;
}

function setAuthedWithSampledb(dbs: string[] = ['sampledb']) {
	signIn({
		token: 'jwt-editor',
		collectives: dbs.map((db) => ({ db, name: db, personId: 'p-viewer' }))
	});
}

function renderEditPage(dbs: string[] = ['sampledb']) {
	const controls: WireControls = { holdEditPost: null, failEditPost: false };
	const stub = editWireStub(controls);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb(dbs);
	const rendered = render(Page);
	return { ...rendered, fetchStub: stub, controls };
}

afterEach(cleanupRealTimersReset);

const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function beginEdit(
	container: HTMLElement,
	field: 'name' | 'location'
): Promise<HTMLInputElement> {
	await waitFor(() => {
		expect(q(container, `event-edit-btn-${field}`), `event-edit-btn-${field}`).not.toBeNull();
	});
	await fireEvent.click(q(container, `event-edit-btn-${field}`)!);
	return await waitFor(() => {
		const el = q(container, `event-edit-input-${field}`);
		expect(el, `event-edit-input-${field} missing after tapping edit`).not.toBeNull();
		return el as HTMLInputElement;
	});
}

async function commitEdit(
	container: HTMLElement,
	field: 'name' | 'location',
	value: string
): Promise<void> {
	const input = await beginEdit(container, field);
	await fireEvent.input(input, { target: { value } });
	await fireEvent.blur(input);
}

describe('#328 event fields — the saved-cue region exists from first render', () => {
	it('editor view: a PERSISTENT empty role="status" aria-live="polite" region (event-edit-status) is mounted BEFORE any write — its own node, exactly one', async () => {
		const { container } = renderEditPage();
		await waitFor(() => {
			expect(q(container, 'event-edit-btn-name')).not.toBeNull();
		});

		const status = q(container, 'event-edit-status');
		expect(status, 'expected the persistent event-edit-status region').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.getAttribute('aria-live')).toBe('polite');
		expect(status!.textContent?.trim()).toBe('');
		expect(container.querySelectorAll('[data-testid="event-edit-status"]')).toHaveLength(1);
	});
});

describe('#328 event fields — a write that reconciles announces saved', () => {
	it('name blur-commit: NOTHING announced while the POST is held open; the settle sets event_edit_saved into event-edit-status; no error node', async () => {
		const { container, controls } = renderEditPage();
		const g = deferred();
		controls.holdEditPost = g.promise;

		await commitEdit(container, 'name', 'Autumn Sing');
		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Autumn Sing');
		});
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');

		g.resolve();
		controls.holdEditPost = null;
		await waitFor(() => {
			expect(q(container, 'event-edit-status')?.textContent).toContain('[event_edit_saved]');
		});
		expect(q(container, 'event-edit-error-name')).toBeNull();
	});

	it('the cue describes the LATEST write: blank again by the time a second field’s write is in flight, re-announced on its settle', async () => {
		const { container, controls } = renderEditPage();

		await commitEdit(container, 'name', 'Autumn Sing');
		await waitFor(() => {
			expect(q(container, 'event-edit-status')?.textContent).toContain('[event_edit_saved]');
		});

		const g = deferred();
		controls.holdEditPost = g.promise;
		await commitEdit(container, 'location', 'Concert Hall');
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');

		g.resolve();
		controls.holdEditPost = null;
		await waitFor(() => {
			expect(q(container, 'event-edit-status')?.textContent).toContain('[event_edit_saved]');
		});
	});

	it('PER-KEY: a location reconcile announces saved while name’s standing error stays untouched (the existing per-field error independence, byte-preserved)', async () => {
		const { container, controls } = renderEditPage();

		controls.failEditPost = true;
		await commitEdit(container, 'name', 'Autumn Sing');
		await waitFor(() => {
			expect(q(container, 'event-edit-error-name')).not.toBeNull();
		});
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');

		controls.failEditPost = false;
		await commitEdit(container, 'location', 'Concert Hall');
		await waitFor(() => {
			expect(q(container, 'event-edit-status')?.textContent).toContain('[event_edit_saved]');
		});
		expect(
			q(container, 'event-edit-error-name'),
			'another field’s reconcile must not clear this field’s error'
		).not.toBeNull();
	});
});

describe('#328 event fields — failure handling stays byte-identical', () => {
	it('a rejected name write still reverts the header and renders event-edit-error-name role="alert" (event_edit_save_error) — and event-edit-status announces NOTHING', async () => {
		const { container, controls } = renderEditPage();
		controls.failEditPost = true;

		await commitEdit(container, 'name', 'Autumn Sing');
		await waitFor(() => {
			const alert = q(container, 'event-edit-error-name');
			expect(alert, 'expected the existing failure node, unchanged').not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('[event_edit_save_error]');
		});
		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Tuesday Rehearsal');
		});
		expect(q(container, 'event-detail-name')?.textContent).not.toContain('Autumn Sing');
		await flush();
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');
	});

	it('#328 review R2-F2 — a pre-write REFUSAL (the #243 duration range check) clears the region: no stale “saved” standing beside the fresh refusal', async () => {
		const { container, fetchStub } = renderEditPage();

		await commitEdit(container, 'name', 'Autumn Sing');
		await waitFor(() => {
			expect(q(container, 'event-edit-status')?.textContent).toContain('[event_edit_saved]');
		});
		const postsBefore = fetchStub.mock.calls.filter(
			(c) => (c[1] as RequestInit | undefined)?.method === 'POST'
		).length;

		await waitFor(() => {
			expect(q(container, 'event-edit-btn-duration_minutes')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-edit-btn-duration_minutes')!);
		await waitFor(() => {
			expect(q(container, 'event-edit-input-duration_minutes')).not.toBeNull();
		});
		await fillDateTime(container, 'event-edit-input-duration_minutes', '2026-09-01', '18:00');
		await commitDateTime(container, 'event-edit-input-duration_minutes');

		await waitFor(() => {
			expect(q(container, 'event-edit-error-duration_minutes')?.textContent).toContain(
				'[event_end_before_start]'
			);
		});
		await flush();
		expect(
			fetchStub.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')
		).toHaveLength(postsBefore);
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');
	});
});

describe('#328 event fields — the saved cue does not outlive its event', () => {
	it('a settled name write’s saved cue does not follow the editor to the NEXT event: the region is mounted and BLANK on arrival', async () => {
		const { container } = renderEditPage(['sampledb', 'crede']);

		await commitEdit(container, 'name', 'Autumn Sing');
		await waitFor(() => {
			expect(q(container, 'event-edit-status')?.textContent).toContain('[event_edit_saved]');
		});

		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Crede Rehearsal');
		});

		const status = q(container, 'event-edit-status');
		expect(status, 'expected the persistent region on the next event').not.toBeNull();
		expect(
			status!.textContent?.trim(),
			'the live region must not still read “saved” for a write made on an older event'
		).toBe('');
		expect(q(container, 'event-edit-error-name')).toBeNull();
	});

	it('a name write still IN FLIGHT when the editor switches collectives announces NOTHING when it lands: the new event’s region stays blank (editWriteGenerations gates the settle)', async () => {
		const { container, controls } = renderEditPage(['sampledb', 'crede']);
		const g = deferred();
		controls.holdEditPost = g.promise;

		await commitEdit(container, 'name', 'Autumn Sing');
		await flush();
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');

		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Crede Rehearsal');
		});
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');

		controls.holdEditPost = null;
		g.resolve();
		await flush();

		expect(
			q(container, 'event-edit-status')?.textContent?.trim(),
			'a late settle must not announce “saved” onto the event the editor has moved to'
		).toBe('');
		expect(q(container, 'event-edit-error-name')).toBeNull();
		expect(q(container, 'event-detail-name')?.textContent).toContain('Crede Rehearsal');
	});
});

// (*MVOX:Tallis* — #328 RED; late-settle case *MVOX:Byrd* — #328 review R2-F1)
