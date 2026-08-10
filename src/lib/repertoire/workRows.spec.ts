import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { Work, Edition, Copy } from '$lib/library/libraryData';
import type { EventWorks } from './repertoireData';
import type { WorkRow } from './types';
import { buildWorkRows, collectSources, loadWorksByEventId } from './workRows';

// #90 TR.2 — the JOIN the branch was missing: repertoireData resolves WHICH
// items an event shows (refs only); everything a member reads (work name,
// composer, edition name, links, PDF file id, borrowability) lives on the
// work/edition/copy entities. Without this module nothing anywhere produced a
// WorkRow, so the agenda's Works element could never render for a real user.

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

const works: Work[] = [
	{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' },
	{ id: 'work-2', name: 'Mass in B minor', composer: 'J. S. Bach' }
];

const editions: Edition[] = [
	{
		id: 'ed-1',
		name: '40-part original',
		publisher: 'Oxford',
		workId: 'work-1',
		externalLinks: ['https://imslp.org/wiki/Spem_in_alium'],
		files: [
			{ id: 'file-cover', filename: 'cover.jpg', filesize: 10, filetype: 'image/jpeg' },
			{ id: 'file-score', filename: 'spem-vocal-score.pdf', filesize: 1937, filetype: 'application/pdf' }
		]
	},
	{
		id: 'ed-2',
		name: 'Bärenreiter BA 5103',
		publisher: 'Bärenreiter',
		workId: 'work-2',
		externalLinks: [],
		files: []
	}
];

const copies: Copy[] = [
	{ id: 'copy-1', name: '#1', copyNumber: 1, editionId: 'ed-1' },
	{ id: 'copy-2', name: '#2', copyNumber: 2, editionId: 'ed-1' }
];

const sources = collectSources(works, editions, copies);

// ── buildWorkRows — the program branch (edition-first) ──────────────────────

describe('buildWorkRows — program items', () => {
	const eventWorks: EventWorks = {
		source: 'program',
		items: [
			{ id: 'pi-1', editionId: 'ed-1', ordinal: 1, notes: 'soloist: N. N.', name: 'Spem in alium' },
			{ id: 'pi-2', editionId: 'ed-2', ordinal: 2, notes: '', name: 'Mass in B minor' }
		]
	};

	it('joins edition -> parent work for composer, keeps ordinal + notes, and carries NO status', () => {
		expect(buildWorkRows(eventWorks, sources)).toEqual<WorkRow[]>([
			{
				id: 'pi-1',
				workName: 'Spem in alium',
				composer: 'Thomas Tallis',
				status: null,
				editionName: '40-part original',
				ordinal: 1,
				fileId: 'file-score',
				externalLinks: ['https://imslp.org/wiki/Spem_in_alium'],
				canBorrow: true,
				notes: 'soloist: N. N.'
			},
			{
				id: 'pi-2',
				workName: 'Mass in B minor',
				composer: 'J. S. Bach',
				status: null,
				editionName: 'Bärenreiter BA 5103',
				ordinal: 2,
				fileId: '',
				externalLinks: [],
				canBorrow: false,
				notes: ''
			}
		]);
	});

	it('prefers the PDF file over other attachments, and yields a file ID — never a url', () => {
		const [row] = buildWorkRows(eventWorks, sources);
		expect(row.fileId).toBe('file-score');
		expect(row.fileId).not.toMatch(/^https?:/);
	});

	it('falls back to the item name and blanks the join when the edition is unreadable', () => {
		const rows = buildWorkRows(
			{
				source: 'program',
				items: [{ id: 'pi-9', editionId: 'ed-gone', ordinal: 1, notes: '', name: 'Ghost piece' }]
			},
			sources
		);
		expect(rows).toEqual<WorkRow[]>([
			{
				id: 'pi-9',
				workName: 'Ghost piece',
				composer: '',
				status: null,
				editionName: '',
				ordinal: 1,
				fileId: '',
				externalLinks: [],
				canBorrow: false,
				notes: ''
			}
		]);
	});
});

// ── buildWorkRows — the repertoire branch (work-first) ──────────────────────

describe('buildWorkRows — repertoire items', () => {
	it('joins the work directly, keeps the status badge, and carries no ordinal or notes', () => {
		const rows = buildWorkRows(
			{
				source: 'repertoire',
				items: [
					{ id: 'ri-1', workId: 'work-1', editionId: 'ed-1', status: 'active', name: 'Spem in alium' },
					{ id: 'ri-2', workId: 'work-2', editionId: '', status: 'learning', name: 'Mass in B minor' }
				]
			},
			sources
		);
		expect(rows).toEqual<WorkRow[]>([
			{
				id: 'ri-1',
				workName: 'Spem in alium',
				composer: 'Thomas Tallis',
				status: 'active',
				editionName: '40-part original',
				ordinal: null,
				fileId: 'file-score',
				externalLinks: ['https://imslp.org/wiki/Spem_in_alium'],
				canBorrow: true,
				notes: ''
			},
			{
				id: 'ri-2',
				workName: 'Mass in B minor',
				composer: 'J. S. Bach',
				status: 'learning',
				editionName: '',
				ordinal: null,
				fileId: '',
				externalLinks: [],
				canBorrow: false,
				notes: ''
			}
		]);
	});

	it('drops the badge for a status outside learning/active — a data slip is not a badge', () => {
		const rows = buildWorkRows(
			{
				source: 'repertoire',
				items: [{ id: 'ri-x', workId: 'work-1', editionId: '', status: 'weird', name: 'Odd' }]
			},
			sources
		);
		expect(rows[0].status).toBeNull();
	});
});

// ── external_link scheme filter (#90 review) ────────────────────────────────
// `edition.external_link` is free text typed by anyone with editor rights on
// the edition, and RepertoireElement binds it straight into an href — Svelte
// does not sanitize href bindings. Filtering in the producer (not the template)
// means every future WorkRow consumer inherits it.

describe('buildWorkRows — external link scheme filter', () => {
	const hostileEditions: Edition[] = [
		{
			id: 'ed-h',
			name: 'Hostile edition',
			publisher: '',
			workId: 'work-1',
			externalLinks: [
				'javascript:alert(document.cookie)',
				'https://imslp.org/wiki/Spem_in_alium',
				'JavaScript:alert(1)',
				'data:text/html,<script>alert(1)</script>',
				'not a url at all',
				'http://example.org/score'
			],
			files: []
		}
	];
	const hostileSources = collectSources(works, hostileEditions, []);

	it('keeps only http(s) urls on a program row — javascript:/data:/garbage are dropped', () => {
		const rows = buildWorkRows(
			{
				source: 'program',
				items: [{ id: 'pi-h', editionId: 'ed-h', ordinal: 1, notes: '', name: 'Hostile' }]
			},
			hostileSources
		);
		expect(rows[0].externalLinks).toEqual([
			'https://imslp.org/wiki/Spem_in_alium',
			'http://example.org/score'
		]);
	});

	it('keeps only http(s) urls on a repertoire row too', () => {
		const rows = buildWorkRows(
			{
				source: 'repertoire',
				items: [{ id: 'ri-h', workId: 'work-1', editionId: 'ed-h', status: 'active', name: 'Hostile' }]
			},
			hostileSources
		);
		expect(rows[0].externalLinks).toEqual([
			'https://imslp.org/wiki/Spem_in_alium',
			'http://example.org/score'
		]);
	});
});

// ── loadWorksByEventId — the page's entry point ─────────────────────────────

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('loadWorksByEventId', () => {
	it('makes NO fetch at all for an empty event list', async () => {
		const fetchImpl = vi.fn();
		expect(await loadWorksByEventId(cfg, [], 'season-1', fetchImpl)).toEqual({});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('assembles a renderable WorkRow end-to-end from the live wire shapes', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string | URL | Request) => {
			const s = String(url);
			if (s.includes('_type.string=work')) {
				return Promise.resolve(
					json({
						entities: [
							{
								_id: 'work-1',
								name: [{ string: 'Spem in alium' }],
								composer: [{ string: 'Thomas Tallis' }]
							}
						]
					})
				);
			}
			if (s.includes('_type.string=edition')) {
				return Promise.resolve(
					json({
						entities: [
							{
								_id: 'ed-1',
								name: [{ string: '40-part original' }],
								_parent: [{ reference: 'work-1', entity_type: 'work' }],
								external_link: [{ string: 'https://imslp.org/wiki/Spem_in_alium' }],
								file: [
									{
										_id: 'file-score',
										filename: 'spem.pdf',
										filesize: 1,
										filetype: 'application/pdf'
									}
								]
							}
						]
					})
				);
			}
			if (s.includes('_type.string=copy')) {
				return Promise.resolve(
					json({
						entities: [
							{
								_id: 'copy-1',
								copy_number: [{ number: 1 }],
								_parent: [{ reference: 'ed-1', entity_type: 'edition' }]
							}
						]
					})
				);
			}
			if (s.includes('_type.string=program_item')) return Promise.resolve(json({ entities: [] }));
			if (s.includes('_type.string=repertoire_item')) {
				return Promise.resolve(
					json({
						entities: [
							{
								_id: 'ri-1',
								name: [{ string: 'Spem in alium' }],
								work: [{ reference: 'work-1' }],
								edition: [{ reference: 'ed-1' }],
								status: [{ string: 'active' }]
							}
						]
					})
				);
			}
			return Promise.resolve(json({ error: `unrouted: ${s}` }, 404));
		});

		const byEvent = await loadWorksByEventId(cfg, ['e1'], 'season-1', fetchImpl);
		expect(byEvent).toEqual<Record<string, WorkRow[]>>({
			e1: [
				{
					id: 'ri-1',
					workName: 'Spem in alium',
					composer: 'Thomas Tallis',
					status: 'active',
					editionName: '40-part original',
					ordinal: null,
					fileId: 'file-score',
					externalLinks: ['https://imslp.org/wiki/Spem_in_alium'],
					canBorrow: true,
					notes: ''
				}
			]
		});
	});
});

// (*MVOX:Josquin*)
