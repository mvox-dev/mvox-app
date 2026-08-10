import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import {
	listRepertoireItems,
	listProgramItems,
	resolveEventWorks,
	resolveEventWorksBatch,
	type RepertoireItem,
	type ProgramItem,
	type EventWorks
} from './repertoireData';

// #90 TR.2 RED — the repertoire READ data layer. Read-only throughout: no
// entuFetch(..., { method: 'POST' | 'DELETE' }) anywhere in the module under
// test. Schema anchors (entu/research schema.ts):
//   repertoire_item — child of season; props: name (formula from work), work
//     (ref, required), edition (ref, optional pinned edition), status
//     ('learning | active | retired | dropped; default `active`').
//   program_item — child of event; props: name (formula via edition→work),
//     edition (ref, required), ordinal (number, required, concert position),
//     notes (text).
// Source hierarchy (#90): an event WITH program_items uses those (ordinal
// order); an event WITHOUT falls back to the season's repertoire_items,
// filtered to active/learning — retired/dropped never reach a member's view.

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/** Route-by-URL mock: first matching pattern wins; unmatched URLs 404 loudly. */
function fetchByUrl(routes: Array<[RegExp, unknown]>) {
	return vi.fn().mockImplementation((url: string | URL | Request) => {
		const s = String(url);
		for (const [re, body] of routes) {
			if (re.test(s)) return Promise.resolve(json(body));
		}
		return Promise.resolve(json({ error: `unrouted: ${s}` }, 404));
	});
}

// ── listRepertoireItems ─────────────────────────────────────────────────────

describe('listRepertoireItems', () => {
	it('maps season repertoire_item entities into RepertoireItem[] (work ref, edition ref, status, name)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'ri-1',
						name: [{ string: 'Spem in alium' }],
						work: [{ reference: 'work-1', string: 'Spem in alium' }],
						edition: [{ reference: 'ed-1' }],
						status: [{ string: 'learning' }]
					},
					{
						// no pinned edition, no status — status defaults to 'active' per schema
						_id: 'ri-2',
						name: [{ string: 'Mass in B minor' }],
						work: [{ reference: 'work-2' }]
					}
				]
			})
		);
		const items = await listRepertoireItems(cfg, 'season-1', fetchImpl);
		expect(items).toEqual<RepertoireItem[]>([
			{ id: 'ri-1', workId: 'work-1', editionId: 'ed-1', status: 'learning', name: 'Spem in alium' },
			{ id: 'ri-2', workId: 'work-2', editionId: '', status: 'active', name: 'Mass in B minor' }
		]);
	});

	it('URL: _type.string=repertoire_item scoped by _parent.reference=seasonId, props=name,work,edition,status, limit=500', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listRepertoireItems(cfg, 'season-1', fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=repertoire_item');
		expect(url).toContain('_parent.reference=season-1');
		const propList = (/[?&]props=([^&]*)/.exec(url)?.[1] ?? '').split(',');
		expect(propList).toContain('name');
		expect(propList).toContain('work');
		expect(propList).toContain('edition');
		expect(propList).toContain('status');
		expect(url).toContain('limit=500');
	});

	it('drops a row with no readable work reference — never fabricates workId ""', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'ri-broken', name: [{ string: 'Ghost' }] }, // no work ref visible
					{ _id: 'ri-ok', name: [{ string: 'Real' }], work: [{ reference: 'work-9' }] }
				]
			})
		);
		const items = await listRepertoireItems(cfg, 'season-1', fetchImpl);
		expect(items).toEqual<RepertoireItem[]>([
			{ id: 'ri-ok', workId: 'work-9', editionId: '', status: 'active', name: 'Real' }
		]);
	});

	it('fails loud on non-2xx', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(listRepertoireItems(cfg, 'season-1', fetchImpl)).rejects.toThrow(/500/);
	});
});

// ── listProgramItems ────────────────────────────────────────────────────────

