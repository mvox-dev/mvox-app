// #113 TU.5 RED — i18n pass over every surface TU.1–TU.4 (#109–#112) touched:
//
//   - src/routes/roster/+page.svelte           (TU.1/TU.2 — section creation
//     threading, reorder spinner, empty-section remove + two-step confirm,
//     collapse-all/expand-all, dashed drop-target hint)
//   - src/lib/sections/SectionPicker.svelte    (TU.1 — org-scoped duplicate
//     check; the create form's labels)
//   - src/lib/components/agenda/RepertoireElement.svelte (TU.3 — separators,
//     unified status/actions row, native selects)
//   - src/routes/library/+page.svelte          (TU.4 — copy-list sort controls)
//   - src/lib/components/agenda/AgendaList.svelte + TakeAttendanceButton.svelte
//     (TU.4 — hide-while-open wiring around the attendance entry point)
//
// Pure source scans — no rendering. Three families:
//   1. no hardcoded user-visible text: every bare text node and every
//      aria-label/title/placeholder must come from a Paraglide m.* call;
//   2. locale parity: every m.* key a scanned file actually uses exists,
//      non-empty, in ALL FOUR locale files (en, et, lv, uk) — and the
//      parameterised remove-confirmation labels carry {name} everywhere;
//   3. focus-indicator hygiene: none of the changed surfaces may strip the
//      browser's default focus ring (`outline-none`) — these files define no
//      replacement focus style, so removing the default would leave keyboard
//      users with NO visible focus indicator at all (WCAG 2.4.7).
//
// Follows the #86/#93/#99 source-scan precedent (page.sections-a11y.spec.ts).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	everyPatternContains,
	isMessageEmpty,
	type MessageFile
} from '$lib/testing/messageFile.js';

const CHANGED_SURFACES = [
	'src/routes/roster/+page.svelte',
	'src/lib/sections/SectionPicker.svelte',
	'src/lib/components/agenda/RepertoireElement.svelte',
	'src/routes/library/+page.svelte',
	'src/lib/components/agenda/AgendaList.svelte',
	'src/lib/components/attendance/TakeAttendanceButton.svelte',
	// #113 review F3 — the files THIS pass itself edits. They were missing from
	// the list, so the scan below never ran against them and a hardcoded English
	// "Switch collective" (plus the whole signed-in/signed-out fallback block)
	// sat untranslated on the app's landing surface. The scan is the right tool;
	// it was pointed at the wrong set.
	//
	// #113 review F2 — the third edited file, event/[id]/+page.svelte (the
	// closeAttendancePanel focus-return), was still missing after that fix, so
	// the focus-indicator family never ran against the surface that owns the
	// pass's own focus-management story. It carried five `focus:outline-none`
	// edit-in-place inputs (#105 debt) with no replacement focus style — all
	// programmatically focused via use:focusOnMount, i.e. invisible keyboard
	// focus exactly where focus is placed for you. Stripped; the UA ring stands.
	'src/routes/+page.svelte',
	'src/lib/components/attendance/AttendanceSurface.svelte',
	'src/routes/event/[id]/+page.svelte'
] as const;

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

function readSource(relPath: string): string {
	return readFileSync(resolve(process.cwd(), relPath), 'utf-8');
}

/** Bare (non-expression) text nodes in a Svelte template — the established
 *  #86/#93/#99 helper: strip script blocks, HTML comments and Svelte
 *  expressions; anything left with letters in it is a hardcoded user-facing
 *  string. Glyph-only nodes (carets, drag handle, arrows, separators, ✕) are
 *  allowed — they must be aria-hidden or labelled, which the DOM specs check;
 *  they are not TRANSLATABLE strings. */
function bareTextNodes(source: string): string[] {
	let template = source.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
	template = template.replace(/<!--[\s\S]*?-->/g, '');
	let prev = '';
	while (prev !== template) {
		prev = template;
		template = template.replace(/\{[^{}]*\}/g, '');
	}
	const nodes: string[] = [];
	const textNodePattern = />([^<]+)</g;
	let match: RegExpExecArray | null;
	while ((match = textNodePattern.exec(template)) !== null) {
		const text = match[1].trim();
		if (!text) continue;
		if (/^[▸▾▲▼≡·×✕♫№\s\-–—|(),/]+$/.test(text)) continue;
		if (/^(&[a-zA-Z]+;|&#\d+;)+$/.test(text)) continue;
		if (!/[a-zA-Z]/.test(text)) continue;
		nodes.push(text);
	}
	return nodes;
}

/** Every Paraglide message key the file's CODE references (comments stripped —
 *  a prose mention of a key is not a usage). Catches both call (`m.key(...)`)
 *  and function-reference (`label: m.key`) forms. */
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

// Values are `string | MessageVariant[]` — plural messages are variant arrays,
// so every assertion below goes through the messageFile helpers rather than
// calling string methods on the raw value.
function localeMessages(locale: string): MessageFile {
	return JSON.parse(readSource(`messages/${locale}.json`)) as MessageFile;
}

// ---------------------------------------------------------------------------
// 1 — no hardcoded user-visible strings on any changed surface
// ---------------------------------------------------------------------------
describe('#113 — i18n: no hardcoded user-facing strings on TU.1–TU.4 surfaces', () => {
	for (const file of CHANGED_SURFACES) {
		it(`${file} renders no bare text nodes outside m.* calls`, () => {
			expect(bareTextNodes(readSource(file))).toEqual([]);
		});

		it(`${file} has no hardcoded aria-label/title/placeholder string literals`, () => {
			// A literal `aria-label="Remove section"` bypasses Paraglide entirely —
			// labels must be bound expressions ({m.*(...)}), never quoted strings.
			const hardcoded =
				readSource(file).match(/(?:aria-label|title|placeholder)="[^"]*[a-zA-Z][^"]*"/g) ?? [];
			expect(hardcoded).toEqual([]);
		});
	}
});

// ---------------------------------------------------------------------------
// 2 — locale parity: every used key exists in ALL FOUR locale files
// ---------------------------------------------------------------------------
describe('#113 — i18n: every message key used by a changed surface exists in all four locales', () => {
	for (const file of CHANGED_SURFACES) {
		it(`every m.* key in ${file} is present and non-empty in en, et, lv and uk`, () => {
			const keys = usedMessageKeys(readSource(file));
			expect(keys.length, `${file} should reference at least one m.* key`).toBeGreaterThan(0);
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

	it('the TU.4 copy-sort labels exist in ALL four locales (group label + the three key labels)', () => {
		for (const locale of LOCALES) {
			const messages = localeMessages(locale);
			for (const key of [
				'library_copy_sort_label',
				'library_copy_sort_nr',
				'library_copy_sort_member',
				'library_copy_sort_since'
			]) {
				expect(isMessageEmpty(messages[key]), `${locale}.json ${key}`).toBe(false);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// 3 — focus-indicator hygiene on the changed surfaces
// ---------------------------------------------------------------------------
describe('#113 — a11y: changed surfaces never strip the default focus indicator', () => {
	for (const file of CHANGED_SURFACES) {
		it(`${file} contains no outline-none (no replacement focus style exists on these surfaces)`, () => {
			const offenders = readSource(file).match(/[\w:-]*outline-none/g) ?? [];
			expect(offenders).toEqual([]);
		});
	}
});

// (*MVOX:Tallis*)
