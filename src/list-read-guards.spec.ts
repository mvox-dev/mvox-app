// #321: every `entity?…` list query carries an explicit `limit=` (Entu's default of 100 is an
// invisible cap), and the reliance on `count` as the caller-visible total cites its probes.
import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { findSourceFiles } from '$lib/testing/soleLiteralGuard';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '.');

// Generated paraglide output is not authored reads.
const sourceFiles = [
	...findSourceFiles(join(SRC, 'lib'), ['.ts'], { excludeSpecs: true, skipDirs: ['paraglide'] }),
	...findSourceFiles(join(SRC, 'routes'), ['.ts', '.svelte'], {
		excludeSpecs: true,
		skipDirs: ['paraglide']
	})
];

/** Comments out, so a query quoted in prose is not a read; `//` only at line start. */
function stripComments(text: string): string {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('//'))
		.join('\n');
}

/** Every string literal starting with `entity?` in the (comment-stripped) text. */
function entityQueryLiterals(text: string): string[] {
	return [...text.matchAll(/[`'"](entity\?[^`'"\n]*)[`'"]/g)].map((m) => m[1]);
}

describe('#321 guard — every entity? list read carries an EXPLICIT limit= (server default 100 is an invisible cap)', () => {
	it('no src/ list-query literal relies on the server default', () => {
		const violations: string[] = [];
		for (const file of sourceFiles) {
			const stripped = stripComments(readFileSync(file, 'utf-8'));
			for (const literal of entityQueryLiterals(stripped)) {
				if (literal.includes('limit=')) continue;
				// The sectionActions shape: the limit rides a same-file variable the literal interpolates.
				const idents = [...literal.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)].map((m) => m[1]);
				const carried = idents.some((ident) =>
					new RegExp(`(?:const|let|var)\\s+${ident}\\s*=[^;\\n]*limit=`).test(stripped)
				);
				if (!carried) violations.push(`${file}: \`${literal}\``);
			}
		}
		expect(
			violations,
			`entity? list reads with NO explicit limit= (the server silently applies limit=100 — a cap ` +
				`that appears nowhere in our code; state the bound, then classify it per #321):\n` +
				violations.join('\n')
		).toEqual([]);
	});

	it('the scanner actually sees the reads (self-check: a scan that finds nothing guards nothing)', () => {
		// Prove the extractor sees the real corpus before trusting an empty violation list.
		const withQueries = sourceFiles.filter(
			(f) => entityQueryLiterals(stripComments(readFileSync(f, 'utf-8'))).length > 0
		);
		const totalLiterals = sourceFiles.reduce(
			(n, f) => n + entityQueryLiterals(stripComments(readFileSync(f, 'utf-8'))).length,
			0
		);
		expect(withQueries.length).toBeGreaterThanOrEqual(15);
		expect(totalLiterals).toBeGreaterThanOrEqual(30);
	});
});

describe('#321 guard — the undocumented count-reliance is written down where it is used', () => {
	const LEDGERS = [
		'probe-321-list-count-semantics-live-2026-09-11T00-39-06-327Z',
		'probe-321-authed-lesser-tier-subset-live-2026-09-11T00-42-57-032Z'
	];

	it('some src/lib module (the detection helper, or a widened reader) cites BOTH probe ledgers', () => {
		const libFiles = findSourceFiles(join(SRC, 'lib'), ['.ts'], {
			excludeSpecs: true,
			skipDirs: ['paraglide']
		});
		const citing = libFiles.filter((f) => {
			const text = readFileSync(f, 'utf-8');
			return LEDGERS.every((ledger) => text.includes(ledger));
		});
		expect(
			citing.length,
			`no src/lib module cites both #321 probe ledgers (${LEDGERS.join(', ')}) — the "count = ` +
				`caller-visible total" property is UNDOCUMENTED upstream; the module that consumes it must ` +
				`say so and cite the probes that established it (Gama amendment, point 3)`
		).toBeGreaterThanOrEqual(1);
	});

	it('the cited ledger artifacts actually exist under scripts/migrations/seed-results/', () => {
		for (const ledger of LEDGERS) {
			const path = resolve(SRC, '../scripts/migrations/seed-results', `${ledger}.json`);
			expect(() => statSync(path), `${path} missing`).not.toThrow();
		}
	});
});

// (*MVOX:Tallis*)
