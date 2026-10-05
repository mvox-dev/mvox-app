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
import {
	cleanupRealTimersResetTypes,
	editorTokenAtNow,
	setAuthed
} from '$lib/testing/pages/event';
import { MY_RSVP_ROW, seasonEntity } from '$lib/testing/pages/eventRsvp';
import { bareEventEntity } from '$lib/testing/pages/eventFixtures';

type WireOpts = {
	updatePost?: 'ok' | 'fail' | 'hold';
};

function wireStub(opts: WireOpts = {}) {
	const heldPost = deferred<Response>();
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/p-viewer') && url.includes('props=_owner')) {
			return json({ entity: { _id: 'p-viewer', _editor: [{ reference: 'p-viewer' }] } });
		}
		if (url.includes('/entity/rsvp-77')) {
			if (method === 'POST') {
				if (opts.updatePost === 'fail') return json({ error: 'boom' }, 500);
				if (opts.updatePost === 'hold') return heldPost.promise;
				return json({});
			}
			return json({
				entity: {
					_id: 'rsvp-77',
					status: [{ _id: 'val-status-1' }],
					event: [{ reference: 'ev1' }],
					going_ref: [{ _id: 'val-sentinel-1' }]
				}
			});
		}
		if (url.includes('/entity/ev1')) return json({ entity: bareEventEntity() });
		if (url.includes('/entity/season1')) return json({ entity: seasonEntity() });
		if (url.includes('_type.string=member') && url.includes('person.reference=p-viewer'))
			return json({ entities: [{ _id: 'member-1' }] });
		if (url.includes('_type.string=rsvp')) {
			if (url.includes('_parent.reference=p-viewer') && url.includes('event.reference=ev1')) {
				return json({ entities: [MY_RSVP_ROW] });
			}
			return json({ entities: [] });
		}
		return json({ entities: [] });
	});
	return {
		stub,
		releasePost: () => heldPost.resolve(json({})),
		failHeldPost: () => heldPost.resolve(json({ error: 'boom' }, 500))
	};
}

function renderPage(opts: WireOpts = {}, dbs?: string[]) {
	const wire = wireStub(opts);
	vi.stubGlobal('fetch', wire.stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed(dbs);
	const rendered = render(Page);
	return { ...rendered, ...wire };
}

function rsvpSection(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid="event-detail-rsvp"]');
}

function savedText(container: HTMLElement): string {
	return (
		rsvpSection(container)
			?.querySelector('[data-testid="rsvp-saved-status"]')
			?.textContent?.trim() ?? ''
	);
}

async function waitForAnsweredControl(container: HTMLElement) {
	await waitFor(() => {
		const btn = container.querySelector(
			'[data-testid="rsvp-btn-going"]'
		) as HTMLButtonElement | null;
		expect(btn).not.toBeNull();
		expect(btn!.getAttribute('aria-pressed')).toBe('true');
		expect(btn!.disabled).toBe(false);
	});
}

afterEach(cleanupRealTimersResetTypes);

describe('/event/[id] — the saved cue fires when the WRITE reconciles (#326)', () => {
	it('while the write is in flight: the PO-ruled SILENT disable is byte-preserved — aria-busy, no saved text, msg line blank', async () => {
		const { container, releasePost } = renderPage({ updatePost: 'hold' });
		await waitForAnsweredControl(container);

		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-not_going"]')!);

		await waitFor(() => {
			expect(
				rsvpSection(container)
					?.querySelector('[data-testid="rsvp-control"]')
					?.getAttribute('aria-busy')
			).toBe('true');
		});
		expect(savedText(container)).toBe('');
		expect(container.textContent).not.toContain('[rsvp_saved]');
		expect(
			rsvpSection(container)
				?.querySelector('[data-testid="rsvp-msg-line"]')
				?.textContent?.trim()
		).toBe('');
		releasePost();
	});

	it('a failed write reverts the value', async () => {
		const { container } = renderPage({ updatePost: 'fail' });
		await waitForAnsweredControl(container);

		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-not_going"]')!);

		await waitFor(() => {
			expect(
				rsvpSection(container)?.querySelector('[data-testid="rsvp-save-failed"]')
			).not.toBeNull();
		});
		expect(
			rsvpSection(container)
				?.querySelector('[data-testid="rsvp-save-failed"]')
				?.getAttribute('role')
		).toBe('alert');
		expect(
			container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
		).toBe('true');
	});
});

// (*MVOX:Tallis* — #326 RED)
