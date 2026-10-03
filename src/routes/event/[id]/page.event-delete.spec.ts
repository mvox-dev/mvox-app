// @vitest-environment happy-dom
// The delete button on the event detail page.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
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

const { deleteEventMock } = vi.hoisted(() => ({
	deleteEventMock: vi.fn()
}));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

vi.mock('$lib/seasons/seasonManage', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/seasons/seasonManage')>()),
	deleteEvent: deleteEventMock
}));

import Page from './+page.svelte';
import { EntityDeleteForbiddenError } from '$lib/seasons/deleteErrors';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock } from '$lib/testing/routeMocks';

const CFG = testCfg('sampledb', 'jwt-token');

function eventEntity(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
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

function readWireStub(eventOver?: Record<string, unknown>) {
	const event = eventOver ?? eventEntity();
	const season = seasonEntity();
	const series = seriesEntity();
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'DELETE' || method === 'POST') {
			throw new Error(`unexpected ${method} ${url} — destructive wire traffic in a mocked-delete spec`);
		}
		if (url.includes('/entity/ev1')) return json({ entity: event });
		if (url.includes('/entity/season1')) return json({ entity: season });
		if (url.includes('/entity/series1')) return json({ entity: series });
		if (url.includes('_type.string=season')) return json({ entities: [season] });
		if (url.includes('_type.string=event_series')) return json({ entities: [series] });
		if (url.includes('_type.string=event')) return json({ entities: [event] });
		return json({ entities: [] });
	});
}

function setAuthedWithSampledb() {
	signIn({
		token: CFG.token,
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }]
	});
}

