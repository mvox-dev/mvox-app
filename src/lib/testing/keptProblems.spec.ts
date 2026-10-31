// useKeptProblems puts back only indexedDB: a spec's own beforeAll stub survives each case.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { useKeptProblems } from './keptProblems';

beforeAll(() => {
	vi.stubGlobal('specOwnStub', 'kept');
});
afterAll(() => {
	vi.unstubAllGlobals();
});
useKeptProblems();

describe('useKeptProblems', () => {
	it('gives each case a log', () => {
		expect(globalThis.indexedDB).toBeDefined();
	});

	it('leaves a beforeAll stub in place after a case', () => {
		expect((globalThis as { specOwnStub?: string }).specOwnStub).toBe('kept');
	});
});

// (*MVOX:Josquin*)
