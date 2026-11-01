// @vitest-environment happy-dom
// The landing on `/` (#1063): six parts in order, each left out when empty, and one-tap answers.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const r = vi.hoisted(() => ({
	loadFullAgenda: vi.fn(),
	listMyRsvps: vi.fn(),
	findMyMemberId: vi.fn(),
	readRsvpRights: vi.fn(),
	readLearningWorks: vi.fn(),
	readEventTally: vi.fn(),
	listLinks: vi.fn(),
	readInitials: vi.fn(),
	applyRsvpChange: vi.fn()
}));
vi.mock('$lib/landing/landingReads', async (importOriginal) => ({
	...(await importOriginal<object>()),
	loadFullAgenda: r.loadFullAgenda,
	listMyRsvps: r.listMyRsvps,
	findMyMemberId: r.findMyMemberId,
	readRsvpRights: r.readRsvpRights,
	readLearningWorks: r.readLearningWorks,
	readEventTally: r.readEventTally,
	listLinks: r.listLinks,
	readInitials: r.readInitials
}));
vi.mock('$lib/rsvp/rsvpOptimistic', () => ({ applyRsvpChange: r.applyRsvpChange }));
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import Page from './+page.svelte';
import { gotoMock } from '$lib/testing/routeMocks';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { item } from '$lib/testing/pages/agenda';
import { signIn } from '$lib/testing/session';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import { selectCollective } from '$lib/collectives/store';
import { goOffline, resetOnLine } from '$lib/testing/networkSignal';
import type { AgendaItem } from '$lib/agenda/types';
import type { LearningWork } from '$lib/landing/landingReads';
import { overwriteGetLocale, type Locale } from '$lib/paraglide/runtime.js';

useKeptProblems();

const ev = (n: number, type = 'rehearsal'): AgendaItem => ({
	...item(`e${n}`, `Event ${n}`, `2030-06-${String(9 + n).padStart(2, '0')}T15:00:00.000Z`, type),
	location: 'Hall'
});
const EVENTS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ev(n));
const LEARNING: LearningWork[] = [
	{
		workId: 'w1',
		name: 'Spem in alium',
		composer: 'Thomas Tallis',
		sheets: [{ fileId: 'f1', filename: 'spem.pdf', edition: 'Novello' }]
	},
	{
		workId: 'w2',
		name: 'Ave verum',
		composer: 'Mozart',
		sheets: [
			{ fileId: 'f2', filename: 'ave-a.pdf', edition: 'Carus' },
			{ fileId: 'f3', filename: 'ave-b.pdf', edition: 'Bärenreiter' }
		]
	}
];
const LINKS = [
	{ id: 'l1', name: 'Drive', url: 'https://drive.example/x', description: null, displayOrder: 1 },
	{ id: 'l2', name: 'Chat', url: 'https://chat.example/y', description: null, displayOrder: 2 }
];

function answers(...entries: [string, string][]) {
	return {
		items: entries.map(([eventId, status], i) => ({ rsvpId: `r${i}`, eventId, status })),
		truncated: false
	};
}

function arrangeFull() {
	r.loadFullAgenda.mockResolvedValue(fullAgendaResult({ upcoming: EVENTS, seasonId: 's1' }));
	r.listMyRsvps.mockResolvedValue(answers(['e3', 'going']));
	r.findMyMemberId.mockResolvedValue('m1');
	r.readRsvpRights.mockResolvedValue(true);
	r.readLearningWorks.mockResolvedValue(LEARNING);
	r.readEventTally.mockResolvedValue({ going: 5, notResponded: 3 });
	r.listLinks.mockResolvedValue(LINKS);
	r.readInitials.mockResolvedValue('AK');
	r.applyRsvpChange.mockResolvedValue({ rsvpId: 'r-new' });
}

const q = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();
const PARTS = [
	'selected-collective',
	'landing-next-event',
	'landing-unanswered',
	'landing-learning',
	'landing-links',
	'landing-everything-else'
];
const partsShown = (c: HTMLElement) =>
	[...c.querySelectorAll('[data-testid]')]
		.map((el) => el.getAttribute('data-testid')!)
		.filter((id) => PARTS.includes(id));

