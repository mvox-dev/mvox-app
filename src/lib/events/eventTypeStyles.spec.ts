// #211 RED — ONE color scheme for event-type badges, in the mvox palette.
//
// PO ruling (Gama, 2026-09-02, on #211): translate polyphony's type colors
// into mvox paper/ink tones — never stock Tailwind hues. Six types get a
// distinct hue family (polyphony anchors: rehearsal=blue, concert=purple,
// retreat=green, festival=orange; plus two NEW distinct hues for workshop and
// meeting); social and other keep the quiet default (text-ink-2, border-ink-4).
// ONE scheme, defined once, consumed by the agenda recent badge, the agenda
// upcoming badge, the event-detail badge, and later #214's chips.
//
// CONTRACT under test (defined HERE, implemented in GREEN):
//
//   src/lib/events/eventTypeStyles.ts
//     export const EVENT_TYPE_BADGE_CLASS: Record<string, string>;
//       — exactly the 8 canonical keys (same set as EVENT_TYPE_LABEL)
//     export function eventTypeBadgeClass(type: string | undefined): string;
//       — per-type COLOR classes only (bg/text/border); the badge base classes
//         (w-fit rounded-full border px-1.5 py-0.5 font-mono text-[9px]
//         tracking-wide uppercase) stay shared in the markup, NOT here.
//
// The hued classes are built from NEW semantic @theme tokens named for the
// TYPE family (--color-type-rehearsal / --color-type-rehearsal-soft, …), not
// from raw hues: the schema key is the stable identity, the hex behind it is
// Mihkel's to adjust at the live gate. indigo and amber already carry
// roster/attendance meanings in this app — the type tokens must not reuse
// their values.
//
// DEVIATION from the task brief, on re-verified evidence: the brief asked to
// assert each token "including under the dark-mode block", but src/app.css has
// NO dark-mode block (no `dark:` variant, no prefers-color-scheme, no .dark —
// grepped 2026-09-02); the app is single-theme paper. Forcing a dark block for
// type tokens alone would dark-tint badges on a paper page. Gama's "check the
// whole set once in dark mode" reads as the live-gate visual check; the
// token-existence assertions here cover the one @theme block that exists.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVENT_TYPE_BADGE_CLASS, eventTypeBadgeClass } from './eventTypeStyles';
import { CANONICAL_EVENT_TYPES } from './eventTypeLabels';

// The quiet default — the badge's CURRENT color classes (AgendaList.svelte /
// event/[id]/+page.svelte), kept verbatim for social, other, unknown free
// text, and undefined.
const DEFAULT_CLASS = 'text-ink-2 border-ink-4';

const HUED_TYPES = ['rehearsal', 'concert', 'festival', 'retreat', 'workshop', 'meeting'] as const;

const APP_CSS = readFileSync(fileURLToPath(new URL('../../app.css', import.meta.url)), 'utf-8');

