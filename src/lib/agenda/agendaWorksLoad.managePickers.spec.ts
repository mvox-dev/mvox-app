import { describe, expect, it } from 'vitest';
import { createAgendaLoadState, createLoadCounters, type AgendaLoadDeps } from './agendaLoad';
import { createAgendaWorksLoad } from './agendaWorksLoad';
import type { Edition, Work } from '$lib/library/libraryData';
import type { RepertoireItem } from '$lib/repertoire/repertoireData';

const cfg = { db: 'db1', token: 't' } as unknown as Parameters<AgendaLoadDeps['listWorks']>[0];

type Read = { works: Work[]; editions: Edition[]; repertoire: RepertoireItem[] };

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
}

function read(tag: string): Read {
	return {
		works: [{ id: `work-${tag}`, name: `Work ${tag}`, composer: 'C' }],
		editions: [
			{ id: `ed-${tag}`, name: `Ed ${tag}`, publisher: 'P', externalLinks: [], files: [] }
		],
		repertoire: [
			{ id: `rep-${tag}`, workId: `work-${tag}`, editionId: '', status: 'active', name: tag }
		]
	};
}

function setup() {
	const ag = createAgendaLoadState();
	const seq = createLoadCounters();
	const pending: Array<ReturnType<typeof deferred<Read>>> = [];
	const next = () => pending[pending.length - 1].promise;
	const deps = {
		listWorks: () => {
			pending.push(deferred<Read>());
			return next().then((r) => ({ items: r.works, truncated: false }));
		},
		listAllEditions: () => next().then((r) => ({ items: r.editions, truncated: false })),
		listRepertoireItems: () => next().then((r) => r.repertoire)
	} as unknown as AgendaLoadDeps;
	const works = createAgendaWorksLoad(ag, seq, deps);
	const settle = async (r: Read) => {
		pending[pending.length - 1].resolve(r);
		await new Promise((done) => setTimeout(done, 0));
	};
	return { ag, seq, works, settle };
}

describe('agenda manage pickers: loading on the first load only', () => {
	it('the first load after a reset shows loading until the pickers land', async () => {
		const { ag, seq, works, settle } = setup();
		works.resetManagement();
		works.loadManagePickers(cfg, 'season-1', seq.requestId);
		expect(ag.libraryPickersLoading).toBe(true);
		await settle(read('a'));
		expect(ag.libraryPickersLoading).toBe(false);
		expect(ag.libraryWorks).toEqual(read('a').works);
	});

	it('a second load keeps the shown pickers and does not show loading', async () => {
		const { ag, seq, works, settle } = setup();
		works.resetManagement();
		works.loadManagePickers(cfg, 'season-1', seq.requestId);
		await settle(read('a'));

		works.loadManagePickers(cfg, 'season-1', seq.requestId);
		expect(ag.libraryPickersLoading).toBe(false);
		expect(ag.libraryPickersLoadSucceeded).toBe(true);
		expect(ag.libraryWorks).toEqual(read('a').works);
		expect(ag.libraryEditions).toEqual(read('a').editions);
		expect(ag.seasonRepertoire).toEqual(read('a').repertoire);

		await settle(read('b'));
		expect(ag.libraryPickersLoading).toBe(false);
		expect(ag.libraryWorks).toEqual(read('b').works);
		expect(ag.libraryEditions).toEqual(read('b').editions);
		expect(ag.seasonRepertoire).toEqual(read('b').repertoire);
	});
});
