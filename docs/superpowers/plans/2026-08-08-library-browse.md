# Library Browse Surfaces Implementation Plan

> **For agentic workers:** Use this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build `/library` for T6.3 (parent #54 — Slice 6, Library 1.0): works/editions/copies rendered as an expandable accordion, per-copy availability (and borrower identity — domain-open per Mihkel's ruling, see the design spec §2.4) derived from `lending`, and a nav entry. Read-only throughout — no write path anywhere.

**Design spec:** `docs/superpowers/specs/2026-08-08-library-browse-design.md` — read it first. It documents the exact ruled field set (T6.1/T6.2/T6.2b, final and live-confirmed) and a correction to the original dispatch brief: borrower identity is domain-open, not hidden.

**Architecture:** `src/lib/library/libraryData.ts` (query + pure derivation functions, same split as `rosterData.ts`) → `src/routes/library/+page.svelte` (accordion page, same state-machine shape as `roster/+page.svelte`) → a nav entry row in `entries.ts`.

**Tech Stack:** SvelteKit 2 / Svelte 5 (Runes) / Vitest + happy-dom / Paraglide i18n / pnpm

## Global Constraints

- Svelte 5 Runes only (`$state`, `$derived`, `$props`, `$effect`) — NEVER legacy `export let` / `$:`
- pnpm, never npm; path: `export PATH="$HOME/.npm-global/bin:$PATH"`
- Read-only: no `entuFetch(..., { method: 'POST' | 'DELETE' })` anywhere in `libraryData.ts` or the page
- Query only the ruled-visible fields (design spec §2) — never request `barcode`, `condition`, `notes`, `edition_type`, `license`, `year`, `file`, `genre`, `edition.cost`, `lending.renewed_at`, `lending.name`, `lending.notes` in any `props=` string
- Co-author trailer: `Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>`

---

## Task 1: Data layer — `libraryData.ts`

### 1.1 RED — write the failing spec first

- [ ] Create `src/lib/library/libraryData.spec.ts`

```ts
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
		expect(copies).toEqual<Copy[]>([{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 }]);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=copy');
		expect(url).toContain('_parent.reference=edition-1');
		expect(url).toContain('props=name,copy_number');
		expect(url).not.toMatch(/\bbarcode\b|\bcondition\b|\bnotes\b/);
	});
});

// ── listLendings ───────────────────────────────────────────────────────────

describe('listLendings', () => {
	it('maps copy,member,assigned_at,assigned_until,returned_at into Lending[]; absent returned_at → \'\'', async () => {
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

	it('domain name preferred over public when both present (matches rosterData.ts\'s toRosterRow rule)', async () => {
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

	it('no domain or public name resolvable → \'\' (page renders the fallback label, not this function)', async () => {
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
```

### 1.2 Test — confirm RED

```bash
export PATH="$HOME/.npm-global/bin:$PATH" && cd ~/workspace-app && pnpm vitest run src/lib/library/libraryData.spec.ts
```

Expect: module-not-found / all failing (no implementation yet).

### 1.3 GREEN — implement `libraryData.ts`

- [ ] Create `src/lib/library/libraryData.ts`

```ts
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listMyProfiles } from '$lib/profile/profileData';

// T6.3/#58(TBD) — the library READ data layer. Read-only throughout: no
// entuFetch(..., { method: 'POST' | 'DELETE' }) anywhere in this module. Field set
// is the T6.1/T6.2/T6.2b ruled set (design doc 2026-08-08-library-browse-design.md
// §2) — queries here must never request a still-private field (barcode, condition,
// notes, edition_type, license, year, file, genre, edition.cost, lending.renewed_at,
// lending.name, lending.notes).

export interface Work {
	id: string;
	name: string;
	composer: string;
}

export async function listWorks(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<Work[]> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=work&props=name,composer&limit=500',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listWorks failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{ _id: string; name?: Array<{ string: string }>; composer?: Array<{ string: string }> }>;
	};
	return (body.entities ?? []).map((raw) => ({
		id: raw._id,
		name: raw.name?.[0]?.string ?? '',
		composer: raw.composer?.[0]?.string ?? ''
	}));
}

export interface Edition {
	id: string;
	name: string;
	publisher: string;
}

export async function listEditions(
	cfg: EntuCfg,
	workId: string,
	fetchImpl: typeof fetch = fetch
): Promise<Edition[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=edition&_parent.reference=${encodeURIComponent(workId)}&props=name,publisher&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listEditions failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{ _id: string; name?: Array<{ string: string }>; publisher?: Array<{ string: string }> }>;
	};
	return (body.entities ?? []).map((raw) => ({
		id: raw._id,
		name: raw.name?.[0]?.string ?? '',
		publisher: raw.publisher?.[0]?.string ?? ''
	}));
}

export interface Copy {
	id: string;
	name: string;
	copyNumber: number;
}

export async function listCopies(
	cfg: EntuCfg,
	editionId: string,
	fetchImpl: typeof fetch = fetch
): Promise<Copy[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=copy&_parent.reference=${encodeURIComponent(editionId)}&props=name,copy_number&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listCopies failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{ _id: string; name?: Array<{ string: string }>; copy_number?: Array<{ number: number }> }>;
	};
	return (body.entities ?? []).map((raw) => ({
		id: raw._id,
		name: raw.name?.[0]?.string ?? '',
		copyNumber: raw.copy_number?.[0]?.number ?? 0
	}));
}

export interface Lending {
	id: string;
	copyId: string;
	memberId: string;
	assignedAt: string;
	assignedUntil: string;
	/** '' = absent = still out (schema note: entu/research schema.ts:524). */
	returnedAt: string;
}

export async function listLendings(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<Lending[]> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=lending&props=copy,member,assigned_at,assigned_until,returned_at&limit=500',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listLendings failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			copy?: Array<{ reference: string }>;
			member?: Array<{ reference: string }>;
			assigned_at?: Array<{ date: string }>;
			assigned_until?: Array<{ date: string }>;
			returned_at?: Array<{ date: string }>;
		}>;
	};
	return (body.entities ?? []).map((raw) => ({
		id: raw._id,
		copyId: raw.copy?.[0]?.reference ?? '',
		memberId: raw.member?.[0]?.reference ?? '',
		assignedAt: raw.assigned_at?.[0]?.date ?? '',
		assignedUntil: raw.assigned_until?.[0]?.date ?? '',
		returnedAt: raw.returned_at?.[0]?.date ?? ''
	}));
}

export type CopyAvailability =
	| { status: 'available' }
	| { status: 'lent'; memberId: string; assignedAt: string; assignedUntil: string };

/**
 * Pure — no fetch. `returnedAt === ''` is "still out" (schema note). More than one
 * concurrent active lending for one copy is a data anomaly (should be impossible
 * under correct lending discipline) — warn and take the most recently assigned
 * rather than throwing and breaking the whole page over one dirty row.
 */
export function deriveCopyAvailability(copyId: string, lendings: Lending[]): CopyAvailability {
	const active = lendings.filter((l) => l.copyId === copyId && l.returnedAt === '');
	if (active.length === 0) return { status: 'available' };
	if (active.length > 1) {
		console.warn(
			`deriveCopyAvailability: copy ${copyId} has ${active.length} concurrent active lendings`
		);
	}
	const chosen = active.reduce((a, b) => (a.assignedAt >= b.assignedAt ? a : b));
	return {
		status: 'lent',
		memberId: chosen.memberId,
		assignedAt: chosen.assignedAt,
		assignedUntil: chosen.assignedUntil
	};
}

/**
 * `lending.member` references a `member` entity, which carries no name of its own
 * (entu/research schema.ts:287-336) — same shape rosterData.ts already solved for
 * roster rows: member -> person -> profile -> name. Reuses profileData.ts's
 * listMyProfiles directly (NOT rosterData.ts's listProfilesForPerson — that
 * wrapper's own doc says it exists purely for roster call-site clarity, not as a
 * cross-feature entry point). Same domain-or-public scan as rosterData.ts's
 * toRosterRow (rosterData.ts:160-167) — NEVER resolveField, NEVER private.
 * Duplicated deliberately (rule of three — two callers doesn't justify widening
 * either file's exported surface for a one-line scan).
 */
async function resolveBorrowerName(
	cfg: EntuCfg,
	memberId: string,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const res = await entuFetch(cfg.db, `entity/${memberId}?props=person`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`resolveBorrowerName: member ${memberId} lookup failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { person?: Array<{ reference: string }> } };
	const personId = body.entity?.person?.[0]?.reference;
	if (!personId) {
		throw new Error(`resolveBorrowerName: member ${memberId} carries no readable person reference`);
	}

	const profiles = await listMyProfiles(cfg, personId, fetchImpl);
	let domain = '';
	let pub = '';
	for (const p of profiles) {
		if (p._sharing === 'domain' && p.name.trim() !== '') domain = p.name.trim();
		else if (p._sharing === 'public' && p.name.trim() !== '') pub = p.name.trim();
	}
	return domain !== '' ? domain : pub;
}

