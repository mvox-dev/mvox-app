// #445 (team-lead, 2nd round) — a real gap found while wiring the failure
// diagnostics: seed-445-person-rsvp-domain-inherit-crede.spec.ts mocks
// `writeLedger` file-wide (to assert what THIS SCRIPT passes to it), so
// nothing in that file ever exercised the REAL allowlist-filtering logic
// against COMMITTED_ALLOW. `_sharing`/`_inheritrights` were missing from
// that array — the committed (tracked) twin would have silently dropped
// them out of every readback/probe/recheck body, while the gitignored
// instance ledger stayed complete. Separate file, mocked `node:fs` only
// (same pattern as lib/ledger-writer.spec.ts), the REAL `writeLedger` and
// the REAL `COMMITTED_ALLOW` this script exports — zero real disk I/O.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const writeFileSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();

vi.mock('node:fs', () => ({
	writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
	mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args)
}));

import { writeLedger } from './lib/ledger-writer';
import { COMMITTED_ALLOW } from './seed-445-person-rsvp-domain-inherit-crede';

beforeEach(() => {
	writeFileSyncMock.mockClear();
	mkdirSyncMock.mockClear();
});

function lastCommittedWrite(): Record<string, unknown> {
	// writeLedger issues two writeFileSync calls when `committed` is set:
	// the gitignored instance file, then the tracked committed twin — last call wins.
	const call = writeFileSyncMock.mock.calls.at(-1) as [string, string];
	return JSON.parse(call[1]);
}

describe('seed-445 COMMITTED_ALLOW — real writeLedger, real filterByAllowlist', () => {
	it('a failure-diagnostics payload keeps _sharing/_inheritrights values intact in the committed twin', () => {
		writeLedger({
			scriptName: 'seed-445-person-rsvp-domain-inherit-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: 'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/445#issuecomment-fake',
			committed: { allow: COMMITTED_ALLOW },
			payload: {
				dryRun: false,
				failureDiagnostics: [
					{
						entityId: 'ex-1',
						sharingPost: { requestBody: [{ type: '_sharing', string: 'domain' }], status: 200, body: { properties: [{ _id: 'p-1', type: '_sharing' }] } },
						readback: { status: 200, body: { entity: { _id: 'ex-1', _sharing: [{ _id: 'p-1', string: 'domain' }], _inheritrights: [] } } }
					}
				]
			}
		});

		const committed = lastCommittedWrite();
		const diag = (committed.failureDiagnostics as Array<Record<string, unknown>>)[0];
		expect(diag.entityId).toBe('ex-1');
		expect((diag.sharingPost as Record<string, unknown>).status).toBe(200);
		const readbackBody = (diag.readback as Record<string, unknown>).body as { entity: Record<string, unknown> };
		// `string` is stripped by writeLedger's own blanket rule (denylisted
		// from EVERY committed.allow, regardless of content) — the key
		// survives, the tier text itself does not. The `_id` proves the key
		// wasn't dropped outright; the full value (with `string: 'domain'`)
		// is only in the gitignored instance ledger, not asserted here.
		expect(readbackBody.entity._sharing).toEqual([{ _id: 'p-1' }]);
		expect(readbackBody.entity._inheritrights).toEqual([]);
	});

	it('a postRunRecheck row keeps its _sharing/_inheritrights values intact in the committed twin', () => {
		writeLedger({
			scriptName: 'seed-445-person-rsvp-domain-inherit-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: 'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/445#issuecomment-fake',
			committed: { allow: COMMITTED_ALLOW },
			payload: {
				dryRun: false,
				postRunRecheck: [{ id: 'ex-2', status: 200, _sharing: [], _inheritrights: [], stillCorrect: false }]
			}
		});

		const committed = lastCommittedWrite();
		expect(committed.postRunRecheck).toEqual([{ id: 'ex-2', status: 200, _sharing: [], _inheritrights: [], stillCorrect: false }]);
	});
});
