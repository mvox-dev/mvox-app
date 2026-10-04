// @vitest-environment happy-dom
// The agenda's work-edition picker says unknown after a partial read.
import { resolve } from 'node:path';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { isMessageEmpty, messagePatterns } from '$lib/testing/messageFile.js';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('list')
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule({ lists: 'bare' })
);

import Page from './+page.svelte';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { listMyRsvpsMock, loadFullAgendaMock } from '$lib/testing/moduleHandles';
import { pickerOptions, workRowOf } from '$lib/testing/pages/eventEdition';
import {
	REPERTOIRE_ITEMS,
	cleanupUnstubResetAgendaRsvps,
	future
} from '$lib/testing/pages/agendaWorks';
import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import { LOCALES, readMessages as localeMessages } from '$lib/testing/pages/profile';

const SCOPED_WORK_2_EDITIONS = [
	{
		_id: 'ed-9',
		name: [{ string: 'Peters, 1904' }],
		_parent: [{ reference: 'work-2', entity_type: 'work' }]
	}
];

function installWorld(
	options: {
		editionCount?: number;
		scoped?: 'editions' | 'none' | 'fail' | 'partial-empty' | 'partial-some';
	} = {}
) {
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [
				{
					id: 'ev-1',
					name: 'Rehearsal',
					startDatetime: future,
					durationMinutes: 90,
					location: '',
					conductors: [],
					owners: [],
					editors: []
				}
			],
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: ['person-p']
		})
	);

	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'DELETE') return json({ deleted: true });
		if (method === 'POST') return json({ _id: 'new-1' });
		if (url.includes('?props=status')) return json({ entity: { status: [{ _id: 'val-status' }] } });
		if (url.includes('?props=edition')) return json({ entity: { edition: [] } });
		if (url.includes('_type.string=entity')) return json({ entities: [{ _id: 'type-1' }] });
		if (url.includes('_type.string=work')) {
			return json({
				entities: [
					{ _id: 'work-1', name: [{ string: 'Spem in alium' }] },
					{ _id: 'work-2', name: [{ string: 'Old warhorse' }] }
				]
			});
		}
		if (url.includes('_type.string=edition') && url.includes('_parent.reference=work-2')) {
			if (options.scoped === 'fail') return json({ error: 'boom' }, 500);
			if (options.scoped === 'partial-empty') return json({ count: 900, entities: [] });
			if (options.scoped === 'partial-some')
				return json({ count: 900, entities: SCOPED_WORK_2_EDITIONS });
			return json({ entities: options.scoped === 'none' ? [] : SCOPED_WORK_2_EDITIONS });
		}
		if (url.includes('_type.string=edition')) {
			return json({
				...(options.editionCount === undefined ? {} : { count: options.editionCount }),
				entities: [
					{
						_id: 'ed-1',
						name: [{ string: '40-part original' }],
						_parent: [{ reference: 'work-1', entity_type: 'work' }]
					},
					{
						_id: 'ed-2',
						name: [{ string: 'Bärenreiter urtext' }],
						_parent: [{ reference: 'work-1', entity_type: 'work' }]
					}
				]
			});
		}
		if (url.includes('_type.string=copy')) return json({ entities: [] });
		if (url.includes('_type.string=program_item')) return json({ entities: [] });
		if (url.includes('_type.string=repertoire_item')) return json({ entities: REPERTOIRE_ITEMS });
		return json({ entities: [] });
	});

	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

async function renderExpandedAsEditor() {
	setAuthedWithOneCollective();
	const rendered = render(Page);
	await vi.waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="works-line"]')).not.toBeNull();
	});
	await fireEvent.click(rendered.container.querySelector('[data-testid="works-line"]')!);
	await vi.waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="work-manage-row"]')).not.toBeNull();
	});
	return rendered;
}

beforeEach(() => {
	resetTypeIdCache();
	listMyRsvpsMock.mockResolvedValue({ items: [], total: 0, truncated: false });
});

afterEach(cleanupUnstubResetAgendaRsvps);