describe('eventTypeBadgeClass — exact per-type class strings (#211)', () => {
	// toEqual on the FULL string, never toContain — partial assertions hide
	// bugs, and #214's chips will re-consume these strings verbatim.
	it.each([
		['rehearsal', 'bg-type-rehearsal-soft text-type-rehearsal border-type-rehearsal'],
		['concert', 'bg-type-concert-soft text-type-concert border-type-concert'],
		['festival', 'bg-type-festival-soft text-type-festival border-type-festival'],
		['retreat', 'bg-type-retreat-soft text-type-retreat border-type-retreat'],
		['workshop', 'bg-type-workshop-soft text-type-workshop border-type-workshop'],
		['meeting', 'bg-type-meeting-soft text-type-meeting border-type-meeting'],
		['social', DEFAULT_CLASS],
		['other', DEFAULT_CLASS],
		// #266 — quiet-grey-first: trip and service join the vocabulary WITHOUT
		// a hue. They need EXPLICIT map entries (the map-coverage pin below
		// forces exactly the canonical key set; the runtime fallback alone
		// cannot satisfy it) — both mapping to the same quiet default.
		['trip', DEFAULT_CLASS],
		['service', DEFAULT_CLASS]
	])('%s → %s', (type, expected) => {
		expect(eventTypeBadgeClass(type)).toEqual(expected);
	});

	// #266 negative pin — the HUED set stays EXACTLY the #211 six. #211's
	// daylight-distinguishability bar (Mihkel's outdoor test) capped the hued
	// set; trip/service arrive quiet, promotion is a later, separate ruling.
	it('#266 — trip and service are NOT hued: quiet default, identical to social/other, never a type-* token class', () => {
		for (const type of ['trip', 'service']) {
			// EXPLICIT map entries, not the runtime fallback: the function
			// already returns the default for ANY unknown string, so hasOwn is
			// the assertion that actually proves the two joined the map (and the
			// map-coverage pin below keeps the key set exactly canonical).
			expect(
				Object.hasOwn(EVENT_TYPE_BADGE_CLASS, type),
				`${type} needs an explicit EVENT_TYPE_BADGE_CLASS entry`
			).toBe(true);
			expect(eventTypeBadgeClass(type)).toEqual(DEFAULT_CLASS);
			expect(eventTypeBadgeClass(type)).not.toMatch(/type-/);
		}
		// And they add nothing to the hued family: still six distinct hued
		// strings, none of which the newcomers share.
		const hued = new Set(HUED_TYPES.map((t) => eventTypeBadgeClass(t)));
		expect(hued.size).toBe(6);
		expect(hued.has(eventTypeBadgeClass('trip'))).toBe(false);
		expect(hued.has(eventTypeBadgeClass('service'))).toBe(false);
	});

	it('the six hued types produce six MUTUALLY DISTINCT class strings', () => {
		const strings = HUED_TYPES.map((t) => eventTypeBadgeClass(t));
		expect(new Set(strings).size).toBe(6);
	});

	it('social === other === the quiet default (identical string, not merely similar)', () => {
		expect(eventTypeBadgeClass('social')).toEqual(eventTypeBadgeClass('other'));
		expect(eventTypeBadgeClass('social')).toEqual(DEFAULT_CLASS);
	});

	it("unknown free text ('proov') and undefined fall back to the quiet default", () => {
		expect(eventTypeBadgeClass('proov')).toEqual(DEFAULT_CLASS);
		expect(eventTypeBadgeClass(undefined)).toEqual(DEFAULT_CLASS);
	});

	// Same lesson as eventTypeLabels review F4: `event_type` is FREE TEXT on
	// the wire, so Object.prototype member names are reachable values. A bare
	// map lookup would hand 'toString' a function, not a class string.
	it("prototype member names ('toString', 'constructor') get the default, not a prototype hit", () => {
		expect(eventTypeBadgeClass('toString')).toEqual(DEFAULT_CLASS);
		expect(eventTypeBadgeClass('constructor')).toEqual(DEFAULT_CLASS);
	});

	it('the underlying map covers exactly the canonical types (10 since #266) — no extras, no free-text keys', () => {
		expect(Object.keys(EVENT_TYPE_BADGE_CLASS).sort()).toEqual([...CANONICAL_EVENT_TYPES].sort());
	});

	it('no scheme string smuggles in a base/shape class — color only (bg-/text-/border- utilities)', () => {
		for (const type of CANONICAL_EVENT_TYPES) {
			for (const cls of eventTypeBadgeClass(type).split(/\s+/)) {
				expect(cls, `'${type}' class '${cls}'`).toMatch(/^(bg|text|border)-[a-z0-9-]+$/);
			}
		}
	});
});

describe('type tokens exist in src/app.css @theme (#211 adds them)', () => {
	// Derive the required tokens from the scheme's OWN class strings, so this
	// assertion can never drift from the map: bg-type-rehearsal-soft needs
	// --color-type-rehearsal-soft, text-type-rehearsal needs
	// --color-type-rehearsal, and so on.
	it('every token a hued class string references is DEFINED as a --color-* custom property', () => {
		const referenced = new Set<string>();
		for (const type of HUED_TYPES) {
			for (const cls of eventTypeBadgeClass(type).split(/\s+/)) {
				const token = cls.replace(/^(bg|text|border)-/, '');
				expect(token, `'${type}' class '${cls}' must reference a type-* token`).toMatch(
					/^type-[a-z]+(-soft)?$/
				);
				referenced.add(token);
			}
		}
		// 6 hued families × (base + soft) = 12 distinct tokens.
		expect(referenced.size).toBe(12);
		for (const token of referenced) {
			expect(APP_CSS, `--color-${token} missing from src/app.css`).toMatch(
				new RegExp(`--color-${token}\\s*:`)
			);
		}
	});

	it('the six base tokens carry six DISTINCT color values — and the six softs too', () => {
		const value = (token: string): string => {
			const match = APP_CSS.match(new RegExp(`--color-${token}\\s*:\\s*([^;]+);`));
			expect(match, `--color-${token} missing from src/app.css`).not.toBeNull();
			return match![1].trim();
		};
		const bases = HUED_TYPES.map((t) => value(`type-${t}`));
		const softs = HUED_TYPES.map((t) => value(`type-${t}-soft`));
		expect(new Set(bases).size).toBe(6);
		expect(new Set(softs).size).toBe(6);
		// indigo and amber already mean roster/attendance in this app — the type
		// scheme must not reuse their values (Gama: distinct new hues).
		// --color-amber-soft was removed as an unused theme token (#227) — the
		// guard now covers the tokens that still exist.
		const reserved = [value('indigo'), value('amber'), value('indigo-soft')];
		for (const v of [...bases, ...softs]) {
			expect(reserved, `type token value ${v} reuses a roster/attendance hue`).not.toContain(v);
		}
	});
});

// (*MVOX:Tallis* — #211 RED)
