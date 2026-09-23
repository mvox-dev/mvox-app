// @vitest-environment happy-dom
//
// #474 RED — the desk background is GONE, the agenda sits on plain paper.
//
// Mihkel (2026-09-23, verbatim): "Lets reopen the background task - instead of
// disabling the animation, lets remove it altogether". Supersedes #463, which
// stood the gradients still; this removes the surface component entirely and
// leaves the front page on the ordinary paper background (bg-paper, the house
// token — src/app.css --color-paper).
//
// Two halves:
//   1. INTEGRATION — the real +page.svelte in the authenticated,
//      collectives-ready agenda state (harness family of
//      page.agenda-event-types.spec.ts): no desk wrapper attribute, no wood
//      background class anywhere in the rendered tree, the agenda's root
//      column painted bg-paper itself, and the agenda list still rendering.
//   2. SOURCE SWEEP — no file under src/ mentions the surface component or
//      its CSS machinery any more, so it cannot quietly return (walker
//      precedent: src/lib/invite/no-rendered-invite-link.sweep.spec.ts).
//      NOTE: every needle below is built by concatenation so THIS file does
//      not trip the sweep (or the done-when `git grep` gate) itself.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { AgendaItem } from '$lib/agenda/types';

vi.mock('$lib/paraglide/messages.js', () => {
	const keys: Record<string, (params?: Record<string, unknown>) => string> = {
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`
	};
	return {
		m: new Proxy(keys, {
			get: (target, key) => target[String(key)] ?? (() => `[${String(key)}]`)
		})
	};
});

const { loadFullAgendaMock, discoverMock, gotoMock, findMyMemberIdMock, listMyRsvpsMock } =
	vi.hoisted(() => ({
		loadFullAgendaMock: vi.fn(),
		discoverMock: vi.fn(),
		gotoMock: vi.fn(),
		findMyMemberIdMock: vi.fn(),
		listMyRsvpsMock: vi.fn()
	}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn((..._args: unknown[]) => {
		const [, entityId, personId] = _args as [unknown, string, string];
		return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
	})
}));
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn().mockResolvedValue([]),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

function setAuthedWithOneCollective() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'p1' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

function item(id: string, name: string, startDatetime: string): AgendaItem {
	return {
		id,
		name,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		eventType: 'rehearsal'
	} as AgendaItem;
}

// Far-future date: AgendaList's relative-day decoration reads the real clock.
const REHEARSAL = item('ev-proov', 'Tavaline proov', '2030-06-10T16:00:00.000Z');

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue(toListRead([]));
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

// ── needles, concatenated so this spec never matches itself ─────────────────
const COMPONENT_NAME = 'Desk' + 'Surface'; // the removed wrapper component
const DESK_ATTR_SELECTOR = '[data' + '-desk]'; // its marker attribute
const WOOD_CLASS = 'wood' + '-bg'; // its background class
const SWEEP_NEEDLES = [
	COMPONENT_NAME,
	WOOD_CLASS,
	'--' + 'dx1', // first of the six offset custom properties
	'data' + '-desk',
	// #474 review F2 — NARROWED (and, like every needle here, concatenated so
	// this file does not match itself). The bare at-rule name alone also spells
	// the standard JSDoc/TSDoc tag, so the first unrelated typedef comment
	// anywhere under src/ would have failed this suite with a message about a
	// desk background — misleading enough to invite deleting the guard rather
	// than reading it. All six registrations we sweep for declared offset
	// custom properties whose names start with the two letters below, so the
	// needle carries that prefix and a JSDoc tag can no longer trip it.
	'@' + 'property ' + '--d', // the CSS custom-property registrations
	'wood' + '-orbit'
];

describe('#474 — the front page agenda sits on plain paper (integration)', () => {
	async function mountAgenda() {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming: [REHEARSAL] }));
		setAuthedWithOneCollective();
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-list"]')).not.toBeNull();
		});
		return container;
	}

	it('renders NO desk wrapper: no marker attribute, no wood background class', async () => {
		const container = await mountAgenda();
		expect(
			container.querySelector(DESK_ATTR_SELECTOR),
			'#474: the desk wrapper must be gone from the rendered agenda'
		).toBeNull();
		expect(
			container.getElementsByClassName(WOOD_CLASS).length,
			'#474: no element may carry the wood background class'
		).toBe(0);
	});

	it('the agenda root column carries bg-paper itself (paper, not blank)', async () => {
		const container = await mountAgenda();
		const column = container.querySelector('div.max-w-md');
		expect(column, 'the agenda root column (max-w-md) must render').not.toBeNull();
		expect(
			(column as HTMLElement).classList.contains('bg-paper'),
			'#474: with the desk surface gone, the surviving root must paint bg-paper — ' +
				'app.html paints no body background, so a bare deletion would leave the page blank'
		).toBe(true);
	});

	it('the agenda list still renders on the paper surface', async () => {
		const container = await mountAgenda();
		expect(container.querySelector('[data-testid="agenda-list"]')).not.toBeNull();
	});
});

describe('#474 review F1 — the paper paint is full-bleed, not column-width', () => {
	// The regression this pins: `bg-paper` moved from the removed surface's
	// `w-full` wrapper onto the agenda's centered `max-w-md` column, which is
	// 28rem — so every viewport wider than that showed a paper strip on the
	// browser's default white, and `/` became the only route not fully on paper
	// (every HOUSE_SHELL route paints a full-width `min-h-screen bg-paper`
	// <main>). Asserting only that SOME element carries bg-paper cannot see
	// that, so assert the full-bleed painter itself.
	//
	// The full-bleed element in a SPA with no server-rendered shell is <body>:
	// app.html ships no style on it, +layout.svelte paints nothing, and
	// NavShell's .nav-content is order/flex/overflow-y only. So the guard reads
	// app.css. jsdom/happy-dom never applies the stylesheet, which is exactly
	// why this has to be a source assertion rather than a computed-style one.
	const css = readFileSync(join(process.cwd(), 'src', 'app.css'), 'utf-8').replace(
		/\/\*[\s\S]*?\*\//g,
		''
	);

	/** Body of the FIRST top-level `@layer <name> { … }` block, brace-matched. */
	function layerBody(source: string, name: string): string | null {
		const open = source.search(new RegExp(`@layer\\s+${name}\\s*\\{`));
		if (open === -1) return null;
		const start = source.indexOf('{', open);
		let depth = 0;
		for (let i = start; i < source.length; i++) {
			if (source[i] === '{') depth++;
			else if (source[i] === '}' && --depth === 0) return source.slice(start + 1, i);
		}
		return null;
	}

	function bodyPaperRules(source: string): string[] {
		return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
			.filter(([, selector, decls]) => {
				const s = selector.split(/[{}]/).pop() ?? selector;
				if (!/(^|[,\s])body(?![-\w])/.test(s)) return false;
				return /background(-color)?\s*:[^;]*var\(\s*--color-paper\s*\)/.test(decls);
			})
			.map(([whole]) => whole);
	}

	it('app.css paints <body> with the house paper token', () => {
		expect(
			bodyPaperRules(css).length,
			'#474: the paper paint must sit on a full-bleed element. bg-paper on the ' +
				'centered max-w-md column only paints 448px, leaving browser-default white ' +
				'either side on any wider viewport.'
		).toBeGreaterThan(0);
	});

	it('that body rule sits inside @layer base, so a bg-* utility can still win', () => {
		const base = layerBody(css, 'base');
		expect(base, 'expected app.css to declare an @layer base block').not.toBeNull();
		expect(
			bodyPaperRules(base ?? '').length,
			'unlayered CSS outranks every Tailwind utility (all of which live in ' +
				'@layer utilities), so an unlayered body background would pin the page ' +
				'even where a future bg-* is deliberate — see the #151 note in app.css'
		).toBeGreaterThan(0);
	});
});

// ── the source sweep: the surface cannot quietly return ─────────────────────

/**
 * Every file under src/ — specs included, mirroring the done-when
 * `git grep … -- src` gate. Generated, GITIGNORED paraglide output is skipped
 * (git grep only sees tracked files; its runtime.js carries JSDoc tags that
 * are not ours) — same exclusion as the #360 sweep's walker.
 */
function allSourceFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const rel = relative(process.cwd(), full).replaceAll('\\', '/');
		if (rel === 'src/lib/paraglide' || rel === 'src/paraglide') continue; // generated, untracked
		if (statSync(full).isDirectory()) {
			allSourceFiles(full, out);
			continue;
		}
		out.push(rel);
	}
	return out;
}

describe('#474 — no file under src/ mentions the desk surface machinery', () => {
	it('sweep: component name, wood/desk markers, offset props and CSS registrations are all gone', () => {
		const hits: string[] = [];
		for (const file of allSourceFiles(join(process.cwd(), 'src'))) {
			const text = readFileSync(file, 'utf-8').toLowerCase();
			for (const needle of SWEEP_NEEDLES) {
				if (text.includes(needle.toLowerCase())) hits.push(`${file} :: ${needle}`);
			}
		}
		expect(
			hits,
			'#474 done-when: nothing in the tree registers or computes the desk background any more'
		).toEqual([]);
	});
});

// (*MVOX:Palestrina* — #474 RED: paper-only front page + source sweep)
