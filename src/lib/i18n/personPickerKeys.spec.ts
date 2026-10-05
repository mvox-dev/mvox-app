// @vitest-environment node

// #209 picker copy: reworded add-prompts, picker_everyone_added, and the retired no-matches keys.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type MessageFile = Record<string, unknown>;

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

function messages(locale: (typeof LOCALES)[number]): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

// The four placeholder keys behind the five picker sites, with the OLD
// search-flavored values they must no longer carry (per locale).
const REWORDED: Record<string, Partial<Record<(typeof LOCALES)[number], string>>> = {
	season_conductor_placeholder: {
		en: 'Add conductor…',
		et: 'Lisa dirigent…'
	},
	event_create_conductor_placeholder: {
		en: 'Add conductor…',
		et: 'Lisa dirigent…'
	},
	admin_roles_add_admin_placeholder: {
		en: 'Add administrator…',
		et: 'Lisa administraator…'
	},
	admin_roles_add_librarian_placeholder: {
		en: 'Add librarian…',
		// The app's existing Estonian librarian term (admin_roles_add_librarian_label
		// says "Lisa noodikoguhoidja") — Gama ruling 1 says to reuse it.
		et: 'Lisa noodikoguhoidja…'
	}
};

// The retired search-flavored copy — the reword must actually happen in EVERY
// locale, not just the two whose copy Gama dictated.
const OLD_SEARCH_VALUES = new Set([
	'Search people…',
	'Search conductors…',
	'Add a conductor…',
	'Otsi inimesi…',
	'Otsi dirigenti…',
	'Meklēt cilvēkus…',
	'Meklēt diriģentu…',
	'Пошук людей…',
	'Пошук диригента…'
]);

const OBSOLETE_KEYS = [
	'season_conductor_no_matches',
	'event_create_conductor_no_matches',
	'admin_roles_empty'
];

describe('#209 — reworded add-prompt placeholders (Gama ruling 1)', () => {
	for (const [key, exact] of Object.entries(REWORDED)) {
		it(`${key}: present and non-empty in all four locales, en/et verbatim, no locale still search-flavored`, () => {
			for (const locale of LOCALES) {
				const value = messages(locale)[key];
				expect(typeof value, `${locale}.json › ${key} must be a string`).toBe('string');
				expect((value as string).trim(), `${locale}.json › ${key} must be non-empty`).not.toBe('');
				expect(
					OLD_SEARCH_VALUES.has(value as string),
					`${locale}.json › ${key} still carries the old search-flavored copy ("${String(value)}")`
				).toBe(false);
			}
			for (const locale of ['en', 'et'] as const) {
				const pinned = exact[locale];
				if (pinned) {
					expect(messages(locale)[key], `${locale}.json › ${key} (Gama's verbatim copy)`).toBe(
						pinned
					);
				}
			}
		});
	}
});

describe('#209 — picker_everyone_added, the ONE shared exhausted-state key (Gama ruling 2)', () => {
	it('exists non-empty in all four locales, en/et verbatim', () => {
		for (const locale of LOCALES) {
			const value = messages(locale)['picker_everyone_added'];
			expect(typeof value, `${locale}.json › picker_everyone_added must exist`).toBe('string');
			expect((value as string).trim()).not.toBe('');
		}
		expect(messages('en')['picker_everyone_added']).toBe('Everyone is already added');
		expect(messages('et')['picker_everyone_added']).toBe('Kõik on juba lisatud');
	});
});

describe('#209 review F1/F2 — the OTHER empty states have their own copy', () => {
	// picker_everyone_added is a claim, so loading, a failed read and an empty collective each
	// get their own key; picker_order_fallback is the section-read failure.

	it('en copy is distinct per state — four different sentences, none of them the everyone-added claim', () => {
		const en = messages('en');
		const values = [
			en['picker_everyone_added'],
			en['picker_roster_loading'],
			en['picker_roster_unavailable'],
			en['picker_no_members'],
			en['picker_order_fallback']
		];
		expect(new Set(values).size).toBe(values.length);
	});
});

describe('#209 — the combobox-only keys are retired from all four locales', () => {
	for (const key of OBSOLETE_KEYS) {
		it(`${key} is absent everywhere (no native-select equivalent; spike-verified consumer-free)`, () => {
			for (const locale of LOCALES) {
				expect(
					Object.prototype.hasOwnProperty.call(messages(locale), key),
					`${locale}.json still carries the obsolete key ${key}`
				).toBe(false);
			}
		});
	}
});

describe('#209 — the Autocomplete component is deleted, not orphaned', () => {
	it('Autocomplete.svelte and Autocomplete.spec.ts no longer exist (zero consumers once the five sites are native selects)', () => {
		const component = resolve(process.cwd(), 'src/lib/components/Autocomplete.svelte');
		const spec = resolve(process.cwd(), 'src/lib/components/Autocomplete.spec.ts');
		expect(existsSync(component), `${component} must be deleted`).toBe(false);
		expect(existsSync(spec), `${spec} must be deleted`).toBe(false);
	});
});

// (*MVOX:Tallis* — #209 RED: reworded add-prompts + picker_everyone_added +
// retired no-matches keys + Autocomplete deletion guard)
