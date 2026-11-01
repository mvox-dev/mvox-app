// @vitest-environment happy-dom
// #1066: /links refuses a link that is not http(s) or an own path, on save and on show.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);
vi.mock('$lib/links/linkData', async () =>
	(await import('$lib/testing/mocks/links')).linkDataModule()
);
vi.mock('$lib/links/linkActions', async () =>
	(await import('$lib/testing/mocks/links')).linkActionsModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$app/state', async () =>
	(await import('$lib/testing/mocks/links')).linksPageStateModule()
);

import Page from './links/+page.svelte';
import { dbEditRight } from '$lib/nav/dbRights';
import { createLinkMock, listLinksMock, updateLinkMock } from '$lib/testing/mocks/links';
import { cleanupClearAdmin, rowEls, setAuthed } from '$lib/testing/pages/links';
import { q, qa } from '$lib/testing/pages/dom';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';

useKeptProblems();

const row = (id: string, name: string, url: string) => ({
	id,
	name,
	url,
	description: null,
	displayOrder: Number(id.slice(1)),
	ownerIds: ['person-p'],
	editorIds: ['person-p']
});
const GOOD = row('l1', 'Good', 'https://crede.ee/x');

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	setAuthed();
	dbEditRight.set('editor');
	listLinksMock.mockResolvedValue([GOOD]);
	createLinkMock.mockResolvedValue('l-new');
	updateLinkMock.mockResolvedValue(undefined);
});
afterEach(cleanupClearAdmin);

async function renderReady() {
	const utils = render(Page);
	await waitFor(() => expect(rowEls(utils.container).length).toBeGreaterThan(0));
	return utils;
}

describe('#1066 — save refuses a disallowed url before any write', () => {
	it.each(['javascript:alert(1)', 'data:text/html,hi', 'ftp://a.ee/x', ' JavaScript:alert(1)'])(
		'add %j: says why, writes nothing, keeps the draft',
		async (url) => {
			const { container } = await renderReady();
			await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Bad' } });
			await fireEvent.input(q(container, 'links-add-url')!, { target: { value: url } });
			await fireEvent.click(q(container, 'links-add-submit')!);
			await waitFor(() =>
				expect(q(container, 'links-write-error')?.textContent).toBe('links_url_scheme_refused')
			);
			expect(createLinkMock).not.toHaveBeenCalled();
			expect((q(container, 'links-add-url') as HTMLInputElement).value).toBe(url);
		}
	);

	it.each(['javascript:alert(1)', 'data:text/html,hi'])(
		'edit %j: says why, writes nothing, keeps the form open',
		async (url) => {
			const { container } = await renderReady();
			await fireEvent.click(q(container, 'links-edit')!);
			await fireEvent.input(q(container, 'links-edit-url')!, { target: { value: url } });
			await fireEvent.click(q(container, 'links-edit-save')!);
			await waitFor(() =>
				expect(q(container, 'links-write-error')?.textContent).toBe('links_url_scheme_refused')
			);
			expect(updateLinkMock).not.toHaveBeenCalled();
			expect(q(container, 'links-edit-url')).not.toBeNull();
		}
	);

	it('a good url after a refusal saves and clears the message', async () => {
		const { container } = await renderReady();
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'N' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'javascript:1x' } });
		await fireEvent.click(q(container, 'links-add-submit')!);
		await waitFor(() => expect(q(container, 'links-write-error')).not.toBeNull());
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'crede.ee/a' } });
		await fireEvent.click(q(container, 'links-add-submit')!);
		await waitFor(() => expect(createLinkMock).toHaveBeenCalledTimes(1));
		expect(q(container, 'links-write-error')).toBeNull();
	});
});

describe('#1066 — mailto: and tel: save as typed', () => {
	it.each(['mailto:info@crede.ee', 'tel:+3725551234'])('add %j', async (url) => {
		const { container } = await renderReady();
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Contact' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: url } });
		await fireEvent.click(q(container, 'links-add-submit')!);
		await waitFor(() => expect(createLinkMock).toHaveBeenCalledTimes(1));
		expect(createLinkMock.mock.calls[0][1].url).toBe(url);
		expect(q(container, 'links-write-error')).toBeNull();
	});

	it('stored mailto: and tel: rows keep their anchors and report nothing', async () => {
		listLinksMock.mockResolvedValue([
			row('l2', 'Mail', 'mailto:info@crede.ee'),
			row('l3', 'Phone', 'tel:+3725551234')
		]);
		const { container } = await renderReady();
		expect(qa(container, 'links-row-url').map((a) => a.getAttribute('href'))).toEqual([
			'mailto:info@crede.ee',
			'tel:+3725551234'
		]);
		await new Promise((r) => setTimeout(r, 50));
		expect(await keptProblems()).toEqual([]);
	});
});

describe('#1066 — one report per link per page load', () => {
	it('leaving /links and coming back files no second report', async () => {
		listLinksMock.mockResolvedValue([GOOD, row('l2', 'Evil', 'javascript:alert(1)')]);
		const first = await renderReady();
		await waitFor(async () => expect(await keptProblems()).toHaveLength(1));
		first.unmount();
		await renderReady();
		await new Promise((r) => setTimeout(r, 50));
		expect(await keptProblems()).toHaveLength(1);
	});
});

describe('#1066 — a stored disallowed url shows as plain text and reports once', () => {
	it('javascript: and data: rows have no anchor; the name stays; one report per link', async () => {
		listLinksMock.mockResolvedValue([
			GOOD,
			row('l2', 'Evil', 'javascript:alert(1)'),
			row('l3', 'Blob', 'data:text/html,hi')
		]);
		const { container } = await renderReady();
		const rows = rowEls(container);
		expect(rows.map((r) => r.querySelector('a') !== null)).toEqual([true, false, false]);
		expect(rows[1].querySelector('[data-testid="links-row-name"]')?.textContent?.trim()).toBe('Evil');
		expect(qa(container, 'links-row-url')).toHaveLength(1);
		expect(container.innerHTML).not.toMatch(/javascript:/i);
		await waitFor(async () => expect(await keptProblems()).toHaveLength(2));
		expect(await keptProblems()).toEqual([
			{ area: 'links', action: 'showing a link', detail: 'link l2 uses scheme javascript' },
			{ area: 'links', action: 'showing a link', detail: 'link l3 uses scheme data' }
		]);
		cleanup();
	});

	it('re-reading the list after a save does not report the same link again', async () => {
		listLinksMock.mockResolvedValue([GOOD, row('l2', 'Evil', 'javascript:alert(1)')]);
		const { container } = await renderReady();
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'N' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'crede.ee/a' } });
		const before = listLinksMock.mock.calls.length;
		await fireEvent.click(q(container, 'links-add-submit')!);
		await waitFor(() => expect(listLinksMock.mock.calls.length).toBeGreaterThan(before));
		await new Promise((r) => setTimeout(r, 50));
		expect(await keptProblems()).toHaveLength(1);
	});
});

// (*MVOX:Josquin*)
