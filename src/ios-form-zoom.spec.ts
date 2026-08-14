// #130 RED — iOS Safari auto-zooms any focused form control whose font-size
// computes below 16px. The fix is two-pronged, and BOTH prongs are asserted
// here because each alone leaves a zoom path open:
//
//   1. app.css must carry a global rule targeting input, select, AND textarea
//      that sets font-size to >= 16px — this covers bare/unclassed controls
//      and any control added in the future without an explicit text class.
//   2. No <input>/<select>/<textarea> in any .svelte source may carry a
//      Tailwind font-size utility below 16px (text-xs = 12px, text-sm = 14px,
//      or arbitrary text-[Npx] with N < 16) — a CLASS utility outspecifies an
//      element-selector base rule, so leaving `text-xs` on a control silently
//      undoes prong 1 (unless GREEN reaches for !important, in which case the
//      lying utility class is dead weight that must go anyway).
//
// #151 adds prong 1b, which is what MAKES prong 2's premise true: the rule must
// live inside `@layer base`. Tailwind v4 emits every utility into
// `@layer utilities`, and an UNLAYERED rule beats every layered one regardless
// of specificity — so authored outside a layer, prong 1 does not merely back up
// prong 2, it OVERRIDES every text-* utility on every control, including the
// >=16px ones a designer meant to apply (text-2xl on the event-name inline-edit
// input, text-lg on the season-name one both rendered 16px). Layered into `base`
// the rule still wins over preflight (same layer, later source order) and still
// covers bare controls, but it becomes a DEFAULT rather than an unconditional
// floor — which is exactly why prong 2 is the load-bearing half of the pair.
//
// Source-scan style follows the page.repertoire-a11y / page.sections-a11y
// precedent: scan real sources so GREEN cannot pass by patching a component
// nothing mounts. The tag extractor is brace- and quote-aware because opening
// tags in this codebase span lines and embed `>` inside arrow-function
// attributes (e.g. `onchange={(e) => (x = e.currentTarget.value)}`).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC_ROOT = resolve(__dirname);

function svelteFiles(): string[] {
	return readdirSync(SRC_ROOT, { recursive: true, withFileTypes: true })
		.filter((d) => d.isFile() && d.name.endsWith('.svelte'))
		.map((d) => join(d.parentPath, d.name));
}

/**
 * Extract every <input|select|textarea ...> opening tag from Svelte source,
 * tolerating `>` characters inside {expression} attributes and quoted strings.
 */
function formControlTags(source: string): { tag: string; line: number }[] {
	const out: { tag: string; line: number }[] = [];
	const re = /<(input|select|textarea)\b/g;
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
			tag: source.slice(m.index, i + 1),
			line: source.slice(0, m.index).split('\n').length
		});
	}
	return out;
}

/** Tailwind font-size utilities that compute below 16px, variant-prefixed or not. */
function subSixteenTokens(tag: string): string[] {
	const hits: string[] = [];
	const named = tag.match(/(?:^|[^-\w])((?:[-\w]+:)*text-(?:xs|sm))(?![-\w])/g);
	for (const h of named ?? []) hits.push(h.trim().replace(/^[^-\w]+/, ''));
	const arbitrary = /(?:[-\w]+:)*text-\[(\d+(?:\.\d+)?)px\]/g;
	let m: RegExpExecArray | null;
	while ((m = arbitrary.exec(tag)) !== null) {
		if (parseFloat(m[1]) < 16) hits.push(m[0]);
	}
	return hits;
}

/** Rules in `css` that target input+select+textarea together with font-size >= 16px. */
function qualifyingControlRules(css: string): string[] {
	const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
	return blocks
		.filter(([, selector, body]) => {
			const s = selector.split(/[{}]/).pop() ?? selector;
			const targetsAll = ['input', 'select', 'textarea'].every((el) =>
				new RegExp(`(^|[,\\s])${el}(?![-\\w])`).test(s)
			);
			if (!targetsAll) return false;
			const fontSize = body.match(/font-size\s*:\s*([^;]+)/);
			if (!fontSize) return false;
			const value = fontSize[1];
			const pxOk = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].some(([, n]) => parseFloat(n) >= 16);
			const remOk = [...value.matchAll(/(\d+(?:\.\d+)?)r?em/g)].some(([, n]) => parseFloat(n) >= 1);
			return pxOk || remOk;
		})
		.map(([whole]) => whole);
}

/** Body of the first top-level `@layer <name> { ... }` block, brace-matched. */
function layerBody(css: string, name: string): string | null {
	const open = css.search(new RegExp(`@layer\\s+${name}\\s*\\{`));
	if (open === -1) return null;
	const start = css.indexOf('{', open);
	let depth = 0;
	for (let i = start; i < css.length; i++) {
		if (css[i] === '{') depth++;
		else if (css[i] === '}' && --depth === 0) return css.slice(start + 1, i);
	}
	return null;
}

describe('#130 iOS form zoom — global >=16px rule in app.css', () => {
	const css = readFileSync(resolve(SRC_ROOT, 'app.css'), 'utf-8').replace(
		/\/\*[\s\S]*?\*\//g,
		''
	);

	it('app.css has a rule targeting input, select, and textarea with font-size >= 16px', () => {
		expect(
			qualifyingControlRules(css).length,
			'expected app.css to contain a global input/select/textarea rule with font-size >= 16px (px >= 16, or >= 1rem/1em)'
		).toBeGreaterThan(0);
	});

	// #151 — prong 1b. Unlayered CSS beats every `@layer` rule, and Tailwind v4 puts
	// ALL utilities in `@layer utilities`, so an unlayered version of this rule
	// silently overrides every text-* utility a control legitimately carries.
	it('the >=16px rule lives inside @layer base, so text-* utilities can still win', () => {
		const base = layerBody(css, 'base');
		expect(base, 'expected app.css to declare an @layer base block').not.toBeNull();
		expect(
			qualifyingControlRules(base ?? '').length,
			'expected the input/select/textarea font-size rule to sit INSIDE @layer base — unlayered, it outranks every Tailwind text-* utility (which live in @layer utilities) and silently pins every control to 16px'
		).toBeGreaterThan(0);
	});
});

describe('#130 iOS form zoom — no sub-16px font utility on any form control', () => {
	const files = svelteFiles();

	it('scans a non-trivial set of svelte sources (sanity: the walker works)', () => {
		expect(files.length).toBeGreaterThan(10);
		expect(files.some((f) => formControlTags(readFileSync(f, 'utf-8')).length > 0)).toBe(true);
	});

	it('no <input>/<select>/<textarea> carries text-xs, text-sm, or text-[<16px]', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf-8');
			for (const { tag, line } of formControlTags(source)) {
				const tokens = subSixteenTokens(tag);
				if (tokens.length > 0) {
					offenders.push(`${relative(SRC_ROOT, file)}:${line} — ${tokens.join(', ')}`);
				}
			}
		}
		expect(
			offenders,
			`form controls with sub-16px font utilities (iOS Safari zooms these on focus):\n${offenders.join('\n')}`
		).toEqual([]);
	});
});

// (*MVOX:Tallis*)
