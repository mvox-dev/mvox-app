// @vitest-environment happy-dom
//
// #105 TE.5 (RED) — i18n + a11y pass over the event detail page. Parent: #81
// (Event detail 1.0). Follows the #86/#93 precedent (page.attendance-a11y /
// page.repertoire-a11y): source-scan tests for i18n hygiene + rendered-DOM
// tests for landmark/heading/keyboard semantics, ALL run against the real
// route (+page.svelte with the real data layer; only the wire is stubbed) —
// never against a lookalike.
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   messages/*.json (all four locales — en, et, lv, uk):
//     • event_edit_name_aria_label becomes "Edit event name" in en (and a
//       matching disambiguation in et/lv/uk): out of page context "Edit name"
//       could name the PROFILE name — the label must name the object edited.
//       (#105: edit buttons labelled 'Edit event name', 'Edit location', …)
//     • NEW key event_detail_rsvp_heading (en: e.g. "Your answer" / "RSVP")
//       in all four locales — the RSVP region gets a real heading (below).
//
//   src/routes/event/[id]/+page.svelte:
//     • the three content regions — event-detail-rsvp, event-detail-works,
//       event-detail-attendance — become <section> elements (today: bare
//       <div>s), each with an <h2> heading rendered from its paraglide key
//       (works/attendance already have the h2; rsvp gains one from the new
//       event_detail_rsvp_heading key). A screen-reader user navigating by
//       region/heading currently finds ONE h1 and floats free between it and
//       the works heading — the RSVP control is anonymous.
//     • heading hierarchy stays h1 → h2 (no skips) — pinned so the new
//       heading cannot land as an h3/h4.
//     • FOCUS MANAGEMENT on inline editing (WAI-ARIA edit-in-place):
//         – activating a pencil moves focus INTO the edit input it becomes
//           (today focus stays on the unmounted button → drops to <body>,
//           and a keyboard user must Tab back from the top of the page);
//         – Escape (cancel) returns focus to the pencil button that opened
//           the editor, for the same reason in reverse.
//     • everything else asserted here is a GUARD pinning what TE.1–TE.4
//       already built (back link, aria-labels from m.*, aria-live tally,
//       keyboard confirm/cancel, decorative glyphs aria-hidden) so this
//       pass cannot regress it.
//
// Assertions match on DATA and message KEYS (full-fallback paraglide proxy
// renders `[key]`), never on translated sentences — same posture as
// page.spec.ts. Locale copy is asserted only via messages/*.json directly.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Pin "now" between the past fixture (2026-08-01) and the future one
// (2026-09-01) — same hygiene as page.spec.ts. Only Date is faked; timers
// stay real so waitFor polls normally.
const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

// Full-fallback paraglide mock — every key renders `[key]` / `[key {params}]`,
// so assertions can pin WHICH key a surface renders without knowing its copy.
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

// ── source + locale helpers ───────────────────────────────────────────────────

const PAGE_SOURCE_PATH = 'src/routes/event/[id]/+page.svelte';
const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

function readSource(relPath: string): string {
	return readFileSync(resolve(process.cwd(), relPath), 'utf-8');
}

function readMessages(locale: string): Record<string, string> {
	return JSON.parse(readSource(`messages/${locale}.json`)) as Record<string, string>;
}

/** Same scan as page.attendance-a11y.spec.ts: strip Svelte expressions + HTML
 *  comments from the template; any remaining bare text node with letters in it
 *  is a hardcoded user-facing string. */