describe('listProgramItems', () => {
	it('maps event program_item entities into ProgramItem[] sorted by ordinal', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					// deliberately OUT of ordinal order — the layer sorts, callers must not
					{
						_id: 'pi-3',
						name: [{ string: 'Nunc dimittis' }],
						edition: [{ reference: 'ed-3' }],
						ordinal: [{ number: 3 }]
					},
					{
						_id: 'pi-1',
						name: [{ string: 'Spem in alium' }],
						edition: [{ reference: 'ed-1' }],
						ordinal: [{ number: 1 }],
						notes: [{ string: 'soloist: N. N.' }]
					},
					{
						_id: 'pi-2',
						name: [{ string: 'Mass in B minor' }],
						edition: [{ reference: 'ed-2' }],
						ordinal: [{ number: 2 }]
					}
				]
			})
		);
		const items = await listProgramItems(cfg, 'event-1', fetchImpl);
		expect(items).toEqual<ProgramItem[]>([
			{ id: 'pi-1', editionId: 'ed-1', ordinal: 1, notes: 'soloist: N. N.', name: 'Spem in alium' },
			{ id: 'pi-2', editionId: 'ed-2', ordinal: 2, notes: '', name: 'Mass in B minor' },
			{ id: 'pi-3', editionId: 'ed-3', ordinal: 3, notes: '', name: 'Nunc dimittis' }
		]);
	});

	it('URL: _type.string=program_item scoped by _parent.reference=eventId, props=name,edition,ordinal,notes, limit=500', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listProgramItems(cfg, 'event-1', fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=program_item');
		expect(url).toContain('_parent.reference=event-1');
		const propList = (/[?&]props=([^&]*)/.exec(url)?.[1] ?? '').split(',');
		expect(propList).toContain('name');
		expect(propList).toContain('edition');
		expect(propList).toContain('ordinal');
		expect(propList).toContain('notes');
		expect(url).toContain('limit=500');
	});

	it('fails loud on non-2xx', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(listProgramItems(cfg, 'event-1', fetchImpl)).rejects.toThrow(/500/);
	});
});

// ── resolveEventWorks — the source hierarchy ────────────────────────────────

const programEntities = [
	{
		_id: 'pi-2',
		name: [{ string: 'Mass in B minor' }],
		edition: [{ reference: 'ed-2' }],
		ordinal: [{ number: 2 }]
	},
	{
		_id: 'pi-1',
		name: [{ string: 'Spem in alium' }],
		edition: [{ reference: 'ed-1' }],
		ordinal: [{ number: 1 }]
	}
];

const repertoireEntities = [
	{
		_id: 'ri-1',
		name: [{ string: 'Spem in alium' }],
		work: [{ reference: 'work-1' }],
		edition: [{ reference: 'ed-1' }],
		status: [{ string: 'active' }]
	},
	{
		_id: 'ri-2',
		name: [{ string: 'Mass in B minor' }],
		work: [{ reference: 'work-2' }],
		status: [{ string: 'learning' }]
	},
	{
		_id: 'ri-3',
		name: [{ string: 'Old warhorse' }],
		work: [{ reference: 'work-3' }],
		status: [{ string: 'retired' }]
	},
	{
		_id: 'ri-4',
		name: [{ string: 'Abandoned piece' }],
		work: [{ reference: 'work-4' }],
		status: [{ string: 'dropped' }]
	}
];

