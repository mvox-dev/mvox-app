// @vitest-environment happy-dom
// Her ink goes to Entu on her own key and comes back on her other devices, joined, erases kept.
import { IDBFactory } from 'fake-indexeddb';
import { waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { endSession } from '$lib/auth/session';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { resetAppState } from '$lib/testing/appReset';
import { deferred } from '$lib/testing/entuFetchKit';
import { inkEntu } from '$lib/testing/inkEntu';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import { installLocks } from '$lib/testing/locks';
import { goOffline, goOnline, resetOnLine, settle } from '$lib/testing/networkSignal';
import { signIn } from '$lib/testing/session';
import { createInkLayer, writeInkPage } from './inkLayerData';
import { createInkStore, liveInk, type InkPage, type SyncedInkStore } from './inkStore';
import { createInkSync, type InkSync } from './inkSync';
import { createInkSyncQueue, type InkSyncQueue } from './inkSyncQueue';
import { createSyncedInkStore } from './syncedInkStore';
import type { Stroke, StrokeData } from './strokes';

const RED: Stroke = { pen: 'red', w: 0.004, pts: [0.1, 0.2, 0.3, 0.2] };
const BLACK: Stroke = { pen: 'black', w: 0.004, pts: [0.1, 0.6, 0.3, 0.6] };
const THIN: Stroke = { pen: 'black', w: 0.002, pts: [0.5, 0.5, 0.7, 0.5] };

const PART = { db: 'sampledb', personId: 'person-p', fileId: 'file-score' };
const at = (page: number, part = PART): InkPage => ({ ...part, page });
const ink = (...strokes: Stroke[]): StrokeData => ({ v: 1, strokes });

const P = { db: 'sampledb', name: 'Sampledb', personId: 'person-p' };
const P2 = { db: 'otherdb', name: 'Otherdb', personId: 'person-p2' };
const Q = { db: 'sampledb', name: 'Sampledb', personId: 'person-q' };

let entu: ReturnType<typeof inkEntu>;

interface Device {
	store: SyncedInkStore;
	queue: InkSyncQueue;
	sync: InkSync;
}

const devices: Device[] = [];

function device(): Device {
	const factory = new IDBFactory();
	const deviceStore = createInkStore(factory);
	const queue = createInkSyncQueue(factory);
	const sync = createInkSync({ queue, device: deviceStore, fetchImpl: entu.fetchImpl });
	const made = { store: createSyncedInkStore({ device: deviceStore, queue, sync }), queue, sync };
	devices.push(made);
	return made;
}

/** What Entu holds for her on one page, as she would see it. */
function inEntu(page: number, db = 'sampledb', personId = 'person-p'): Stroke[] {
	const logs = entu.layers(db, personId).flatMap((l) => l.pages.filter((p) => p.page === page));
	const erased = new Set(logs.flatMap((l) => l.erased));
	const byId = new Map(logs.flatMap((l) => l.strokes).map((s) => [s.id, s.stroke] as const));
	return [...byId].filter(([id]) => !erased.has(id)).map(([, stroke]) => stroke);
}

/** Opens the part on a device as the viewer does: her device ink, then Entu's joined in. */
async function shown(d: Device, page: number, part = PART): Promise<StrokeData> {
	const remote = await d.store.pull(part);
	if (remote?.pages[page]) await d.store.merge(at(page, part), remote.pages[page]);
	return liveInk(await d.store.load(at(page, part)));
}

const signInP = () => signIn({ token: 'jwt-p', collectives: [P, P2] });

useKeptProblems();

beforeEach(() => {
	resetTypeIdCache();
	installLocks();
	entu = inkEntu({
		tokens: {
			'jwt-p': { sampledb: 'person-p', otherdb: 'person-p2' },
			'jwt-q': { sampledb: 'person-q' }
		},
		files: { sampledb: { 'file-score': 'edition-1' }, otherdb: { 'file-score': 'edition-9' } }
	});
	signInP();
});

afterEach(() => {
	for (const d of devices.splice(0)) d.sync.cancel();
	resetOnLine();
	resetAppState();
});

describe('#1069 — her marks reach her other device', () => {
	it('marks made on one device are on the other, signed in as her', async () => {
		const a = device();
		await a.store.save(at(1), ink(RED));
		await a.store.save(at(2), ink(BLACK));
		await a.sync.flush();

		const b = device();
		expect(await shown(b, 1)).toEqual(ink(RED));
		expect(await shown(b, 2)).toEqual(ink(BLACK));
		expect(entu.layers('sampledb', 'person-p')).toHaveLength(1);
	});

	it('ink drawn offline waits on the device and reaches Entu once the device is online', async () => {
		const a = device();
		const stop = a.sync.start();
		try {
			await goOffline();
			entu.state.offline = true;
			await a.store.save(at(1), ink(RED));
			await settle();
			expect(entu.layers('sampledb', 'person-p')).toEqual([]);

			entu.state.offline = false;
			await goOnline();
			await waitFor(() => expect(inEntu(1)).toEqual([RED]));
			expect(await a.queue.list({ db: 'sampledb', personId: 'person-p' })).toEqual([]);
		} finally {
			stop();
		}
	});

	it('ink from two devices is joined, erases included', async () => {
		const a = device();
		const b = device();
		await a.store.save(at(1), ink(RED, BLACK));
		await a.sync.flush();
		expect(await shown(b, 1)).toEqual(ink(RED, BLACK));

		// Each device then works on the page without hearing from the other.
		await b.store.save(at(1), ink(BLACK));
		await a.store.save(at(1), ink(RED, BLACK, THIN));
		await b.sync.flush();
		await a.sync.flush();

		expect(inEntu(1)).toEqual([BLACK, THIN]);
		expect(await shown(a, 1)).toEqual(ink(BLACK, THIN));
		expect(await shown(b, 1)).toEqual(ink(BLACK, THIN));
	});

	it('two layers made by two offline devices are both read and joined; neither is dropped', async () => {
		const cfg = { db: 'sampledb', token: 'jwt-p' };
		const layerPart = { personId: 'person-p', editionId: 'edition-1', fileId: 'file-score' };
		const one = await createInkLayer(cfg, layerPart, entu.fetchImpl);
		const two = await createInkLayer(cfg, layerPart, entu.fetchImpl);
		await writeInkPage(cfg, one, 1, { v: 1, strokes: [{ id: 'r', stroke: RED }], erased: [] }, entu.fetchImpl);
		await writeInkPage(cfg, two, 1, { v: 1, strokes: [{ id: 'b', stroke: BLACK }], erased: [] }, entu.fetchImpl);

		const c = device();
		expect(await shown(c, 1)).toEqual(ink(RED, BLACK));
		await c.store.save(at(1), ink(RED, BLACK, THIN));
		await c.sync.flush();

		expect(entu.layers('sampledb', 'person-p')).toHaveLength(2);
		expect(inEntu(1)).toEqual([RED, BLACK, THIN]);
		expect(await shown(device(), 1)).toEqual(ink(RED, BLACK, THIN));
	});

	it('with two layers of hers, every write goes to the oldest', async () => {
		const cfg = { db: 'sampledb', token: 'jwt-p' };
		const layerPart = { personId: 'person-p', editionId: 'edition-1', fileId: 'file-score' };
		const oldest = await createInkLayer(cfg, layerPart, entu.fetchImpl);
		await createInkLayer(cfg, layerPart, entu.fetchImpl);

		const a = device();
		await a.store.save(at(1), ink(RED));
		await a.store.turn(PART, 2);
		await a.sync.flush();
		const [first, second] = entu.layers('sampledb', 'person-p');
		expect(first._id).toBe(oldest);
		expect(first.pages).toHaveLength(1);
		expect(first.place).toBe(2);
		expect(second.pages).toEqual([]);
		expect(second.place).toBeUndefined();
	});

	it('in two collectives she has two layers, one per collective, each with its own ink', async () => {
		const a = device();
		const other = { ...PART, db: 'otherdb', personId: 'person-p2' };
		await a.store.save(at(1), ink(RED));
		await a.store.save(at(1, other), ink(BLACK));
		await a.sync.flush();

		expect(inEntu(1)).toEqual([RED]);
		expect(inEntu(1, 'otherdb', 'person-p2')).toEqual([BLACK]);
		expect(entu.layers('otherdb', 'person-p2')[0].props.edition).toEqual([
			expect.objectContaining({ reference: 'edition-9' })
		]);
		const b = device();
		expect(await shown(b, 1, other)).toEqual(ink(BLACK));
	});
});

describe('#1069 — her page', () => {
	it('the part opens on her last saved page, from either device', async () => {
		const a = device();
		const b = device();
		await a.store.turn(PART, 3);
		expect(await a.store.placeOf(PART)).toBe(3);
		await a.sync.flush();

		expect(await b.store.placeOf(PART)).toBeNull();
		expect((await b.store.pull(PART))?.page).toBe(3);
		expect(await b.store.placeOf(PART)).toBe(3);

		await b.store.turn(PART, 2);
		await b.sync.flush();
		expect((await a.store.pull(PART))?.page).toBe(2);
		expect(await a.store.placeOf(PART)).toBe(2);
	});

	it('a page she turned to offline is not overwritten by an older one from Entu', async () => {
		const a = device();
		const b = device();
		await a.store.turn(PART, 3);
		await a.sync.flush();
		entu.state.offline = true;
		await b.store.turn(PART, 2);

		entu.state.offline = false;
		expect((await b.store.pull(PART))?.page).toBe(2);
		expect(await b.store.placeOf(PART)).toBe(2);
		await b.sync.flush();
		expect((await a.store.pull(PART))?.page).toBe(2);
	});
});

describe('#1069 — only hers, and nothing lost', () => {
	it('another person signed in on the same device never sees her layer, and hers waits for her', async () => {
		const a = device();
		await a.store.save(at(1), ink(RED));
		await a.sync.flush();
		const d = device();
		entu.state.offline = true;
		await d.store.save(at(2), ink(BLACK));
		await settle();

		endSession({ preserveProvider: false });
		signIn({ token: 'jwt-q', collectives: [Q] });
		entu.state.offline = false;
		const qPart = { ...PART, personId: 'person-q' };
		expect(await shown(d, 1, qPart)).toEqual(ink());
		await d.sync.flush();
		expect(inEntu(2)).toEqual([]);
		expect(entu.layers('sampledb', 'person-q')).toEqual([]);

		endSession({ preserveProvider: false });
		signInP();
		await d.sync.flush();
		expect(inEntu(2)).toEqual([BLACK]);
		expect(await shown(d, 1)).toEqual(ink(RED));
	});

	it('an ended session keeps the ink on the device and stops; she signs in and it goes', async () => {
		const a = device();
		const stop = a.sync.start();
		try {
			entu.state.expired = true;
			await a.store.save(at(1), ink(RED));
			await settle();
			expect(await a.queue.list({ db: 'sampledb', personId: 'person-p' })).toHaveLength(1);
			const tried = entu.fetchImpl.mock.calls.length;
			await settle(50);
			expect(entu.fetchImpl.mock.calls.length).toBe(tried);

			entu.state.expired = false;
			endSession({ preserveProvider: false });
			signInP();
			await waitFor(() => expect(inEntu(1)).toEqual([RED]));
		} finally {
			stop();
		}
	});

	it('a write Entu refuses is reported and kept on the device, then sent once Entu takes it', async () => {
		const a = device();
		entu.state.refuse = 403;
		await a.store.save(at(1), ink(RED));
		await a.sync.flush();

		const identity = { db: 'sampledb', personId: 'person-p' };
		await waitFor(async () =>
			expect(await keptProblems(identity)).toEqual([
				expect.objectContaining({ area: 'part', action: 'syncing the marks' })
			])
		);
		expect(await a.queue.list(identity)).toHaveLength(1);

		entu.state.refuse = null;
		await a.sync.flush();
		expect(inEntu(1)).toEqual([RED]);
		expect(await a.queue.list(identity)).toEqual([]);
	});

	it('a save made while a send is under way is sent too', async () => {
		const gate = deferred();
		let held = false;
		const answer = entu.fetchImpl.getMockImplementation()!;
		entu.fetchImpl.mockImplementation(async (input, init) => {
			if (!held && init?.method === 'POST' && /\/entity\/layer-/.test(String(input))) {
				held = true;
				await gate.promise;
			}
			return answer(input, init);
		});
		const a = device();
		await a.store.save(at(1), ink(RED));
		await waitFor(() => expect(held).toBe(true));
		await a.store.save(at(1), ink(RED, BLACK));
		gate.resolve();
		await a.sync.flush();
		expect(inEntu(1)).toEqual([RED, BLACK]);
		expect(await a.queue.list({ db: 'sampledb', personId: 'person-p' })).toEqual([]);
	});
});

// (*MVOX:Josquin*)