/**
 * Batched + deduped borrower-name resolution. Fails loud as a whole (matches
 * loadRoster's Promise.all semantics, rosterData.ts:188-199) — a resolution
 * failure rejects the whole batch rather than silently showing an unresolved
 * copy as available or unattributed.
 */
export async function resolveBorrowerNames(
	cfg: EntuCfg,
	memberIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<Map<string, string>> {
	const unique = [...new Set(memberIds)];
	const pairs = await Promise.all(
		unique.map(async (id) => [id, await resolveBorrowerName(cfg, id, fetchImpl)] as const)
	);
	return new Map(pairs);
}

// (*MVOX:Tallis* — RED spec)
// (*MVOX:Josquin* — GREEN implementation)
```

### 1.4 Test — confirm GREEN

```bash
export PATH="$HOME/.npm-global/bin:$PATH" && cd ~/workspace-app && pnpm vitest run src/lib/library/libraryData.spec.ts
```

### 1.5 Type check

```bash
export PATH="$HOME/.npm-global/bin:$PATH" && cd ~/workspace-app && pnpm check
```

### 1.6 Commit

```
feat(library): T6.3 data layer — works/editions/copies/lendings + availability (#54)

listWorks/listEditions/listCopies/listLendings query the T6.1/T6.2/T6.2b ruled
field set only. deriveCopyAvailability is pure (returned_at absent = still out).
resolveBorrowerNames resolves lending.member -> person -> profile name, reusing
profileData.ts's listMyProfiles and rosterData.ts's domain-or-public name scan.

Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>
```

---

## Task 2: Library page component

### 2.1 RED — page spec

- [ ] Create `src/routes/page.library.spec.ts`

```ts
// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		library_title: () => 'Library',
		library_no_collective: () => 'Select a collective to view the library.',
		library_load_error: () => 'Something went wrong loading the library.',
		library_retry: () => 'Retry',
		library_empty: () => 'Nothing in the library yet.',
		library_work_composer_unknown: () => 'Unknown composer',
		library_editions_empty: () => 'No editions yet.',
		library_edition_publisher_unknown: () => 'Unknown publisher',
		library_copies_empty: () => 'No copies yet.',
		library_copy_available: () => 'Available',
		library_copy_lent_to: (p: { name: string }) => `Out — ${p.name}`,
		library_borrower_unknown: () => 'an unnamed member',
		library_lent_since: (p: { date: string }) => `since ${p.date}`,
		library_node_load_error: () => 'Could not load.',
		library_node_retry: () => 'Retry'
	}
}));

