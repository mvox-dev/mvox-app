// @vitest-environment happy-dom
// What a my-loans row is called, and the reads behind it: one per copy, one per edition.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '$lib/paraglide/runtime';
import { json, testCfg } from '$lib/testing/entuFetchKit';
import {
	heldLoanCopy,
	loanCopyLabel,
	resolveLoanCopies,
	type LoanCopy
} from './libraryData';
import type { Copy, Edition, Work } from './libraryReads';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

const cfg = testCfg('testdb');
const WORKS: Work[] = [{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }];

const copyWire = (number: number, edition = 'edition-1', name = '') => ({
	entity: {
		...(name ? { name: [{ string: name }] } : {}),
		copy_number: [{ number }],
		_parent: edition ? [{ reference: edition, entity_type: 'edition' }] : []
	}
});
const editionWire = (name: string, work = 'work-1') => ({
	entity: { name: [{ string: name }], _parent: [{ reference: work, entity_type: 'work' }] }
});

// Answers entity/<id> from the table; any id not in it answers 404.
function wire(entities: Record<string, unknown>) {
	return vi.fn(async (input: RequestInfo | URL) => {
		const id = /entity\/([^?]*)/.exec(String(input))?.[1] ?? '';
		return id in entities ? json(entities[id]) : json({ message: 'not found' }, 404);
	});
}

function readsOf(fetchImpl: ReturnType<typeof wire>, id: string): string[] {
	return fetchImpl.mock.calls.map((c) => String(c[0])).filter((u) => u.includes(`entity/${id}?`));
}

const loanCopy = (over: Partial<LoanCopy['chain']> = {}, name = 'No. 3'): LoanCopy => ({
	name,
	chain: { copyNumber: 3, workName: 'Spem in alium', editionName: '40-part original', ...over }
});

afterEach(() => {
	setLocale('en', { reload: false });
});

describe('#980 each loaned copy is read once', () => {
	it('one read per copy gives both its name and its chain; a shared edition is read once', async () => {
		const fetchImpl = wire({
			'copy-1': copyWire(3, 'edition-1', 'Blue binder'),
			'copy-2': copyWire(4),
			'edition-1': editionWire('40-part original')
		});
		const { resolved, failed } = await resolveLoanCopies(
			cfg, ['copy-1', 'copy-2', 'copy-1'], WORKS, fetchImpl
		);

		expect(failed).toEqual([]);
		expect(readsOf(fetchImpl, 'copy-1')).toHaveLength(1);
		expect(readsOf(fetchImpl, 'copy-2')).toHaveLength(1);
		expect(readsOf(fetchImpl, 'edition-1')).toHaveLength(1);
		expect(resolved.get('copy-1')).toEqual<LoanCopy>({
			name: 'Blue binder',
			chain: { copyNumber: 3, workName: 'Spem in alium', editionName: '40-part original' }
		});
		expect(resolved.get('copy-2')).toEqual<LoanCopy>({
			name: 'No. 4',
			chain: { copyNumber: 4, workName: 'Spem in alium', editionName: '40-part original' }
		});
	});
});

