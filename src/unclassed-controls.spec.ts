// #335 RED — an unclassed form control is an INVISIBLE form control. Tailwind's
// preflight strips the browser default border and background from input, select,
// textarea and button; the only global rule this codebase puts on controls is
// the #130/#151 iOS-zoom `@layer base { input, select, textarea { font-size: 1rem } }`
// in app.css — no border, no background, no padding. So a control added with no
// `class` at all renders as a transparent box (or bare text, for a button), and
// nothing catches it until a human opens the page: six inputs and seven buttons
// shipped exactly that way on the Links page (#335, reported live from a phone).
//
// This guard makes forgetting fail the suite: every <input>, <select>,
// <textarea> and <button> in every src/**/*.svelte file must carry SOME class —
// a `class=` attribute or a `class:` directive. NEVER a specific class: the
// deliberate partial-border designs (the agenda/event/admin
// `border-b border-ink bg-transparent` inline edits) must pass by construction,
// which is also why this lives in the test suite and not in a global style that
// would repaint them (issue #335, scope item 3).
//
// The four-element family is app.css's own: its base rule names input, select
// and textarea as one family (button joins because preflight strips it just the
// same). A guard narrower than the family it guards has a hole whether or not
// anything is currently in it (Gama's retraction on #335).
//
// EXEMPT: <input type="checkbox">, <input type="file">, <input type="radio">.
// Reason: these do not read as text boxes — the browser draws their control
// glyph regardless of preflight, so an unclassed one is still visible and
// usable. (radio currently has zero instances anywhere in src/; the exemption
// is stated for completeness so the next radio doesn't fail for the wrong
// reason.)
//
// Scanner mechanics mirror src/ios-form-zoom.spec.ts (scan real sources so
// GREEN cannot pass by patching a component nothing mounts), hardened against
// the TWO failure modes real sweeps demonstrated ON THIS VERY ISSUE:
//
//   (a) COMMENT BLINDNESS — InviteSurface.svelte contains the literal string
//       `<select>` as prose inside an HTML <!-- --> comment; a comment-blind
//       scan reported it as a naked select (issue body's InviteSurface:629
//       "finding", retracted). Comments are stripped BEFORE tag-matching,
//       newline-preserving so line numbers stay honest.
//   (b) MULTI-LINE TRUNCATION — a scan that collects a tag by reading forward
//       until a line ends in '>' stops at `oninput={(e) =>` and never reaches
//       the class attribute two lines below; that exact bug produced twelve
//       phantom findings in #335's body (all retracted). The tag extractor here
//       is ios-form-zoom's quote- and brace-aware scanner, which walks to the
//       tag's REAL closing '>' (brace depth 0, outside quotes).
//
// The scanner is exported as a pure function (source text in → offenders out)
// and its behaviour is pinned below with INLINE STRING fixtures — not fixture
// .svelte files under src/, because this guard scans src/ and a naked-control
// fixture file would trip the guard itself forever (Gama's ruling on #335: pin
// the instrument, never a count of the tree you are about to change).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC_ROOT = resolve(__dirname);

function svelteFiles(): string[] {
	return readdirSync(SRC_ROOT, { recursive: true, withFileTypes: true })
		.filter((d) => d.isFile() && d.name.endsWith('.svelte'))
		.map((d) => join(d.parentPath, d.name));
}

/** Blank a matched span, preserving newlines so line numbers stay correct. */
function blank(span: string): string {
	return span.replace(/[^\n]/g, ' ');
}

/**
 * Blank out every HTML comment, preserving newlines (and column offsets on the
 * comment's own lines) so downstream line numbers stay correct. Failure mode
 * (a): tag-looking prose inside <!-- --> must never reach the tag matcher.
 */
export function stripHtmlComments(source: string): string {
	return source.replace(/<!--[\s\S]*?-->/g, blank);
}

/**
 * Blank out <script> and <style> blocks. Form controls are MARKUP — they only
 * exist in the template — while script blocks are dense with tag-looking prose
 * in // and JSDoc comments ("native <select> elements", "#209 a native
 * <select>"...). The first live run of this guard surfaced 27 such phantoms
 * across ten files: the same comment-blindness class as failure mode (a), one
 * comment syntax over. Verified at RED time: with script/style stripped the
 * offender list is exactly the 13 Links-page controls.
 */
export function stripScriptAndStyle(source: string): string {
	return source
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, blank)
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, blank);
}

/**
 * Extract every <input|select|textarea|button ...> opening tag, tolerating `>`
 * characters inside {expression} attributes and quoted strings — failure mode
 * (b): `oninput={(e) =>` must NOT terminate the tag. Same scanner as
 * ios-form-zoom.spec.ts, with `button` added to the family.
 */
function controlTags(source: string): { element: string; tag: string; line: number }[] {
	const out: { element: string; tag: string; line: number }[] = [];
	const re = /<(input|select|textarea|button)\b/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(source)) !== null) {
		let i = m.index;
		let brace = 0;
		let quote: string | null = null;
		for (; i < source.length; i++) {
			const c = source[i];
			if (quote) {
				if (c === quote) quote = null;
			} else if (c === '"' || c === "'" || c === '`') {
				quote = c;
			} else if (c === '{') {
				brace++;
			} else if (c === '}') {
				brace--;
			} else if (c === '>' && brace === 0) {
				break;
			}
		}
		out.push({
			element: m[1],
			tag: source.slice(m.index, i + 1),
			line: source.slice(0, m.index).split('\n').length
		});
	}
	return out;
}