const { listWorksMock, listEditionsMock, listCopiesMock, listLendingsMock, resolveBorrowerNamesMock } =
	vi.hoisted(() => ({
		listWorksMock: vi.fn(),
		listEditionsMock: vi.fn(),
		listCopiesMock: vi.fn(),
		listLendingsMock: vi.fn(),
		resolveBorrowerNamesMock: vi.fn()
	}));
vi.mock('$lib/library/libraryData', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>('$lib/library/libraryData');
	return {
		...actual, // keep the real, pure deriveCopyAvailability
		listWorks: listWorksMock,
		listEditions: listEditionsMock,
		listCopies: listCopiesMock,
		listLendings: listLendingsMock,
		resolveBorrowerNames: resolveBorrowerNamesMock
	};
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './library/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({ status: 'authenticated', personIdByDb: { polyphony: 'person-p' }, expMs: Date.now() + 100_000 });
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function setNoCollective() {
	setToken('jwt-abc');
	authStore.set({ status: 'authenticated', personIdByDb: {}, expMs: Date.now() + 100_000 });
	collectiveState.set({ status: 'ready', collectives: [], erroredDbs: [] });
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(null);
}

afterEach(() => {
	cleanup();
	listWorksMock.mockReset();
	listEditionsMock.mockReset();
	listCopiesMock.mockReset();
	listLendingsMock.mockReset();
	resolveBorrowerNamesMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('/library — loading state', () => {
	it('shows the skeleton while the initial load is in flight', async () => {
		listWorksMock.mockReturnValue(new Promise(() => {}));
		listLendingsMock.mockReturnValue(new Promise(() => {}));
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-skeleton"]')).not.toBeNull();
		});
	});
});

describe('/library — ready state, empty', () => {
	it('shows library-empty and no work rows when listWorks resolves []', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="library-work-list"]')).toBeNull();
	});
});

