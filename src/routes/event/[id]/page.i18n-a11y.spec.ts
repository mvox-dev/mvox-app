// @vitest-environment happy-dom
// #105: i18n and a11y on the real event route; source scans for copy, rendered DOM for semantics.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bareTextNodes } from '$lib/testing/bareText';
import { surfacesUnder } from '$lib/testing/svelteSurfaces';

const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
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

const EVENT_SURFACES = surfacesUnder('src/routes/event/', 'src/lib/events/');

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

function readSource(relPath: string): string {
	return readFileSync(resolve(process.cwd(), relPath), 'utf-8');
}

function readMessages(locale: string): Record<string, string> {
	return JSON.parse(readSource(`messages/${locale}.json`)) as Record<string, string>;
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

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

function pastConductorEvent(over: Partial<Record<string, unknown>> = {}) {
	return editorEvent({
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-08-01T16:00:00.000Z' }],
		conductor: [{ reference: 'p-viewer' }],
		...over
	});
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

function entuStub(event: Record<string, unknown>) {
	const season = seasonEntity();
	const series = seriesEntity();
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/ev1') && method === 'POST') return json({});
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
}

function setAuthedWithSampledb() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'p-viewer' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

function renderEventPage(event: Record<string, unknown> = eventEntity()) {
	const fetchStub = entuStub(event);
	vi.stubGlobal('fetch', fetchStub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
	const rendered = render(Page);
	return { ...rendered, fetchStub };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

async function waitForTestid(container: HTMLElement, testid: string): Promise<HTMLElement> {
	return await waitFor(() => {
		const el = container.querySelector(`[data-testid="${testid}"]`);
		expect(el, `${testid} missing`).not.toBeNull();
		return el as HTMLElement;
	});
}

const EDITABLE_FIELDS = [
	'name',
	'start_datetime',
	'duration_minutes',
	'location',
	'description'
] as const;

function accessibleName(el: Element): string {
	const labelledby = el.getAttribute('aria-labelledby');
	if (labelledby) {
		return labelledby
			.split(/\s+/)
			.filter(Boolean)
			.map((id) => {
				const target = el.ownerDocument.getElementById(id);
				return target ? accessibleName(target) : '';
			})
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
	}
	const label = el.getAttribute('aria-label');
	if (label) return label.replace(/\s+/g, ' ').trim();
	let out = '';
	for (const node of el.childNodes) {
		if (node.nodeType === 3 /* TEXT_NODE */) {
			out += node.textContent ?? '';
		} else if (node.nodeType === 1 /* ELEMENT_NODE */) {
			const child = node as Element;
			if (child.getAttribute('aria-hidden') === 'true') continue;
			out += ` ${accessibleName(child)}`;
		}
	}
	return out.replace(/\s+/g, ' ').trim();
}

const EVENT_HEADING = 'Tuesday Rehearsal';

function editPosts(fetchStub: ReturnType<typeof vi.fn>) {
	return fetchStub.mock.calls.filter(
		(c) =>
			((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST' &&
			String(c[0]).includes('/entity/ev1')
	);
}

describe('#105 — i18n: the event detail page renders via Paraglide keys only', () => {
	it('the derived EVENT_SURFACES list is not empty (a moved folder would scan nothing)', () => {
		expect(EVENT_SURFACES.length).toBeGreaterThanOrEqual(8);
	});

	it.each(EVENT_SURFACES)('%s contains no bare text nodes outside m.* calls', (file) => {
		expect(bareTextNodes(readSource(file))).toEqual([]);
	});

	it.each(EVENT_SURFACES)('%s has no hardcoded aria-label string literals (labels must come from m.*)', (file) => {
		const hardcoded = readSource(file).match(/aria-label="[^"]*[a-zA-Z][^"]*"/g) ?? [];
		expect(hardcoded).toEqual([]);
	});

	it.each(EVENT_SURFACES)('every m.* key %s references exists in en.json (a key that renders its own name is a missing translation)', (file) => {
		const source = readSource(file);
		const en = readMessages('en');
		const referenced = new Set<string>();
		const pattern = /\bm\.([a-z][a-zA-Z0-9_]*)/g;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(source)) !== null) referenced.add(match[1]);
		expect(referenced.size).toBeGreaterThan(0);
		const missing = [...referenced].filter((key) => !(key in en));
		expect(missing).toEqual([]);
	});

	it('every event_detail_* / event_edit_* / event_type_* key in en.json exists in et, lv and uk', () => {
		const en = readMessages('en');
		const eventKeys = Object.keys(en).filter(
			(k) =>
				k.startsWith('event_detail_') || k.startsWith('event_edit_') || k.startsWith('event_type_')
		);
		expect(eventKeys.length).toBeGreaterThan(0);
		for (const locale of ['et', 'lv', 'uk']) {
			const messages = readMessages(locale);
			const missing = eventKeys.filter((k) => !(k in messages));
			expect(missing, `${locale}.json is missing event keys`).toEqual([]);
		}
	});
});

describe('#105 — i18n: edit-button labels name the OBJECT edited', () => {
	it("en: the name pencil is 'Edit event name' — 'Edit name' out of context could as well mean the profile name", () => {
		expect(readMessages('en').event_edit_name_aria_label).toBe('Edit event name');
	});

	it("en: the location pencil stays 'Edit location'", () => {
		expect(readMessages('en').event_edit_location_aria_label).toBe('Edit location');
	});

	it('the five edit labels are pairwise distinct in every locale — five identical "Edit" buttons are indistinguishable to a screen reader', () => {
		for (const locale of LOCALES) {
			const messages = readMessages(locale);
			const labels = EDITABLE_FIELDS.map((f) => messages[`event_edit_${f}_aria_label`]);
			for (const label of labels) {
				expect(label, `${locale}: missing an edit aria-label key`).toBeTruthy();
			}
			expect(new Set(labels).size, `${locale}: duplicate edit labels`).toBe(labels.length);
		}
	});

	it('event_detail_rsvp_heading exists in all four locales (the RSVP region needs a heading to be named by)', () => {
		for (const locale of LOCALES) {
			expect(
				readMessages(locale).event_detail_rsvp_heading,
				`${locale}.json is missing event_detail_rsvp_heading`
			).toBeTruthy();
		}
	});
});

describe('#105 — a11y: landmarks and headings', () => {
	it('exactly one <main> landmark, containing both the back link and the h1', async () => {
		const { container } = renderEventPage();
		await waitForTestid(container, 'event-detail-name');
		const mains = container.querySelectorAll('main');
		expect(mains).toHaveLength(1);
		expect(mains[0].querySelector('[data-testid="event-detail-back"]')).not.toBeNull();
		expect(mains[0].querySelector('h1')).not.toBeNull();
	});

	it('the event name is the ONE h1 on the page', async () => {
		const { container } = renderEventPage();
		const name = await waitForTestid(container, 'event-detail-name');
		expect(name.tagName).toBe('H1');
		expect(name.textContent).toContain('Tuesday Rehearsal');
		expect(container.querySelectorAll('h1')).toHaveLength(1);
	});

	it('the RSVP region is a <section> with an h2 heading rendered from event_detail_rsvp_heading', async () => {
		const { container } = renderEventPage();
		const rsvp = await waitForTestid(container, 'event-detail-rsvp');
		expect(rsvp.tagName, 'the RSVP region must be a <section>, not an anonymous <div>').toBe(
			'SECTION'
		);
		const heading = rsvp.querySelector('h2');
		expect(heading, 'the RSVP section has no heading').not.toBeNull();
		expect(heading!.textContent).toContain('[event_detail_rsvp_heading]');
	});

	it('the Works region is a <section> whose h2 renders event_detail_works_heading', async () => {
		const { container } = renderEventPage(editorEvent());
		const works = await waitForTestid(container, 'event-detail-works');
		expect(works.tagName, 'the Works region must be a <section>').toBe('SECTION');
		const heading = works.querySelector('h2');
		expect(heading).not.toBeNull();
		expect(heading!.textContent).toContain('[event_detail_works_heading]');
	});

	it('the Attendance region is a <section> whose h2 renders event_detail_attendance_heading', async () => {
		const { container } = renderEventPage(pastConductorEvent());
		const attendance = await waitForTestid(container, 'event-detail-attendance');
		expect(attendance.tagName, 'the Attendance region must be a <section>').toBe('SECTION');
		const heading = attendance.querySelector('h2');
		expect(heading).not.toBeNull();
		expect(heading!.textContent).toContain('[event_detail_attendance_heading]');
	});

	it('opening the attendance panel moves focus INTO it, and closing returns focus to the restored entry point', async () => {
		const { container } = renderEventPage(pastConductorEvent());
		const attendance = await waitForTestid(container, 'event-detail-attendance');
		const open = await waitFor(() => {
			const el = attendance.querySelector('[data-testid="take-attendance-btn"]');
			expect(el, 'the conductor entry point').not.toBeNull();
			return el as HTMLElement;
		});
		open.focus();
		await fireEvent.click(open);
		const panel = await waitFor(() => {
			const el = attendance.querySelector('[data-testid="attendance-panel"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(
			attendance.querySelector('[data-testid="take-attendance-btn"]'),
			'the entry point unmounts while the panel is open'
		).toBeNull();
		expect(
			panel.contains(panel.ownerDocument.activeElement),
			`focus must land inside the panel, was on <${panel.ownerDocument.activeElement?.tagName}>`
		).toBe(true);

		const close = panel.querySelector('[data-testid="attendance-collapse-btn"]') as HTMLElement;
		expect(close, "the panel's close control").not.toBeNull();
		close.focus();
		await fireEvent.click(close);
		const restored = await waitFor(() => {
			expect(attendance.querySelector('[data-testid="attendance-panel"]')).toBeNull();
			const el = attendance.querySelector('[data-testid="take-attendance-btn"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		await waitFor(() => {
			expect(
				restored.ownerDocument.activeElement,
				'focus must return to the restored entry point'
			).toBe(restored);
		});
	});

	it('heading levels never skip (h1 → h2 → h3, no jumps) — on the editor view with every section rendered', async () => {
		const { container } = renderEventPage(pastConductorEvent());
		await waitForTestid(container, 'event-detail-attendance');
		const headings = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')];
		expect(headings.length).toBeGreaterThan(1);
		expect(headings[0].tagName).toBe('H1');
		let prevLevel = 1;
		for (const heading of headings.slice(1)) {
			const level = Number(heading.tagName[1]);
			expect(
				level,
				`heading "${heading.textContent?.trim()}" skips from h${prevLevel} to h${level}`
			).toBeLessThanOrEqual(prevLevel + 1);
			prevLevel = level;
		}
	});
});

describe('#105 — a11y: back link', () => {
	it('is a real <a href="/"> whose accessible text comes from event_detail_back, with the arrow glyph aria-hidden', async () => {
		const { container } = renderEventPage();
		const back = await waitForTestid(container, 'event-detail-back');
		expect(back.tagName).toBe('A');
		expect(back.getAttribute('href')).toBe('/');
		expect(back.textContent).toContain('[event_detail_back]');
		const arrow = [...back.querySelectorAll('span')].find((s) => s.textContent?.includes('←'));
		expect(arrow, 'the ← glyph must live in its own aria-hidden span').not.toBeUndefined();
		expect(arrow!.getAttribute('aria-hidden')).toBe('true');
	});
});

describe('#105 — a11y: edit pencils and inputs are labelled per field', () => {
	it('every pencil is a <button type="button"> whose label rides as an sr-only CHILD (never aria-label — #157), with an aria-hidden glyph', async () => {
		const { container } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-description');
		for (const field of EDITABLE_FIELDS) {
			const btn = container.querySelector(
				`[data-testid="event-edit-btn-${field}"]`
			) as HTMLElement | null;
			expect(btn, `event-edit-btn-${field} missing`).not.toBeNull();
			expect(btn!.tagName).toBe('BUTTON');
			expect(btn!.getAttribute('type')).toBe('button');
			expect(
				btn!.getAttribute('aria-label'),
				`event-edit-btn-${field} carries aria-label — it would silence the value it wraps`
			).toBeNull();
			const srLabel = btn!.querySelector('.sr-only');
			expect(srLabel, `event-edit-btn-${field} has no sr-only label node`).not.toBeNull();
			expect(srLabel!.textContent).toBe(`[event_edit_${field}_aria_label]`);
			const glyph = [...btn!.querySelectorAll('span')].find((el) =>
				(el.textContent ?? '').includes('✎')
			);
			expect(glyph, `event-edit-btn-${field} glyph span missing`).not.toBeUndefined();
			expect(glyph!.getAttribute('aria-hidden')).toBe('true');
		}
	});

	it('every edit input carries the SAME accessible name as the pencil it replaced (the button is unmounted, its label cannot name the textbox)', async () => {
		const { container } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-description');
		for (const field of EDITABLE_FIELDS) {
			await fireEvent.click(container.querySelector(`[data-testid="event-edit-btn-${field}"]`)!);
			const input = await waitForTestid(container, `event-edit-input-${field}`);
			expect(input.getAttribute('aria-label')).toBe(`[event_edit_${field}_aria_label]`);
			const keyTarget =
				container.querySelector(`[data-testid="event-edit-input-${field}-date"]`) ?? input;
			await fireEvent.keyDown(keyTarget, { key: 'Escape' });
			await waitFor(() => {
				expect(container.querySelector(`[data-testid="event-edit-input-${field}"]`)).toBeNull();
			});
		}
	});
});

describe('#157 — the edit tap target is the whole field, not the pencil glyph', () => {
	const VALUE_TESTID: Record<string, string> = {
		start_datetime: 'event-detail-time',
		duration_minutes: 'event-detail-duration',
		location: 'event-detail-location',
		description: 'event-detail-description'
	};

	it('each field value is rendered INSIDE its edit button', async () => {
		const { container } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-description');
		for (const [field, valueTestid] of Object.entries(VALUE_TESTID)) {
			const btn = container.querySelector(`[data-testid="event-edit-btn-${field}"]`);
			expect(btn, `event-edit-btn-${field} missing`).not.toBeNull();
			const value = container.querySelector(`[data-testid="${valueTestid}"]`);
			expect(value, `${valueTestid} missing`).not.toBeNull();
			expect(
				btn!.contains(value),
				`${valueTestid} is outside event-edit-btn-${field} — the tap target is the glyph again`
			).toBe(true);
		}
	});

	it('the name value sits inside the button too, with the <h1> wrapping the button (heading role preserved)', async () => {
		const { container } = renderEventPage(editorEvent());
		const btn = await waitForTestid(container, 'event-edit-btn-name');
		expect(btn.textContent).toContain('Tuesday Rehearsal');
		const h1 = container.querySelector('[data-testid="event-detail-name"]')!;
		expect(h1.tagName, 'the event name must stay an <h1> for an editor too').toBe('H1');
		expect(h1.contains(btn), 'the name button must live inside the <h1>').toBe(true);
		expect(container.querySelectorAll('h1')).toHaveLength(1);
	});

	it('an EDITOR hears the event name alone as the heading — the sr-only edit label stays on the button', async () => {
		const { container } = renderEventPage(editorEvent());
		const btn = await waitForTestid(container, 'event-edit-btn-name');
		const h1 = container.querySelector('h1')!;
		expect(
			accessibleName(h1),
			'the edit label leaked into the h1 — an editor and a member now hear different headings'
		).toBe(EVENT_HEADING);
		expect(accessibleName(btn)).toBe(`[event_edit_name_aria_label] ${EVENT_HEADING}`);
	});

	it('a MEMBER hears exactly the same heading (the invariant the editor case is measured against)', async () => {
		const { container } = renderEventPage(eventEntity());
		await waitForTestid(container, 'event-detail-name');
		expect(container.querySelector('[data-testid="event-edit-btn-name"]')).toBeNull();
		expect(accessibleName(container.querySelector('h1')!)).toBe(EVENT_HEADING);
	});

	it('every whole-field button keeps a pointer hover cue on its glyph', async () => {
		const { container } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-description');
		for (const field of EDITABLE_FIELDS) {
			const btn = container.querySelector(`[data-testid="event-edit-btn-${field}"]`)!;
			expect(
				btn.classList.contains('group'),
				`event-edit-btn-${field} is not a hover group`
			).toBe(true);
			const glyph = [...btn.querySelectorAll('span')].find((el) =>
				(el.textContent ?? '').includes('✎')
			)!;
			expect(
				glyph.classList.contains('group-hover:text-ink'),
				`event-edit-btn-${field} glyph has no hover cue — the enlarged target is invisible to a mouse`
			).toBe(true);
		}
	});

	it('every edit button spans the field width and clears the 44px minimum touch size', async () => {
		const { container } = renderEventPage(
			editorEvent({
				location: [],
				description: [],
				duration_minutes: [],
				_parent: [
					{ reference: 'org1', entity_type: 'organization' },
					{ reference: 'season1', entity_type: 'season' }
				]
			})
		);
		await waitForTestid(container, 'event-edit-btn-description');
		expect(container.querySelector('[data-testid="event-detail-location"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-description"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-duration"]')).toBeNull();
		for (const field of EDITABLE_FIELDS) {
			const btn = container.querySelector(`[data-testid="event-edit-btn-${field}"]`)!;
			expect(btn.classList.contains('w-full'), `event-edit-btn-${field} is not full width`).toBe(
				true
			);
			expect(
				btn.classList.contains('min-h-11'),
				`event-edit-btn-${field} has no 44px minimum height`
			).toBe(true);
		}
	});

	it('an event with no parseable start still offers a full-size target, not a bare glyph', async () => {
		const { container } = renderEventPage(editorEvent({ start_datetime: [] }));
		const btn = await waitForTestid(container, 'event-edit-btn-start_datetime');
		expect(container.querySelector('[data-testid="event-detail-time"]')).toBeNull();
		expect(btn.classList.contains('w-full')).toBe(true);
		expect(btn.classList.contains('min-h-11')).toBe(true);
		expect(btn.querySelector('.sr-only')?.textContent).toBe('[event_edit_start_datetime_aria_label]');
		expect(btn.classList.contains('group'), 'the empty-start target is not a hover group').toBe(
			true
		);
		const glyph = [...btn.querySelectorAll('span')].find((el) =>
			(el.textContent ?? '').includes('✎')
		)!;
		expect(
			glyph.classList.contains('group-hover:text-ink'),
			'the empty-start glyph has no hover cue'
		).toBe(true);
	});
});

describe('#105 — a11y: focus management on inline editing (WAI-ARIA edit-in-place)', () => {
	it('activating a pencil moves focus INTO the input it becomes — otherwise focus drops to <body> and a keyboard user restarts from the top of the page', async () => {
		const { container } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-name');
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-name"]')!);
		const input = await waitForTestid(container, 'event-edit-input-name');
		await waitFor(() => {
			expect(input.ownerDocument.activeElement, 'the edit input did not receive focus').toBe(
				input
			);
		});
	});

	it('the textarea (description) receives focus too — multiline is not an exception', async () => {
		const { container } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-description');
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-description"]')!);
		const textarea = await waitForTestid(container, 'event-edit-input-description');
		await waitFor(() => {
			expect(textarea.ownerDocument.activeElement).toBe(textarea);
		});
	});

	it('Escape returns focus to the pencil button that opened the editor — an unmounted activeElement drops focus to <body>', async () => {
		const { container } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-location');
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-location"]')!);
		const input = await waitForTestid(container, 'event-edit-input-location');
		await fireEvent.keyDown(input, { key: 'Escape' });
		const pencil = await waitForTestid(container, 'event-edit-btn-location');
		await waitFor(() => {
			expect(
				pencil.ownerDocument.activeElement,
				'focus did not return to the pencil after Escape'
			).toBe(pencil);
		});
	});

	it('Enter commit (a real change) returns focus to the pencil — activeElement is never <body> — #105 review F1', async () => {
		const { container } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-location');
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-location"]')!);
		const input = await waitForTestid(container, 'event-edit-input-location');
		await fireEvent.input(input, { target: { value: 'New Hall' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-location"]')).toBeNull();
		});
		const pencil = await waitForTestid(container, 'event-edit-btn-location');
		await waitFor(() => {
			const active = pencil.ownerDocument.activeElement;
			expect(active, 'activeElement fell to <body> after an Enter commit').toBe(pencil);
			expect(active).not.toBe(pencil.ownerDocument.body);
		});
	});

	it('blur without change leaves focus wherever the user moved it — it is NOT dragged back to the pencil — #105 review F2', async () => {
		const { container } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-location');
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-location"]')!);
		const input = await waitForTestid(container, 'event-edit-input-location');
		const elsewhere = document.createElement('button');
		elsewhere.type = 'button';
		elsewhere.textContent = 'elsewhere';
		container.appendChild(elsewhere);
		elsewhere.focus();
		await fireEvent.blur(input);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-location"]')).toBeNull();
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(
			input.ownerDocument.activeElement,
			'a blur-without-change dragged focus back to the pencil'
		).toBe(elsewhere);
	});

	it('blur WITH a change leaves focus where the user moved it, even after the write settles — #105 review R2-F1', async () => {
		const { container, fetchStub } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-location');
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-location"]')!);
		const input = await waitForTestid(container, 'event-edit-input-location');
		await fireEvent.input(input, { target: { value: 'New Hall' } });
		const elsewhere = document.createElement('button');
		elsewhere.type = 'button';
		elsewhere.textContent = 'elsewhere';
		container.appendChild(elsewhere);
		elsewhere.focus();
		await fireEvent.blur(input);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-location"]')).toBeNull();
		});
		await waitFor(() => {
			expect(editPosts(fetchStub)).toHaveLength(1);
		});
		const pencil = await waitForTestid(container, 'event-edit-btn-location');
		await waitFor(() => {
			expect(pencil.hasAttribute('disabled'), 'write still in flight').toBe(false);
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(
			input.ownerDocument.activeElement,
			'a blur-with-change dragged focus back to the pencil after the write settled'
		).toBe(elsewhere);
	});
});

describe('#105 — a11y: inline edits stay keyboard-operable (guard on the TE.4 contract)', () => {
	it('Enter confirms a single-line edit: the editor closes and exactly one write POST is issued', async () => {
		const { container, fetchStub } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-name');
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-name"]')!);
		const input = await waitForTestid(container, 'event-edit-input-name');
		await fireEvent.input(input, { target: { value: 'Autumn Sing' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-name"]')).toBeNull();
		});
		await waitFor(() => {
			expect(editPosts(fetchStub)).toHaveLength(1);
		});
	});

	it('Escape cancels: the editor closes, the original value is restored, NOTHING is written', async () => {
		const { container, fetchStub } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-location');
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-location"]')!);
		const input = await waitForTestid(container, 'event-edit-input-location');
		await fireEvent.input(input, { target: { value: 'Should Never Land' } });
		await fireEvent.keyDown(input, { key: 'Escape' });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-location"]')).toBeNull();
		});
		const location = await waitForTestid(container, 'event-detail-location');
		expect(location.textContent).toContain('Rehearsal Hall');
		expect(editPosts(fetchStub)).toHaveLength(0);
	});
});

describe('#105 — a11y: RSVP tally', () => {
	it("the editor's tally is aria-live=polite — counts that change under an open page must be announced, not silently repainted", async () => {
		const { container } = renderEventPage(editorEvent());
		const tally = await waitForTestid(container, 'event-detail-tally');
		expect(tally.getAttribute('aria-live')).toBe('polite');
	});
});

// (*MVOX:Tallis* — #105 TE.5 RED)
