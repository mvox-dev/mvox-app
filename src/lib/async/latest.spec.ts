import { describe, expect, it } from 'vitest';
import { createLatest } from './latest';

describe('createLatest', () => {
	it('a fresh load is current', () => {
		const latest = createLatest();
		expect(latest.next()()).toBe(true);
	});

	it('a newer load makes the older one stale and stays current itself', () => {
		const latest = createLatest();
		const first = latest.next();
		const second = latest.next();
		expect(first()).toBe(false);
		expect(second()).toBe(true);
	});

	it('cancel makes the in-flight load stale', () => {
		const latest = createLatest();
		const inFlight = latest.next();
		latest.cancel();
		expect(inFlight()).toBe(false);
	});

	it('a load opened after cancel is current', () => {
		const latest = createLatest();
		latest.cancel();
		expect(latest.next()()).toBe(true);
	});

	it('whileCurrent checks the open load without opening another', () => {
		const latest = createLatest();
		const open = latest.next();
		const check = latest.whileCurrent();
		expect(open()).toBe(true);
		expect(check()).toBe(true);
		latest.next();
		expect(check()).toBe(false);
	});

	it('instances do not invalidate each other', () => {
		const a = createLatest();
		const b = createLatest();
		const inA = a.next();
		b.next();
		b.cancel();
		expect(inA()).toBe(true);
	});

	it('a stale check stays stale', () => {
		const latest = createLatest();
		const first = latest.next();
		latest.next();
		expect(first()).toBe(false);
		expect(first()).toBe(false);
	});
});

// (*MVOX:Josquin*)
