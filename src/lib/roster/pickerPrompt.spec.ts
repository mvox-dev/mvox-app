// The one member-picker prompt the agenda and /admin share (#617).
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

import { pickerPromptText } from './pickerPrompt';

const settled = { failed: false, loading: false, rowCount: 3 };

describe('pickerPromptText', () => {
	it('offers the add prompt whenever there is someone to pick, whatever the read state', () => {
		expect(pickerPromptText(2, 'Add…', settled)).toBe('Add…');
		expect(pickerPromptText(2, 'Add…', { ...settled, loading: true })).toBe('Add…');
		expect(pickerPromptText(2, 'Add…', { ...settled, failed: true })).toBe('Add…');
	});

	it('with no options, says which empty this is: failed, loading, no members, everyone added', () => {
		expect(pickerPromptText(0, 'Add…', { failed: true, loading: true, rowCount: 0 })).toBe(
			'picker_roster_unavailable'
		);
		expect(pickerPromptText(0, 'Add…', { failed: false, loading: true, rowCount: 0 })).toBe(
			'picker_roster_loading'
		);
		expect(pickerPromptText(0, 'Add…', { ...settled, rowCount: 0 })).toBe('picker_no_members');
		expect(pickerPromptText(0, 'Add…', settled)).toBe('picker_everyone_added');
	});
});

// (*MVOX:Josquin*)
