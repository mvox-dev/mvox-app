// #230 RED — the shared Tallinn DST-aware conversion helpers (R1 review item
// 32, epic #223). The two-pass wall-clock ↔ UTC conversion is duplicated
// near-verbatim between src/routes/+page.svelte (eventCreateTallinnOffsetMinutes
// + tallinnLocalToUtcIso) and src/routes/event/[id]/+page.svelte
// (tallinnOffsetMinutes + tallinnLocalToUtcIso) — byte-identical bodies modulo
// names (re-verified by diff in research-224-232.json). Both files ALREADY
// import $lib/preferences/timeFormat, so the shared home exists.
//
// CONTRACT (GREEN must implement — src/lib/preferences/timeFormat.ts):
//
//   export function tallinnOffsetMinutes(date: Date): number;
//     // Tallinn wall-clock offset (minutes) in effect AT `date`:
//     // 120 in EET (winter), 180 in EEST (summer), DST-aware.
//   export function tallinnLocalToUtcIso(local: string): string;
//     // 'YYYY-MM-DDTHH:MM' typed AS Tallinn wall clock → UTC ISO instant,
//     // TWO passes (the offset depends on the instant being converted).
//     // TOTAL: '' on an empty or unparseable draft — never throws.
//
// SCOPE (stated per the slice brief): AgendaList.svelte is deliberately OUT.
// Its TZ usage is structurally different — calendar-day GROUPING formatters
// guarded by a PRESERVED-VERBATIM comment citing the T5 DST edge cases — not
// the two-pass offset/local→UTC-ISO conversion this slice extracts. Only the
// two event surfaces above move onto the shared helpers.
//
// timeFormat.no-hardcoded-render.spec.ts coherence: that lint spec's
// `isConverter` fingerprint (options carrying `second: '2-digit'` OR an
// immediate `.formatToParts(` call) already excludes these offset converters
// wherever they live, and timeFormat.ts is on its ALLOWLIST anyway — the
// wiring block below pins that the moved converter keeps the fingerprint, so
// the exclusion stays coherent instead of silently widening.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The module exists but does not export these yet — a static named import
// would fail at LINK time (and pnpm check with it) with an opaque error, so
// the tests reach for the exports dynamically and fail with a legible
// "not a function" instead. GREEN makes this cast a truthful no-op.
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
		// This is the exact scenario the in-code doc-comment documents, and the
		// instant event/[id] page.event-editing.spec.ts pins end-to-end.
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
		// Independent reference: render the produced instant BACK to a Tallinn
		// 'YYYY-MM-DDTHH:MM' wall clock and require the original input.
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

describe('#230 — extraction wiring (integration: both event routes consume the SHARED helpers, duplicates deleted)', () => {
	const SRC_ROOT = resolve(__dirname, '../..'); // …/src
	const rootPage = () => readFileSync(resolve(SRC_ROOT, 'routes/+page.svelte'), 'utf8');
	const eventPage = () => readFileSync(resolve(SRC_ROOT, 'routes/event/[id]/+page.svelte'), 'utf8');

	it('src/routes/+page.svelte no longer declares its own copies (eventCreateTallinnOffsetMinutes / tallinnLocalToUtcIso)', () => {
		const content = rootPage();
		expect(/function\s+eventCreateTallinnOffsetMinutes\s*\(/.test(content)).toBe(false);
		expect(/function\s+tallinnLocalToUtcIso\s*\(/.test(content)).toBe(false);
	});

	it('src/routes/+page.svelte imports tallinnLocalToUtcIso from $lib/preferences/timeFormat and still calls it', () => {
		const content = rootPage();
		expect(
			/import\s*\{[^}]*\btallinnLocalToUtcIso\b[^}]*\}\s*from\s*'\$lib\/preferences\/timeFormat'/.test(
				content
			)
		).toBe(true);
		// The import must not be dead — the create flow still converts through it.
		expect(/[^.\w]tallinnLocalToUtcIso\(/.test(content.replace(/import[^;]*;/g, ''))).toBe(true);
	});

	it('src/routes/event/[id]/+page.svelte no longer declares its own copies (tallinnOffsetMinutes / tallinnLocalToUtcIso); toTallinnLocalInputValue STAYS local (out of slice)', () => {
		const content = eventPage();
		expect(/function\s+tallinnOffsetMinutes\s*\(/.test(content)).toBe(false);
		expect(/function\s+tallinnLocalToUtcIso\s*\(/.test(content)).toBe(false);
		// The ISO→input seeder is NOT part of the shared offset/local→UTC pair.
		expect(/function\s+toTallinnLocalInputValue\s*\(/.test(content)).toBe(true);
	});

	it('src/routes/event/[id]/+page.svelte imports tallinnLocalToUtcIso from $lib/preferences/timeFormat and still calls it', () => {
		const content = eventPage();
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
		// timeFormat.no-hardcoded-render.spec.ts excludes data-layer converters by
		// fingerprint; the moved helper must keep matching it so the lint spec's
		// exclusion stays the SAME shape after the move (allowlist membership of
		// timeFormat.ts is belt, this is braces).
		const content = readFileSync(resolve(SRC_ROOT, 'lib/preferences/timeFormat.ts'), 'utf8');
		const converterFingerprint =
			/Intl\.DateTimeFormat\([^)]*,\s*\{[^}]*second:\s*'2-digit'[^}]*\}\s*\)\.formatToParts\(/s;
		expect(converterFingerprint.test(content)).toBe(true);
	});
});

// (*MVOX:Tallis* — #230 RED: shared Tallinn DST-aware conversion helpers — offset + two-pass local→UTC-ISO, extraction wiring pinned)
