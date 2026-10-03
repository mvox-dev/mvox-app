// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { AgendaItem } from '$lib/agenda/types';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', {
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`
	})
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
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).repertoireActionsModule(await importOriginal())
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).databaseEntityModule(await importOriginal())
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('empty')
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule()
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);

import Page from './+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';

function setAuthedWithOneCollective() {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }] });
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

const REHEARSAL = item('ev-proov', 'Tavaline proov', '2030-06-10T16:00:00.000Z');

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue(toListRead([]));
	resetAppState();
});

const COMPONENT_NAME = 'Desk' + 'Surface'; // the removed wrapper component
const DESK_ATTR_SELECTOR = '[data' + '-desk]'; // its marker attribute
const WOOD_CLASS = 'wood' + '-bg'; // its background class
const SWEEP_NEEDLES = [
	COMPONENT_NAME,
	WOOD_CLASS,
	'--' + 'dx1', // first of the six offset custom properties
	'data' + '-desk',
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
	const css = readFileSync(join(process.cwd(), 'src', 'app.css'), 'utf-8').replace(
		/\/\*[\s\S]*?\*\//g,
		''
	);

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
