// #230 RED — the shared Tallinn DST-aware conversion helpers (epic #223): the
// two-pass wall-clock <-> UTC conversion was duplicated near-verbatim between
// the two event-create surfaces; this module is their shared home.

// CONTRACT (src/lib/preferences/timeFormat.ts): tallinnOffsetMinutes(date) —
// the DST-aware Tallinn offset in minutes at that instant; tallinnLocalToUtcIso
// (local) — 'YYYY-MM-DDTHH:MM' Tallinn wall clock -> UTC ISO, '' if unparseable.

// SCOPE: AgendaList.svelte is deliberately OUT (its calendar-day GROUPING
// formatters are a different, PRESERVED-VERBATIM shape). timeFormat.ts stays
// on the no-hardcoded-render allowlist and keeps the isConverter fingerprint.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { surfacesUnder } from '$lib/testing/svelteSurfaces';
import { tallinnWallClockParts, toTallinnLocalInputValue } from './timeFormat';

// A static named import of not-yet-exported members would fail at LINK time
// with an opaque error, so the tests reach for the exports dynamically.
type TallinnConversionExports = {
	tallinnOffsetMinutes: (date: Date) => number;
	tallinnLocalToUtcIso: (local: string) => string;
};

async function conversionExports(): Promise<TallinnConversionExports> {
	return (await import('./timeFormat')) as unknown as TallinnConversionExports;
}

describe('#230 — tallinnOffsetMinutes (shared DST-aware offset reader)', () => {
	it('plain winter instant → 120 (EET), plain summer instant → 180 (EEST)', async () => {
		const { tallinnOffsetMinutes } = await conversionExports();
		expect(tallinnOffsetMinutes(new Date('2026-01-15T12:00:00.000Z'))).toEqual(120);
		expect(tallinnOffsetMinutes(new Date('2026-07-15T12:00:00.000Z'))).toEqual(180);
	});

	it('spring-forward edge (2026-03-29, 01:00Z): 120 right before, 180 right after', async () => {
		const { tallinnOffsetMinutes } = await conversionExports();
		expect(tallinnOffsetMinutes(new Date('2026-03-29T00:59:00.000Z'))).toEqual(120);
		expect(tallinnOffsetMinutes(new Date('2026-03-29T01:00:00.000Z'))).toEqual(180);
	});

	it('fall-back edge (2026-10-25, 01:00Z): 180 right before, 120 right after', async () => {
		const { tallinnOffsetMinutes } = await conversionExports();
		expect(tallinnOffsetMinutes(new Date('2026-10-25T00:59:00.000Z'))).toEqual(180);
		expect(tallinnOffsetMinutes(new Date('2026-10-25T01:00:00.000Z'))).toEqual(120);
	});
});

