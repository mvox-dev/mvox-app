// #321 — two mechanical guards over the real source tree (pattern:
// rights-model-identifiers.spec.ts / typography-scale.spec.ts — readFileSync
// over repo files, spec at src root).
//
// GUARD 1 — EXPLICIT LIMIT (the 00:46Z Gama amendment, adopted as spec):
// Entu's list endpoint applies `limit=100` when the parameter is omitted
// (entu/www query reference: "Max results to return (default: 100)"). An
// omitted limit is therefore an INVISIBLE cap, tighter than any explicit one
// this app writes — the same defect #321 exists to fix, one layer further
// from the reader, because the number appears nowhere in our code. So: every
// `entity?…` list-query string literal in src/ carries an explicit `limit=`,
// either in the literal itself or in a same-file variable it interpolates
// (sectionActions.ts's `scoped` shape). Verified ZERO violations at HEAD —
// this guard passes immediately and exists to catch the future read that
// forgets.
//
// GUARD 2 — COUNT-RELIANCE DOCUMENTATION (the amendment's point 3): the
// truncation detection rests on `count` being the true CALLER-VISIBLE total
// on Entu list responses — behaviour that is UNDOCUMENTED upstream and
// established only by two ledgered probes. The reliance must be written down
// where it is used (the shared detection helper, or the widened module if no
// helper exists), citing BOTH probe ledgers, so the next reader can tell a
// vendor guarantee from an observed behaviour. RED today: no such citation
// exists in src/lib.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '.');

/** Recursively collect files under `dir` matching `keep`. */
function collect(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			// Generated code — not authored reads, and not this guard's business.
			if (entry === 'paraglide') continue;
			collect(path, keep, out);
		} else if (keep(path)) {
			out.push(path);
		}
	}
	return out;
}

const sourceFiles = [
	...collect(join(SRC, 'lib'), (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts')),
	...collect(
		join(SRC, 'routes'),
		(p) => (p.endsWith('.ts') || p.endsWith('.svelte')) && !p.endsWith('.spec.ts')
	)
];

/** Strip block comments, line comments and HTML comments — a query string
 *  QUOTED IN PROSE (seasonManage.ts's own doc comments do this) is not a
 *  read. Line comments are stripped only when the line STARTS with `//`
 *  (after whitespace), so `https://` inside string literals survives. */
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
				// The sectionActions shape: the limit rides a same-file variable the
				// literal interpolates (`entity?_type.string=member&${scoped}` where
				// `const scoped = \`…&limit=1\``).
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
		// Negative-from-the-instrument discipline: prove the extractor matches the
		// real corpus before trusting its empty violation list. HEAD carries ~40
		// query sites across ~20 lib files; require a sane floor of both.
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
		const libFiles = collect(join(SRC, 'lib'), (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'));
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

// (*MVOX:Tallis* — RED spec, #321)
