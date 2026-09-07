import { beforeEach, describe, expect, it, vi } from 'vitest';

// mvox-app#274 review round 1 (Bentham, RED-274.2) — lib/ledger-writer.ts
// shipped with zero tests. This pins the ten-cell redaction shape table
// (RED-274.1's fix) and the sensitive→directory / crede→acknowledgement
// cross-checks (YELLOW-274.3), all against mocked fs — zero real I/O, so
// nothing lands in the real seed-results/ tree from running this suite.

const writeFileSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();

vi.mock('node:fs', () => ({
	writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
	mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args)
}));

import { writeLedger } from './ledger-writer';

beforeEach(() => {
	writeFileSyncMock.mockClear();
	mkdirSyncMock.mockClear();
});

function lastWrite(): { path: string; content: Record<string, unknown> } {
	const call = writeFileSyncMock.mock.calls.at(-1) as [string, string];
	return { path: call[0], content: JSON.parse(call[1]) };
}

describe('writeLedger — sensitive→directory routing', () => {
	it('routes sensitive:true into seed-results/crede-instance/', () => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'mvox_crede', sensitive: true, payload: {} });
		const { path } = lastWrite();
		expect(path).toMatch(/seed-results[/\\]crede-instance[/\\]/);
	});

	it('routes sensitive:false into plain seed-results/, not crede-instance', () => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, payload: {} });
		const { path } = lastWrite();
		expect(path).toMatch(/seed-results[/\\]/);
		expect(path).not.toMatch(/crede-instance/);
	});
});

describe('writeLedger — crede + sensitive:false cross-check (YELLOW-274.3)', () => {
	it('throws before any write when db looks like crede and sensitive:false arrives unacknowledged', () => {
		expect(() =>
			writeLedger({ scriptName: 'x', dryRun: true, db: 'mvox_crede', sensitive: false, payload: {} })
		).toThrow(/acknowledgedNonSensitive/);
		expect(writeFileSyncMock).not.toHaveBeenCalled();
	});

	it('does not throw when acknowledgedNonSensitive:true is explicit', () => {
		expect(() =>
			writeLedger({ scriptName: 'x', dryRun: true, db: 'mvox_crede', sensitive: false, acknowledgedNonSensitive: true, payload: {} })
		).not.toThrow();
	});

	it('does not require acknowledgement for a non-crede db', () => {
		expect(() =>
			writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, payload: {} })
		).not.toThrow();
	});

	it('does not require acknowledgement when sensitive:true', () => {
		expect(() =>
			writeLedger({ scriptName: 'x', dryRun: true, db: 'mvox_crede', sensitive: true, payload: {} })
		).not.toThrow();
	});
});

describe('writeLedger — email content scrub runs unconditionally', () => {
	it('redacts an email-shaped string leaf even when sensitive:false and the field is not declared', () => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, payload: { note: 'contact jaan@example.ee please' } });
		const { content } = lastWrite();
		expect(content.note).toBe('contact [REDACTED-EMAIL] please');
	});
});

// RED-274.1 shape table — a declared field (default or caller-supplied) must
// redact its WHOLE subtree regardless of the value's shape. The original bug
// only redacted a string LEAF, so array/object-wrapped values (Entu's native
// multi-value property shape among them) passed through in the clear.
describe('writeLedger — redaction shape table (RED-274.1)', () => {
	type Cell = { label: string; build: () => Record<string, unknown>; read: (redacted: Record<string, unknown>) => unknown };

	function cellsFor(field: string): Cell[] {
		return [
			{ label: `${field}: scalar`, build: () => ({ [field]: 'Jaan Tamm' }), read: (r) => r[field] },
			{ label: `${field}: array-of-string`, build: () => ({ [field]: ['Jaan Tamm'] }), read: (r) => r[field] },
			{ label: `${field}: array-of-object`, build: () => ({ [field]: [{ string: 'Jaan Tamm' }] }), read: (r) => r[field] },
			{ label: `${field}: nested-object`, build: () => ({ [field]: { string: 'Jaan Tamm' } }), read: (r) => r[field] },
			{
				label: `${field}: deep-nested (array > object > object)`,
				build: () => ({ ledger: [{ profile: { [field]: 'Jaan Tamm' } }] }),
				read: (r) => (r.ledger as Array<{ profile: Record<string, unknown> }>)[0].profile[field]
			}
		];
	}

	const defaultFieldCells = cellsFor('surname'); // DEFAULT_REDACT_FIELDS member
	const customFieldCells = cellsFor('nickname'); // caller-supplied redactFields member

	it.each(defaultFieldCells)('DEFAULT_REDACT_FIELDS field — $label', ({ build, read }) => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, payload: build() });
		const { content } = lastWrite();
		expect(read(content)).toBe('[REDACTED]');
	});

	it.each(customFieldCells)('caller redactFields field — $label', ({ build, read }) => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, redactFields: ['nickname'], payload: build() });
		const { content } = lastWrite();
		expect(read(content)).toBe('[REDACTED]');
	});

	it('an undeclared field of the same shapes is left untouched (no false positives)', () => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, payload: { section: ['Soprano I'] } });
		const { content } = lastWrite();
		expect(content.section).toEqual(['Soprano I']);
	});
});
