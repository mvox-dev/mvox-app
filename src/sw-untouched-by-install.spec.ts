// #408 fence — the service worker is UNTOUCHED by the install-as-app slice.
//
// #368's regime (update polling + single-reload-on-controllerchange + the
// atomic precache install) is what keeps an already-installed client
// updating on deploy — the issue's own fence: "an already-installed client
// must keep updating exactly as it does now." The manifest and icons #408
// adds under static/ join the precache set through the EXISTING files()
// filter; nothing in src/lib/sw/ or src/service-worker.ts changes.
//
// These are the sha256 byte hashes of the three files as they stand on main
// at feat/408-install-as-app branch time (post-#427). The review drops or
// updates this pin after merge ONLY if a later slice legitimately changes
// those files — #408 itself may not.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PINNED: Record<string, string> = {
	'src/lib/sw/swPolicy.ts': '227f7c9e4b5fef738269117a4c5220a8b9cab9237fb8713d9ca07e3c228dedcd',
	'src/lib/sw/swUpdate.ts': 'd079f2c78bfa9c614bc3a84a2d70a31508dc5a768063edc7e52d162da168b6d2',
	'src/service-worker.ts': 'b360f68c38d3972899cfea912840eb79002f06c7dd2e15e03e01b90cf91c9d9a'
};

describe('#408 fence — src/lib/sw/* and src/service-worker.ts are byte-identical to main', () => {
	for (const [file, expected] of Object.entries(PINNED)) {
		it(`${file} is unchanged`, () => {
			const bytes = readFileSync(resolve(__dirname, '..', file));
			const actual = createHash('sha256').update(bytes).digest('hex');
			expect(actual, `${file} changed — #408 must not touch the #368 regime`).toBe(expected);
		});
	}
});
