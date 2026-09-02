// #220 — the AM/PM preference applies GLOBALLY ("Am/pm preference applies
// globally" — Mihkel): every displayed clock time flows through the ONE shared
// formatTime next to the #207 preference read. This lint-style spec makes that
// structural rule executable: no source file outside the allowlist may carry a
// 24h-RENDERING Intl formatter of its own, because any such formatter is a
// clock-time surface the preference cannot reach.
//
// What counts as a 24h-RENDERING formatter (the display fingerprint):
//   an Intl.DateTimeFormat options object containing
//     hour: '2-digit' | 'numeric'
//   together with
//     hour12: false  OR  hourCycle: 'h23'
//   and NEITHER second: '2-digit' NOR an immediate `.formatToParts(` call.
//
// Both exclusions are deliberate, not loopholes: they are the SPIKE's
// data-layer-builder allowlist expressed as a fingerprint instead of a
// filename list (so a builder can move files without faking a violation). The
// DATA-LAYER wall-clock CONVERTERS legitimately keep per-file h23 formatters —
// they compute UTC instants and input seeds for the WIRE, which #220
// explicitly leaves untouched — and every one of them is a
// construct-and-`.formatToParts(…)` inline call (the offset converters
// additionally need `second: '2-digit'` for the round-trip), while every HH:MM
// display formatter is a stored formatter whose `.format(…)` output lands in
// the DOM as-is.
//
// GREEN therefore moves the three display sites (AgendaList row/recent times,
// event-detail timeRange, the event-created toast's time half) onto
// timeFormat.ts's shared `tallinnHHMM(date)` (same Intl options as today,
// pinned DST-equal in timeFormat.spec.ts) wrapped in `formatTime(…, mode)` —
// after which this scan finds nothing outside the module. TODAY it fails on
// exactly those three files: that is this spec's RED.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(__dirname, '../..'); // …/src

/** Files ALLOWED to construct a 24h-rendering Intl formatter. */
const ALLOWLIST = new Set([
	// The shared module itself — tallinnHHMM is THE one place the app renders
	// a 24h HH:MM from an instant.
	'lib/preferences/timeFormat.ts',
	// The composite time-entry control: an INPUT surface, not a display one —
	// its 24h/12h duality is the #207 contract, pinned in its own spec.
	'lib/components/TimeSelect.svelte'
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

/** Scan one file for 24h-RENDERING Intl formatters (see the fingerprint above). */
function violationsIn(full: string): Violation[] {
	const content = readFileSync(full, 'utf8');
	const found: Violation[] = [];
	const re = /Intl\.DateTimeFormat/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(content)) !== null) {
		// The options object is brace-nesting-free in every real occurrence, so
		// the first `}` after the constructor bounds it exactly — no window
		// bleeding into a NEIGHBOURING formatter's options.
		const close = content.indexOf('}', match.index);
		if (close === -1) continue;
		const options = content.slice(match.index, close + 1).replace(/\s+/g, '');
		const rendersHour = /hour:['"](2-digit|numeric)['"]/.test(options);
		const is24h = /hour12:false/.test(options) || /hourCycle:['"]h23['"]/.test(options);
		// Data-layer wire/seed builders, NOT display (see the fingerprint above):
		const isConverter =
			/second:['"]2-digit['"]/.test(options) ||
			content
				.slice(close, close + 40)
				.replace(/\s+/g, '')
				.startsWith('}).formatToParts(');
		if (rendersHour && is24h && !isConverter) {
			const line = content.slice(0, match.index).split('\n').length;
			found.push({
				file: relative(SRC_ROOT, full).split(sep).join('/'),
				line,
				excerpt: options.slice(0, 120)
			});
		}
	}
	return found;
}

describe('#220 — no hardcoded 24h clock-time rendering outside the shared formatter', () => {
	it('every 24h-rendering Intl formatter in src/ lives in the allowlist (timeFormat.ts / TimeSelect.svelte); display sites must render via formatTime(tallinnHHMM(d), mode)', () => {
		const files = walk(SRC_ROOT);
		const violations = files
			.filter((f) => !ALLOWLIST.has(relative(SRC_ROOT, f).split(sep).join('/')))
			.flatMap(violationsIn);
		expect(
			violations,
			'these files render clock times the AM/PM preference cannot reach — ' +
				'move the formatting onto $lib/preferences/timeFormat formatTime(tallinnHHMM(d), $timeFormatStore):\n' +
				violations.map((v) => `  ${v.file}:${v.line} — ${v.excerpt}`).join('\n')
		).toEqual([]);
	});

	it('meta-guard: the fingerprint itself still matches the shared module (the scan must never silently go blind)', () => {
		// timeFormat.ts is REQUIRED to contain exactly the formatter shape this
		// spec hunts for (tallinnHHMM's Intl options). If the scan finds nothing
		// even THERE, the regex has rotted and the empty-violations pass above
		// proves nothing.
		const self = violationsIn(join(SRC_ROOT, 'lib/preferences/timeFormat.ts'));
		expect(
			self.length,
			'expected tallinnHHMM in timeFormat.ts to carry the one allowlisted 24h-rendering Intl formatter'
		).toBeGreaterThan(0);
	});
});

// (*MVOX:Tallis* — #220 RED: lint spec — the preference must be able to reach every rendered clock time)
