// Template text outside m.* calls, which Paraglide never translates; scans are the guard.
const GLYPHS_ONLY = /^[▸▾▲▼≡·×✕♫№\s\-–—|(),/]+$/;
const ENTITY = /&[a-zA-Z]+;|&#\d+;/g;

export function bareTextNodes(source: string): string[] {
	let template = source
		.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
		.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
		.replace(/<!--[\s\S]*?-->/g, '');
	let prev = '';
	while (prev !== template) {
		prev = template;
		template = template.replace(/\{[^{}]*\}/g, '');
	}
	const nodes: string[] = [];
	for (const match of template.matchAll(/>([^<]+)</g)) {
		const text = match[1].trim();
		const prose = text.replace(ENTITY, '').trim();
		if (!prose || GLYPHS_ONLY.test(prose) || !/[a-zA-Z]/.test(prose)) continue;
		nodes.push(text);
	}
	return nodes;
}
