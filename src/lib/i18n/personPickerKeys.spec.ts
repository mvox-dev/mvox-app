// @vitest-environment node
//
// #209 RED — the i18n leg of the native-person-select sweep (PO standing rule
// 1; Gama rulings 1+2, issue comment 2026-09-02). This spec reads the RAW
// message files (messages/*.json), not the compiled Paraglide output, because
// the contract is about the FILES: which keys exist, which are retired, and
// the exact en/et copy Gama ruled verbatim.
//
// Contract:
//   RULING 1 — the four EXISTING placeholder keys (season_conductor_placeholder
//   serves both the season-manage panel and the season-create form, so five
//   picker sites share four keys) are REWORDED to add-prompts in all four
//   locales — a native select's first option is a prompt, not a search hint.
//   en/et copy is Gama's verbatim; lv/uk are natural translations, pinned here
//   only as "present, non-empty, and no longer the old search-flavored string".
//   No new placeholder keys.
//   RULING 2 — ONE new shared key `picker_everyone_added` (en "Everyone is
//   already added", et "Kõik on juba lisatud") in all four locales.
//   RETIREMENT — the combobox-only empty-filter keys have no native-select
//   equivalent and no other consumer (verified in the #209 spike):
//   season_conductor_no_matches, event_create_conductor_no_matches,
//   admin_roles_empty leave ALL FOUR locale files.
//   COMPONENT — Autocomplete.svelte has zero consumers once the five sites are
//   selects (spike-verified); the component and its spec are DELETED, not left
//   as dead code.
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
	// `picker_everyone_added` is a factual claim, and it was being made for
	// three states that had established nothing: a roster read still in flight,
	// a roster read that FAILED, and a collective with no members at all. Each
	// gets its own key; `picker_order_fallback` is the section-read failure,
	// where the picker still works but no longer in roster order.
	for (const key of [
		'picker_roster_loading',
		'picker_roster_unavailable',
		'picker_no_members',
		'picker_order_fallback'
	]) {
		it(`${key} exists non-empty in all four locales`, () => {
			for (const locale of LOCALES) {
				const value = messages(locale)[key];
				expect(typeof value, `${locale}.json › ${key} must exist`).toBe('string');
				expect((value as string).trim(), `${locale}.json › ${key} must be non-empty`).not.toBe('');
			}
		});
	}

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
