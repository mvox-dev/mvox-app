import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import type { MyProfile } from '$lib/profile/profileData';
import {
	listWorks,
	listEditions,
	listAllEditions,
	listCopies,
	listLendings,
	resolveBorrowerNames,
	resolveCopyNames,
	deriveCopyAvailability,
	deriveEditionAvailability,
	deriveWorkAvailability,
	activeLendingForMemberInEdition,
	type Work,
	type Edition,
	type Copy,
	type Lending,
	type CopyAvailability
} from './libraryData';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	resetTypeIdCache();
});

// ── listWorks ──────────────────────────────────────────────────────────────

describe('listWorks', () => {
	it('maps name,composer into Work[]', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'work-1', name: [{ string: 'Spem in alium' }], composer: [{ string: 'Thomas Tallis' }] },
					{ _id: 'work-2', name: [{ string: 'Ave verum corpus' }] } // no composer
				]
			})
		);
		const works = await listWorks(cfg, fetchImpl);
		expect(works).toEqual<Work[]>([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' },
			{ id: 'work-2', name: 'Ave verum corpus', composer: '' }
		]);
	});

	it('URL: _type.string=work, props=name,composer, limit=500 — never a private field', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listWorks(cfg, fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=work');
		expect(url).toContain('props=name,composer');
		expect(url).toContain('limit=500');
		expect(url).not.toMatch(/\bgenre\b/);
	});

	it('fails loud on non-2xx', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(listWorks(cfg, fetchImpl)).rejects.toThrow(/500/);
	});
});

// ── listEditions ───────────────────────────────────────────────────────────

describe('listEditions', () => {
	it('maps name,publisher into Edition[], scoped by _parent.reference=workId', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'edition-1', name: [{ string: '40-part original' }], publisher: [{ string: 'Bärenreiter' }] }
				]
			})
		);
		const editions = await listEditions(cfg, 'work-1', fetchImpl);
		expect(editions).toEqual<Edition[]>([
			{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }
		]);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=edition');
		expect(url).toContain('_parent.reference=work-1');
		expect(url).toContain('props=name,publisher');
		expect(url).not.toMatch(/\bcost\b/);
	});
});

// ── listAllEditions ───────────────────────────────────────────────────────

describe('listAllEditions', () => {
	it('maps name,publisher,_parent into Edition[] with workId from _parent[0].reference', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'edition-1',
						name: [{ string: '40-part original' }],
						publisher: [{ string: 'Bärenreiter' }],
						_parent: [{ reference: 'work-1', entity_type: 'work' }]
					},
					{
						_id: 'edition-2',
						name: [{ string: 'Peters arrangement' }],
						_parent: [{ reference: 'work-2', entity_type: 'work' }]
					}
				]
			})
		);
		const editions = await listAllEditions(cfg, fetchImpl);
		expect(editions).toEqual<Edition[]>([
			{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter', workId: 'work-1' },
			{ id: 'edition-2', name: 'Peters arrangement', publisher: '', workId: 'work-2' }
		]);
	});

	it('URL: _type.string=edition, props includes _parent, limit=500 — never a private field', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listAllEditions(cfg, fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=edition');
		expect(url).toContain('props=name,publisher,_parent');
		expect(url).toContain('limit=500');
		expect(url).not.toMatch(/\bcost\b/);
	});

	it('fails loud on non-2xx', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(listAllEditions(cfg, fetchImpl)).rejects.toThrow(/500/);
	});
});

// ── listCopies ─────────────────────────────────────────────────────────────

describe('listCopies', () => {
	it('maps name,copy_number into Copy[], scoped by _parent.reference=editionId', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'copy-1', name: [{ string: 'Copy #1' }], copy_number: [{ number: 1 }] }
				]
			})
		);
		const copies = await listCopies(cfg, 'edition-1', fetchImpl);
		expect(copies).toEqual<Copy[]>([{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }]);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=copy');
		expect(url).toContain('_parent.reference=edition-1');
		expect(url).toContain('props=name,copy_number');
		expect(url).not.toMatch(/\bbarcode\b|\bcondition\b|\bnotes\b/);
	});
});

// ── listLendings ───────────────────────────────────────────────────────────