/** SOME class, never a specific one: a `class=` attribute or a `class:` directive. */
function carriesAClass(tag: string): boolean {
	return /(^|[\s"'}])class\s*=/.test(tag) || /(^|[\s"'}])class:[^\s=]/.test(tag);
}

/** Exempt inputs: checkbox/file/radio do not read as text boxes (see header). */
function isExemptInput(element: string, tag: string): boolean {
	return element === 'input' && /\btype\s*=\s*["']?(checkbox|file|radio)\b/.test(tag);
}

export interface UnclassedControl {
	element: string;
	line: number;
	/** data-testid when the tag carries one, for a readable failure line. */
	identifier: string | null;
}

/**
 * The guard's instrument, pure: Svelte source text in, unclassed controls out.
 * Strips comments, walks each full tag, applies the checkbox/file/radio
 * exemption, and demands SOME class on everything else.
 */
export function findUnclassedControls(source: string): UnclassedControl[] {
	const offenders: UnclassedControl[] = [];
	const template = stripHtmlComments(stripScriptAndStyle(source));
	for (const { element, tag, line } of controlTags(template)) {
		if (isExemptInput(element, tag)) continue;
		if (carriesAClass(tag)) continue;
		const testid = tag.match(/data-testid\s*=\s*["']([^"']+)["']/);
		offenders.push({ element, line, identifier: testid ? testid[1] : null });
	}
	return offenders;
}

// ── scanner pins: inline string fixtures, green forever ─────────────────────
// These pin the INSTRUMENT, not the current state of the tree — they survive
// the Links fix and every future sweep unchanged.

describe('#335 unclassed-control scanner — behaviour pinned on inline fixtures', () => {
	it('reads a multi-line tag to its REAL closing > — a class below an `oninput={(e) =>` line counts (truncation immunity, the bug behind the twelve retracted findings)', () => {
		const fixture = [
			'<input',
			'\tdata-testid="event-create-capacity"',
			'\ttype="text"',
			'\toninput={(e) =>',
			'\t\t(eventCreateCapacity = (e.currentTarget as HTMLInputElement).value)}',
			'\tclass="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"',
			'/>'
		].join('\n');
		expect(findUnclassedControls(fixture)).toEqual([]);
	});

	it('ignores tag-looking prose inside <!-- --> comments (comment immunity — the retracted InviteSurface:629 "select")', () => {
		const fixture = [
			'<!--',
			'\tFor dropdowns always use a native <select> element, never a custom widget.',
			'-->',
			'<p class="text-sm">real content</p>'
		].join('\n');
		expect(findUnclassedControls(fixture)).toEqual([]);
	});

	it('ignores tag-looking prose inside <script> // comments — controls are markup, script is not scanned', () => {
		const fixture = [
			'<script lang="ts">',
			"\t// #209 rule — the pickers are NATIVE <select> elements; there is no <input> at all.",
			'\tlet open = $state(false);',
			'</script>',
			'',
			'<p class="text-sm">real content</p>'
		].join('\n');
		expect(findUnclassedControls(fixture)).toEqual([]);
	});

	it('reports a genuinely naked <textarea> with its line and testid (the guard actually fires)', () => {
		const fixture = [
			'<label class="flex flex-col gap-1 text-sm">',
			'\tNotes',
			'\t<textarea data-testid="notes-field" bind:value={notes}></textarea>',
			'</label>'
		].join('\n');
		expect(findUnclassedControls(fixture)).toEqual([
			{ element: 'textarea', line: 3, identifier: 'notes-field' }
		]);
	});

	it('passes a naked <input type="checkbox"> — the checkbox/file/radio exemption is live', () => {
		const fixture = '<input type="checkbox" data-testid="row-picker" bind:checked={picked} />';
		expect(findUnclassedControls(fixture)).toEqual([]);
	});

	it('accepts a class: directive as SOME class — no class= attribute needed', () => {
		const fixture = '<button type="button" class:active={isOpen} onclick={toggle}>Toggle</button>';
		expect(findUnclassedControls(fixture)).toEqual([]);
	});
});

// ── the guard ───────────────────────────────────────────────────────────────

describe('#335 — every form control in src/**/*.svelte carries SOME class', () => {
	const files = svelteFiles();

	it('scans a non-trivial set of svelte sources (sanity: the walker works)', () => {
		expect(files.length).toBeGreaterThan(10);
		expect(
			files.some(
				(f) =>
					controlTags(stripHtmlComments(stripScriptAndStyle(readFileSync(f, 'utf-8')))).length > 0
			)
		).toBe(true);
	});

	it('no <input>/<select>/<textarea>/<button> is unclassed (checkbox/file/radio exempt — they do not read as text boxes)', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf-8');
			for (const { element, line, identifier } of findUnclassedControls(source)) {
				offenders.push(
					`${relative(SRC_ROOT, file)}:${line} — <${element}>${identifier ? ` ${identifier}` : ''}`
				);
			}
		}
		expect(
			offenders,
			`form controls with no class at all (preflight leaves these invisible — a transparent box or bare text; see #335):\n${offenders.join('\n')}`
		).toEqual([]);
	});
});

// (*MVOX:Tallis* — #335 RED)
