// #113 TU.5 RED — i18n pass over the CHANGED_SURFACES list below: hardcoded
// strings, locale parity, and focus-indicator hygiene (source scans only).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bareTextNodes } from '$lib/testing/bareText';
import {
	everyPatternContains,
	isMessageEmpty,
	type MessageFile
} from '$lib/testing/messageFile.js';
import { EVENT_SURFACES } from '$lib/events/eventSurfaces';
import { ROSTER_SURFACES } from '$lib/roster/rosterSurfaces';

const CHANGED_SURFACES = [
	...ROSTER_SURFACES,
	'src/lib/sections/SectionPicker.svelte',
	'src/lib/components/agenda/RepertoireElement.svelte',
	'src/routes/library/+page.svelte',
	'src/lib/components/agenda/AgendaList.svelte',
	'src/lib/components/attendance/TakeAttendanceButton.svelte',
	// The landing surface and the components its own i18n pass edited — the scan
	// is only as wide as this list.
	// #508 splits +page.svelte into the agenda/ components listed below.
	'src/routes/+page.svelte',
	'src/lib/components/attendance/AttendanceSurface.svelte',
	...EVENT_SURFACES,
	'src/lib/components/agenda/SeriesCreateForm.svelte',
	'src/lib/components/agenda/EventCreateForm.svelte',
	'src/lib/components/agenda/SeasonCreateForm.svelte',
	'src/lib/components/agenda/SeasonManagePanel.svelte',
	// #529 splits the profile page into these.
	'src/lib/profile/RosterNamesToggle.svelte',
	'src/lib/profile/ProfileStorageSection.svelte',
	// #528 splits the library page into these.
	'src/lib/library/MyLoansSection.svelte',
	'src/lib/library/BulkCheckoutPanel.svelte',
	'src/lib/library/CreateWorkForm.svelte',
	'src/lib/library/WorkRow.svelte',
	'src/lib/library/CreateEditionForm.svelte',
	'src/lib/library/EditionRow.svelte',
	'src/lib/library/CopyRow.svelte',
	'src/lib/library/EditionFiles.svelte'
] as const;

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

function readSource(relPath: string): string {
	return readFileSync(resolve(process.cwd(), relPath), 'utf-8');
}

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
describe('#113 — i18n: no hardcoded user-facing strings on TU.1–TU.4 surfaces', () => {
	for (const file of CHANGED_SURFACES) {
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

// 3 — focus-indicator hygiene on the changed surfaces

// No surface may strip the UA focus ring (WCAG 2.4.7) without a listed
// FOCUS_STRIP_EXCEPTIONS replacement (#205 gave the arrange row one).
const FOCUS_STRIP_EXCEPTIONS: Record<string, { allowed: string[]; replacement: RegExp }> = {
	'src/lib/sections/SectionArrangeRow.svelte': {
		allowed: ['focus:outline-none'],
		replacement: /focus-within:ring-2/
	}
};

describe('#113 — a11y: changed surfaces never strip the default focus indicator', () => {
	for (const file of CHANGED_SURFACES) {
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