describe('listLendings', () => {
	it("maps copy,member,assigned_at,assigned_until,returned_at into Lending[]; absent returned_at → ''", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'lending-1',
						copy: [{ reference: 'copy-1' }],
						member: [{ reference: 'member-1' }],
						assigned_at: [{ date: '2026-07-01' }],
						assigned_until: [{ date: '2026-08-01' }]
						// returned_at absent — still out
					}
				]
			})
		);
		const lendings = await listLendings(cfg, fetchImpl);
		expect(lendings).toEqual<Lending[]>([
			{
				id: 'lending-1',
				copyId: 'copy-1',
				memberId: 'member-1',
				assignedAt: '2026-07-01',
				assignedUntil: '2026-08-01',
				returnedAt: ''
			}
		]);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=lending');
		expect(url).toContain('props=copy,member,assigned_at,assigned_until,returned_at');
		expect(url).not.toMatch(/\brenewed_at\b/);
	});
});

// ── deriveCopyAvailability — pure, no fetch ──────────────────────────────────

describe('deriveCopyAvailability', () => {
	const lendings: Lending[] = [
		{ id: 'l1', copyId: 'copy-1', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '2026-08-01', returnedAt: '' },
		{ id: 'l2', copyId: 'copy-2', memberId: 'member-b', assignedAt: '2026-06-01', assignedUntil: '2026-07-01', returnedAt: '2026-06-15' }
	];

	it('a copy with no active lending → available', () => {
		expect(deriveCopyAvailability('copy-3', lendings)).toEqual<CopyAvailability>({ status: 'available' });
	});

	it('a copy whose only lending has a returned_at → available (returned, not active)', () => {
		expect(deriveCopyAvailability('copy-2', lendings)).toEqual<CopyAvailability>({ status: 'available' });
	});

	it('a copy with an active lending (returned_at absent) → lent, with memberId/assignedAt/assignedUntil', () => {
		expect(deriveCopyAvailability('copy-1', lendings)).toEqual<CopyAvailability>({
			status: 'lent',
			memberId: 'member-a',
			assignedAt: '2026-07-01',
			assignedUntil: '2026-08-01'
		});
	});

	it('two concurrent active lendings for the same copy (data anomaly) → picks the most recently assigned, warns, does not throw', () => {
		const dirty: Lending[] = [
			{ id: 'l1', copyId: 'copy-x', memberId: 'member-old', assignedAt: '2026-01-01', assignedUntil: '', returnedAt: '' },
			{ id: 'l2', copyId: 'copy-x', memberId: 'member-new', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
		];
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const result = deriveCopyAvailability('copy-x', dirty);
		expect(result).toEqual<CopyAvailability>({
			status: 'lent',
			memberId: 'member-new',
			assignedAt: '2026-07-01',
			assignedUntil: ''
		});
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

// ── resolveBorrowerNames — batched, dedup, domain-or-public scan ────────────

function profile(sharing: MyProfile['_sharing'], name: string): MyProfile {
	return { _id: `p-${sharing}`, name, email: '', _sharing: sharing };
}

describe('resolveBorrowerNames', () => {
	it('resolves member → person → domain-or-public name; dedupes repeated memberIds to one fetch pair', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('entity/member-1')) {
				return Promise.resolve(json({ entity: { person: [{ reference: 'person-a' }] } }));
			}
			if (url.includes('_parent.reference=person-a')) {
				return Promise.resolve(
					json({
						entities: [
							{ _id: 'prof-1', name: [{ string: 'Ada Lovelace' }], _sharing: [{ string: 'domain' }] }
						]
					})
				);
			}
			throw new Error(`unexpected url ${url}`);
		});
		const names = await resolveBorrowerNames(cfg, ['member-1', 'member-1'], fetchImpl);
		expect(names.get('member-1')).toBe('Ada Lovelace');
		// deduped — one member lookup + one profile lookup, not two of each
		const memberLookups = fetchImpl.mock.calls.filter(([u]) => String(u).includes('entity/member-1'));
		expect(memberLookups).toHaveLength(1);
	});

	it("domain name preferred over public when both present (matches rosterData.ts's toRosterRow rule)", async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('entity/member-2')) {
				return Promise.resolve(json({ entity: { person: [{ reference: 'person-b' }] } }));
			}
			return Promise.resolve(
				json({
					entities: [
						{ _id: 'prof-d', name: [{ string: 'Domain Name' }], _sharing: [{ string: 'domain' }] },
						{ _id: 'prof-p', name: [{ string: 'Public Name' }], _sharing: [{ string: 'public' }] }
					]
				})
			);
		});
		const names = await resolveBorrowerNames(cfg, ['member-2'], fetchImpl);
		expect(names.get('member-2')).toBe('Domain Name');
	});

	it("no domain or public name resolvable → '' (page renders the fallback label, not this function)", async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('entity/member-3')) {
				return Promise.resolve(json({ entity: { person: [{ reference: 'person-c' }] } }));
			}
			return Promise.resolve(json({ entities: [] }));
		});
		const names = await resolveBorrowerNames(cfg, ['member-3'], fetchImpl);
		expect(names.get('member-3')).toBe('');
	});

	it('fails loud as a whole if any member lookup 500s', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(resolveBorrowerNames(cfg, ['member-4'], fetchImpl)).rejects.toThrow(/500/);
	});
});