describe('#230 — tallinnLocalToUtcIso (shared two-pass wall-clock → UTC instant)', () => {
	it('plain dates: winter converts at +120, summer at +180 — exact ISO shapes', async () => {
		const { tallinnLocalToUtcIso } = await conversionExports();
		expect(tallinnLocalToUtcIso('2026-01-15T12:00')).toEqual('2026-01-15T10:00:00.000Z');
		expect(tallinnLocalToUtcIso('2026-07-15T12:00')).toEqual('2026-07-15T09:00:00.000Z');
	});

	it('spring-forward day, EET side (01:30 on 29 Mar): the SECOND pass is what lands 23:30Z — one pass would write 22:30Z, an hour off', async () => {
		const { tallinnLocalToUtcIso } = await conversionExports();
		// The exact instant page.event-editing.spec.ts pins end-to-end.
		expect(tallinnLocalToUtcIso('2026-03-29T01:30')).toEqual('2026-03-28T23:30:00.000Z');
	});

	it('spring-forward day, EEST side (04:30 after the jump) → 01:30Z', async () => {
		const { tallinnLocalToUtcIso } = await conversionExports();
		expect(tallinnLocalToUtcIso('2026-03-29T04:30')).toEqual('2026-03-29T01:30:00.000Z');
	});

	it('spring-forward day, the NONEXISTENT 03:xx hour maps forward deterministically (03:30 → 01:30Z, i.e. wall 04:30 EEST) — pinned so the extraction cannot drift it', async () => {
		const { tallinnLocalToUtcIso } = await conversionExports();
		expect(tallinnLocalToUtcIso('2026-03-29T03:30')).toEqual('2026-03-29T01:30:00.000Z');
	});

	it('fall-back day, unambiguous EEST side (02:30 on 25 Oct) → 23:30Z the previous day', async () => {
		const { tallinnLocalToUtcIso } = await conversionExports();
		expect(tallinnLocalToUtcIso('2026-10-25T02:30')).toEqual('2026-10-24T23:30:00.000Z');
	});

	it('fall-back day, the AMBIGUOUS repeated 03:xx hour resolves to the EET (second) occurrence: 03:30 → 01:30Z', async () => {
		const { tallinnLocalToUtcIso } = await conversionExports();
		expect(tallinnLocalToUtcIso('2026-10-25T03:30')).toEqual('2026-10-25T01:30:00.000Z');
	});

	it('fall-back day, afternoon (12:00, already EET) → 10:00Z', async () => {
		const { tallinnLocalToUtcIso } = await conversionExports();
		expect(tallinnLocalToUtcIso('2026-10-25T12:00')).toEqual('2026-10-25T10:00:00.000Z');
	});

	it("date-only draft defaults the time to 00:00 (a half-filled composite is a reachable state): '2026-01-15' → 2026-01-14T22:00Z", async () => {
		const { tallinnLocalToUtcIso } = await conversionExports();
		expect(tallinnLocalToUtcIso('2026-01-15')).toEqual('2026-01-14T22:00:00.000Z');
	});

	it("TOTAL on purpose: '' for an empty or unparseable draft — never throws (the onblur handlers depend on this)", async () => {
		const { tallinnLocalToUtcIso } = await conversionExports();
		for (const junk of ['', 'garbage', 'T19:00', '15.01.2026T12:00']) {
			expect(tallinnLocalToUtcIso(junk), JSON.stringify(junk)).toEqual('');
		}
	});

	it('round-trips every valid Tallinn wall clock — full-shape, DST edges included', async () => {
		const { tallinnLocalToUtcIso } = await conversionExports();
		// Independent reference: render the instant back to a wall clock, require the original.
		const backFmt = new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Europe/Tallinn',
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
		const toLocal = (iso: string): string => {
			const parts = backFmt.formatToParts(new Date(iso));
			const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
			return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
		};
		const locals = [
			'2026-01-15T12:00', // plain EET
			'2026-07-15T12:00', // plain EEST
			'2026-03-29T01:30', // spring-forward day, EET side
			'2026-03-29T04:30', // spring-forward day, EEST side
			'2026-10-25T02:30', // fall-back day, EEST side
			'2026-10-25T12:00', // fall-back day, EET side
			'2026-06-15T00:30', // just past a summer midnight
			'2026-12-31T23:59' // year boundary
		];
		expect(locals.map((local) => ({ local, roundTrip: toLocal(tallinnLocalToUtcIso(local)) }))).toEqual(
			locals.map((local) => ({ local, roundTrip: local }))
		);
	});
});

describe('toTallinnLocalInputValue and tallinnWallClockParts (Tallinn wall clock of a UTC instant)', () => {
	it('summer and winter instants seed the Tallinn wall clock as YYYY-MM-DDTHH:mm', () => {
		expect(toTallinnLocalInputValue('2026-09-01T16:00:00.000Z')).toBe('2026-09-01T19:00');
		expect(toTallinnLocalInputValue('2026-01-15T23:30:00.000Z')).toBe('2026-01-16T01:30');
	});

	it('an empty or unparseable instant seeds nothing', () => {
		expect(toTallinnLocalInputValue('')).toBe('');
		expect(toTallinnLocalInputValue('not a date')).toBe('');
	});

	it('splits the same wall clock into date and time parts', () => {
		expect(tallinnWallClockParts('2026-09-01T16:00:00.000Z')).toEqual({ date: '2026-09-01', time: '19:00' });
		expect(tallinnWallClockParts('2026-01-15T23:30:00.000Z')).toEqual({ date: '2026-01-16', time: '01:30' });
		expect(tallinnWallClockParts('')).toEqual({ date: '', time: '' });
	});
});

