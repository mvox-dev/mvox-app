// The landing's own reads (#1063), driven over a fake Entu wire.
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { initialsOf, readEventTally, readLearningWorks } from './landingReads';

const CFG = { db: 'sampledb', token: 'jwt' };

function wire(byType: Record<string, unknown[]>) {
	const seen: string[] = [];
	const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
		const url = decodeURIComponent(String(input));
		const type = /_type\.string=([a-z_]+)/.exec(url)?.[1] ?? '';
		seen.push(type);
		return new Response(JSON.stringify({ entities: byType[type] ?? [], count: (byType[type] ?? []).length }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	});
	return { fetchImpl: fetchImpl as unknown as typeof fetch, seen };
}

const ref = (id: string) => [{ reference: id }];
const str = (v: string) => [{ string: v }];
const file = (id: string, filename: string, filetype: string) => ({ _id: id, filename, filesize: 1, filetype });

describe('readLearningWorks', () => {
	it('gives one row per learning work, a sheet per learning edition, the PDF first', async () => {
		const { fetchImpl } = wire({
			repertoire_item: [
				{ _id: 'ri1', work: ref('w1'), edition: ref('ed1'), status: str('learning') },
				{ _id: 'ri2', work: ref('w1'), edition: ref('ed2'), status: str('learning') },
				{ _id: 'ri3', work: ref('w2'), edition: ref('ed3'), status: str('active') },
				{ _id: 'ri4', work: ref('w3'), status: str('learning'), name: str('Stored name') }
			],
			work: [
				{ _id: 'w1', name: str('Ave verum'), composer: str('Mozart') },
				{ _id: 'w2', name: str('Not learning'), composer: str('X') }
			],
			edition: [
				{ _id: 'ed1', name: str('Carus'), file: [file('f-mp3', 'a.mp3', 'audio/mpeg'), file('f1', 'a.pdf', 'application/pdf')] },
				{ _id: 'ed2', name: str('Bärenreiter'), file: [file('f2', 'b.pdf', 'application/pdf')] }
			]
		});
		expect(await readLearningWorks(CFG, 's1', fetchImpl)).toEqual([
			{
				workId: 'w1',
				name: 'Ave verum',
				composer: 'Mozart',
				sheets: [
					{ fileId: 'f1', filename: 'a.pdf', edition: 'Carus' },
					{ fileId: 'f2', filename: 'b.pdf', edition: 'Bärenreiter' }
				]
			},
			{ workId: 'w3', name: 'Stored name', composer: '', sheets: [] }
		]);
	});

	it('reads no works or editions when nothing is being learned', async () => {
		const { fetchImpl, seen } = wire({
			repertoire_item: [{ _id: 'ri1', work: ref('w1'), status: str('active') }]
		});
		expect(await readLearningWorks(CFG, 's1', fetchImpl)).toEqual([]);
		expect(seen).toEqual(['repertoire_item']);
	});
});

describe('readEventTally', () => {
	it('counts going and not-responded over active members only', async () => {
		const { fetchImpl } = wire({
			rsvp: [
				{ _id: 'r1', member: ref('m1'), status: str('going') },
				{ _id: 'r2', member: ref('m2'), status: str('maybe') },
				{ _id: 'r3', member: ref('m-gone'), status: str('going') }
			],
			member: ['m1', 'm2', 'm3', 'm4'].map((id) => ({ _id: id, person: ref(`p-${id}`) }))
		});
		expect(await readEventTally(CFG, 'e1', fetchImpl)).toEqual({ going: 1, notResponded: 2 });
	});
});

describe('initialsOf', () => {
	it.each([
		['Anna Kask', 'AK'],
		['  mari  ann  tamm ', 'MT'],
		['Õie', 'Õ'],
		['', '']
	])('%j gives %j', (name, initials) => {
		expect(initialsOf(name)).toBe(initials);
	});
});

// (*MVOX:Josquin*)
