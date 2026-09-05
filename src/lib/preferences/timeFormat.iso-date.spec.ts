// #231 — R1 review item 34: the ISO date-only formatter
//   Intl.DateTimeFormat('en-CA', { year:'numeric', month:'2-digit', day:'2-digit', timeZone? })
// is rebuilt at SEVEN production sites (re-grepped at RED time — the epic's "~8"
// predates #251, after which AgendaList's headerFmt follows getLocale() and is
// no longer an en-CA site):
//
//   1. AgendaList.svelte           groupKeyFmt              Europe/Tallinn
//   2. AgendaList.svelte           shortDateFmt             Europe/Tallinn
//   3. routes/+page.svelte         seasonDateFmt            UTC
//   4. routes/+page.svelte         eventCreateStatusDateFmt Europe/Tallinn (EVENT_CREATE_TZ)
//   5. InviteSurface.svelte        inviteExpiryDateFmt      (no timeZone — process-local)
//   6. invite/[token]/+page.svelte expiryDateFmt            (no timeZone — process-local)
//   7. library/+page.svelte        _dateFmt                 UTC
//
// GREEN adds ONE factory to $lib/preferences/timeFormat —
//   isoDateFormatter(timeZone?: string): Intl.DateTimeFormat
// — and points all seven sites at it. The timeZone parameter is OPTIONAL and
// undefined must mean exactly what "no timeZone key" means to Intl today: sites
// 5 and 6 legitimately run process-local, and a required-TZ factory would
// silently change their output. Preserving each site's tz EXACTLY (including
// "unspecified") is the issue's stop-and-report condition — these tests pin it.
//
// DELIBERATELY OUT OF SCOPE (different animals, not date-only rendering):
//   - event/[id]/+page.svelte toTallinnLocalInputValue — en-CA but with
//     hourCycle/hour/minute + .formatToParts (a datetime-local SEED builder)
//   - routes/+page.svelte tallinnWallClockParts — en-US + time parts
// The census fingerprint below excludes both structurally (they render hours).
//
// #251 note for GREEN: AgendaList.spec.ts pins groupKeyFmt/shortDateFmt en-CA
// byte-identity and ISO grouping keys under every locale — the factory swap
// must keep those pins green UNTOUCHED; they are the behavior oracle for
// sites 1–2, just as page.admin-invite / page.invite-landing / library suites
// are for sites 5–7.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isoDateFormatter } from './timeFormat';

// ─── The factory itself ─────────────────────────────────────────────────────

/** The exact resolved shape every site's formatter has today — full-shape
 *  (toEqual) so no stray option (hour, weekday, …) can sneak in unseen. */
function expectedResolved(timeZone: string) {
	return {
		locale: 'en-CA',
		calendar: 'gregory',
		numberingSystem: 'latn',
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	};
}

/** Inline oracle mirroring the no-TZ sites' construction BYTE-IDENTICALLY
 *  (InviteSurface.svelte inviteExpiryDateFmt / invite/[token] expiryDateFmt):
 *  no timeZone key at all — the process-local zone, whatever it is in the
 *  environment running this suite (vitest pins no TZ). */
