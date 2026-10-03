// @vitest-environment happy-dom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import RepertoireElement from './RepertoireElement.svelte';
import type { WorkRow } from '$lib/repertoire/types';
import { messagePatterns, type MessageFile } from '$lib/testing/messageFile.js';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
);

afterEach(cleanup);

let rowSeq = 0;
function row(overrides: Partial<WorkRow> = {}): WorkRow {
	return {
		id: `pi-${++rowSeq}`,
		kind: 'program',
		workId: 'work-1',
		editionId: 'ed-1',
		workName: 'Spem in alium',
		composer: 'Thomas Tallis',
		status: null,
		editionName: '40-part original',
		ordinal: 0,
		fileId: '',
		fileName: '',
		externalLinks: [],
		canBorrow: false,
		notes: '',
		...overrides
	};
}

const EDITIONS = [
	{ id: 'ed-9', label: 'Spem in alium - Thomas Tallis — 40-part original' },
	{ id: 'ed-10', label: 'Old warhorse — Eulenburg' }
];

function renderProgrammeEditor(
	pickableEditions: Array<{ id: string; label: string }>,
	extra: Record<string, unknown> = {}
) {
	return render(RepertoireElement, {
		props: {
			rows: [row()],
			expanded: true,
			context: 'programme',
			eventRights: 'editor',
			pickableEditions,
			...extra
		}
	});
}

const WRAPPER = '[data-testid="work-manage-add-programme"]';
const SELECT = '[data-testid="work-manage-add-programme-select"]';
const BUTTON = '[data-testid="work-manage-add-programme-button"]';

describe('#272 — "Add to programme" link visibility follows the selection', () => {
	it('with NOTHING selected the button is ABSENT from the DOM — hidden, not disabled', () => {
		const { container } = renderProgrammeEditor(EDITIONS);
		expect(container.querySelector(SELECT), 'the select renders (it has content)').not.toBeNull();
		expect(
			container.querySelector(BUTTON),
			'no edition selected → the button must not be in the DOM at all (a disabled button is the old, ruled-out shape)'
		).toBeNull();
	});

	it('selecting an edition makes the button APPEAR — enabled, not merely un-disabled', async () => {
		const { container } = renderProgrammeEditor(EDITIONS);
		await fireEvent.change(container.querySelector(SELECT)!, { target: { value: 'ed-9' } });
		const button = container.querySelector(BUTTON) as HTMLButtonElement | null;
		expect(button, 'edition selected → the button appears').not.toBeNull();
		expect(button!.disabled).toBe(false);
	});

	it("returning the selection to the placeholder ('') hides the button again", async () => {
		const { container } = renderProgrammeEditor(EDITIONS);
		await fireEvent.change(container.querySelector(SELECT)!, { target: { value: 'ed-9' } });
		expect(container.querySelector(BUTTON)).not.toBeNull();
		await fireEvent.change(container.querySelector(SELECT)!, { target: { value: '' } });
		expect(
			container.querySelector(BUTTON),
			"selection back to '' → the button leaves the DOM again"
		).toBeNull();
	});

	it('after a successful add the handler resets the selection — button gone, placeholder restored (handler behaviour itself unchanged)', async () => {
		const onaddprogramitem = vi.fn();
		const { container } = renderProgrammeEditor(EDITIONS, { onaddprogramitem });
		await fireEvent.change(container.querySelector(SELECT)!, { target: { value: 'ed-9' } });
		await fireEvent.click(container.querySelector(BUTTON)!);
		expect(onaddprogramitem).toHaveBeenCalledWith('ed-9', 1);
		expect(container.querySelector(BUTTON), 'post-add: selection reset → button hidden').toBeNull();
		expect((container.querySelector(SELECT) as HTMLSelectElement).value).toBe('');
	});
});

