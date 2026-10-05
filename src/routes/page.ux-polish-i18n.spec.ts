// Source scans over every .svelte file: hardcoded strings, locale parity, focus indicators.
import { describe, expect, it } from 'vitest';
import { bareTextNodes } from '$lib/testing/bareText';
import {
	everyPatternContains,
	isMessageEmpty,
	type MessageFile
} from '$lib/testing/messageFile.js';
import { svelteSurfaces } from '$lib/testing/svelteSurfaces';
import { findSourceFiles } from '$lib/testing/soleLiteralGuard';
import { LOCALES } from '$lib/testing/pages/profile';
import { readSource } from '$lib/testing/pages/files';

const SURFACES = svelteSurfaces();

/** The .ts modules that import the messages: keys used outside a component. */
const MESSAGE_MODULES = findSourceFiles('src', ['.ts'], { excludeSpecs: true })
	.filter((file) => !file.startsWith('src/lib/testing/') && !file.startsWith('src/lib/paraglide/'))
	.filter((file) => readSource(file).includes('paraglide/messages'))
	.sort();

/** Every m.* key the file's CODE references (comments stripped first). */
function usedMessageKeys(source: string): string[] {
	let code = source.replace(/<!--[\s\S]*?-->/g, '');
	code = code.replace(/\/\*[\s\S]*?\*\//g, '');
	code = code.replace(/^[ \t]*\/\/.*$/gm, '');
	const keys = new Set<string>();
	const pattern = /\bm\.([a-z][a-zA-Z0-9_]*)/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(code)) !== null) keys.add(match[1]);
	return [...keys].sort();
}

// Messages are `string | MessageVariant[]`, so assertions use messageFile helpers.
function localeMessages(locale: string): MessageFile {
	return JSON.parse(readSource(`messages/${locale}.json`)) as MessageFile;
}

// 1 — no hardcoded user-visible strings on any changed surface
describe('#113 — i18n: no hardcoded user-facing strings on any surface', () => {
	for (const file of SURFACES) {
		it(`${file} renders no bare text nodes outside m.* calls`, () => {
			expect(bareTextNodes(readSource(file))).toEqual([]);
		});

		it(`${file} has no hardcoded aria-label/title/placeholder string literals`, () => {
			// A literal aria-label/title/placeholder bypasses Paraglide — must be m.*.
			const hardcoded =
				readSource(file).match(/(?:aria-label|title|placeholder)="[^"]*[a-zA-Z][^"]*"/g) ?? [];
			expect(hardcoded).toEqual([]);
		});
	}
});

// 2 — locale parity: every used key exists in ALL FOUR locale files
describe('#113 — i18n: every message key used by a surface exists in all four locales', () => {
	it('the surfaces include every route page, and the modules are found', () => {
		expect(SURFACES).toEqual(expect.arrayContaining(findSourceFiles('src/routes', ['/+page.svelte'])));
		expect(MESSAGE_MODULES.length).toBeGreaterThan(0);
	});

	it('the four locale files carry the same keys, none empty', () => {
		const en = Object.keys(localeMessages('en')).sort();
		for (const locale of LOCALES) {
			const messages = localeMessages(locale);
			expect(Object.keys(messages).sort(), `${locale}.json keys`).toEqual(en);
			const empty = en.filter((k) => k !== '$schema' && isMessageEmpty(messages[k]));
			expect(empty, `${locale}.json empty values`).toEqual([]);
		}
	});

	for (const file of [...SURFACES, ...MESSAGE_MODULES]) {
		it(`every m.* key in ${file} is present and non-empty in en, et, lv and uk`, () => {
			const keys = usedMessageKeys(readSource(file));
			for (const locale of LOCALES) {
				const messages = localeMessages(locale);
				const missing = keys.filter((k) => !(k in messages));
				expect(missing, `${locale}.json is missing keys used by ${file}`).toEqual([]);
				const empty = keys.filter((k) => k in messages && isMessageEmpty(messages[k]));
				expect(empty, `${locale}.json has empty values for keys used by ${file}`).toEqual([]);
			}
		});
	}

	it('the TU.2 remove-confirmation labels carry {name} in ALL four locales — a label that drops the param collapses every section to the same announcement', () => {
		for (const locale of LOCALES) {
			const messages = localeMessages(locale);
			for (const key of [
				'roster_section_remove',
				'roster_section_remove_confirm',
				'roster_section_remove_cancel',
				'roster_section_remove_failed',
				'roster_section_remove_not_empty'
			]) {
				expect(
					everyPatternContains(messages[key], '{name}'),
					`${locale}.json ${key} must carry {name} in every variant`
				).toBe(true);
			}
		}
	});
});

// 3 — focus-indicator hygiene on every surface

// No surface may strip the UA focus ring (WCAG 2.4.7) without a listed
// FOCUS_STRIP_EXCEPTIONS replacement (#205 gave the arrange row one).
const FOCUS_STRIP_EXCEPTIONS: Record<string, { allowed: string[]; replacement: RegExp }> = {
	'src/lib/sections/SectionArrangeRow.svelte': {
		allowed: ['focus:outline-none'],
		replacement: /focus-within:ring-2/
	}
};

describe('#113 — a11y: no surface strips the default focus indicator', () => {
	for (const file of SURFACES) {
		it(`${file} strips no focus indicator without a replacement`, () => {
			const source = readSource(file);
			const offenders = source.match(/[\w:-]*outline-none/g) ?? [];
			const exception = FOCUS_STRIP_EXCEPTIONS[file];

			if (!exception) {
				expect(offenders).toEqual([]);
				return;
			}
			expect(offenders, `${file}: only the itemised strips are allowed`).toEqual(
				exception.allowed
			);
			expect(
				source,
				`${file}: strips the default outline, so the replacement focus indicator must be present`
			).toMatch(exception.replacement);
		});
	}
});

// (*MVOX:Tallis*; #205's focus-strip exception *MVOX:Josquin*)
