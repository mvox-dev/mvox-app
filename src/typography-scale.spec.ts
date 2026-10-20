// #151 — the type scale, made enforceable: the scale lives in docs/design/typography.md.
//
// Real sources are scanned rather than rendered: an unmounted component cannot hide a violation.
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

// Walk the chain: classes sit on a wrapper while role="alert" rides an inner element.
function taggedWithAncestors(source: string): { tag: Tag; chain: Tag[] }[] {
	const out: { tag: Tag; chain: Tag[] }[] = [];
	const stack: Tag[] = [];
	for (const t of scanTags(source)) {
		if (t.closing) {
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

/** Font-size utilities only — `text-ink-2`, `text-danger` etc. are colours. */
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
	if (/(?:^|[^-\w])text-danger(?![-\w])/.test(tag)) return 'error';
	if (/(?:^|[^-\w])text-red(?![-\w])/.test(tag)) return 'bare';
	return null;
}

/** An error site: the live-region role, or a test id naming an error or failure. */
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

	// Two reds: bare `text-red` is the destructive-action token, `text-danger` is error copy;
	// mixing them made one error role look different across sibling surfaces.
	it('error copy uses text-danger, not the bare text-red destructive-action token', () => {
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
			`error text using the bare \`text-red\` token instead of the shared \`text-danger\` error colour:\n${offenders.join('\n')}`
		).toEqual([]);
	});

	// docs/design/typography.md: an error is a sentence, so never at the stamp tier.
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
