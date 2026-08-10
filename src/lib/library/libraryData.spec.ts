import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import type { MyProfile } from '$lib/profile/profileData';
import {
	listWorks,
	listEditions,
	listCopies,
	listLendings,
	resolveBorrowerNames,
	deriveCopyAvailability,
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
