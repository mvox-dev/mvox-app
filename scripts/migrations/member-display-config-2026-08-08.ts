// #48 (#37-P3.6) split — member display-config fix. Authorized on #37 by
// team-lead (2026-08-08, "combined dry+live approach... it's a cosmetic
// prop-def flag, same class as the menu _sharing writes"). Sets `list:true`
// on the `member.person` prop-def (currently absent) so the Entu admin
// member list renders a "Person" column — today the list shows only
// `section` (the sole prop-def with `list:true`), and with no `member.name`
// prop-def (removed T3.1 bundle 3), there is no way to identify which member
// a row is. Also lowers `ordinal` from 4 to 1 so Person sorts first, ahead
// of Section's `ordinal:7`. Single combined run: verify live state → write →
// read-back verify → result artifact. No separate DRY_RUN gate — the small,
// reversible, cosmetic scope was explicitly authorized as a combined pass.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/member-display-config-2026-08-08.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';

const MEMBER_PERSON_PROPDEF_ID = '69c7ea4b8489bfcb0e819f05';

function writeResultArtifact(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'seed-results');
	const filename = `member-display-config-2026-08-08-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();

	// Step 1 — verify live state (READ-ONLY).
	const beforeRes = await entuFetch(cfg.db, `entity/${MEMBER_PERSON_PROPDEF_ID}?props=name,list,ordinal`, cfg.token);
	if (!beforeRes.ok) throw new Error(`verify GET ${MEMBER_PERSON_PROPDEF_ID} failed: ${beforeRes.status}`);
	const beforeBody = (await beforeRes.json()) as {
		entity?: { name?: Array<{ string: string }>; list?: Array<{ _id: string; boolean: boolean }>; ordinal?: Array<{ _id: string; number: number }> };
	};
	const liveName = beforeBody.entity?.name?.[0]?.string;
	if (liveName !== 'person') {
		throw new Error(`verify: ${MEMBER_PERSON_PROPDEF_ID} has name=${JSON.stringify(liveName)}, expected 'person' — wrong id, refuse to proceed`);
	}
	const currentList = beforeBody.entity?.list?.[0]?.boolean;
	if (currentList === true) {
		throw new Error(`verify: member.person already has list:true — nothing to do, state has moved, refuse to proceed`);
	}
	const currentOrdinalId = beforeBody.entity?.ordinal?.[0]?._id ?? null;
	const currentOrdinalValue = beforeBody.entity?.ordinal?.[0]?.number ?? null;
	console.log(`Verified live: member.person list=${currentList ?? '(absent)'}, ordinal=${currentOrdinalValue ?? '(absent)'}`);

	// Step 2 — write: set list:true (plain create, currently absent), replace ordinal 4->1.
	const writeBody: Array<Record<string, unknown>> = [{ type: 'list', boolean: true }];
	if (currentOrdinalId != null) {
		writeBody.push({ _id: currentOrdinalId, type: 'ordinal', number: 1 });
	} else {
		writeBody.push({ type: 'ordinal', number: 1 });
	}
	const writeRes = await entuFetch(cfg.db, `entity/${MEMBER_PERSON_PROPDEF_ID}`, cfg.token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(writeBody)
	});
	if (!writeRes.ok) {
		const artifactPath = writeResultArtifact({ status: 'failed', stage: 'write', httpStatus: writeRes.status, exitCode: 1 });
		console.error(`Write POST failed: ${writeRes.status}`);
		console.error(`Result artifact: ${artifactPath}`);
		process.exit(1);
	}

	// Step 3 — read-back verify.
	const afterRes = await entuFetch(cfg.db, `entity/${MEMBER_PERSON_PROPDEF_ID}?props=name,list,ordinal`, cfg.token);
	if (!afterRes.ok) throw new Error(`read-back GET failed: ${afterRes.status}`);
	const afterBody = (await afterRes.json()) as {
		entity?: { list?: Array<{ boolean: boolean }>; ordinal?: Array<{ number: number }> };
	};
	const newList = afterBody.entity?.list?.[0]?.boolean;
	const newOrdinal = afterBody.entity?.ordinal?.[0]?.number;
	const listOk = newList === true;
	const ordinalOk = newOrdinal === 1;

	console.log(`Read-back: list=${newList} (expected true, ${listOk ? 'OK' : 'MISMATCH'}), ordinal=${newOrdinal} (expected 1, ${ordinalOk ? 'OK' : 'MISMATCH'})`);

	const artifactPath = writeResultArtifact({
		status: listOk && ordinalOk ? 'success' : 'partial',
		propDefId: MEMBER_PERSON_PROPDEF_ID,
		before: { list: currentList ?? null, ordinal: currentOrdinalValue },
		after: { list: newList ?? null, ordinal: newOrdinal ?? null },
		listOk,
		ordinalOk,
		exitCode: listOk && ordinalOk ? 0 : 1
	});
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(listOk && ordinalOk ? 0 : 1);
}

main().catch((err) => {
	console.error('member-display-config ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
