// Her ink on a part, kept on the device per (db, person, file, page); an erase is a tombstone.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createInkStore, liveInk, type InkPage } from './inkStore';
import type { Stroke, StrokeData } from './strokes';

const AT: InkPage = { db: 'sampledb', personId: 'person-p', fileId: 'file-score', page: 1 };

const RED: Stroke = { pen: 'red', w: 0.004, pts: [0.1, 0.2, 0.3, 0.2] };
const BLACK: Stroke = { pen: 'black', w: 0.004, pts: [0.1, 0.6, 0.3, 0.6], p: [0.5, 0.7] };

function ink(...strokes: Stroke[]): StrokeData {
	return { v: 1, strokes };
}

describe('#616 — the ink store', () => {
	it('a page with nothing saved reads as an empty log', async () => {
		const log = await createInkStore(new IDBFactory()).load(AT);
		expect(log).toEqual({ v: 1, strokes: [], erased: [] });
		expect(liveInk(log)).toEqual(ink());
	});

	it('saved ink reads back through a fresh store on the same device', async () => {
		const device = new IDBFactory();
		await createInkStore(device).save(AT, ink(RED, BLACK));

		const log = await createInkStore(device).load(AT);
		expect(liveInk(log)).toEqual(ink(RED, BLACK));
		expect(log).toEqual({
			v: 1,
			strokes: [
				{ id: expect.any(String), stroke: RED },
				{ id: expect.any(String), stroke: BLACK }
			],
			erased: []
		});
		expect(log.strokes[0].id).not.toBe(log.strokes[1].id);
	});

	it('an erase keeps the stroke and stores its id as a tombstone', async () => {
		const device = new IDBFactory();
		const store = createInkStore(device);
		await store.save(AT, ink(RED, BLACK));
		const [red, black] = (await store.load(AT)).strokes;

		await store.save(AT, ink(BLACK));

		const log = await createInkStore(device).load(AT);
		expect(log).toEqual({ v: 1, strokes: [red, black], erased: [red.id] });
		expect(liveInk(log)).toEqual(ink(BLACK));
	});

	it('undoing an erase adds the mark again under a new id; the tombstone stays', async () => {
		const store = createInkStore(new IDBFactory());
		await store.save(AT, ink(RED));
		await store.save(AT, ink());
		await store.save(AT, ink(RED));

		const log = await store.load(AT);
		expect(log.strokes.map((s) => s.stroke)).toEqual([RED, RED]);
		expect(log.erased).toEqual([log.strokes[0].id]);
		expect(liveInk(log)).toEqual(ink(RED));
	});

	it('a save that changes nothing adds nothing', async () => {
		const store = createInkStore(new IDBFactory());
		await store.save(AT, ink(RED, BLACK));
		const before = await store.load(AT);
		await store.save(AT, ink(RED, BLACK));
		expect(await store.load(AT)).toEqual(before);
	});

	it('two identical marks on one page are two strokes; erasing one keeps the other', async () => {
		const store = createInkStore(new IDBFactory());
		await store.save(AT, ink(RED, RED));
		await store.save(AT, ink(RED));

		const log = await store.load(AT);
		expect(log.strokes).toHaveLength(2);
		expect(log.erased).toHaveLength(1);
		expect(liveInk(log)).toEqual(ink(RED));
	});

	it('ink is kept apart per collective, person, file and page', async () => {
		const device = new IDBFactory();
		await createInkStore(device).save(AT, ink(RED));

		const store = createInkStore(device);
		for (const other of [
			{ ...AT, db: 'otherdb' },
			{ ...AT, personId: 'person-q' },
			{ ...AT, fileId: 'file-other' },
			{ ...AT, page: 2 }
		]) {
			expect(liveInk(await store.load(other)), JSON.stringify(other)).toEqual(ink());
		}
		expect(liveInk(await store.load(AT))).toEqual(ink(RED));
	});

	it('saves to the same page in quick succession all land', async () => {
		const store = createInkStore(new IDBFactory());
		await Promise.all([
			store.save(AT, ink(RED)),
			store.save(AT, ink(RED, BLACK)),
			store.save(AT, ink(BLACK))
		]);
		const log = await store.load(AT);
		expect(log.strokes.map((s) => s.stroke)).toEqual([RED, BLACK]);
		expect(log.erased).toEqual([log.strokes[0].id]);
	});
});

// (*MVOX:Josquin*)