describe('/library — work expand -> edition expand -> copy availability', () => {
	it('expanding a work lazily loads its editions; expanding an edition lazily loads its copies; availability reflects an active lending', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '2026-08-01', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada Lovelace']]));
		listEditionsMock.mockResolvedValue([{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }]);
		listCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2 }
		]);
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
		});
		expect(listEditionsMock).not.toHaveBeenCalled();

		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		await waitFor(() => expect(listEditionsMock).toHaveBeenCalledWith(expect.anything(), 'work-1', expect.anything()));
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull();
		});
		expect(listCopiesMock).not.toHaveBeenCalled();

		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);
		await waitFor(() => expect(listCopiesMock).toHaveBeenCalledWith(expect.anything(), 'edition-1', expect.anything()));

		await waitFor(() => {
			const copy1 = container.querySelector('[data-testid="library-copy-copy-1"]');
			const copy2 = container.querySelector('[data-testid="library-copy-copy-2"]');
			expect(copy1?.textContent).toContain('Available');
			expect(copy2?.textContent).toContain('Out');
			expect(copy2?.textContent).toContain('Ada Lovelace');
		});
	});

	it('re-collapsing then re-expanding a work does not re-fetch its editions (cached)', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		listEditionsMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitFor(() => expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull());

		const toggle = container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element;
		await fireEvent.click(toggle); // expand
		await waitFor(() => expect(listEditionsMock).toHaveBeenCalledTimes(1));
		await fireEvent.click(toggle); // collapse
		await fireEvent.click(toggle); // expand again

		expect(listEditionsMock).toHaveBeenCalledTimes(1);
	});
});

describe('/library — unresolved borrower name', () => {
	it('an active lending with no resolvable name shows the fallback label, never a blank', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-x', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-x', '']]));
		listEditionsMock.mockResolvedValue([{ id: 'edition-1', name: 'Ed', publisher: 'Pub' }]);
		listCopiesMock.mockResolvedValue([{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 }]);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitFor(() => container.querySelector('[data-testid="library-work-work-1"]'));
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		await waitFor(() => container.querySelector('[data-testid="library-edition-edition-1"]'));
		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-copy-copy-1"]')?.textContent).toContain(
				'an unnamed member'
			);
		});
	});
});

describe('/library — top-level load-error state', () => {
	it('shows a generic localized error; logs detail to console.error; retry reloads', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listWorksMock.mockRejectedValue(new Error('boom 500'));
		listLendingsMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-load-error"]')).not.toBeNull();
		});
		expect(container.textContent).toContain('Something went wrong loading the library.');
		expect(container.textContent).not.toContain('boom 500');
		expect(consoleSpy).toHaveBeenCalled();

		listWorksMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		const retryBtn = container.querySelector('[data-testid="library-retry-load"]') as HTMLButtonElement;
		await fireEvent.click(retryBtn);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		consoleSpy.mockRestore();
	});
});

