import { describe, expect, it } from 'vitest';
import { bareTextNodes } from './bareText';

describe('bareTextNodes', () => {
	it('reports literal prose between tags', () => {
		expect(bareTextNodes('<p>Try again</p><span>{m.ok()}</span>')).toEqual(['Try again']);
	});

	it('reads no script block as template, <script module> included', () => {
		const source =
			'<script module>\nconst a = "<b>x</b>";\n</script>\n' +
			'<script>\nlet b = 1;\n</script>\n<p>{b}</p>';
		expect(bareTextNodes(source)).toEqual([]);
	});

	it('reads no style block or html comment as template', () => {
		const source = '<style>\na > b { color: red; }\n</style><!-- <b>note</b> --><p></p>';
		expect(bareTextNodes(source)).toEqual([]);
	});

	it('skips glyph-only, entity-only and entity-plus-glyph nodes', () => {
		const glyphs = '▸▾▲▼≡·×✕♫№-–—|(),/';
		const source = `<i>${glyphs}</i><i>&times;</i><i>&nbsp;—</i><i>&#8212;</i>`;
		expect(bareTextNodes(source)).toEqual([]);
	});

	it('an entity next to prose does not hide the prose', () => {
		expect(bareTextNodes('<p>&nbsp;Sign in</p>')).toEqual(['&nbsp;Sign in']);
	});
});
