// What a copy is called in lists: its name, else its number, else the unknown text.
import { describe, expect, it } from 'vitest';
import { m } from '$lib/paraglide/messages.js';
import { copyLabel } from './libraryData';
import type { Copy } from './libraryReads';

const copy = (over: Partial<Copy>): Copy => ({ id: 'c1', editionId: 'e1', name: '', copyNumber: 0, ...over }) as Copy;

describe('copyLabel', () => {
	it('uses the name when there is one', () => {
		expect(copyLabel(copy({ name: 'Blue binder', copyNumber: 3 }))).toBe('Blue binder');
	});

	it('uses #N when there is a number but no name', () => {
		expect(copyLabel(copy({ copyNumber: 3 }))).toBe('#3');
	});

	it('uses the unknown text with neither', () => {
		expect(copyLabel(copy({}))).toBe(m.library_copy_name_unknown());
	});
});