const bareOracle = new Intl.DateTimeFormat('en-CA', {
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

/** Instants chosen so the timeZone actually SHOWS in the output: late-evening
 *  UTC crosses midnight in Tallinn (EET +2 and EEST +3 both covered), plus the
 *  two 2026 Tallinn DST transition nights and a plain midsummer noon. */
const PROBES = [
	'2026-01-15T22:30:00.000Z', // EET winter: 00:30 Jan 16 Tallinn, still Jan 15 UTC
	'2026-06-30T22:30:00.000Z', // EEST summer: 01:30 Jul 1 Tallinn, still Jun 30 UTC
	'2026-03-28T22:30:00.000Z', // spring-forward eve: 00:30 Mar 29 EET
	'2026-03-29T01:30:00.000Z', // just past the 01:00Z spring-forward: 04:30 EEST
	'2026-10-24T21:30:00.000Z', // fall-back eve: 00:30 Oct 25 EEST
	'2026-10-25T01:30:00.000Z', // just past the 01:00Z fall-back: 03:30 EET
	'2026-07-15T12:00:00.000Z' // plain noon — same date everywhere relevant
].map((iso) => new Date(iso));

describe('#231 — isoDateFormatter(timeZone?): the ONE shared en-CA ISO-date factory', () => {
	it('with an explicit timeZone: resolved options are exactly the shared shape (full-shape pin)', () => {
		expect(isoDateFormatter('UTC').resolvedOptions()).toEqual(expectedResolved('UTC'));
		expect(isoDateFormatter('Europe/Tallinn').resolvedOptions()).toEqual(
			expectedResolved('Europe/Tallinn')
		);
	});

	it('without a timeZone: resolves to the PROCESS-LOCAL zone, byte-identical to a bare en-CA construction (sites 5–6 contract)', () => {
		// The oracle's own resolved zone IS the definition of "process-local"
		// here — never hardcoded, so this holds under any host TZ.
		expect(isoDateFormatter().resolvedOptions()).toEqual(
			expectedResolved(bareOracle.resolvedOptions().timeZone)
		);
	});

	it('an EXPLICIT undefined timeZone behaves exactly like omitting it (replacement sites may pass undefined through)', () => {
		expect(isoDateFormatter(undefined).resolvedOptions()).toEqual(
			isoDateFormatter().resolvedOptions()
		);
		expect(PROBES.map((d) => isoDateFormatter(undefined).format(d))).toEqual(
			PROBES.map((d) => isoDateFormatter().format(d))
		);
	});

	it('formats the exact YYYY-MM-DD string, with the timeZone genuinely applied (UTC vs Tallinn diverge on midnight-straddling instants)', () => {
		const utc = isoDateFormatter('UTC');
		const tallinn = isoDateFormatter('Europe/Tallinn');
		expect(PROBES.map((d) => utc.format(d))).toEqual([
			'2026-01-15',
			'2026-06-30',
			'2026-03-28',
			'2026-03-29',
			'2026-10-24',
			'2026-10-25',
			'2026-07-15'
		]);
		expect(PROBES.map((d) => tallinn.format(d))).toEqual([
			'2026-01-16', // EET +2 crossed midnight
			'2026-07-01', // EEST +3 crossed midnight
			'2026-03-29', // 00:30 EET on transition day
			'2026-03-29', // 04:30 EEST after the jump
			'2026-10-25', // 00:30 EEST on transition day
			'2026-10-25', // 03:30 EET after the fold
			'2026-07-15'
		]);
	});

	it('UTC guard: a date-only midnight-UTC instant never slides to the previous day (season/library contract)', () => {
		expect(isoDateFormatter('UTC').format(new Date('2026-07-01T00:00:00.000Z'))).toEqual(
			'2026-07-01'
		);
	});

	it('no-TZ output is byte-identical to the current InviteSurface / invite-landing constructions on every probe', () => {
		expect(PROBES.map((d) => isoDateFormatter().format(d))).toEqual(
			PROBES.map((d) => bareOracle.format(d))
		);
	});

	it('Tallinn output is byte-identical to the current AgendaList groupKeyFmt/shortDateFmt construction on every probe (the #251 pins stay honest)', () => {
		// Oracle mirrors AgendaList.svelte's construction verbatim.
		const agendaOracle = new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Europe/Tallinn',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		});
		expect(PROBES.map((d) => isoDateFormatter('Europe/Tallinn').format(d))).toEqual(
			PROBES.map((d) => agendaOracle.format(d))
		);
	});
});

// ─── The wiring census (what forces GREEN to actually SWAP the sites) ───────
//
// Unit tests alone would go green with the factory sitting unused next to
// seven surviving copies. This lint-style scan (house pattern:
// timeFormat.no-hardcoded-render.spec.ts) makes the consolidation executable:
// outside timeFormat.ts, NO production source may construct a date-only en-CA
// Intl formatter of its own. RED: exactly the seven sites above. GREEN: [].
//
// Fingerprint — an `Intl.DateTimeFormat` construction whose window (up to the
// options object's closing brace; every real occurrence is brace-nesting-free)
// names the 'en-CA' locale and the date-only option trio, and renders NO hour.
// The hour exclusion is what keeps the two out-of-scope near-misses
// (event/[id] toTallinnLocalInputValue, en-US tallinnWallClockParts) out
// structurally rather than by filename.

const SRC_ROOT = resolve(__dirname, '../..'); // …/src

const ALLOWLIST = new Set([
	// The shared module itself — isoDateFormatter is THE one place the app
	// constructs a date-only en-CA formatter.
	'lib/preferences/timeFormat.ts'
]);

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			// Generated i18n output — not hand-written source.
			if (entry.name === 'paraglide') continue;
			walk(full, out);
		} else if (
			(entry.name.endsWith('.ts') || entry.name.endsWith('.svelte')) &&
			!entry.name.includes('.spec.') &&
			!entry.name.endsWith('.d.ts')
		) {
			out.push(full);
		}
	}
	return out;
}