function bareTextNodes(source: string): string[] {
	const templateMatch = source.match(/<\/script>\s*([\s\S]*)$/);
	let template = templateMatch ? templateMatch[1] : source;
	template = template.replace(/<!--[\s\S]*?-->/g, '');
	let prev = '';
	while (prev !== template) {
		prev = template;
		template = template.replace(/\{[^{}]*\}/g, '');
	}
	const nodes: string[] = [];
	const textNodePattern = />([^<]+)</g;
	let match: RegExpExecArray | null;
	while ((match = textNodePattern.exec(template)) !== null) {
		const text = match[1].trim();
		if (!text) continue;
		if (/^(&[a-zA-Z]+;|&#\d+;)+$/.test(text)) continue;
		if (!/[a-zA-Z]/.test(text)) continue;
		nodes.push(text);
	}
	return nodes;
}

// ── Entu fixtures — same event as page.spec.ts / page.event-editing.spec.ts ──
// 2026-09-01T16:00Z = 19:00 Europe/Tallinn (EEST, UTC+3); value `_id`s present
// so the edit choreography's DELETE leg has ids to target.

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

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

/** The rights-holder's view: the viewer IS in the event's `_editor` list —
 *  pencils, tally and the works section all render. */
function editorEvent(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({ _editor: [{ reference: 'p-viewer' }], ...over });
}

/** A PAST event where the viewer holds the conductor seat — the attendance
 *  section's admit condition (isPast && conductor). */
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

/** The liberal wire stub page.spec.ts uses (serves the fixtures whether the
 *  impl reads by id or by query) plus a permissive write path, so the
 *  keyboard-confirm test's POST/DELETE choreography succeeds. */
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

function setAuthedWithPolyphony() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'p-viewer' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p-viewer' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function renderEventPage(event: Record<string, unknown> = eventEntity()) {
	const fetchStub = entuStub(event);
	vi.stubGlobal('fetch', fetchStub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithPolyphony();
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

/**
 * Enough of the accessible-name computation to pin what a screen reader
 * ANNOUNCES, which `textContent` cannot: `aria-labelledby` wins outright,
 * then `aria-label`, then name-from-contents — and name-from-contents skips
 * `aria-hidden` subtrees while recursing into each descendant element's OWN
 * name. That recursion is the whole point here: it is how the edit button's
 * sr-only label climbs into the <h1> that wraps it (#157 review round 2, F1),
 * a leak every containment/`textContent` assertion below sails straight past.
 */
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

/** The one heading string an editor and a member must BOTH hear. */
const EVENT_HEADING = 'Tuesday Rehearsal';

/** Every write POST the page issued against the event entity. */
function editPosts(fetchStub: ReturnType<typeof vi.fn>) {
	return fetchStub.mock.calls.filter(
		(c) =>
			((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST' &&
			String(c[0]).includes('/entity/ev1')
	);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 — i18n: source hygiene (guards — TE.1–TE.4 already route all copy
//     through paraglide; this pass must not regress it)
// ═════════════════════════════════════════════════════════════════════════════

describe('#105 — i18n: the event detail page renders via Paraglide keys only', () => {
	it('contains no bare text nodes outside m.* calls', () => {
		expect(bareTextNodes(readSource(PAGE_SOURCE_PATH))).toEqual([]);
	});

	it('has no hardcoded aria-label string literals (labels must come from m.*)', () => {
		const hardcoded = readSource(PAGE_SOURCE_PATH).match(/aria-label="[^"]*[a-zA-Z][^"]*"/g) ?? [];
		expect(hardcoded).toEqual([]);
	});

	it('every m.* key the page references exists in en.json (a key that renders its own name is a missing translation)', () => {
		const source = readSource(PAGE_SOURCE_PATH);
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

// ═════════════════════════════════════════════════════════════════════════════
// 2 — i18n: the TE.5 copy contract (RED — labels disambiguated, the RSVP
//     region named)
// ═════════════════════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════════════════════
// 3 — a11y: landmarks + heading structure (rendered on the real route)
// ═════════════════════════════════════════════════════════════════════════════

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

	// #113 review F2 — the attendance entry point unmounts while its panel is
	// open and the panel's Close button unmounts itself, so BOTH transitions
	// have to place focus (WCAG 2.4.3). The agenda route got the pair; this
	// route renders the SAME AttendanceSurface behind the SAME gate and had only
	// the open half (the component's own onMount), stranding focus on <body> on
	// the way back out.
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

// ═════════════════════════════════════════════════════════════════════════════
// 4 — a11y: the back link (guard)
// ═════════════════════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════════════════════
// 5 — a11y: inline editing — labels, keyboard, focus management
// ═════════════════════════════════════════════════════════════════════════════

describe('#105 — a11y: edit pencils and inputs are labelled per field', () => {
	it('every pencil is a <button type="button"> whose label rides as an sr-only CHILD (never aria-label — #157), with an aria-hidden glyph', async () => {
		// #157 review F1 — the button now WRAPS the field value, so its accessible
		// name must compose "Edit location, Rehearsal Hall". `aria-label` overrides
		// name-from-contents outright, which would announce the label alone and
		// leave the value unspoken; the label therefore lives in an sr-only span
		// inside the button, the same shape the roster's sr-only regions use.
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
			// Escape out so the next field's pencil is back on screen. #207 review
			// F3 — start_datetime is a composite whose surface testid sits on a
			// role="group" wrapper; a non-interactive role must not own key
			// listeners, so the Escape gesture lives on the real controls inside
			// and the key event originates there, exactly as it does in a browser.
			const keyTarget =
				container.querySelector(`[data-testid="event-edit-input-${field}-date"]`) ?? input;
			await fireEvent.keyDown(keyTarget, { key: 'Escape' });
			await waitFor(() => {
				expect(container.querySelector(`[data-testid="event-edit-input-${field}"]`)).toBeNull();
			});
		}
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 5b — #157: the whole field is the tap target
//
// The regression these pin: before #157 the tap target was the bare pencil
// glyph — a ~12px box next to the value. The fix makes the value part of the
// button, which is invisible to every existing assertion here (they all query
// the value by data-testid and do not care what wraps it), so without these a
// refactor could silently put the pencil back on its own.
// ═════════════════════════════════════════════════════════════════════════════

describe('#157 — the edit tap target is the whole field, not the pencil glyph', () => {
	// name is excluded: its value node is the <h1>, which WRAPS the button
	// rather than sitting inside it (a heading is not phrasing content and
	// role=button would strip its heading role) — asserted separately below.
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
		// …and it is still the ONLY h1 — an editor and a member get the same
		// heading tree (a <button>-swallowed heading would leave the editor none).
		expect(container.querySelectorAll('h1')).toHaveLength(1);
	});

	// The pair below closes the gap the two assertions above leave open: they
	// pin the heading's SHAPE (tag, containment, count) but never what it SAYS,
	// so the sr-only edit label could — and did — ride up into the h1 through
	// name-from-contents while every one of them stayed green.
	it('an EDITOR hears the event name alone as the heading — the sr-only edit label stays on the button', async () => {
		const { container } = renderEventPage(editorEvent());
		const btn = await waitForTestid(container, 'event-edit-btn-name');
		const h1 = container.querySelector('h1')!;
		expect(
			accessibleName(h1),
			'the edit label leaked into the h1 — an editor and a member now hear different headings'
		).toBe(EVENT_HEADING);
		// …while the button it wraps still composes label + value, which is the
		// #157 shape and must NOT be sacrificed to clean the heading up.
		expect(accessibleName(btn)).toBe(`[event_edit_name_aria_label] ${EVENT_HEADING}`);
	});

	it('a MEMBER hears exactly the same heading (the invariant the editor case is measured against)', async () => {
		const { container } = renderEventPage(eventEntity());
		await waitForTestid(container, 'event-detail-name');
		expect(container.querySelector('[data-testid="event-edit-btn-name"]')).toBeNull();
		expect(accessibleName(container.querySelector('h1')!)).toBe(EVENT_HEADING);
	});

	it('every whole-field button keeps a pointer hover cue on its glyph', async () => {
		// The pre-#157 pencil buttons each carried `hover:text-ink`. Growing the
		// target to the whole field is a mobile win, but dropping that rule would
		// make the field LESS discoverable with a mouse than the glyph it replaced
		// — Tailwind's preflight sets no `cursor: pointer` on <button>, so the
		// glyph darkening is the only cue left that the region is clickable.
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
		// `min-h-11` = 44px, the same floor the agenda/season controls already use
		// (#101). Empty optional fields (no location/description, duration 0) render
		// nothing but the glyph, so without an explicit minimum they would keep the
		// pre-#157 target size exactly where it hurt most.
		const { container } = renderEventPage(
			editorEvent({
				location: [],
				description: [],
				duration_minutes: [],
				// No series parent either — otherwise the series defaults fill all
				// three back in and this stops being the empty case.
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
		// …and the same hover cue as the four populated fields: this branch used
		// to carry a button-level `hover:text-ink` while they had none, so the
		// header's hover treatment disagreed with itself inside one file.
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

	// #105 review F1 — the write path (Enter, or blur WITH a real change) used
	// to clear `editingField` and stop there: the input unmounts, and with no
	// restore, `activeElement` falls all the way to `<body>` — a keyboard user
	// who just committed a change loses her place on the page.
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

	// #105 review F2 — confirmFieldEdit's NO-CHANGE path degrades to
	// cancelFieldEdit, which (post-F1) restores focus to the pencil. That is
	// right for a KEYBOARD dismissal, but a BLUR means the viewer already moved
	// focus somewhere else ON PURPOSE (tabbed to the next field, clicked
	// another control) — yanking it back to the pencil fights that choice.
	it('blur without change leaves focus wherever the user moved it — it is NOT dragged back to the pencil — #105 review F2', async () => {
		const { container } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-location');
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-location"]')!);
		const input = await waitForTestid(container, 'event-edit-input-location');
		// No `fireEvent.input` — the draft is left exactly as seeded, so this is
		// a genuine no-change confirm, the one path blur can reach without an
		// intervening write.
		const elsewhere = document.createElement('button');
		elsewhere.type = 'button';
		elsewhere.textContent = 'elsewhere';
		container.appendChild(elsewhere);
		elsewhere.focus();
		await fireEvent.blur(input);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-location"]')).toBeNull();
		});
		// Give any (wrongly) scheduled restore-focus microtask a chance to land
		// before asserting it did not.
		await Promise.resolve();
		await Promise.resolve();
		expect(
			input.ownerDocument.activeElement,
			'a blur-without-change dragged focus back to the pencil'
		).toBe(elsewhere);
	});

	// #105 review R2-F1 — the same rule on the OTHER branch. A blur that carries a
	// real change takes the WRITE path, which used to restore focus from the
	// queue's settle callbacks unconditionally: the viewer clicks another
	// control on the page (an RSVP button, the back link), the write lands a
	// round-trip later, and focus jumps to the pencil out from under her. The
	// `editingField === null` guard does not catch this — the control she moved
	// to is not an edit field, so no editor is open.
	it('blur WITH a change leaves focus where the user moved it, even after the write settles — #105 review R2-F1', async () => {
		const { container, fetchStub } = renderEventPage(editorEvent());
		await waitForTestid(container, 'event-edit-btn-location');
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-location"]')!);
		const input = await waitForTestid(container, 'event-edit-input-location');
		// A REAL change — this confirm takes the write branch, unlike the F2 case.
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
		// Wait for the write to actually SETTLE — the restore, if any, is issued
		// from the queue's reconcile, which only runs once the POST resolves.
		await waitFor(() => {
			expect(editPosts(fetchStub)).toHaveLength(1);
		});
		const pencil = await waitForTestid(container, 'event-edit-btn-location');
		await waitFor(() => {
			expect(pencil.hasAttribute('disabled'), 'write still in flight').toBe(false);
		});
		// Let any (wrongly) scheduled restore-focus microtask land before
		// asserting it did not.
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

// ═════════════════════════════════════════════════════════════════════════════
// 6 — a11y: the RSVP tally announces itself (guard)
// ═════════════════════════════════════════════════════════════════════════════

describe('#105 — a11y: RSVP tally', () => {
	it("the editor's tally is aria-live=polite — counts that change under an open page must be announced, not silently repainted", async () => {
		const { container } = renderEventPage(editorEvent());
		const tally = await waitForTestid(container, 'event-detail-tally');
		expect(tally.getAttribute('aria-live')).toBe('polite');
	});
});

// (*MVOX:Tallis* — #105 TE.5 RED)