describe('/library — no-collective state', () => {
	it('shows library-no-collective and never calls listWorks', async () => {
		setNoCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-no-collective"]')).not.toBeNull();
		});
		expect(listWorksMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis*)
```

### 2.2 Test — confirm RED

```bash
export PATH="$HOME/.npm-global/bin:$PATH" && cd ~/workspace-app && pnpm vitest run src/routes/page.library.spec.ts
```

### 2.3 GREEN — page component

- [ ] Create `src/routes/library/+page.svelte`

```svelte
<script lang="ts">
	// T6.3/#54 — the library browse page: works -> editions -> copies, availability
	// derived from lending. Read-only throughout. Same state-machine shape as
	// roster/+page.svelte (loading/no-collective/load-error/ready + generation guard).
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
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
		type Lending
	} from '$lib/library/libraryData';

	const selected = $derived($selectedCollectiveStore);

	type Status = 'loading' | 'no-collective' | 'load-error' | 'ready';
	type NodeStatus = 'idle' | 'loading' | 'error';

	let generation = 0;
	let status = $state<Status>('loading');
	let works = $state<Work[]>([]);
	let lendings = $state<Lending[]>([]);
	let borrowerNames = $state<Map<string, string>>(new Map());

	let expandedWorks = $state<Set<string>>(new Set());
	let expandedEditions = $state<Set<string>>(new Set());
	let editionsByWork = $state<Map<string, Edition[]>>(new Map());
	let copiesByEdition = $state<Map<string, Copy[]>>(new Map());
	let editionNodeStatus = $state<Map<string, NodeStatus>>(new Map());
	let copyNodeStatus = $state<Map<string, NodeStatus>>(new Map());

	async function loadForSelected(): Promise<void> {
		const current = selected;
		const g = ++generation;
		if (!current) {
			status = 'no-collective';
			works = [];
			return;
		}
		const token = getToken();
		if (!token) {
			console.error('library: no auth token in storage on a protected route');
			status = 'load-error';
			return;
		}
		status = 'loading';
		expandedWorks = new Set();
		expandedEditions = new Set();
		editionsByWork = new Map();
		copiesByEdition = new Map();
		try {
			const cfg = { db: current.db, token };
			const [workList, lendingList] = await Promise.all([listWorks(cfg), listLendings(cfg)]);
			if (g !== generation) return;
			const activeMemberIds = lendingList.filter((l) => l.returnedAt === '').map((l) => l.memberId);
			const names = await resolveBorrowerNames(cfg, activeMemberIds);
			if (g !== generation) return;
			works = workList;
			lendings = lendingList;
			borrowerNames = names;
			status = 'ready';
		} catch (e) {
			if (g !== generation) return;
			console.error('library: load failed', e);
			status = 'load-error';
		}
	}

	// Fetch-only (does not touch expandedWorks) — called both when a work is first
	// expanded (not yet cached) and from the error state's retry button (the node
	// stays expanded across a retry; only toggleWork collapses it).
	async function loadEditionsFor(workId: string): Promise<void> {
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		editionNodeStatus = new Map(editionNodeStatus).set(workId, 'loading');
		try {
			const editions = await listEditions({ db: current.db, token }, workId);
			editionsByWork = new Map(editionsByWork).set(workId, editions);
			editionNodeStatus = new Map(editionNodeStatus).set(workId, 'idle');
		} catch (e) {
			console.error('library: editions load failed', workId, e);
			editionNodeStatus = new Map(editionNodeStatus).set(workId, 'error');
		}
	}

	function toggleWork(workId: string): void {
		const next = new Set(expandedWorks);
		if (next.has(workId)) {
			next.delete(workId);
			expandedWorks = next;
			return;
		}
		next.add(workId);
		expandedWorks = next;
		if (editionsByWork.has(workId)) return; // cached
		void loadEditionsFor(workId);
	}

	// Same fetch-only / toggle split as editions, one level down.
	async function loadCopiesFor(editionId: string): Promise<void> {
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		copyNodeStatus = new Map(copyNodeStatus).set(editionId, 'loading');
		try {
			const copies = await listCopies({ db: current.db, token }, editionId);
			copiesByEdition = new Map(copiesByEdition).set(editionId, copies);
			copyNodeStatus = new Map(copyNodeStatus).set(editionId, 'idle');
		} catch (e) {
			console.error('library: copies load failed', editionId, e);
			copyNodeStatus = new Map(copyNodeStatus).set(editionId, 'error');
		}
	}

	function toggleEdition(editionId: string): void {
		const next = new Set(expandedEditions);
		if (next.has(editionId)) {
			next.delete(editionId);
			expandedEditions = next;
			return;
		}
		next.add(editionId);
		expandedEditions = next;
		if (copiesByEdition.has(editionId)) return; // cached
		void loadCopiesFor(editionId);
	}

	$effect(() => {
		void selected;
		loadForSelected().catch((e) => {
			console.error('library: load failed', e);
			status = 'load-error';
		});
	});
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.library_title()}</h1>

		{#if status === 'no-collective'}
			<p data-testid="library-no-collective" class="text-sm">{m.library_no_collective()}</p>
		{:else if status === 'loading'}
			<div data-testid="library-skeleton" class="flex flex-col gap-3" aria-hidden="true" aria-busy="true">
				{#each [0, 1, 2] as row (row)}
					<div class="flex animate-pulse flex-col gap-1.5 py-2">
						<div class="h-3 w-1/2 rounded bg-ink-5"></div>
						<div class="h-2.5 w-1/3 rounded bg-ink-5"></div>
					</div>
				{/each}
			</div>
		{:else if status === 'load-error'}
			<div data-testid="library-load-error" class="flex flex-col gap-2" role="alert">
				<p class="text-sm text-red-700">{m.library_load_error()}</p>
				<button
					type="button"
					data-testid="library-retry-load"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={() => loadForSelected()}
				>
					{m.library_retry()}
				</button>
			</div>
		{:else if works.length === 0}
			<div data-testid="library-empty" class="flex min-h-[30vh] items-center justify-center">
				<p class="font-display text-xl text-ink-2">{m.library_empty()}</p>
			</div>
		{:else}
			<ul data-testid="library-work-list" class="flex flex-col gap-1">
				{#each works as work (work.id)}
					{@const isOpen = expandedWorks.has(work.id)}
					<li data-testid="library-work-{work.id}" class="flex flex-col border-b border-dashed border-ink-5 py-2 last:border-b-0">
						<button
							type="button"
							data-testid="library-work-toggle-{work.id}"
							class="flex items-center justify-between text-left"
							aria-expanded={isOpen}
							aria-controls="library-editions-{work.id}"
							onclick={() => toggleWork(work.id)}
						>
							<span class="flex flex-col">
								<span class="text-sm text-ink">{work.name}</span>
								<span class="text-xs text-ink-2">{work.composer || m.library_work_composer_unknown()}</span>
							</span>
							<span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
						</button>

						{#if isOpen}
							<div id="library-editions-{work.id}" class="ml-4 mt-2 flex flex-col gap-1">
								{#if editionNodeStatus.get(work.id) === 'loading'}
									<div class="h-2.5 w-1/3 animate-pulse rounded bg-ink-5"></div>
								{:else if editionNodeStatus.get(work.id) === 'error'}
									<div class="flex items-center gap-2">
										<p class="text-xs text-red-700">{m.library_node_load_error()}</p>
										<button
											type="button"
											class="text-xs underline"
											onclick={() => loadEditionsFor(work.id)}
										>
											{m.library_node_retry()}
										</button>
									</div>
								{:else if (editionsByWork.get(work.id) ?? []).length === 0}
									<p class="text-xs text-ink-2">{m.library_editions_empty()}</p>
								{:else}
									{#each editionsByWork.get(work.id) ?? [] as edition (edition.id)}
										{@const editionOpen = expandedEditions.has(edition.id)}
										<div data-testid="library-edition-{edition.id}" class="flex flex-col border-b border-dashed border-ink-5 py-1.5 last:border-b-0">
											<button
												type="button"
												data-testid="library-edition-toggle-{edition.id}"
												class="flex items-center justify-between text-left"
												aria-expanded={editionOpen}
												aria-controls="library-copies-{edition.id}"
												onclick={() => toggleEdition(edition.id)}
											>
												<span class="flex flex-col">
													<span class="text-sm text-ink">{edition.name}</span>
													<span class="text-xs text-ink-2">{edition.publisher || m.library_edition_publisher_unknown()}</span>
												</span>
												<span aria-hidden="true">{editionOpen ? '▾' : '▸'}</span>
											</button>

											{#if editionOpen}
												<div id="library-copies-{edition.id}" class="ml-4 mt-1.5 flex flex-col gap-1">
													{#if copyNodeStatus.get(edition.id) === 'loading'}
														<div class="h-2.5 w-1/3 animate-pulse rounded bg-ink-5"></div>
													{:else if copyNodeStatus.get(edition.id) === 'error'}
														<div class="flex items-center gap-2">
															<p class="text-xs text-red-700">{m.library_node_load_error()}</p>
															<button type="button" class="text-xs underline" onclick={() => loadCopiesFor(edition.id)}>
																{m.library_node_retry()}
															</button>
														</div>
													{:else if (copiesByEdition.get(edition.id) ?? []).length === 0}
														<p class="text-xs text-ink-2">{m.library_copies_empty()}</p>
													{:else}
														{#each copiesByEdition.get(edition.id) ?? [] as copy (copy.id)}
															{@const availability = deriveCopyAvailability(copy.id, lendings)}
															<div data-testid="library-copy-{copy.id}" class="flex items-center justify-between text-xs">
																<span class="text-ink">{copy.name}</span>
																{#if availability.status === 'available'}
																	<span class="rounded-full bg-ink-5 px-2 py-0.5 text-ink-2">{m.library_copy_available()}</span>
																{:else}
																	<span class="rounded-full bg-ink-5 px-2 py-0.5 text-ink-2">
																		{m.library_copy_lent_to({
																			name: borrowerNames.get(availability.memberId) || m.library_borrower_unknown()
																		})}
																		{#if availability.assignedAt}
																			· {m.library_lent_since({ date: availability.assignedAt })}
																		{/if}
																	</span>
																{/if}
															</div>
														{/each}
													{/if}
												</div>
											{/if}
										</div>
									{/each}
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
```

### 2.4 Test — confirm GREEN

```bash
export PATH="$HOME/.npm-global/bin:$PATH" && cd ~/workspace-app && pnpm vitest run src/routes/page.library.spec.ts
```

### 2.5 Type check

```bash
export PATH="$HOME/.npm-global/bin:$PATH" && cd ~/workspace-app && pnpm check
```

### 2.6 Commit

```
feat(library): T6.3 browse page — expandable works/editions/copies with availability (#54)

/library renders works -> editions -> copies as a lazy-expanding accordion.
Same state-machine shape as roster/+page.svelte. Availability + borrower name
derived from pre-loaded lendings; per-node (edition/copy) lazy-load failures
degrade locally, not page-wide.

Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>
```

---

## Task 3: Nav entry

### 3.1 Add the `library` row

- [ ] Edit `src/lib/nav/entries.ts` — add the icon constant and the entry row (after `roster`, before `profile`):

```ts
const libraryIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>';
```

```ts
	{
		key: 'library',
		label: () => m.nav_library(),
		route: '/library',
		icon: libraryIcon,
		visible: () => true,
	},
```

Inserted between the `roster` and `profile` entries in `NAV_ENTRIES`.

### 3.2 Verify no regression in NavShell tests

```bash
export PATH="$HOME/.npm-global/bin:$PATH" && cd ~/workspace-app && pnpm vitest run src/lib/components/nav/
```

(`NavShell.spec.ts`'s fixtures define their own local entry arrays — adding a row to `NAV_ENTRIES` should not affect them. Confirm, don't assume.)

### 3.3 Commit

```
feat(nav): add library entry to NAV_ENTRIES (#54)

Always-visible row (T6.1 ruling: all members browse), positioned after
roster, before profile.

Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>
```

---

## Task 4: i18n

### 4.1 Add keys to `messages/en.json` (before the closing `}`, after the `nav_*` block)

```json
	"nav_library": "Library",
	"library_title": "Library",
	"library_no_collective": "Select a collective to view the library.",
	"library_load_error": "Something went wrong loading the library.",
	"library_retry": "Retry",
	"library_empty": "Nothing in the library yet.",
	"library_work_composer_unknown": "Unknown composer",
	"library_editions_empty": "No editions yet.",
	"library_edition_publisher_unknown": "Unknown publisher",
	"library_copies_empty": "No copies yet.",
	"library_copy_available": "Available",
	"library_copy_lent_to": "Out — {name}",
	"library_borrower_unknown": "an unnamed member",
	"library_lent_since": "since {date}",
	"library_node_load_error": "Could not load.",
	"library_node_retry": "Retry"
```

### 4.2 Add the equivalent keys to `messages/et.json`, `messages/lv.json`, `messages/uk.json`

Translate each value; keep every key identical across all four files (Paraglide requires key parity). If a fluent translator isn't available in-session, ask Comenius rather than guessing — do not ship an English fallback silently in a non-en locale file (matches the standing i18n discipline already applied to roster/nav/profile keys).

### 4.3 Verify Paraglide regenerates cleanly

```bash
export PATH="$HOME/.npm-global/bin:$PATH" && cd ~/workspace-app && pnpm check
```

(Paraglide's Vite plugin regenerates `src/lib/paraglide/messages.js` from the JSON on build/check — confirm no missing-key errors across locales.)

### 4.4 Commit

```
feat(library): i18n keys for library browse page, all four locales (#54)

nav_library + 15 library_* keys added to en/et/lv/uk message files.

Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>
```

---

## Task 5: Tests + verification

### 5.1 Full suite

```bash
export PATH="$HOME/.npm-global/bin:$PATH" && cd ~/workspace-app && pnpm vitest run
```

### 5.2 Type check

```bash
export PATH="$HOME/.npm-global/bin:$PATH" && cd ~/workspace-app && pnpm check
```

### 5.3 Structural read-only guard (manual, not a test file — a quick grep Bentham/the implementer should run before sign-off)

```bash
cd ~/workspace-app && grep -n "method:\s*['\"]POST['\"]\|method:\s*['\"]DELETE['\"]" src/lib/library/libraryData.ts src/routes/library/+page.svelte
```

Expect: no matches. If this ever shows a hit, the read-only boundary (design spec §8) has been violated — stop and fix before proceeding, do not commit.

### 5.4 Grep guard for private fields never requested (design spec §2.5)

```bash
cd ~/workspace-app && grep -n "props=" src/lib/library/libraryData.ts
```

Manually confirm each `props=` list against the ruled set in the design spec §2 — none of `barcode`, `condition`, `notes`, `edition_type`, `license`, `year`, `file`, `genre`, `cost`, `renewed_at` (on lending) appear.

### 5.5 Live smoke check (recommended before Bentham's review — this ticket's data crossed the 3-gate-AND live, per #54's 11:56 confirmation, so a real fetch is cheap and catches wire-shape drift the mocks can't)

Not a live-mutation — pure reads. No auth-gate ceremony required (read-only, matches `project_entu_probe_first` discipline: probe live directly). Confirm `listWorks`/`listEditions`/`listCopies`/`listLendings` against the polyphony db with a throwaway script under `scripts/migrations/probes/`, comparing shapes to what the raw-mapping code in `libraryData.ts` expects (mirrors `probe-55-library-fieldset-grooming-2026-08-08.ts`'s pattern) — catch a reference-vs-string wire-shape mismatch (see `project_entu_create_type_reference` memory: mocks can't catch wire-contract bugs) before it reaches the browser.

### 5.6 Final commit (if 5.1–5.4 surfaced any fixes)

```
test(library): T6.3 verification pass — full suite green, read-only + field-set guards confirmed (#54)

Closes #54 (T6.3 portion — browse surfaces: works/editions/copies rendering,
availability derivation, nav entry row)

Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>
```

---

## Verification checklist (post-implementation)

- [ ] `pnpm vitest run` — all tests pass
- [ ] `pnpm check` — no type errors
- [ ] `/library` reachable from nav for an authenticated member (no admin gate)
- [ ] Works list renders name + composer; a work with no composer shows the fallback label, not blank
- [ ] Expanding a work lazily loads editions (not eagerly on page load); re-expanding doesn't re-fetch
- [ ] Expanding an edition lazily loads copies; a copy shows `Available` or `Out — <borrower name>`
- [ ] An active lending with no resolvable borrower name shows the fallback label, never blank
- [ ] A returned lending (`returned_at` present) does NOT mark its copy as out
- [ ] No `barcode`/`condition`/`notes`/`edition_type`/`license`/`year`/`file`/`genre`/`cost`/`renewed_at` ever appears in a `props=` query string (grep guard, §5.4)
- [ ] No `POST`/`DELETE` call anywhere in `libraryData.ts` or the page (grep guard, §5.3)
- [ ] All 16 new keys present and translated in en/et/lv/uk
- [ ] Load-error state: generic message shown, raw error in console only, retry works
- [ ] A per-node (edition/copy) lazy-load failure shows an inline retry, does not blank the whole page

(*MVOX:Palestrina*)