describe('#329 agenda — a zero-match row under a TRUNCATED edition read says UNKNOWN', () => {
	it('the unknown state stands while the scoped read has not answered — never the known-absent wording', async () => {
		const fetchMock = installWorld({ editionCount: 4000, scoped: 'fail' });
		const { container } = await renderExpandedAsEditor();
		await vi.waitFor(() => {
			expect(
				fetchMock.mock.calls.some((c) => String(c[0]).includes('_parent.reference=work-2'))
			).toBe(true);
		});
		const li = workRowOf(container, 'Old warhorse');
		expect(
			li.querySelector('[data-testid="work-edition-unknown"]')!.textContent
		).toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');
		const picker = li.querySelector('[data-testid="work-edition-picker"]');
		expect(picker, 'work-edition-picker on the unknown row').not.toBeNull();
		expect((picker as HTMLElement).tagName).toBe('SELECT');
		expect((picker as HTMLSelectElement).disabled).toBe(false);
	});

	it('reads that ONE work scoped and turns unknown into a fact — the picker names its editions', async () => {
		const fetchMock = installWorld({ editionCount: 4000 });
		const { container } = await renderExpandedAsEditor();
		await vi.waitFor(() => {
			expect(pickerOptions(workRowOf(container, 'Old warhorse')).length).toBe(2);
		});
		const scoped = fetchMock.mock.calls
			.map((c) => String(c[0]))
			.filter((u) => u.includes('_parent.reference=work-2'));
		expect(scoped.length).toBe(1);
		expect(scoped[0]).toContain('_type.string=edition');

		const li = workRowOf(container, 'Old warhorse');
		expect(pickerOptions(li)).toEqual([
			{ value: '', label: '[repertoire_pin_edition_label]', disabled: false },
			{ value: 'ed-9', label: 'Peters, 1904', disabled: false }
		]);
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
	});

	it('a scoped read that comes back EMPTY and COMPLETE is a known absence — that read has a reachable cap', async () => {
		const fetchMock = installWorld({ editionCount: 4000, scoped: 'none' });
		const { container } = await renderExpandedAsEditor();
		await vi.waitFor(() => {
			expect(
				workRowOf(container, 'Old warhorse').querySelector('[data-testid="work-no-edition"]')
			).not.toBeNull();
		});
		const li = workRowOf(container, 'Old warhorse');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(
			fetchMock.mock.calls.some((c) => String(c[0]).includes('_parent.reference=work-2'))
		).toBe(true);
	});

	it('a MATCHED row is untouched by the truncation — full option shape, no unknown wording (truncation poisons negatives, never positives)', async () => {
		installWorld({ editionCount: 4000 });
		const { container } = await renderExpandedAsEditor();
		await vi.waitFor(() => {
			expect(
				workRowOf(container, 'Spem in alium').querySelector(
					'[data-testid="work-edition-picker"]'
				)
			).not.toBeNull();
		});
		const li = workRowOf(container, 'Spem in alium');
		expect(pickerOptions(li)).toEqual([
			{ value: '', label: '[repertoire_pin_edition_label]', disabled: false },
			{ value: 'ed-1', label: '40-part original', disabled: false },
			{ value: 'ed-2', label: 'Bärenreiter urtext', disabled: false }
		]);
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
	});

	it('a MATCHED row renders byte-identically under truncated and complete reads', async () => {
		installWorld({ editionCount: 4000 });
		const truncatedRender = await renderExpandedAsEditor();
		await vi.waitFor(() => {
			expect(
				workRowOf(truncatedRender.container, 'Spem in alium').querySelector(
					'[data-testid="work-edition-picker"]'
				)
			).not.toBeNull();
		});
		const truncatedHtml = workRowOf(truncatedRender.container, 'Spem in alium').outerHTML;
		cleanup();
		vi.unstubAllGlobals();

		installWorld({});
		const completeRender = await renderExpandedAsEditor();
		await vi.waitFor(() => {
			expect(
				workRowOf(completeRender.container, 'Spem in alium').querySelector(
					'[data-testid="work-edition-picker"]'
				)
			).not.toBeNull();
		});
		const completeHtml = workRowOf(completeRender.container, 'Spem in alium').outerHTML;

		expect(truncatedHtml).toBe(completeHtml);
	});
});

async function settleScopedRead(fetchMock: ReturnType<typeof installWorld>, urlFragment: string) {
	await vi.waitFor(() => {
		expect(fetchMock.mock.calls.some((c) => String(c[0]).includes(urlFragment))).toBe(true);
	});
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("#329 review — the scoped read's OWN truncation is not a fact either", () => {
	it('a scoped read that comes back PARTIAL is not a known absence — unknown stands', async () => {
		const fetchMock = installWorld({ editionCount: 4000, scoped: 'partial-empty' });
		const { container } = await renderExpandedAsEditor();
		await settleScopedRead(fetchMock, '_parent.reference=work-2');

		const li = workRowOf(container, 'Old warhorse');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')!.textContent).toContain(
			'[repertoire_edition_unknown]'
		);
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');
		const picker = li.querySelector('[data-testid="work-edition-picker"]');
		expect(picker, 'work-edition-picker on the unknown row').not.toBeNull();
		expect((picker as HTMLSelectElement).disabled).toBe(false);
	});

	it('a PARTIAL scoped read never marks the work resolved — a short page is not that work’s edition list', async () => {
		const fetchMock = installWorld({ editionCount: 4000, scoped: 'partial-some' });
		const { container } = await renderExpandedAsEditor();
		await settleScopedRead(fetchMock, '_parent.reference=work-2');

		const li = workRowOf(container, 'Old warhorse');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).not.toBeNull();
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(pickerOptions(li)).toEqual([
			{ value: '', label: '[repertoire_pin_edition_label]', disabled: false }
		]);
		expect(
			fetchMock.mock.calls
				.map((c) => String(c[0]))
				.filter((u) => u.includes('_parent.reference=work-2')).length
		).toBe(1);
	});
});

