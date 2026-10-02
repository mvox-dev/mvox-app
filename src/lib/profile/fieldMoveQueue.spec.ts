// The visibility-move queue reports only what the server confirmed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldMoveInput, FieldMoveResult, DuplicateRepairInput } from './fieldMove';
import { deferred, testCfg } from '$lib/testing/entuFetchKit';

const h = vi.hoisted(() => {
	class FieldMoveError extends Error {
		readonly phase: 'create' | 'delete';
		readonly createdTargetId?: string;
		constructor(message: string, phase: 'create' | 'delete', createdTargetId?: string) {
			super(message);
			this.name = 'FieldMoveError';
			this.phase = phase;
			this.createdTargetId = createdTargetId;
		}
	}
	return { FieldMoveError, applyFieldMoveMock: vi.fn(), applyDuplicateRepairMock: vi.fn() };
});
vi.mock('./fieldMove', () => ({
	applyFieldMove: h.applyFieldMoveMock,
	applyDuplicateRepair: h.applyDuplicateRepairMock,
	FieldMoveError: h.FieldMoveError
}));

import { createFieldMoveQueue } from './fieldMoveQueue';

const cfg = testCfg('testdb');

function makeCallbacks() {
	return {
		setTransport: vi.fn(),
		onCreateConfirmed: vi.fn(),
		onMoveConfirmed: vi.fn(),
		onMoveFailed: vi.fn(),
		onRepairConfirmed: vi.fn(),
		onRepairFailed: vi.fn()
	};
}

function installMove() {
	const d = deferred<FieldMoveResult>();
	let onPhase: ((phase: 'created' | 'deleted', id: string) => void) | undefined;
	h.applyFieldMoveMock.mockImplementationOnce((_input: FieldMoveInput, cbPhase: typeof onPhase) => {
		onPhase = cbPhase;
		return d.promise;
	});
	return {
		resolve: d.resolve,
		reject: d.reject,
		created: (id = 'pub-new') => onPhase!('created', id),
		deleted: (id = 'pub-new') => onPhase!('deleted', id)
	};
}

function moveReq(over: Partial<FieldMoveInput> = {}): FieldMoveInput {
	return {
		cfg,
		personId: 'person-p',
		field: 'name',
		fromLevel: 'domain',
		toLevel: 'public',
		value: 'Ada',
		srcId: 'dom-src',
		dstId: null,
		srcSibling: 'dom@x.io',
		dstSibling: '',
		...over
	};
}

function moveResult(over: Partial<FieldMoveResult> = {}): FieldMoveResult {
	return { field: 'name', fromLevel: 'domain', toLevel: 'public', targetId: 'pub-new', sourceId: 'dom-src', ...over };
}

function repairReq(over: Partial<DuplicateRepairInput> = {}): DuplicateRepairInput {
	return { cfg, field: 'name', clear: [{ id: 'pub-wider', sibling: 'pub@x.io' }], ...over };
}

beforeEach(() => {
	h.applyFieldMoveMock.mockReset();
	h.applyDuplicateRepairMock.mockReset();
});

describe('createFieldMoveQueue — honest two-phase round trip', () => {
	it('on dispatch: the target icon goes in-transport; NOTHING is confirmed yet', () => {
		installMove();
		const cb = makeCallbacks();
		const queue = createFieldMoveQueue(cb, () => 0);

		queue.move(moveReq());

		expect(h.applyFieldMoveMock).toHaveBeenCalledTimes(1);
		expect(cb.setTransport).toHaveBeenCalledWith('name', 'public', true); // dst spinner on
		expect(cb.onCreateConfirmed).not.toHaveBeenCalled();
		expect(cb.onMoveConfirmed).not.toHaveBeenCalled();
	});

	it('step-1 (create) server-confirms → dst spinner OFF, dst lit, THEN src spinner ON; move not yet done', () => {
		const mv = installMove();
		const cb = makeCallbacks();
		const queue = createFieldMoveQueue(cb, () => 0);

		queue.move(moveReq());
		mv.created('pub-new');

		expect(cb.setTransport).toHaveBeenCalledWith('name', 'public', false); // dst spinner off
		expect(cb.onCreateConfirmed).toHaveBeenCalledWith('name', 'public'); // dst now active/lit
		expect(cb.setTransport).toHaveBeenCalledWith('name', 'domain', true); // src spinner on
		expect(cb.onMoveConfirmed).not.toHaveBeenCalled(); // step 2 not confirmed yet
	});

	it('step-2 (delete) server-confirms → src spinner OFF and onMoveConfirmed fires with the result', async () => {
		const mv = installMove();
		const cb = makeCallbacks();
		const queue = createFieldMoveQueue(cb, () => 0);

		queue.move(moveReq());
		mv.created('pub-new');
		mv.resolve(moveResult());

		await vi.waitFor(() => expect(cb.onMoveConfirmed).toHaveBeenCalled());
		expect(cb.setTransport).toHaveBeenCalledWith('name', 'domain', false); // src spinner off
		expect(cb.onMoveConfirmed).toHaveBeenCalledWith('name', moveResult());
		expect(cb.onMoveFailed).not.toHaveBeenCalled();
	});
});

