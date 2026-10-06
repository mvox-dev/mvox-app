// Where a name can reach a native <option> or an aria-label in Svelte markup (#619).
export type NameSurface = 'option' | 'aria-label';

export interface NameSurfaceSite {
	line: number;
	surface: NameSurface;
	token: string;
}

const blank = (s: string) => s.replace(/[^\n]/g, ' ');

/** Scripts, styles and comments blanked to the same length, so indices and lines hold. */
export function markupOnly(source: string): string {
	return source
		.replace(/<script[\s\S]*?<\/script>/g, blank)
		.replace(/<style[\s\S]*?<\/style>/g, blank)
		.replace(/<!--[\s\S]*?-->/g, blank);
}

function lineOf(src: string, i: number): number {
	return src.slice(0, i).split('\n').length;
}

const NAME_ISH = /^(?:names?|filenames?|[\w$]*[a-z]Names?)$/;

/** The value chains an expression reads that carry a name or a generic label. */
export function nameTokens(expr: string): string[] {
	const stripped = expr
		.replace(/(['"])(?:\\.|(?!\1)[^\\])*\1/g, "''")
		.replace(/\bm\.[a-z0-9_]+/g, 'm.MSG')
		.replace(/\?\./g, '.')
		.replace(/([{,(]\s*)[A-Za-z_$][\w$]*\s*:/g, '$1');
	const chains = stripped.match(/[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*/g) ?? [];
	const out = new Set<string>();
	for (const raw of chains) {
		const chain = raw.replace(/\s+/g, '');
		const parts = chain.split('.');
		const last = parts[parts.length - 1];
		if (parts.some((p) => NAME_ISH.test(p)) || /^labels?$/.test(last)) out.add(chain);
	}
	return [...out];
}

/** The balanced `{…}` starting at i, or null when it never closes. */
function braced(src: string, i: number): string | null {
	let depth = 0;
	for (let j = i; j < src.length; j += 1) {
		if (src[j] === '{') depth += 1;
		else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
	}
	return null;
}

/** The `{…}` interpolations in a run of markup text; the plain words around them are not read. */
function interpolations(text: string): string {
	const out: string[] = [];
	for (let i = text.indexOf('{'); i !== -1; i = text.indexOf('{', i + 1)) {
		const expr = braced(text, i);
		if (expr === null) break;
		out.push(expr);
		i += expr.length - 1;
	}
	return out.join(' ');
}

/** The interpolations of an attribute value starting at i: `{expr}` or a quoted string. */
function attributeValue(src: string, i: number): string {
	if (src[i] === '{') return braced(src, i) ?? '';
	const quote = src[i];
	if (quote !== '"' && quote !== "'") return '';
	const end = src.indexOf(quote, i + 1);
	return interpolations(src.slice(i + 1, end === -1 ? src.length : end));
}

/** An object-literal value starting at i, up to the `,` or closer at its own depth. */
function objectValue(src: string, i: number): string {
	let depth = 0;
	for (let j = i; j < src.length; j += 1) {
		const ch = src[j];
		if ('({['.includes(ch)) depth += 1;
		else if (')}]'.includes(ch)) {
			if (depth === 0) return src.slice(i, j);
			depth -= 1;
		} else if (ch === ',' && depth === 0) return src.slice(i, j);
	}
	return src.slice(i);
}

/** The end of the tag opened at i: the first `>` outside any `{…}`. */
function tagEnd(src: string, i: number): number {
	let depth = 0;
	for (let j = i; j < src.length; j += 1) {
		if (src[j] === '{') depth += 1;
		else if (src[j] === '}') depth -= 1;
		else if (src[j] === '>' && depth === 0) return j;
	}
	return src.length;
}

/** Every option content and aria-label value in the markup, with the name tokens it reads. */
export function nameSurfaceSites(source: string): NameSurfaceSite[] {
	const src = markupOnly(source);
	const found: Array<[number, NameSurface, string]> = [];

	for (const hit of src.matchAll(/<option\b/g)) {
		const open = tagEnd(src, hit.index);
		const close = src.indexOf('</option>', open);
		if (close !== -1) found.push([hit.index, 'option', interpolations(src.slice(open + 1, close))]);
	}
	for (const hit of src.matchAll(/(?<![\w-])(?:aria-label|ariaLabel)\s*=\s*/g)) {
		const at = hit.index + hit[0].length;
		found.push([hit.index, 'aria-label', attributeValue(src, at)]);
	}
	for (const hit of src.matchAll(/(?<![\w-])ariaLabel\s*:\s*/g)) {
		found.push([hit.index, 'aria-label', objectValue(src, hit.index + hit[0].length)]);
	}
	for (const hit of src.matchAll(/<SegmentedPill\b/g)) {
		const tag = src.slice(hit.index, tagEnd(src, hit.index));
		for (const label of tag.matchAll(/(?<![\w-])label\s*=\s*/g)) {
			const at = hit.index + label.index + label[0].length;
			found.push([hit.index + label.index, 'aria-label', attributeValue(src, at)]);
		}
	}

	return found
		.flatMap(([i, surface, value]) =>
			nameTokens(value).map((token) => ({ line: lineOf(src, i), surface, token }))
		)
		.sort((a, b) => a.line - b.line);
}