async function renderLanding() {
	const { container } = render(Page);
	await waitFor(() => expect(q(container, 'landing-links')).not.toBeNull());
	return container;
}

beforeEach(() => {
	vi.clearAllMocks();
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }] });
	arrangeFull();
});

afterEach(() => {
	cleanup();
	resetOnLine();
});

describe('#1063 — the landing shows six parts, in order', () => {
	it('heading, next event, unanswered, learning, links, then the door to the rest', async () => {
		const c = await renderLanding();
		expect(partsShown(c)).toEqual(PARTS);
		expect(text(q(c, 'selected-collective'))).toBe('Sampledb');
		const profile = q(c, 'landing-profile')!;
		expect(profile.getAttribute('href')).toBe('/profile');
		expect(text(profile)).toBe('AK');
		const door = q(c, 'landing-everything-else')!;
		expect(door.getAttribute('href')).toBe('/agenda');
		expect(text(door)).toBe('Everything else: members, seasons ›');
	});

	it('leaves out every part with nothing to show: no heading, no placeholder', async () => {
		r.loadFullAgenda.mockResolvedValue(fullAgendaResult({ upcoming: [], seasonId: 's1' }));
		r.readLearningWorks.mockResolvedValue([]);
		r.listLinks.mockResolvedValue([]);
		const { container: c } = render(Page);
		await waitFor(() => expect(r.listLinks).toHaveBeenCalled());
		await new Promise((done) => setTimeout(done, 50));
		expect(partsShown(c)).toEqual(['selected-collective', 'landing-everything-else']);
		expect(c.querySelectorAll('h2')).toHaveLength(0);
	});

	it('leaves out the unanswered part when every later event is answered', async () => {
		r.loadFullAgenda.mockResolvedValue(fullAgendaResult({ upcoming: EVENTS.slice(0, 2) }));
		r.listMyRsvps.mockResolvedValue(answers(['e2', 'maybe']));
		const c = await renderLanding();
		expect(q(c, 'landing-next-event')).not.toBeNull();
		expect(q(c, 'landing-unanswered')).toBeNull();
	});
});

describe('#1063 — the next event card', () => {
	it('has no title when the event has no name', async () => {
		r.loadFullAgenda.mockResolvedValue(fullAgendaResult({ upcoming: [{ ...EVENTS[0], name: '' }] }));
		const c = await renderLanding();
		expect(q(c, 'landing-next-event')!.querySelector('h2')).toBeNull();
		expect(text(q(c, 'landing-next-event'))).toContain('Rehearsal · Monday, June 10');
	});

	it('says what, when and where, and links the event page with the tally', async () => {
		const c = await renderLanding();
		const card = q(c, 'landing-next-event')!;
		expect(text(card.querySelector('h2'))).toBe('Event 1');
		expect(text(card)).toContain('Rehearsal · Monday, June 10');
		expect(text(card)).toContain('18:00–19:30 · Hall');
		expect(text(q(card, 'landing-next-answer'))).toBe('Not responded');
		expect(q(card, 'landing-going-e1')).not.toBeNull();
		const link = q(card, 'landing-event-link')!;
		expect(link.getAttribute('href')).toBe('/event/e1');
		expect(text(link)).toBe('5 going · 3 not responded · programme and scores ›');
	});

	it.each([
		['lv', 'Vēl neatbildēts'],
		['uk', 'Ще без відповіді']
	])('in %s, an unanswered next event reads as one person not answering: %s', async (locale, words) => {
		overwriteGetLocale(() => locale as Locale);
		try {
			const c = await renderLanding();
			expect(text(q(c, 'landing-next-answer'))).toBe(words);
		} finally {
			overwriteGetLocale(() => 'en' as Locale);
		}
	});

	it('shows the own answer and a change-answer button that opens all four answers', async () => {
		r.listMyRsvps.mockResolvedValue(answers(['e1', 'late']));
		const c = await renderLanding();
		await waitFor(() => expect(text(q(c, 'landing-next-answer'))).toBe('Late Change answer'));
		expect(q(c, 'landing-going-e1')).toBeNull();
		await fireEvent.click(q(c, 'landing-change-answer')!);
		await fireEvent.click(q(c, 'rsvp-btn-maybe')!);
		await waitFor(() => expect(r.applyRsvpChange).toHaveBeenCalledTimes(1));
		expect(r.applyRsvpChange.mock.calls[0][0]).toMatchObject({
			eventId: 'e1',
			newStatus: 'maybe',
			existing: { rsvpId: 'r0', eventId: 'e1', status: 'late' }
		});
	});
});