describe('resolveEventWorks — source hierarchy', () => {
	it("an event WITH program_items uses those (source: 'program', ordinal order) and never queries the season's repertoire", async () => {
		const fetchImpl = fetchByUrl([
			[/_type\.string=program_item/, { entities: programEntities }],
			[/_type\.string=repertoire_item/, { entities: repertoireEntities }]
		]);
		const result = await resolveEventWorks(cfg, 'event-1', 'season-1', fetchImpl);
		expect(result).toEqual<EventWorks>({
			source: 'program',
			items: [
				{ id: 'pi-1', editionId: 'ed-1', ordinal: 1, notes: '', name: 'Spem in alium' },
				{ id: 'pi-2', editionId: 'ed-2', ordinal: 2, notes: '', name: 'Mass in B minor' }
			]
		});
		// The whole point of the hierarchy: a programmed event does NOT hit repertoire.
		const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('_type.string=repertoire_item'))).toBe(false);
	});

	it("an event WITHOUT program_items falls back to season repertoire (source: 'repertoire')", async () => {
		const fetchImpl = fetchByUrl([
			[/_type\.string=program_item/, { entities: [] }],
			[/_type\.string=repertoire_item/, { entities: repertoireEntities }]
		]);
		const result = await resolveEventWorks(cfg, 'event-1', 'season-1', fetchImpl);
		expect(result.source).toBe('repertoire');
		const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('_type.string=repertoire_item'))).toBe(true);
		expect(urls.some((u) => u.includes('_parent.reference=season-1'))).toBe(true);
	});

	it('the repertoire fallback filters to active/learning — retired and dropped never reach a member (#90 AC-8)', async () => {
		const fetchImpl = fetchByUrl([
			[/_type\.string=program_item/, { entities: [] }],
			[/_type\.string=repertoire_item/, { entities: repertoireEntities }]
		]);
		const result = await resolveEventWorks(cfg, 'event-1', 'season-1', fetchImpl);
		expect(result).toEqual<EventWorks>({
			source: 'repertoire',
			items: [
				{ id: 'ri-1', workId: 'work-1', editionId: 'ed-1', status: 'active', name: 'Spem in alium' },
				{ id: 'ri-2', workId: 'work-2', editionId: '', status: 'learning', name: 'Mass in B minor' }
			]
		});
	});

	it('no program_items and no current season (seasonId null) resolves to an empty repertoire — no second fetch', async () => {
		const fetchImpl = fetchByUrl([[/_type\.string=program_item/, { entities: [] }]]);
		const result = await resolveEventWorks(cfg, 'event-1', null, fetchImpl);
		expect(result).toEqual<EventWorks>({ source: 'repertoire', items: [] });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('fails loud when the program_item read fails — never silently degrades to the fallback', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(resolveEventWorks(cfg, 'event-1', 'season-1', fetchImpl)).rejects.toThrow(/500/);
	});
});

// ── resolveEventWorksBatch — the whole agenda in one pass ──────────────────
// The agenda renders every event at once. Resolving them one at a time re-read
// the SAME season repertoire once per unprogrammed event (an N+1 against an
// identical list), so the page calls the batch instead.

describe('resolveEventWorksBatch', () => {
	it('reads the season repertoire AT MOST ONCE across many unprogrammed events', async () => {
		const fetchImpl = fetchByUrl([
			[/_type\.string=program_item/, { entities: [] }],
			[/_type\.string=repertoire_item/, { entities: repertoireEntities }]
		]);
		const byEvent = await resolveEventWorksBatch(cfg, ['e1', 'e2', 'e3'], 'season-1', fetchImpl);
		const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => u.includes('_type.string=repertoire_item')).length).toBe(1);
		expect(Object.keys(byEvent).sort()).toEqual(['e1', 'e2', 'e3']);
		for (const id of ['e1', 'e2', 'e3']) {
			expect(byEvent[id]).toEqual<EventWorks>({
				source: 'repertoire',
				items: [
					{ id: 'ri-1', workId: 'work-1', editionId: 'ed-1', status: 'active', name: 'Spem in alium' },
					{ id: 'ri-2', workId: 'work-2', editionId: '', status: 'learning', name: 'Mass in B minor' }
				]
			});
		}
	});

	it('mixes sources per event: a programmed event keeps its programme, the rest fall back', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string | URL | Request) => {
			const s = String(url);
			if (s.includes('_type.string=program_item')) {
				return Promise.resolve(
					json({ entities: s.includes('_parent.reference=concert') ? programEntities : [] })
				);
			}
			if (s.includes('_type.string=repertoire_item')) {
				return Promise.resolve(json({ entities: repertoireEntities }));
			}
			return Promise.resolve(json({ error: `unrouted: ${s}` }, 404));
		});
		const byEvent = await resolveEventWorksBatch(cfg, ['concert', 'rehearsal'], 'season-1', fetchImpl);
		expect(byEvent.concert.source).toBe('program');
		expect(byEvent.concert.items.map((i) => i.id)).toEqual(['pi-1', 'pi-2']);
		expect(byEvent.rehearsal.source).toBe('repertoire');
	});

	it('never touches the repertoire when EVERY event is programmed', async () => {
		const fetchImpl = fetchByUrl([
			[/_type\.string=program_item/, { entities: programEntities }],
			[/_type\.string=repertoire_item/, { entities: repertoireEntities }]
		]);
		await resolveEventWorksBatch(cfg, ['e1', 'e2'], 'season-1', fetchImpl);
		const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('_type.string=repertoire_item'))).toBe(false);
	});

	it('dedupes repeated event ids and fetches each event exactly once', async () => {
		const fetchImpl = fetchByUrl([[/_type\.string=program_item/, { entities: programEntities }]]);
		const byEvent = await resolveEventWorksBatch(cfg, ['e1', 'e1'], null, fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(Object.keys(byEvent)).toEqual(['e1']);
	});

	it('an empty repertoire fallback yields an empty programme, not a missing entry', async () => {
		const fetchImpl = fetchByUrl([[/_type\.string=program_item/, { entities: [] }]]);
		const byEvent = await resolveEventWorksBatch(cfg, ['e1'], null, fetchImpl);
		expect(byEvent).toEqual<Record<string, EventWorks>>({
			e1: { source: 'repertoire', items: [] }
		});
	});

	it('fails loud as a whole when ONE event read fails — never a partially work-free agenda', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string | URL | Request) => {
			const s = String(url);
			if (s.includes('_parent.reference=bad')) return Promise.resolve(json({}, 500));
			return Promise.resolve(json({ entities: [] }));
		});
		await expect(
			resolveEventWorksBatch(cfg, ['ok', 'bad'], null, fetchImpl)
		).rejects.toThrow(/500/);
	});
});