describe('#272 — the edition dropdown renders only when it has content', () => {
	it('pickableEditions EMPTY → NO select and NO button; the wrapper itself stays (the gate is on the dropdown, not the block)', () => {
		const { container } = renderProgrammeEditor([]);
		expect(
			container.querySelector(WRAPPER),
			'the work-manage-add-programme wrapper is pinned present elsewhere with an empty list — the gate must NOT move onto it'
		).not.toBeNull();
		expect(
			container.querySelector(SELECT),
			'nothing to pick → a placeholder-only dropdown must not render'
		).toBeNull();
		expect(container.querySelector(BUTTON)).toBeNull();
	});

	it('pickableEditions non-empty → the select renders with the placeholder plus one option per edition (guard)', () => {
		const { container } = renderProgrammeEditor(EDITIONS);
		const select = container.querySelector(SELECT) as HTMLSelectElement;
		expect(select).not.toBeNull();
		const labels = [...select.querySelectorAll('option')].map((o) => (o.textContent ?? '').trim());
		expect(labels).toEqual(['[repertoire_add_programme_label]', EDITIONS[0].label, EDITIONS[1].label]);
	});

	it('FIRST-program_item fence: an EVENT editor on the season-repertoire fallback with an EMPTY pickable list still gets the wrapper — select absent, nothing crashes', () => {
		const { container } = render(RepertoireElement, {
			props: {
				rows: [row({ id: 'ri-fallback', kind: 'repertoire', status: 'active', ordinal: null })],
				expanded: true,
				context: 'repertoire',
				seasonRights: 'not-editor',
				eventRights: 'editor',
				pickableEditions: []
			}
		});
		expect(container.querySelector(WRAPPER)).not.toBeNull();
		expect(container.querySelector(SELECT)).toBeNull();
		expect(container.querySelector(BUTTON)).toBeNull();
	});
});

describe('#272 — programme-control wording (messages/*.json, all four locales)', () => {
	const read = (locale: string): MessageFile =>
		JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')) as MessageFile;

	const EXPECTED: Record<string, Record<string, string>> = {
		en: {
			repertoire_add_programme_label: 'Select edition',
			repertoire_add_programme_button: 'Add to programme',
			repertoire_add_programme_select_aria_label: 'Select edition',
			repertoire_add_programme_aria_label: 'Add to programme: the selected edition'
		},
		et: {
			repertoire_add_programme_label: 'Vali väljaanne',
			repertoire_add_programme_button: 'Lisa kavasse',
			repertoire_add_programme_select_aria_label: 'Vali väljaanne',
			repertoire_add_programme_aria_label: 'Lisa kavasse: valitud väljaanne'
		},
		lv: {
			repertoire_add_programme_label: 'Izvēlieties izdevumu',
			repertoire_add_programme_button: 'Pievienot programmai',
			repertoire_add_programme_select_aria_label: 'Izvēlieties izdevumu',
			repertoire_add_programme_aria_label: 'Pievienot programmai: izvēlētais izdevums'
		},
		uk: {
			repertoire_add_programme_label: 'Виберіть видання',
			repertoire_add_programme_button: 'Додати до програми',
			repertoire_add_programme_select_aria_label: 'Виберіть видання',
			repertoire_add_programme_aria_label: 'Додати до програми: вибране видання'
		}
	};

	for (const [locale, expected] of Object.entries(EXPECTED)) {
		it(`${locale}: the four programme-control keys carry the new wording exactly`, () => {
			const messages = read(locale);
			for (const [key, value] of Object.entries(expected)) {
				expect(messages[key], `${locale}.json ${key}`).toBe(value);
			}
		});
	}

	it('neither aria-label claims a date in any locale — the surface renders for ANY event, not tonight\'s', () => {
		const DATE_CLAIMS = ['tonight', 'tänase', 'Tänase', 'vakara', 'сьогодні'];
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const messages = read(locale);
			for (const key of [
				'repertoire_add_programme_select_aria_label',
				'repertoire_add_programme_aria_label'
			]) {
				for (const pattern of messagePatterns(messages[key])) {
					for (const claim of DATE_CLAIMS) {
						expect(
							pattern.includes(claim),
							`${locale}.json ${key} ("${pattern}") still claims a date ("${claim}")`
						).toBe(false);
					}
				}
			}
		}
	});

	it("Label in Name, locally: the button's aria-label CONTAINS the visible button text verbatim in every locale (the standing a11y guard must stay green over the new copy)", () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const messages = read(locale);
			const visible = messagePatterns(messages['repertoire_add_programme_button']);
			const aria = messagePatterns(messages['repertoire_add_programme_aria_label']);
			expect(visible.length).toBeGreaterThan(0);
			expect(aria.length).toBeGreaterThan(0);
			for (const a of aria) {
				expect(
					visible.some((v) => a.includes(v)),
					`${locale}.json repertoire_add_programme_aria_label ("${a}") does not contain the visible button text`
				).toBe(true);
			}
		}
	});
});

// (*MVOX:Tallis* — #272 RED: programme control — conditional select + link, new wording)
// (*MVOX:Josquin* — #288 review F2: the select aria-label contract, as superseded)