describe('#329 agenda — known-absent under a COMPLETE read is byte-identical to today', () => {
	it("zero editions for the work, read complete → today's wording, no unknown state, no picker", async () => {
		const fetchMock = installWorld({}); // no count on the wire = complete
		const { container } = await renderExpandedAsEditor();
		await vi.waitFor(() => {
			expect(
				workRowOf(container, 'Spem in alium').querySelector(
					'[data-testid="work-edition-picker"]'
				)
			).not.toBeNull();
		});
		const li = workRowOf(container, 'Old warhorse');
		const noEdition = li.querySelector('[data-testid="work-no-edition"]');
		expect(noEdition, 'work-no-edition').not.toBeNull();
		expect(noEdition!.textContent).toContain('[repertoire_no_edition]');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(
			fetchMock.mock.calls.some((c) => String(c[0]).includes('_parent.reference=work-2'))
		).toBe(false);
	});
});

describe('#329 — the lifetime listMyRsvps read keeps its OTHER consumer', () => {
	it('the agenda still seeds its rows from listMyRsvps — this issue moves only the EVENT PAGE off it', async () => {
		installWorld({});
		await renderExpandedAsEditor();
		expect(listMyRsvpsMock).toHaveBeenCalled();
		expect(listMyRsvpsMock.mock.calls.some((c) => c[1] === 'person-p')).toBe(true);
	});
});

const NO_EDITION_TODAY: Record<(typeof LOCALES)[number], string> = {
	en: 'No pinned edition',
	et: 'Trükiväljaanne valimata',
	lv: 'Izdevums nav norādīts',
	uk: 'Видання не вказано'
};

describe('#329 i18n — repertoire_edition_unknown exists; repertoire_no_edition unchanged', () => {
	it.each(LOCALES)('%s.json carries repertoire_edition_unknown, non-empty', (locale) => {
		const messages = localeMessages(locale);
		expect('repertoire_edition_unknown' in messages, `${locale}.json missing key`).toBe(true);
		expect(isMessageEmpty(messages['repertoire_edition_unknown'])).toBe(false);
	});

	it.each(LOCALES)(
		'%s: unknown and known-absent are DIFFERENT sentences — the two states must not share wording',
		(locale) => {
			const messages = localeMessages(locale);
			const unknown = messagePatterns(messages['repertoire_edition_unknown']).join(' ');
			const noEdition = messagePatterns(messages['repertoire_no_edition']).join(' ');
			expect(unknown).not.toBe('');
			expect(unknown).not.toBe(noEdition);
		}
	);

	it.each(LOCALES)("%s: repertoire_no_edition keeps today's wording byte-identically", (locale) => {
		const messages = localeMessages(locale);
		expect(messages['repertoire_no_edition']).toBe(NO_EDITION_TODAY[locale]);
	});
});

describe('#342 i18n — repertoire_edition_unknown_pinned exists; the three edition-state messages are distinct', () => {
	it.each(LOCALES)('%s.json carries repertoire_edition_unknown_pinned, non-empty', (locale) => {
		const messages = localeMessages(locale);
		expect('repertoire_edition_unknown_pinned' in messages, `${locale}.json missing key`).toBe(
			true
		);
		expect(isMessageEmpty(messages['repertoire_edition_unknown_pinned'])).toBe(false);
	});

	it.each(LOCALES)(
		'%s: no_edition, edition_unknown and edition_unknown_pinned are pairwise DIFFERENT sentences',
		(locale) => {
			const messages = localeMessages(locale);
			const noEdition = messagePatterns(messages['repertoire_no_edition']).join(' ');
			const unknown = messagePatterns(messages['repertoire_edition_unknown']).join(' ');
			const pinned = messagePatterns(messages['repertoire_edition_unknown_pinned']).join(' ');
			expect(pinned).not.toBe('');
			expect(pinned).not.toBe(unknown);
			expect(pinned).not.toBe(noEdition);
			expect(unknown).not.toBe(noEdition);
		}
	);
});

// (*MVOX:Tallis*)
