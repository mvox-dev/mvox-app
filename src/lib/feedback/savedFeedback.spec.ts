// Feedback saved on the device waits under its owner, keyed (db, personId, id), until it is sent.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createSavedFeedbackStore, type SavedFeedback } from './savedFeedback';

const BYTES = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

function item(over: Partial<SavedFeedback> = {}): SavedFeedback {
	return {
		id: 'local-1',
		db: 'sampledb',
		personId: 'person-p',
		screenshot: new Blob([BYTES], { type: 'image/png' }),
		strokes: { v: 1, strokes: [] },
		description: 'typed',
		pagePath: '/roster',
		page: { route: '/roster', time: '2026-10-05T08:30:15.250Z', locale: 'en', viewport: '390x844' },
		...over
	};
}

describe('#611 saved feedback store', () => {
	it('keeps the whole feedback, screenshot bytes included, across a reopen', async () => {
		const factory = new IDBFactory();
		await createSavedFeedbackStore(factory).put(item());

		const [read] = await createSavedFeedbackStore(factory).list('sampledb', 'person-p');
		const { screenshot, ...rest } = read;
		const { screenshot: _s, ...expected } = item();
		expect(rest).toEqual(expected);
		expect(screenshot.type).toBe('image/png');
		expect(new Uint8Array(await screenshot.arrayBuffer())).toEqual(BYTES);
	});

	it("lists only one person's feedback in one collective", async () => {
		const store = createSavedFeedbackStore(new IDBFactory());
		await store.put(item());
		await store.put(item({ id: 'local-2', personId: 'person-q' }));
		await store.put(item({ id: 'local-3', db: 'otherdb' }));

		expect((await store.list('sampledb', 'person-p')).map((f) => f.id)).toEqual(['local-1']);
		expect((await store.list('sampledb', 'person-q')).map((f) => f.id)).toEqual(['local-2']);
		expect((await store.list('otherdb', 'person-p')).map((f) => f.id)).toEqual(['local-3']);
	});

	it('delete removes that one feedback and nothing else', async () => {
		const store = createSavedFeedbackStore(new IDBFactory());
		await store.put(item());
		await store.put(item({ id: 'local-2' }));
		await store.put(item({ personId: 'person-q' }));

		await store.delete('sampledb', 'person-p', 'local-1');

		expect((await store.list('sampledb', 'person-p')).map((f) => f.id)).toEqual(['local-2']);
		expect((await store.list('sampledb', 'person-q')).map((f) => f.id)).toEqual(['local-1']);
	});
});

// (*MVOX:Josquin*)