describe('#1063 — "waiting for your answer"', () => {
	it('lists unanswered events after the next one: the first 5, with the full count', async () => {
		const c = await renderLanding();
		const part = q(c, 'landing-unanswered')!;
		expect(text(part.querySelector('h2'))).toBe('Waiting for your answer · 7');
		const rows = [...part.querySelectorAll('li')].map((li) => li.getAttribute('data-testid'));
		expect(rows).toEqual([
			'landing-unanswered-e2',
			'landing-unanswered-e4',
			'landing-unanswered-e5',
			'landing-unanswered-e6',
			'landing-unanswered-e7'
		]);
		expect(q(part, 'landing-all-agenda')!.getAttribute('href')).toBe('/agenda');
	});

	it('✓ saves "going" in one tap and the row leaves the list', async () => {
		const c = await renderLanding();
		await waitFor(() => expect((q(c, 'landing-going-e2') as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(q(c, 'landing-going-e2')!);
		await waitFor(() => expect(r.applyRsvpChange).toHaveBeenCalledTimes(1));
		expect(r.applyRsvpChange.mock.calls[0][0]).toMatchObject({
			personId: 'p1',
			memberId: 'm1',
			eventId: 'e2',
			existing: null,
			newStatus: 'going'
		});
		expect(q(c, 'landing-unanswered-e2')).toBeNull();
		expect(text(q(c, 'landing-unanswered')!.querySelector('h2'))).toBe('Waiting for your answer · 6');
	});

	it('⋯ offers the other three answers, and one of them saves', async () => {
		const c = await renderLanding();
		await waitFor(() => expect((q(c, 'landing-more-e4') as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(q(c, 'landing-more-e4')!);
		const others = q(c, 'landing-others-e4')!;
		expect([...others.querySelectorAll('button')].map(text)).toEqual(['Not going', 'Maybe', 'Late']);
		await fireEvent.click(q(c, 'landing-answer-not_going-e4')!);
		await waitFor(() => expect(r.applyRsvpChange).toHaveBeenCalledTimes(1));
		expect(r.applyRsvpChange.mock.calls[0][0]).toMatchObject({ eventId: 'e4', newStatus: 'not_going' });
		expect(q(c, 'landing-unanswered-e4')).toBeNull();
	});

	it('a failed save puts the row back, says so on it, and reports once', async () => {
		r.applyRsvpChange.mockRejectedValueOnce(new Error('createRsvp failed: 500'));
		const c = await renderLanding();
		await waitFor(() => expect((q(c, 'landing-going-e5') as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(q(c, 'landing-going-e5')!);
		await waitFor(() => expect(text(q(c, 'landing-save-failed-e5'))).toBe("Couldn't save — tap to try again."));
		expect(q(c, 'landing-unanswered-e5')).not.toBeNull();
		await waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'landing', action: 'saving an answer', detail: 'Error: createRsvp failed: 500' }
			])
		);
	});

	it('offline, the answer buttons are disabled and the page says why', async () => {
		const c = await renderLanding();
		await goOffline();
		await waitFor(() => expect(r.findMyMemberId).toHaveBeenCalled());
		await new Promise((done) => setTimeout(done, 20));
		expect((q(c, 'landing-going-e2') as HTMLButtonElement).disabled).toBe(true);
		expect((q(c, 'landing-going-e1') as HTMLButtonElement).disabled).toBe(true);
		expect(q(c, 'landing-write-unavailable')).not.toBeNull();
	});

	it('a non-member gets the members-only hint and no unanswered list', async () => {
		r.findMyMemberId.mockResolvedValue(null);
		const c = await renderLanding();
		await waitFor(() => expect(text(q(c, 'rsvp-non-member-hint'))).toBe('Only members can RSVP.'));
		expect(q(c, 'landing-going-e1')).toBeNull();
		expect(q(c, 'landing-unanswered')).toBeNull();
	});
});

describe('#1063 — "now learning", links', () => {
	it('lists each learning work once; Noot opens its sheet', async () => {
		const c = await renderLanding();
		const part = q(c, 'landing-learning')!;
		expect([...part.querySelectorAll('li')].map((li) => li.getAttribute('data-testid'))).toEqual([
			'landing-work-w1',
			'landing-work-w2'
		]);
		expect(text(q(part, 'landing-work-w1'))).toContain('Spem in alium');
		await fireEvent.click(q(part, 'landing-sheet-w1')!);
		expect(gotoMock).toHaveBeenCalledWith('/part/f1?db=sampledb', {
			state: {
				partLabel: { work: 'Spem in alium', composer: 'Thomas Tallis', edition: 'Novello', filename: 'spem.pdf' }
			}
		});
		expect(q(part, 'landing-all-library')!.getAttribute('href')).toBe('/library');
	});

	it('with two learning editions, Noot offers the choice of the two', async () => {
		const c = await renderLanding();
		await fireEvent.click(q(c, 'landing-sheet-w2')!);
		expect(gotoMock).not.toHaveBeenCalled();
		expect(text(q(c, 'landing-sheet-choice-f2'))).toBe('Carus');
		await fireEvent.click(q(c, 'landing-sheet-choice-f3')!);
		expect(gotoMock).toHaveBeenCalledWith('/part/f3?db=sampledb', expect.anything());
	});

	it('shows the links as chips that open the link', async () => {
		const c = await renderLanding();
		const chips = [...q(c, 'landing-links')!.querySelectorAll('a')];
		expect(chips.map((a) => [text(a), a.getAttribute('href')])).toEqual([
			['Drive', 'https://drive.example/x'],
			['Chat', 'https://chat.example/y']
		]);
	});

	it('#1066 — a stored javascript:/data: link is a plain chip with no href, reported once', async () => {
		r.listLinks.mockResolvedValue([
			...LINKS,
			{ id: 'l3', name: 'Evil', url: 'javascript:alert(1)', description: null, displayOrder: 3 },
			{ id: 'l4', name: 'Blob', url: 'data:text/html,hi', description: null, displayOrder: 4 },
			{ id: 'l5', name: 'Mail', url: 'mailto:a@b.ee', description: null, displayOrder: 5 },
			{ id: 'l6', name: 'Old', url: 'example.com/x', description: null, displayOrder: 6 }
		]);
		const c = await renderLanding();
		const section = q(c, 'landing-links')!;
		expect([...section.querySelectorAll('a')].map(text)).toEqual(['Drive', 'Chat', 'Mail', 'Old']);
		expect(section.querySelectorAll('a')[3].getAttribute('href')).toBe('https://example.com/x');
		expect(text(section)).toContain('Evil');
		expect(text(section)).toContain('Blob');
		expect(section.innerHTML).not.toMatch(/javascript:|data:text/i);
		await waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'landing', action: 'showing a link', detail: 'link l3 uses scheme javascript' },
				{ area: 'landing', action: 'showing a link', detail: 'link l4 uses scheme data' }
			])
		);
	});

	it('#1066 — coming back to the landing files no second report for the same link', async () => {
		r.listLinks.mockResolvedValue([
			...LINKS,
			{ id: 'l3', name: 'Evil', url: 'javascript:alert(1)', description: null, displayOrder: 3 }
		]);
		const first = render(Page);
		await waitFor(async () => expect(await keptProblems()).toHaveLength(1));
		first.unmount();
		const c = await renderLanding();
		await new Promise((res) => setTimeout(res, 50));
		expect(q(c, 'landing-links')).not.toBeNull();
		expect(await keptProblems()).toHaveLength(1);
	});

	it('when the name read fails, the profile link says "Profile" and it reports once', async () => {
		r.readInitials.mockRejectedValue(new Error('listMyProfiles failed: 500'));
		const c = await renderLanding();
		await waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'landing', action: 'reading your name', detail: 'Error: listMyProfiles failed: 500' }
			])
		);
		expect(text(q(c, 'landing-profile'))).toBe('Profile');
		expect(q(c, 'landing-profile')!.getAttribute('href')).toBe('/profile');
	});

	it('a failed read says so in its place and reports once', async () => {
		r.listLinks.mockRejectedValue(new Error('listLinks failed: HTTP 503'));
		const { container: c } = render(Page);
		await waitFor(() => expect(text(q(c, 'landing-links-error'))).toBe("Couldn't load the links."));
		expect(q(c, 'landing-links')).toBeNull();
		await waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'landing', action: 'loading the links', detail: 'Error: listLinks failed: HTTP 503' }
			])
		);
	});
});