// ── manage read mode (#91 review finding 3) ─────────────────────────────────
// The member-facing active/learning filter made the status toggle ONE-WAY: set
// a work to retired and its row (and with it the only toggle that could bring
// it back) vanished, while pickableWorks refuses to re-offer a work that
// already HAS a repertoire_item. A rights-holder reads the list unfiltered.

describe('resolveEventWorks — includeInactive (management read)', () => {
	function fallbackFetch() {
		return fetchByUrl([
			[/_type\.string=program_item/, { entities: [] }],
			[/_type\.string=repertoire_item/, { entities: repertoireEntities }]
		]);
	}

	it('default (member) read still drops retired/dropped — AC-8 is unchanged', async () => {
		const result = await resolveEventWorks(cfg, 'event-1', 'season-1', fallbackFetch());
		expect(result.items.map((item) => item.id)).toEqual(['ri-1', 'ri-2']);
	});

	it('includeInactive keeps retired AND dropped, so the toggle has something to toggle back', async () => {
		const result = await resolveEventWorks(cfg, 'event-1', 'season-1', fallbackFetch(), {
			includeInactive: true
		});
		expect(result.source).toBe('repertoire');
		if (result.source !== 'repertoire') return;
		expect(result.items.map((item) => item.id)).toEqual(['ri-1', 'ri-2', 'ri-3', 'ri-4']);
		expect(result.items.map((item) => item.status)).toContain('retired');
		expect(result.items.map((item) => item.status)).toContain('dropped');
	});

	it('includeInactive changes NOTHING about the source hierarchy — a programmed event still never reads repertoire', async () => {
		const fetchImpl = fetchByUrl([
			[/_type\.string=program_item/, { entities: programEntities }],
			[/_type\.string=repertoire_item/, { entities: repertoireEntities }]
		]);
		const result = await resolveEventWorks(cfg, 'event-1', 'season-1', fetchImpl, {
			includeInactive: true
		});
		expect(result.source).toBe('program');
		const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('_type.string=repertoire_item'))).toBe(false);
	});

	it('batch: includeInactive still reads the season repertoire AT MOST ONCE across events', async () => {
		const fetchImpl = fetchByUrl([
			[/_type\.string=program_item/, { entities: [] }],
			[/_type\.string=repertoire_item/, { entities: repertoireEntities }]
		]);
		await resolveEventWorksBatch(cfg, ['e1', 'e2', 'e3'], 'season-1', fetchImpl, {
			includeInactive: true
		});
		const repertoireReads = fetchImpl.mock.calls.filter((c) =>
			String(c[0]).includes('_type.string=repertoire_item')
		);
		expect(repertoireReads.length).toBe(1);
	});
});

// (*MVOX:Tallis* — RED spec)
// (*MVOX:Josquin* — review fix-forward: batch resolver; edition metadata now
// comes from libraryData's bulk reads, file signing from fileUrls.ts)
