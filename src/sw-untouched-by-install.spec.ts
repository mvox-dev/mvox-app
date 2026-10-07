// The #368 update regime's files, pinned by hash: changing one must come with a deliberate repin.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PINNED: Record<string, string> = {
	'src/lib/sw/swPolicy.ts': '891397f133787cd61d40bd473c2084dbc3d738aa76d23387539bba5c4beeb6b3',
	'src/lib/sw/swUpdate.ts': 'd079f2c78bfa9c614bc3a84a2d70a31508dc5a768063edc7e52d162da168b6d2',
	'src/service-worker.ts': '169a78d088974c28fba74413a7a90de80222ecdbe6e1568ae4d86baee7b8c507'
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