describe('#1063 — switching collective', () => {
	it("a write that settles after a switch never paints on B, leaves B's same-id row free, reports under A", async () => {
		signIn({
			collectives: [
				{ db: 'org-a', name: 'Org A', personId: 'p1' },
				{ db: 'org-b', name: 'Org B', personId: 'p1' }
			],
			selected: 'org-a'
		});
		let failA: (e: Error) => void = () => {};
		r.applyRsvpChange.mockImplementationOnce(
			() => new Promise((_, reject) => (failA = reject))
		);
		const { container: c } = render(Page);
		await waitFor(() => expect((q(c, 'landing-going-e2') as HTMLButtonElement)?.disabled).toBe(false));
		await fireEvent.click(q(c, 'landing-going-e2')!);
		await waitFor(() => expect(r.applyRsvpChange).toHaveBeenCalledTimes(1));

		await selectCollective('org-b');
		await waitFor(() => expect(r.listMyRsvps).toHaveBeenCalledTimes(2));
		await waitFor(() => expect((q(c, 'landing-going-e2') as HTMLButtonElement)?.disabled).toBe(false));
		await fireEvent.click(q(c, 'landing-going-e2')!);
		await waitFor(() => expect(r.applyRsvpChange).toHaveBeenCalledTimes(2));
		expect(r.applyRsvpChange.mock.calls[1][0]).toMatchObject({ eventId: 'e2', cfg: { db: 'org-b' } });

		failA(new Error('createRsvp failed: 500'));
		await new Promise((done) => setTimeout(done, 50));
		expect(q(c, 'landing-save-failed-e2')).toBeNull();
		expect(q(c, 'landing-unanswered-e2'), "B's saved answer stays").toBeNull();
		await waitFor(async () =>
			expect(await keptProblems({ db: 'org-a', personId: 'p1' })).toEqual([
				{ area: 'landing', action: 'saving an answer', detail: 'Error: createRsvp failed: 500' }
			])
		);
		expect(await keptProblems({ db: 'org-b', personId: 'p1' })).toEqual([]);
	});

	it("a late result from the old collective never paints on the new one", async () => {
		signIn({
			collectives: [
				{ db: 'org-a', name: 'Org A', personId: 'p1' },
				{ db: 'org-b', name: 'Org B', personId: 'p1' }
			],
			selected: 'org-a'
		});
		let lateLinks: (rows: unknown) => void = () => {};
		r.listLinks.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'org-a'
				? new Promise((resolve) => (lateLinks = resolve))
				: Promise.resolve([{ ...LINKS[1], id: 'b1', name: 'B chat' }])
		);
		const { container: c } = render(Page);
		await waitFor(() => expect(r.listLinks).toHaveBeenCalledTimes(1));
		await selectCollective('org-b');
		await waitFor(() => expect(q(c, 'landing-links')).not.toBeNull());
		lateLinks([{ ...LINKS[0], name: 'A drive' }]);
		await new Promise((done) => setTimeout(done, 20));
		expect([...q(c, 'landing-links')!.querySelectorAll('a')].map(text)).toEqual(['B chat']);
		expect((q(c, 'selected-collective') as HTMLSelectElement).value).toBe('org-b');
	});
});

// (*MVOX:Josquin*)