describe('#230 — extraction wiring (integration: both event routes consume the SHARED helpers, duplicates deleted)', () => {
	const SRC_ROOT = resolve(__dirname, '../..'); // …/src
	const rootPage = () => readFileSync(resolve(SRC_ROOT, 'routes/+page.svelte'), 'utf8');
	const EVENT_SURFACES = surfacesUnder('src/routes/event/', 'src/lib/events/');
	it('the derived EVENT_SURFACES list is not empty (a moved folder would scan nothing)', () => {
		expect(EVENT_SURFACES.length).toBeGreaterThanOrEqual(8);
	});
	const eventSurfaces = () =>
		EVENT_SURFACES.map((file) => readFileSync(resolve(SRC_ROOT, '..', file), 'utf8')).join('\n');
	const timeFormatSource = () => readFileSync(resolve(SRC_ROOT, 'lib/preferences/timeFormat.ts'), 'utf8');
	const TALLINN_TO_UTC_CALLERS = [
		'src/lib/events/EventConvertForm.svelte',
		'src/lib/events/EventScheduleSection.svelte',
		'src/lib/events/EventFieldEdit.svelte'
	];

	it('src/routes/+page.svelte no longer declares its own copies (eventCreateTallinnOffsetMinutes / tallinnLocalToUtcIso)', () => {
		const content = rootPage();
		expect(/function\s+eventCreateTallinnOffsetMinutes\s*\(/.test(content)).toBe(false);
		expect(/function\s+tallinnLocalToUtcIso\s*\(/.test(content)).toBe(false);
	});

	// #508 moved the event-create form (and its tallinnLocalToUtcIso call) out
	// of +page.svelte into EventCreateForm.svelte — the wiring pin followed it.
	it('EventCreateForm.svelte imports tallinnLocalToUtcIso from $lib/preferences/timeFormat and still calls it', () => {
		const content = readFileSync(
			resolve(SRC_ROOT, 'lib/components/agenda/EventCreateForm.svelte'),
			'utf8'
		);
		expect(
			/import\s*\{[^}]*\btallinnLocalToUtcIso\b[^}]*\}\s*from\s*'\$lib\/preferences\/timeFormat'/.test(
				content
			)
		).toBe(true);
		// The import must not be dead — the create flow still converts through it.
		expect(/[^.\w]tallinnLocalToUtcIso\(/.test(content.replace(/import[^;]*;/g, ''))).toBe(true);
	});

	it('no event surface declares its own copies (tallinnOffsetMinutes / tallinnLocalToUtcIso); toTallinnLocalInputValue is declared in timeFormat.ts', () => {
		const content = eventSurfaces();
		expect(/function\s+tallinnOffsetMinutes\s*\(/.test(content)).toBe(false);
		expect(/function\s+tallinnLocalToUtcIso\s*\(/.test(content)).toBe(false);
		// The ISO→input seeder is NOT part of the shared offset/local→UTC pair.
		expect(/function\s+toTallinnLocalInputValue\s*\(/.test(timeFormatSource())).toBe(true);
	});

	it.each(TALLINN_TO_UTC_CALLERS)('%s imports tallinnLocalToUtcIso from $lib/preferences/timeFormat and still calls it', (file) => {
		const content = readFileSync(resolve(SRC_ROOT, '..', file), 'utf8');
		expect(
			/import\s*\{[^}]*\btallinnLocalToUtcIso\b[^}]*\}\s*from\s*'\$lib\/preferences\/timeFormat'/.test(
				content
			)
		).toBe(true);
		expect(/[^.\w]tallinnLocalToUtcIso\(/.test(content.replace(/import[^;]*;/g, ''))).toBe(true);
	});

	it('AgendaList.svelte is untouched by this slice: its PRESERVED-VERBATIM calendar-day formatters and local TZ constant stay', () => {
		const content = readFileSync(
			resolve(SRC_ROOT, 'lib/components/agenda/AgendaList.svelte'),
			'utf8'
		);
		expect(/const\s+TZ\s*=\s*'Europe\/Tallinn'/.test(content)).toBe(true);
		expect(content.includes('PRESERVED VERBATIM')).toBe(true);
	});

	it("no-hardcoded-render coherence: the shared module's moved offset converter keeps the isConverter fingerprint (second: '2-digit' + immediate .formatToParts)", () => {
		// The lint spec excludes data-layer converters by fingerprint — belt and braces.
		const content = readFileSync(resolve(SRC_ROOT, 'lib/preferences/timeFormat.ts'), 'utf8');
		const converterFingerprint =
			/Intl\.DateTimeFormat\([^)]*,\s*\{[^}]*second:\s*'2-digit'[^}]*\}\s*\)\.formatToParts\(/s;
		expect(converterFingerprint.test(content)).toBe(true);
	});
});

// (*MVOX:Tallis* — #230 RED: shared Tallinn conversion helpers, wiring pinned)