function renderPage(eventOver?: Record<string, unknown>) {
	const stub = readWireStub(eventOver);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
	const rendered = render(Page);
	return { ...rendered, fetchStub: stub };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	deleteEventMock.mockReset();
	gotoMock.mockReset();
	localStorage.clear();
	resetAppState();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function idleDeleteButton(container: HTMLElement): Promise<HTMLElement> {
	return await waitFor(() => {
		const btn = q(container, 'event-detail-delete');
		expect(btn, 'event-detail-delete missing for a rights-holder').not.toBeNull();
		return btn as HTMLElement;
	});
}

async function arm(container: HTMLElement): Promise<{ confirm: HTMLElement; cancel: HTMLElement }> {
	await fireEvent.click(await idleDeleteButton(container));
	return await waitFor(() => {
		const confirm = q(container, 'event-detail-delete-confirm');
		const cancel = q(container, 'event-detail-delete-cancel');
		expect(confirm, 'event-detail-delete-confirm missing after arming').not.toBeNull();
		expect(cancel, 'event-detail-delete-cancel missing after arming').not.toBeNull();
		return { confirm: confirm as HTMLElement, cancel: cancel as HTMLElement };
	});
}

describe('event detail — #203 delete button visibility', () => {
	it('a rights-holder sees the delete button, as a <button>, in IDLE shape — no confirm/cancel yet, nothing called', async () => {
		const { container } = renderPage(editorEvent());
		const btn = await idleDeleteButton(container);
		expect(btn.tagName).toBe('BUTTON');
		expect(q(container, 'event-detail-delete-confirm')).toBeNull();
		expect(q(container, 'event-detail-delete-cancel')).toBeNull();
		expect(deleteEventMock).not.toHaveBeenCalled();
	});

	it('a plain member (no rights lists at all — the private-bucket read) sees NO delete surface of any kind', async () => {
		const { container } = renderPage(eventEntity());
		await waitFor(() => {
			expect(q(container, 'event-detail-name')).not.toBeNull();
		});
		expect(q(container, 'event-detail-delete')).toBeNull();
		expect(q(container, 'event-detail-delete-confirm')).toBeNull();
		expect(q(container, 'event-detail-delete-cancel')).toBeNull();
	});

	it('the delete sits at the FOOT of the article — after the RSVP section, not inside the field stack', async () => {
		const { container } = renderPage(editorEvent());
		const btn = await idleDeleteButton(container);
		const rsvp = q(container, 'event-detail-rsvp');
		expect(rsvp, 'event-detail-rsvp missing').not.toBeNull();
		expect(
			btn.compareDocumentPosition(rsvp as HTMLElement) & Node.DOCUMENT_POSITION_PRECEDING,
			'the delete button renders before the RSVP section — it is back inside the field stack'
		).toBeTruthy();
		const pencil = q(container, 'event-edit-btn-description');
		expect(pencil, 'event-edit-btn-description missing').not.toBeNull();
		expect(
			btn.compareDocumentPosition(pencil as HTMLElement) & Node.DOCUMENT_POSITION_PRECEDING
		).toBeTruthy();
	});

	it('the delete NAMES itself — visible text label beside the shared trashcan icon, not a bare glyph leaning on an aria-label (#237)', async () => {
		const { container } = renderPage(editorEvent());
		const btn = await idleDeleteButton(container);
		expect(btn.getAttribute('aria-label')).toBeNull();
		expect(btn.textContent ?? '').toContain('[event_detail_delete_label]');
		const svg = btn.querySelector('svg[data-icon="trash"]');
		expect(svg, 'TrashIcon must render inside the trigger').not.toBeNull();
		expect(svg!.getAttribute('aria-hidden')).toBe('true');
		expect(btn.textContent ?? '').not.toMatch(/[×✕]/);
		for (const cls of ['text-red-700', 'hover:text-red-800', 'min-h-11', 'min-w-11']) {
			expect(btn.classList.contains(cls), `${cls} missing on the trigger`).toBe(true);
		}
	});
});

describe('event detail — #203 delete is a TWO-step confirm, never a single tap', () => {
	it('tapping the × writes NOTHING — it arms: confirm + cancel appear, the idle × leaves', async () => {
		const { container } = renderPage(editorEvent());
		await arm(container);
		expect(deleteEventMock).not.toHaveBeenCalled();
		expect(gotoMock).not.toHaveBeenCalled();
		expect(q(container, 'event-detail-delete')).toBeNull();
	});

	it('confirm calls deleteEvent(cfg, eventId) exactly ONCE and navigates home', async () => {
		deleteEventMock.mockResolvedValue(undefined);
		const { container } = renderPage(editorEvent());
		const { confirm } = await arm(container);
		await fireEvent.click(confirm);
		await waitFor(() => {
			expect(deleteEventMock).toHaveBeenCalledTimes(1);
		});
		expect(deleteEventMock).toHaveBeenCalledWith(CFG, 'ev1');
		await waitFor(() => {
			expect(gotoMock).toHaveBeenCalledWith('/');
		});
	});

	it('cancel disarms back to idle: × returns, confirm/cancel unmount, NOTHING was called', async () => {
		const { container } = renderPage(editorEvent());
		const { cancel } = await arm(container);
		await fireEvent.click(cancel);
		await waitFor(() => {
			expect(q(container, 'event-detail-delete')).not.toBeNull();
		});
		expect(q(container, 'event-detail-delete-confirm')).toBeNull();
		expect(q(container, 'event-detail-delete-cancel')).toBeNull();
		expect(deleteEventMock).not.toHaveBeenCalled();
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('arming moves focus onto the confirm button that replaced the trigger — never <body>', async () => {
		const { container } = renderPage(editorEvent());
		const { confirm } = await arm(container);
		await waitFor(() => {
			expect(
				document.activeElement,
				`focus after arming was <${document.activeElement?.tagName}>, not the confirm button`
			).toBe(confirm);
		});
	});

	it('cancelling hands focus back to the trigger that came back — never <body>', async () => {
		const { container } = renderPage(editorEvent());
		const { cancel } = await arm(container);
		await fireEvent.click(cancel);
		const trigger = await waitFor(() => {
			const btn = q(container, 'event-detail-delete');
			expect(btn, 'event-detail-delete missing after cancelling').not.toBeNull();
			return btn as HTMLElement;
		});
		await waitFor(() => {
			expect(
				document.activeElement,
				`focus after cancelling was <${document.activeElement?.tagName}>, not the delete trigger`
			).toBe(trigger);
		});
	});
});

describe('event detail — #203 refused delete', () => {
	it('a 403 refusal shows the FORBIDDEN-flavoured error, stays on the page, and never navigates', async () => {
		deleteEventMock.mockRejectedValue(new EntityDeleteForbiddenError('ev1'));
		const { container } = renderPage(editorEvent());
		const { confirm } = await arm(container);
		await fireEvent.click(confirm);
		const error = await waitFor(() => {
			const el = q(container, 'event-detail-delete-error');
			expect(el, 'event-detail-delete-error missing after a refused delete').not.toBeNull();
			return el as HTMLElement;
		});
		expect(error.textContent ?? '').toMatch(/forbidden/i);
		expect(gotoMock).not.toHaveBeenCalled();
		expect(q(container, 'event-detail-name')).not.toBeNull();
	});
});

// (*MVOX:Palestrina*)
