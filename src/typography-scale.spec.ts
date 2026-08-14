// #151 — the type scale, made enforceable.
//
// The original #151 pass fixed three heading inversions but left the thing the
// issue actually named untouched: after #130 raised every form control to 16px,
// nothing in the app rendered at 16px (`text-base` appeared zero times), so any
// display text a control REPLACES or sits beside changed size on entering edit
// mode. Fixing the sites without recording the resulting scale would leave the
// next slice free to re-diverge, so the scale lives in docs/design/typography.md
// and the two rules that are mechanically checkable are asserted here.
//
// Scanning real sources (rather than rendering) follows the ios-form-zoom.spec /
// page.sections-a11y precedent: a component nothing mounts cannot hide a
// violation, and the check costs nothing at runtime.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC_ROOT = resolve(__dirname);

function svelteFiles(): string[] {
	return readdirSync(SRC_ROOT, { recursive: true, withFileTypes: true })
		.filter((d) => d.isFile() && d.name.endsWith('.svelte'))
		.map((d) => join(d.parentPath, d.name));
}

interface Tag {
	/** The raw `<p …>` / `</p>` text. */
	tag: string;
	name: string;
	closing: boolean;
	selfClosing: boolean;
	line: number;
}

/** Elements with no close tag — they never open a nesting level. */
const VOID_ELEMENTS = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr'
]);

/**
 * Every tag in the source — opening AND closing — tolerating `>` inside
 * {expression} attributes and quoted strings (same extractor shape as
 * ios-form-zoom.spec.ts). Scanning resumes AFTER each tag's `>` so a `<` inside
 * an attribute expression cannot be mistaken for the start of a tag.
 */
function scanTags(source: string): Tag[] {
	const out: Tag[] = [];
	const re = /<(\/?)([a-zA-Z][-\w.]*)/g;
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
		const tag = source.slice(m.index, i + 1);
		out.push({
			tag,
			name: m[2],
			closing: m[1] === '/',
			selfClosing: /\/>$/.test(tag),
			line: source.slice(0, m.index).split('\n').length
		});
		re.lastIndex = i + 1;
	}
	return out;
}

/**
 * Each opening tag paired with its ancestor chain, nearest first, INCLUDING
 * itself at index 0.
 *
 * Why the chain and not the tag alone: presentation classes are routinely
 * authored on a WRAPPER while the semantic role (`role="alert"`, an
 * `error`/`failed` test id) rides an inner element — that is exactly how the
 * RSVP save-failed line kept a stamp-tier size and the bare destructive-action
 * red through a pass meant to remove both. A tag-local check has a hole the
 * shape of every wrapper in the app; resolving the chain closes it.
 */
function taggedWithAncestors(source: string): { tag: Tag; chain: Tag[] }[] {
	const out: { tag: Tag; chain: Tag[] }[] = [];
	const stack: Tag[] = [];
	for (const t of scanTags(source)) {
		if (t.closing) {
			// Pop to the nearest matching open. Unbalanced markup (a tag opened in
			// one `{#if}` branch and closed in another) just truncates the stack
			// rather than derailing the rest of the file.
			for (let i = stack.length - 1; i >= 0; i--) {
				if (stack[i].name === t.name) {
					stack.length = i;
					break;
				}
			}
			continue;
		}
		out.push({ tag: t, chain: [t, ...[...stack].reverse()] });
		if (!t.selfClosing && !VOID_ELEMENTS.has(t.name.toLowerCase())) stack.push(t);
	}
	return out;
}

/**
 * The sanctioned scale. Named steps carry the body/heading tiers; the two
 * arbitrary values are the "stamp" tier — font-mono uppercase tracking-wide
 * chips, badges and timestamps — which is a deliberate design layer, not drift.
 * Anything else is a new step nobody agreed to; add it here on purpose or not
 * at all. See docs/design/typography.md.
 */
const SANCTIONED_STEPS = new Set([
	'text-xs',
	'text-sm',
	'text-base',
	'text-lg',
	'text-xl',
	'text-2xl',
	'text-[9px]',
	'text-[10px]'
]);

/** The stamp tier — chips and badges. Never a sentence, so never an error. */
const STAMP_STEPS = new Set(['text-[9px]', 'text-[10px]']);

/** Font-size utilities only — `text-ink-2`, `text-red-700` etc. are colours. */
const SIZE_TOKEN =
	/(?:^|[^-\w])((?:[-\w]+:)*text-(?:xs|sm|base|lg|[2-9]?xl|\[[\d.]+(?:px|rem|em)\]))(?![-\w])/g;

function sizeTokens(source: string): { token: string; line: number }[] {
	const out: { token: string; line: number }[] = [];
	let m: RegExpExecArray | null;
	SIZE_TOKEN.lastIndex = 0;
	while ((m = SIZE_TOKEN.exec(source)) !== null) {
		// Drop any variant prefix (`sm:`, `hover:`) — the STEP is what is scaled.
		out.push({ token: m[1].split(':').pop() as string, line: source.slice(0, m.index).split('\n').length });
	}
	return out;
}