type Violation = { file: string; line: number; excerpt: string };

/** Scan one file for date-only en-CA Intl constructions (see the fingerprint above). */
function violationsIn(full: string): Violation[] {
	const content = readFileSync(full, 'utf8');
	const found: Violation[] = [];
	const re = /Intl\.DateTimeFormat/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(content)) !== null) {
		const close = content.indexOf('}', match.index);
		if (close === -1) continue;
		const window = content.slice(match.index, close + 1).replace(/\s+/g, '');
		const isEnCa = /DateTimeFormat\(['"]en-CA['"]/.test(window);
		const isDateOnly =
			/year:['"]numeric['"]/.test(window) &&
			/month:['"]2-digit['"]/.test(window) &&
			/day:['"]2-digit['"]/.test(window) &&
			!/hour:/.test(window);
		if (isEnCa && isDateOnly) {
			const line = content.slice(0, match.index).split('\n').length;
			found.push({
				file: relative(SRC_ROOT, full).split(sep).join('/'),
				line,
				excerpt: window.slice(0, 120)
			});
		}
	}
	return found;
}

describe('#231 — no hand-rolled ISO-date (en-CA) formatter outside the shared factory', () => {
	it('every date-only en-CA Intl construction in src/ lives in timeFormat.ts; the seven sites must consume isoDateFormatter(tz?)', () => {
		const files = walk(SRC_ROOT);
		const violations = files
			.filter((f) => !ALLOWLIST.has(relative(SRC_ROOT, f).split(sep).join('/')))
			.flatMap(violationsIn);
		expect(
			violations,
			'these files rebuild the ISO-date formatter locally — ' +
				'replace with $lib/preferences/timeFormat isoDateFormatter(timeZone?), preserving each site\'s exact tz (including NO tz):\n' +
				violations.map((v) => `  ${v.file}:${v.line} — ${v.excerpt}`).join('\n')
		).toEqual([]);
	});

	it('meta-guard: the fingerprint still matches the shared module itself (the scan must never silently go blind)', () => {
		// timeFormat.ts is REQUIRED to contain exactly the construction this spec
		// hunts for (isoDateFormatter's body). If the scan finds nothing even
		// THERE, the regex has rotted and the empty-violations pass proves nothing.
		const self = violationsIn(join(SRC_ROOT, 'lib/preferences/timeFormat.ts'));
		expect(
			self.length,
			'expected isoDateFormatter in timeFormat.ts to carry the one allowlisted date-only en-CA Intl construction'
		).toBeGreaterThan(0);
	});
});

// (*MVOX:Tallis* — #231 RED: shared ISO-date (en-CA) factory — optional-TZ contract + wiring census)