describe('createFieldMoveQueue — single-flight guard', () => {
	it('a second move while one is in flight is a no-op — only ONE applyFieldMove fires', () => {
		installMove();
		const cb = makeCallbacks();
		const queue = createFieldMoveQueue(cb, () => 0);

		queue.move(moveReq({ field: 'name' }));
		queue.move(moveReq({ field: 'email', fromLevel: 'private', toLevel: 'domain' })); // ignored — busy

		expect(h.applyFieldMoveMock).toHaveBeenCalledTimes(1);
	});

	it('a repair while a move is in flight is a no-op (single-flight covers moves AND repairs)', () => {
		installMove();
		const cb = makeCallbacks();
		const queue = createFieldMoveQueue(cb, () => 0);

		queue.move(moveReq());
		queue.repair(repairReq());

		expect(h.applyDuplicateRepairMock).not.toHaveBeenCalled();
	});

	it('after a move settles, a fresh move fires (the lock is released, not wedged)', async () => {
		const mv = installMove();
		installMove();
		const cb = makeCallbacks();
		const queue = createFieldMoveQueue(cb, () => 0);

		queue.move(moveReq());
		mv.created('pub-new');
		mv.resolve(moveResult());
		await vi.waitFor(() => expect(cb.onMoveConfirmed).toHaveBeenCalled());

		queue.move(moveReq({ field: 'email' }));
		expect(h.applyFieldMoveMock).toHaveBeenCalledTimes(2);
	});
});

describe('createFieldMoveQueue — fail-loud, never stuck', () => {
	it('a delete-phase failure calls onMoveFailed with the phase-tagged error, clears the source transport, and frees the lock', async () => {
		const mv = installMove();
		const cb = makeCallbacks();
		const queue = createFieldMoveQueue(cb, () => 0);

		queue.move(moveReq());
		mv.created('pub-new'); // step 1 confirmed → src spinner on
		mv.reject(new h.FieldMoveError('delete-from-old failed', 'delete'));

		await vi.waitFor(() => expect(cb.onMoveFailed).toHaveBeenCalled());
		const err = cb.onMoveFailed.mock.calls[0][1] as InstanceType<typeof h.FieldMoveError>;
		expect(err).toBeInstanceOf(h.FieldMoveError);
		expect(err.phase).toBe('delete'); // a live-duplicate → the AC3 privacy-repair banner
		expect(cb.onMoveConfirmed).not.toHaveBeenCalled();
		expect(cb.setTransport).toHaveBeenCalledWith('name', 'domain', false);

		installMove();
		queue.move(moveReq({ field: 'email' }));
		expect(h.applyFieldMoveMock).toHaveBeenCalledTimes(2);
	});
});

describe('createFieldMoveQueue — generation guard on the settle', () => {
	it('a SUCCESS settling after the generation changed does NOT onMoveConfirmed — but frees the lock for a fresh move', async () => {
		const mv = installMove();
		let generation = 0;
		const cb = makeCallbacks();
		const queue = createFieldMoveQueue(cb, () => generation);

		queue.move(moveReq());
		generation = 1; // collective switched mid-move
		mv.created('pub-new');
		mv.resolve(moveResult());
		await Promise.resolve();
		await Promise.resolve();

		expect(cb.onMoveConfirmed).not.toHaveBeenCalled();

		installMove();
		queue.move(moveReq({ field: 'email' }));
		expect(h.applyFieldMoveMock).toHaveBeenCalledTimes(2); // lock was freed despite the guard
	});

	it('a FAILURE settling after the generation changed does NOT onMoveFailed', async () => {
		const mv = installMove();
		let generation = 0;
		const cb = makeCallbacks();
		const queue = createFieldMoveQueue(cb, () => generation);

		queue.move(moveReq());
		generation = 1;
		mv.reject(new h.FieldMoveError('delete failed', 'delete'));
		await Promise.resolve();
		await Promise.resolve();

		expect(cb.onMoveFailed).not.toHaveBeenCalled();
	});

	it('reset() frees an in-flight move so a fresh move fires while the stale one is STILL pending', () => {
		installMove(); // first move never settles
		installMove();
		const cb = makeCallbacks();
		let generation = 0;
		const queue = createFieldMoveQueue(cb, () => generation);

		queue.move(moveReq());
		expect(h.applyFieldMoveMock).toHaveBeenCalledTimes(1);

		generation = 1;
		queue.reset();

		queue.move(moveReq({ field: 'email' }));
		expect(h.applyFieldMoveMock).toHaveBeenCalledTimes(2);
	});
});

describe('createFieldMoveQueue — duplicate repair round trip', () => {
	it('dispatches applyDuplicateRepair and only confirms AFTER it resolves (no premature clear)', async () => {
		const d = deferred<{ field: 'name' | 'email'; clearedIds: string[] }>();
		h.applyDuplicateRepairMock.mockReturnValueOnce(d.promise);
		const cb = makeCallbacks();
		const queue = createFieldMoveQueue(cb, () => 0);

		queue.repair(repairReq());

		expect(h.applyDuplicateRepairMock).toHaveBeenCalledTimes(1);
		expect(cb.onRepairConfirmed).not.toHaveBeenCalled(); // banner stays until the delete lands

		d.resolve({ field: 'name', clearedIds: ['pub-wider'] });
		await vi.waitFor(() => expect(cb.onRepairConfirmed).toHaveBeenCalledWith('name'));
	});

	it('a failed repair calls onRepairFailed (banner KEPT, preserve-on-error) and frees the lock', async () => {
		h.applyDuplicateRepairMock.mockRejectedValueOnce(new Error('saveProfileFields save failed: 403'));
		const cb = makeCallbacks();
		const queue = createFieldMoveQueue(cb, () => 0);

		queue.repair(repairReq());

		await vi.waitFor(() => expect(cb.onRepairFailed).toHaveBeenCalledWith('name', expect.any(Error)));
		expect(cb.onRepairConfirmed).not.toHaveBeenCalled();

		installMove();
		queue.move(moveReq());
		expect(h.applyFieldMoveMock).toHaveBeenCalledTimes(1);
	});
});