/** The size step this tag sets on itself, if any (first one wins). */
function ownSizeStep(tag: string): string | null {
	return sizeTokens(tag)[0]?.token ?? null;
}

/** The red this tag sets on itself: the bare theme token, the error colour, or none. */
function ownRed(tag: string): 'bare' | 'error' | null {
	if (/(?:^|[^-\w])text-red-700(?![-\w])/.test(tag)) return 'error';
	if (/(?:^|[^-\w])text-red(?![-\w])/.test(tag)) return 'bare';
	return null;
}

/**
 * An error SITE: the element announces itself as an error, whether through the
 * live-region role or through the test id the specs address it by.
 */
function isErrorRole(tag: string): boolean {
	return /role=["']alert["']/.test(tag) || /data-testid="[^"]*(?:error|failed)/.test(tag);
}

/** The nearest value in the ancestor chain (self first) — what actually renders. */
function inherited<T>(chain: Tag[], read: (tag: string) => T | null): T | null {
	for (const t of chain) {
		const v = read(t.tag);
		if (v !== null) return v;
	}
	return null;
}

describe('#151 typography — one scale, no ad-hoc steps', () => {
	const files = svelteFiles();

	it('scans a non-trivial set of svelte sources (sanity: the walker works)', () => {
		expect(files.length).toBeGreaterThan(10);
		expect(files.some((f) => sizeTokens(readFileSync(f, 'utf-8')).length > 0)).toBe(true);
	});

	it('finds error sites that carry their role and their classes on different tags (sanity: the chain works)', () => {
		// Guard the guard: if the ancestor walk ever silently stopped resolving,
		// both rules below would pass vacuously on every wrapper-styled site.
		const split = files.flatMap((f) =>
			taggedWithAncestors(readFileSync(f, 'utf-8')).filter(
				({ tag, chain }) =>
					isErrorRole(tag.tag) &&
					ownSizeStep(tag.tag) === null &&
					chain.slice(1).some((a) => ownSizeStep(a.tag) !== null)
			)
		);
		expect(split.length).toBeGreaterThan(0);
	});

	it('every font-size utility is a sanctioned step', () => {
		const offenders: string[] = [];
		for (const file of files) {
			for (const { token, line } of sizeTokens(readFileSync(file, 'utf-8'))) {
				if (!SANCTIONED_STEPS.has(token)) {
					offenders.push(`${relative(SRC_ROOT, file)}:${line} — ${token}`);
				}
			}
		}
		expect(
			offenders,
			`font-size utilities outside the agreed scale (see docs/design/typography.md):\n${offenders.join('\n')}`
		).toEqual([]);
	});

	// The app carries TWO reds: the paper-palette theme token `--color-red`
	// (`text-red`) and Tailwind's default `text-red-700`. Error copy settled on
	// text-red-700 (~50 sites across every route); the bare token is the
	// destructive-ACTION affordance (the repertoire "remove" link). Mixing them
	// per-component is what made the same error role look different on sibling
	// surfaces, so the split is pinned here.
	it('error copy uses text-red-700, not the bare text-red destructive-action token', () => {
		const offenders: string[] = [];
		for (const file of files) {
			for (const { tag, chain } of taggedWithAncestors(readFileSync(file, 'utf-8'))) {
				if (!isErrorRole(tag.tag)) continue;
				if (inherited(chain, ownRed) === 'bare') {
					offenders.push(`${relative(SRC_ROOT, file)}:${tag.line}`);
				}
			}
		}
		expect(
			offenders,
			`error text using the bare \`text-red\` token instead of the shared \`text-red-700\` error colour:\n${offenders.join('\n')}`
		).toEqual([]);
	});

	// docs/design/typography.md: "An error message is never rendered at the stamp
	// tier — a stamp is a chip or a badge, an error is a sentence." Two sibling
	// surfaces (attendance rows, RSVP rows) had each drifted their error line down
	// to 9px to fit the dense row, which is how the same role ended up looking
	// like two different things.
	it('no error message renders at the stamp tier', () => {
		const offenders: string[] = [];
		for (const file of files) {
			for (const { tag, chain } of taggedWithAncestors(readFileSync(file, 'utf-8'))) {
				if (!isErrorRole(tag.tag)) continue;
				const step = inherited(chain, ownSizeStep);
				if (step && STAMP_STEPS.has(step)) {
					offenders.push(`${relative(SRC_ROOT, file)}:${tag.line} — ${step}`);
				}
			}
		}
		expect(
			offenders,
			`error copy at the stamp tier; an error is a sentence, not a chip (see docs/design/typography.md):\n${offenders.join('\n')}`
		).toEqual([]);
	});
});

// (*MVOX:Josquin*)
