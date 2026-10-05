// The shared Tallinn DST-aware conversion helpers; each form's own spec checks what it posts.
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSourceFiles } from '$lib/testing/soleLiteralGuard';
import {
	tallinnLocalToUtcIso,
	tallinnOffsetMinutes,
	tallinnWallClockParts,
	toTallinnLocalInputValue
} from './timeFormat';

describe('#230 — tallinnOffsetMinutes (shared DST-aware offset reader)', () => {
	it('plain winter instant → 120 (EET), plain summer instant → 180 (EEST)', async () => {
		expect(tallinnOffsetMinutes(new Date('2026-01-15T12:00:00.000Z'))).toEqual(120);
		expect(tallinnOffsetMinutes(new Date('2026-07-15T12:00:00.000Z'))).toEqual(180);
	});

	it('spring-forward edge (2026-03-29, 01:00Z): 120 right before, 180 right after', async () => {
		expect(tallinnOffsetMinutes(new Date('2026-03-29T00:59:00.000Z'))).toEqual(120);
		expect(tallinnOffsetMinutes(new Date('2026-03-29T01:00:00.000Z'))).toEqual(180);
	});

	it('fall-back edge (2026-10-25, 01:00Z): 180 right before, 120 right after', async () => {
		expect(tallinnOffsetMinutes(new Date('2026-10-25T00:59:00.000Z'))).toEqual(180);
		expect(tallinnOffsetMinutes(new Date('2026-10-25T01:00:00.000Z'))).toEqual(120);
	});
});

describe('#230 — tallinnLocalToUtcIso (shared two-pass wall-clock → UTC instant)', () => {
	it('plain dates: winter converts at +120, summer at +180 — exact ISO shapes', async () => {
		expect(tallinnLocalToUtcIso('2026-01-15T12:00')).toEqual('2026-01-15T10:00:00.000Z');
		expect(tallinnLocalToUtcIso('2026-07-15T12:00')).toEqual('2026-07-15T09:00:00.000Z');
	});

	it('spring-forward day, EET side (01:30 on 29 Mar): the SECOND pass is what lands 23:30Z — one pass would write 22:30Z, an hour off', async () => {
		// The exact instant page.event-editing.spec.ts pins end-to-end.
		expect(tallinnLocalToUtcIso('2026-03-29T01:30')).toEqual('2026-03-28T23:30:00.000Z');
	});

	it('spring-forward day, EEST side (04:30 after the jump) → 01:30Z', async () => {
		expect(tallinnLocalToUtcIso('2026-03-29T04:30')).toEqual('2026-03-29T01:30:00.000Z');
	});

	it('spring-forward day, the NONEXISTENT 03:xx hour maps forward deterministically (03:30 → 01:30Z, i.e. wall 04:30 EEST) — pinned so the extraction cannot drift it', async () => {
		expect(tallinnLocalToUtcIso('2026-03-29T03:30')).toEqual('2026-03-29T01:30:00.000Z');
	});

	it('fall-back day, unambiguous EEST side (02:30 on 25 Oct) → 23:30Z the previous day', async () => {
		expect(tallinnLocalToUtcIso('2026-10-25T02:30')).toEqual('2026-10-24T23:30:00.000Z');
	});

	it('fall-back day, the AMBIGUOUS repeated 03:xx hour resolves to the EET (second) occurrence: 03:30 → 01:30Z', async () => {
		expect(tallinnLocalToUtcIso('2026-10-25T03:30')).toEqual('2026-10-25T01:30:00.000Z');
	});

	it('fall-back day, afternoon (12:00, already EET) → 10:00Z', async () => {
		expect(tallinnLocalToUtcIso('2026-10-25T12:00')).toEqual('2026-10-25T10:00:00.000Z');
	});

	it("date-only draft defaults the time to 00:00 (a half-filled composite is a reachable state): '2026-01-15' → 2026-01-14T22:00Z", async () => {
		expect(tallinnLocalToUtcIso('2026-01-15')).toEqual('2026-01-14T22:00:00.000Z');
	});

	it("TOTAL on purpose: '' for an empty or unparseable draft — never throws (the onblur handlers depend on this)", async () => {
		for (const junk of ['', 'garbage', 'T19:00', '15.01.2026T12:00']) {
			expect(tallinnLocalToUtcIso(junk), JSON.stringify(junk)).toEqual('');
		}
	});

	it('round-trips every valid Tallinn wall clock — full-shape, DST edges included', async () => {
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

	it('the input value is the parts joined by T, at Tallinn midnight and on both DST nights', () => {
		const instants = [
			'2026-06-14T21:00:00.000Z',
			'2026-01-14T22:00:00.000Z',
			'2026-03-29T00:30:00.000Z',
			'2026-03-29T01:30:00.000Z',
			'2026-10-25T00:30:00.000Z',
			'2026-10-25T01:30:00.000Z',
			'2026-12-31T22:00:00.000Z'
		];
		expect(instants.map(toTallinnLocalInputValue)).toEqual([
			'2026-06-15T00:00',
			'2026-01-15T00:00',
			'2026-03-29T02:30',
			'2026-03-29T04:30',
			'2026-10-25T03:30',
			'2026-10-25T03:30',
			'2027-01-01T00:00'
		]);
		expect(instants.map(toTallinnLocalInputValue)).toEqual(
			instants.map((iso) => {
				const p = tallinnWallClockParts(iso);
				return `${p.date}T${p.time}`;
			})
		);
	});
});

describe('#230 — one Tallinn conversion module', () => {
	const SRC_ROOT = resolve(__dirname, '../..'); // …/src

	// A loose-text pin on purpose: it is the executable form of "one zone constant" (#548).
	it('the quoted zone name is spelled only in timeFormat.ts (TALLINN_TZ)', () => {
		const spellers = findSourceFiles(SRC_ROOT, ['.ts', '.svelte'], {
			excludeSpecs: true,
			skipDirs: ['paraglide']
		})
			.filter((file) => /(['"`])Europe\/Tallinn\1/.test(readFileSync(file, 'utf8')))
			.map((file) => relative(SRC_ROOT, file));
		expect(spellers).toEqual(['lib/preferences/timeFormat.ts']);
	});

	it("no-hardcoded-render coherence: the shared module's moved offset converter keeps the isConverter fingerprint (second: '2-digit' + immediate .formatToParts)", () => {
		// The lint spec excludes data-layer converters by fingerprint — belt and braces.
		const content = readFileSync(resolve(SRC_ROOT, 'lib/preferences/timeFormat.ts'), 'utf8');
		const converterFingerprint =
			/Intl\.DateTimeFormat\([^)]*,\s*\{[^}]*second:\s*'2-digit'[^}]*\}\s*\)\.formatToParts\(/s;
		expect(converterFingerprint.test(content)).toBe(true);
	});
});

// (*MVOX:Tallis* — #230 RED: shared Tallinn conversion helpers)
