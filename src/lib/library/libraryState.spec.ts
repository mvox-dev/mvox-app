import { describe, it, expect } from 'vitest';
import {
	createEditionDrafts,
	createWorkForm,
	editionDraftView,
	workFormView
} from './libraryState';

describe('workFormView', () => {
	it('reads the flat work form, composer as the second field', () => {
		const error = () => 'Required';
		const form = { ...createWorkForm(), open: true, name: 'Ave', composer: 'Byrd', error };
		const { onopen, onclose, onname, onsecond, ...fields } = workFormView(form);
		expect(fields).toEqual({
			open: true,
			name: 'Ave',
			second: 'Byrd',
			error,
			pending: false,
			status: ''
		});
		expect([onopen, onclose, onname, onsecond].every((f) => typeof f === 'function')).toBe(true);
	});

	it('writes through to the form, and open/close reset it', () => {
		const form = { ...createWorkForm(), status: 'Ave created.' };
		workFormView(form).onopen();
		expect(form).toEqual({ ...createWorkForm(), open: true });
		const view = workFormView(form);
		view.onname('Ave');
		view.onsecond('Byrd');
		expect(form).toMatchObject({ name: 'Ave', composer: 'Byrd' });
		view.onclose();
		expect(form).toEqual({ ...createWorkForm() });
	});
});

describe('editionDraftView', () => {
	it('reads one work\'s draft, publisher as the second field, empty when absent', () => {
		const drafts = createEditionDrafts();
		const { onopen, onclose, onname, onsecond, ...empty } = editionDraftView(drafts, 'w1');
		expect(empty).toEqual({
			open: false,
			name: '',
			second: '',
			error: null,
			pending: false,
			status: ''
		});
		expect([onopen, onclose, onname, onsecond].every((f) => typeof f === 'function')).toBe(true);
	});

	it('writes only its own work\'s draft, and close drops it', () => {
		const drafts = createEditionDrafts();
		editionDraftView(drafts, 'w2').onopen();
		const view = editionDraftView(drafts, 'w1');
		view.onopen();
		view.onname('Urtext');
		view.onsecond('Carus');
		expect(editionDraftView(drafts, 'w1')).toMatchObject({
			open: true,
			name: 'Urtext',
			second: 'Carus'
		});
		view.onclose();
		expect([...drafts.open]).toEqual(['w2']);
		expect([...drafts.name]).toEqual([['w2', '']]);
		expect([...drafts.publisher]).toEqual([['w2', '']]);
	});
});
