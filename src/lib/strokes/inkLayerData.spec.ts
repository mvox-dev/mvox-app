// Her layer in Entu: private, her own grants, a child of her person; one text value per page.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { INK_TYPE_ID, inkEntu } from '$lib/testing/inkEntu';
import type { InkLog } from './inkLog';
import {
	createInkLayer,
	editionOfFile,
	findInkLayers,
	latestPlace,
	writeInkPage,
	writeInkPlace
} from './inkLayerData';

const P = { db: 'sampledb', token: 'jwt-p' };
const Q = { db: 'sampledb', token: 'jwt-q' };
const PART = { personId: 'person-p', editionId: 'edition-1', fileId: 'file-score' };
const RED = { pen: 'red' as const, w: 0.004, pts: [0.1, 0.2, 0.3, 0.2] };
const BLACK = { pen: 'black' as const, w: 0.004, pts: [0.1, 0.6, 0.3, 0.6] };

const log = (strokes: InkLog['strokes'], erased: string[] = []): InkLog => ({ v: 1, strokes, erased });

let entu: ReturnType<typeof inkEntu>;

beforeEach(() => {
	resetTypeIdCache();
	entu = inkEntu({
		tokens: { 'jwt-p': { sampledb: 'person-p' }, 'jwt-q': { sampledb: 'person-q' } },
		files: { sampledb: { 'file-score': 'edition-1', 'file-alto': 'edition-1' } }
	});
});

describe('#1069 — the layer', () => {
	it('is created on her own key as a private child of her person, naming edition and file', async () => {
		const id = await createInkLayer(P, PART, entu.fetchImpl);

		const [layer] = entu.layers('sampledb', 'person-p');
		expect(layer._id).toBe(id);
		expect(layer.props._type).toEqual([expect.objectContaining({ reference: INK_TYPE_ID })]);
		expect(layer.props._parent).toEqual([expect.objectContaining({ reference: 'person-p' })]);
		expect(layer.props._inheritrights).toEqual([expect.objectContaining({ boolean: false })]);
		expect(layer.props._sharing).toEqual([expect.objectContaining({ string: 'private' })]);
		expect(layer.props.edition).toEqual([expect.objectContaining({ reference: 'edition-1' })]);
		expect(layer.props.file).toEqual([expect.objectContaining({ string: 'file-score' })]);
		expect(layer.props._owner).toBeUndefined();
		expect(layer.props._editor).toBeUndefined();
	});

	it('the edition comes from the file: the file is a value on the edition entity', async () => {
		await expect(editionOfFile(P, 'file-score', entu.fetchImpl)).resolves.toBe('edition-1');
		await expect(editionOfFile(P, 'file-gone', entu.fetchImpl)).rejects.toThrow(/file-gone.*404/);
	});

	it('she finds every one of hers for the edition and file; another person finds none of them', async () => {
		const first = await createInkLayer(P, PART, entu.fetchImpl);
		const second = await createInkLayer(P, PART, entu.fetchImpl);
		await createInkLayer(P, { ...PART, fileId: 'file-alto' }, entu.fetchImpl);

		const hers = await findInkLayers(P, PART, entu.fetchImpl);
		expect(hers.map((l) => l._id)).toEqual([first, second]);
		expect(await findInkLayers(Q, { ...PART, personId: 'person-q' }, entu.fetchImpl)).toEqual([]);
		expect(await findInkLayers(Q, PART, entu.fetchImpl)).toEqual([]);
	});

	it('a page write joins what Entu holds for that page and replaces that one value only', async () => {
		const id = await createInkLayer(P, PART, entu.fetchImpl);
		await writeInkPage(P, id, 1, log([{ id: 'a', stroke: RED }]), entu.fetchImpl);
		await writeInkPage(P, id, 2, log([{ id: 'b', stroke: BLACK }]), entu.fetchImpl);
		const pageTwo = entu.layers('sampledb', 'person-p')[0].props.page_ink[1];

		await writeInkPage(P, id, 1, log([{ id: 'c', stroke: BLACK }], ['a']), entu.fetchImpl);

		const [layer] = entu.layers('sampledb', 'person-p');
		expect(layer.pages).toHaveLength(2);
		expect(layer.props.page_ink[1]).toEqual(pageTwo);
		const [found] = await findInkLayers(P, PART, entu.fetchImpl);
		expect(found.pages.find((p) => p.page === 1)?.log).toEqual(
			log(
				[
					{ id: 'a', stroke: RED },
					{ id: 'c', stroke: BLACK }
				],
				['a']
			)
		);
	});

	it('her page: the save Entu took last wins, across two layers', async () => {
		const one = await createInkLayer(P, PART, entu.fetchImpl);
		const two = await createInkLayer(P, PART, entu.fetchImpl);
		await writeInkPlace(P, two, 5, entu.fetchImpl);
		await writeInkPlace(P, one, 3, entu.fetchImpl);
		expect(await latestPlace(P, await findInkLayers(P, PART, entu.fetchImpl), entu.fetchImpl)).toBe(3);

		await writeInkPlace(P, two, 4, entu.fetchImpl);
		const layers = await findInkLayers(P, PART, entu.fetchImpl);
		expect(layers.map((l) => l.place?.page)).toEqual([3, 4]);
		expect(await latestPlace(P, layers, entu.fetchImpl)).toBe(4);
		expect(await latestPlace(P, [], entu.fetchImpl)).toBeNull();
	});

	it('a page value Entu holds that cannot be read stops the write, so it is not overwritten', async () => {
		const id = await createInkLayer(P, PART, entu.fetchImpl);
		entu.layers('sampledb', 'person-p')[0].props.page_ink = [
			{ _id: 'value-bad', string: '{not json', at: '2026-11-03T10:00:00.000Z' }
		];
		await expect(writeInkPage(P, id, 1, log([{ id: 'a', stroke: RED }]), entu.fetchImpl)).rejects.toThrow(
			/value-bad/
		);
		expect(entu.state.entities[0].props.page_ink).toEqual([expect.objectContaining({ _id: 'value-bad' })]);
	});
});

// (*MVOX:Josquin*)