describe('#979 one unreadable copy leaves the others resolved', () => {
	it('a copy that answers 404 is a failure; the other copy still resolves', async () => {
		const fetchImpl = wire({ 'copy-1': copyWire(3), 'edition-1': editionWire('40-part original') });
		const { resolved, failed } = await resolveLoanCopies(cfg, ['copy-1', 'copy-gone'], WORKS, fetchImpl);

		expect([...resolved.keys()]).toEqual(['copy-1']);
		expect(failed).toHaveLength(1);
		expect(String(failed[0])).toMatch(/copy-gone.*404/);
	});

	it('an unreadable edition keeps the copy by its name, and is a failure', async () => {
		const fetchImpl = wire({ 'copy-1': copyWire(3, 'edition-gone') });
		const { resolved, failed } = await resolveLoanCopies(cfg, ['copy-1'], WORKS, fetchImpl);

		expect(resolved.get('copy-1')).toEqual<LoanCopy>({
			name: 'No. 3',
			chain: { copyNumber: 3, workName: '', editionName: '' }
		});
		expect(failed).toHaveLength(1);
		expect(String(failed[0])).toMatch(/edition-gone.*404/);
	});

	it('an edition whose work is not in the works list leaves the work name empty', async () => {
		const fetchImpl = wire({ 'copy-1': copyWire(3), 'edition-1': editionWire('Urtext', 'work-9') });
		const { resolved } = await resolveLoanCopies(cfg, ['copy-1'], WORKS, fetchImpl);

		expect(resolved.get('copy-1')?.chain).toEqual({ copyNumber: 3, workName: '', editionName: 'Urtext' });
	});

	it('an empty id is a failure, never an entry and never an entity/ read', async () => {
		const fetchImpl = wire({});
		const { resolved, failed } = await resolveLoanCopies(cfg, [''], WORKS, fetchImpl);

		expect(resolved.size).toBe(0);
		expect(failed).toHaveLength(1);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

describe('#981 a loan label never shows empty parts', () => {
	it('with the whole chain, the label names copy, work and edition', () => {
		expect(loanCopyLabel(loanCopy())).toBe('Copy no. 3 — Spem in alium / 40-part original');
	});

	it('without a copy number, the label is work and edition only', () => {
		const label = loanCopyLabel(loanCopy({ copyNumber: 0 }));
		expect(label).toBe('Spem in alium / 40-part original');
	});

	it('with the edition missing, the label is the copy name', () => {
		expect(loanCopyLabel(loanCopy({ editionName: '', workName: '' }, 'Blue binder'))).toBe('Blue binder');
	});

	it('with the work missing, the label is the copy name', () => {
		expect(loanCopyLabel(loanCopy({ workName: '' }, 'No. 3'))).toBe('No. 3');
	});

	it('with the chain and the name both missing, the label is "Untitled copy"', () => {
		expect(loanCopyLabel(loanCopy({ editionName: '' }, ''))).toBe('Untitled copy');
	});

	it('a held copy with no edition reads by its own name', () => {
		const held: Copy = { id: 'c-1', name: '', copyNumber: 3, editionId: '' };
		expect(loanCopyLabel(heldLoanCopy(held, new Map(), new Map()))).toBe('No. 3');
	});

	it('a held copy with its edition and work reads as the whole chain', () => {
		const held: Copy = { id: 'c-1', name: '', copyNumber: 3, editionId: 'edition-1' };
		const edition = { id: 'edition-1', name: '40-part original', workId: 'work-1' } as Edition;
		const label = loanCopyLabel(
			heldLoanCopy(held, new Map([['edition-1', edition]]), new Map([['work-1', WORKS[0]]]))
		);
		expect(label).toBe('Copy no. 3 — Spem in alium / 40-part original');
	});
});

describe('#976 loan labels are in the user’s language', () => {
	it('in Estonian the label reads as Estonian', () => {
		setLocale('et', { reload: false });
		expect(loanCopyLabel(loanCopy())).toBe('Eksemplar nr 3 — Spem in alium / 40-part original');
		expect(loanCopyLabel(loanCopy({ copyNumber: 0 }))).toBe('Spem in alium / 40-part original');
		expect(loanCopyLabel(loanCopy({ editionName: '' }, ''))).toBe('Nimetu koopia');
	});

	it('in Estonian a copy known only by its number reads "Nr 3"', async () => {
		setLocale('et', { reload: false });
		const fetchImpl = wire({ 'copy-1': copyWire(3, '') });
		const { resolved } = await resolveLoanCopies(cfg, ['copy-1'], WORKS, fetchImpl);
		expect(loanCopyLabel(resolved.get('copy-1')!)).toBe('Nr 3');
	});
});

// (*MVOX:Josquin*)