// ── deriveEditionAvailability — pure, no fetch ──────────────────────────────

describe('deriveEditionAvailability', () => {
	const copies: Copy[] = [
		{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
		{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' },
		{ id: 'copy-3', name: 'Copy #3', copyNumber: 3, editionId: 'edition-1' },
		{ id: 'copy-other', name: 'Copy Other', copyNumber: 1, editionId: 'edition-2' }
	];

	it('counts available vs total for the given edition; ignores copies from other editions', () => {
		const lendings: Lending[] = [
			{ id: 'l1', copyId: 'copy-1', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' },
			{ id: 'l2', copyId: 'copy-2', memberId: 'member-b', assignedAt: '2026-06-01', assignedUntil: '', returnedAt: '2026-06-15' }
		];
		expect(deriveEditionAvailability('edition-1', copies, lendings)).toEqual({ available: 2, total: 3 });
	});

	it('all copies available when no active lendings', () => {
		expect(deriveEditionAvailability('edition-1', copies, [])).toEqual({ available: 3, total: 3 });
	});

	it('zero copies for a nonexistent edition', () => {
		expect(deriveEditionAvailability('edition-unknown', copies, [])).toEqual({ available: 0, total: 0 });
	});
});

// ── activeLendingForMemberInEdition — pure, no fetch ────────────────────────

describe('activeLendingForMemberInEdition', () => {
	const editionCopyIds = new Set(['copy-1', 'copy-2']);
	const lendings: Lending[] = [
		{ id: 'l1', copyId: 'copy-1', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' },
		{ id: 'l2', copyId: 'copy-2', memberId: 'member-b', assignedAt: '2026-06-01', assignedUntil: '', returnedAt: '2026-06-15' },
		{ id: 'l3', copyId: 'copy-3', memberId: 'member-a', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
	];

	it('returns the active lending when the member holds a copy from the edition', () => {
		const result = activeLendingForMemberInEdition('member-a', editionCopyIds, lendings);
		expect(result).toEqual(lendings[0]);
	});

	it('returns undefined when the member has a returned lending (not active) for the edition', () => {
		expect(activeLendingForMemberInEdition('member-b', editionCopyIds, lendings)).toBeUndefined();
	});

	it('returns undefined when the member has no lending for any copy in the edition', () => {
		expect(activeLendingForMemberInEdition('member-c', editionCopyIds, lendings)).toBeUndefined();
	});

	it('ignores active lendings for copies outside the edition', () => {
		// member-a has an active lending for copy-3, which is NOT in editionCopyIds
		const outsideCopyIds = new Set(['copy-3']);
		expect(activeLendingForMemberInEdition('member-a', outsideCopyIds, lendings)).toEqual(lendings[2]);
		// But if we ask about a set that doesn't include copy-3:
		expect(activeLendingForMemberInEdition('member-a', new Set(['copy-99']), lendings)).toBeUndefined();
	});
});

// ── deriveWorkAvailability — pure, no fetch ───────────────────────────────

describe('deriveWorkAvailability', () => {
	const editions: Edition[] = [
		{ id: 'ed-1', name: 'Ed 1', publisher: 'P1', workId: 'work-1' },
		{ id: 'ed-2', name: 'Ed 2', publisher: 'P2', workId: 'work-1' },
		{ id: 'ed-other', name: 'Ed Other', publisher: 'P3', workId: 'work-2' }
	];
	const copies: Copy[] = [
		{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'ed-1' },
		{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'ed-1' },
		{ id: 'copy-3', name: 'Copy #3', copyNumber: 1, editionId: 'ed-2' },
		{ id: 'copy-other', name: 'Copy Other', copyNumber: 1, editionId: 'ed-other' }
	];

	it('aggregates availability across all editions of a work', () => {
		const lendings: Lending[] = [
			{ id: 'l1', copyId: 'copy-1', memberId: 'm-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' },
			{ id: 'l2', copyId: 'copy-3', memberId: 'm-b', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
		];
		// work-1 has 3 copies (copy-1, copy-2, copy-3), 2 lent => 1 available
		expect(deriveWorkAvailability('work-1', editions, copies, lendings)).toEqual({ available: 1, total: 3 });
	});

	it('all copies available when no active lendings', () => {
		expect(deriveWorkAvailability('work-1', editions, copies, [])).toEqual({ available: 3, total: 3 });
	});

	it('ignores copies/editions from other works', () => {
		const lendings: Lending[] = [
			{ id: 'l1', copyId: 'copy-other', memberId: 'm-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
		];
		// work-1 has 3 copies, none lent (copy-other belongs to work-2)
		expect(deriveWorkAvailability('work-1', editions, copies, lendings)).toEqual({ available: 3, total: 3 });
	});

	it('returns zero for a nonexistent work', () => {
		expect(deriveWorkAvailability('work-unknown', editions, copies, [])).toEqual({ available: 0, total: 0 });
	});

	it('ignores returned lendings (returnedAt !== "")', () => {
		const lendings: Lending[] = [
			{ id: 'l1', copyId: 'copy-1', memberId: 'm-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '2026-07-15' }
		];
		expect(deriveWorkAvailability('work-1', editions, copies, lendings)).toEqual({ available: 3, total: 3 });
	});
});

// ── resolveCopyNames — batched, dedup ─────────────────────────────────────

describe('resolveCopyNames', () => {
	it('resolves copy names from entity lookup; prefers name over copy_number', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('entity/copy-1')) {
				return Promise.resolve(json({ entity: { name: [{ string: 'Score #7' }], copy_number: [{ number: 7 }] } }));
			}
			throw new Error(`unexpected url ${url}`);
		});
		const names = await resolveCopyNames(cfg, ['copy-1'], fetchImpl);
		expect(names.get('copy-1')).toBe('Score #7');
	});

	it('falls back to #<copy_number> when name is absent', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('entity/copy-2')) {
				return Promise.resolve(json({ entity: { copy_number: [{ number: 3 }] } }));
			}
			throw new Error(`unexpected url ${url}`);
		});
		const names = await resolveCopyNames(cfg, ['copy-2'], fetchImpl);
		expect(names.get('copy-2')).toBe('#3');
	});

	it('returns empty string when neither name nor copy_number is present', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entity: {} }));
		const names = await resolveCopyNames(cfg, ['copy-3'], fetchImpl);
		expect(names.get('copy-3')).toBe('');
	});

	it('dedupes repeated copyIds', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('entity/copy-1')) {
				return Promise.resolve(json({ entity: { name: [{ string: 'Score #7' }] } }));
			}
			throw new Error(`unexpected url ${url}`);
		});
		const names = await resolveCopyNames(cfg, ['copy-1', 'copy-1'], fetchImpl);
		expect(names.get('copy-1')).toBe('Score #7');
		const lookups = fetchImpl.mock.calls.filter((args) => String(args[0]).includes('entity/copy-1'));
		expect(lookups).toHaveLength(1);
	});

	it('fails loud on non-2xx', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(resolveCopyNames(cfg, ['copy-bad'], fetchImpl)).rejects.toThrow(/500/);
	});
});
