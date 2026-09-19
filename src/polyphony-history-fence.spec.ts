// #407 — Polyphony survives in the code only as dated history.
//
// RED for the #407 TDD chain. Mihkel, 2026-09-18: "drop polyphony from
// constraining us. cleanup all appearances of polyphony other than historic
// references". The polyphony Entu db is frozen, dated history only — it is
// not the sample database, not the provisioning template, not a db we run
// against. This fence walks every tracked file (git ls-files) and asserts
// that no case-insensitive 'polyphony' occurrence remains outside the
// allowlist below. Classification is BY REFERENT, not by string (the issue's
// own instruction): polyphony.uk (Crede's legacy web app), the archived
// prototype at ~/projects/polyphony, and the musical term are different
// referents and stay untouched.
//
// Scanning real repo files follows the rights-model-identifiers.spec /
// typography-scale.spec precedent (mechanical checks over real files, spec
// at src root).

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── ALLOWLIST: whole files/dirs the fence never reads ──────────────────────
// One entry per referent class. A path matching ANY of these is skipped.
export const ALLOWED_PATHS: ReadonlyArray<RegExp> = [
	// Dated ledgers of already-run migrations/probes — frozen history by issue definition.
	/^scripts\/migrations\/seed-results\//,
	// Dated, already-run probe scripts — frozen history.
	/^scripts\/migrations\/probes\//,
	// Dated migration scripts (filename carries the run date) — frozen history.
	// Includes the six tidy-td* scripts once renamed with their 2026-08-12 run date.
	// A run-date in the filename marks the file historic wherever it sits, so the
	// lib/ subdirectory counts too (e.g. lib/menu-empty-shells-2026-08-08.ts, whose
	// header quotes a 2026-08-07 walkthrough verbatim and must not be reworded).
	/^scripts\/migrations\/(lib\/)?[^/]+-2026-[^/]+\.ts$/,
	// Team memory checkpoints — historic records, never rewritten.
	/^teams\/mvox-dev\/memory\//,
	// Team inbox snapshots — historic message records.
	/^teams\/mvox-dev\/inboxes\//,
	// Dated, frozen design documents.
	/^docs\/design\//,
	// Dated external audits by another team (trailer (*FR:Medici*)) — frozen as
	// history, same class as docs/design and teams/mvox-dev/memory above. Their
	// quotations record what other files said on the audit date; rewording them
	// falsifies the record.
	/^teams\/mvox-dev\/docs\/health-report-.*\.md$/,
	// Dated, frozen implementation plans (superpowers:writing-plans output).
	/^docs\/superpowers\//,
	// polyphony.uk referent: Crede's legacy web app as the D1 migration SOURCE,
	// not the Entu db — every mention in this runbook is that referent.
	/^docs\/runbook\/provisioning\.md$/,
	// polyphony.uk referent: colour anchors carried over from the legacy web
	// app's type scale. The '.uk' token is NOT on every line, so a per-line
	// regex is wrong — whole-file exclusion (issue #407 names this file).
	/^src\/app\.css$/,
	// polyphony.uk referent: same colour-anchor referent as src/app.css
	// (app.css's own cross-reference names this file) — whole-file exclusion.
	/^src\/lib\/events\/eventTypeStyles\.ts$/,
	// polyphony.uk referent: spec for the colour anchors above, same referent,
	// no '.uk' token on the offending lines — whole-file exclusion.
	/^src\/lib\/events\/eventTypeStyles\.spec\.ts$/,
	// Musical-term referent: William Byrd etymology ("vocal polyphony").
	/^teams\/mvox-dev\/prompts\/byrd\.md$/,
	// Musical-term referent: Palestrina etymology ("saved polyphony from
	// being banned" — the compositional technique, not the db).
	/^teams\/mvox-dev\/prompts\/palestrina\.md$/,
	// This fence itself — its patterns necessarily contain the word.
	/^src\/polyphony-history-fence\.spec\.ts$/,
	// Locked by its OWN byte-identity fence (#318/#320, workers/entu-rights-mcp/
	// fences.spec.ts + src/rights-model-identifiers.spec.ts's own sha256 pins):
	// "a doc edit belongs to its own commissioned slice... Repin only behind a
	// PO ruling that widens the mandate." Its dated ER-14 citation of the
	// probed db (`polyphony`, synthetic, probed 2026-09-10) cannot be reworded
	// here without breaking that separate, independently-authoritative fence —
	// whole-file exclusion until a dedicated slice touches this doc.
	/^docs\/architecture\/entu-rights-and-visibility-model\.md$/,
	// Same lock, the mirror side: this guard spec's own sha256 pin (workers/
	// entu-rights-mcp/fences.spec.ts) requires it byte-identical to HEAD except
	// through its own commissioned slice — it asserts the doc above names its
	// probed db verbatim, so its assertion text cannot be reworded here either.
	/^src\/rights-model-identifiers\.spec\.ts$/
];

// ── LINE EXCLUSIONS: referents that are allowed anywhere ───────────────────
// A line matching ANY of these is not an offender, whatever file it is in.
export const ALLOWED_LINE_PATTERNS: ReadonlyArray<RegExp> = [
	// polyphony.uk — Crede's legacy web app, a different thing (issue #407).
	/polyphony\.uk/i,
	// ~/projects/polyphony — the archived prototype's path, dated history.
	/~\/projects\/polyphony/,
	// Musical term — the compositional technique, not the db.
	/vocal polyphony/i,
	// Archived-prototype referent — the pre-mvox prototype, not the db.
	/polyphony prototype/i,
	// Archived-prototype referent — code harvested from the prototype.
	/polyphony harvest/i
];

// ── SCOPED LINE EXCLUSIONS: referents allowed only in named paths ──────────
export const ALLOWED_SCOPED_LINE_PATTERNS: ReadonlyArray<{
	path: RegExp;
	line: RegExp;
}> = [
	// docs/architecture dated citations — a line that pins a machine date is a
	// historic record of what was probed/decided then, not a current-db claim.
	{ path: /^docs\/architecture\//, line: /20\d{2}-\d{2}-\d{2}/ },
	// roster.json etymology lines — composer origin blurbs (musical term).
	{ path: /^teams\/mvox-dev\/roster\.json$/, line: /"origin":/ }
];

// The six tidy-td* migration scripts ran 2026-08-12 (their seed-results
// ledgers prove it) but carry no date in their filenames. They become
// historic by the filename rule: renamed with the run-date suffix, content
// UNTOUCHED (their `?? 'polyphony'` default is then a dated historic record).
export const TIDY_SCRIPT_RENAMES: ReadonlyArray<{
	undated: string;
	dated: string;
}> = [
	{
		undated: 'scripts/migrations/tidy-td2-name-visibility.ts',
		dated: 'scripts/migrations/tidy-td2-name-visibility-2026-08-12.ts'
	},
	{
		undated: 'scripts/migrations/tidy-td2b-tier-alignment.ts',
		dated: 'scripts/migrations/tidy-td2b-tier-alignment-2026-08-12.ts'
	},
	{
		undated: 'scripts/migrations/tidy-td2c-rsvp-name-formula.ts',
		dated: 'scripts/migrations/tidy-td2c-rsvp-name-formula-2026-08-12.ts'
	},
	{
		undated: 'scripts/migrations/tidy-td2d-member-name-formula.ts',
		dated: 'scripts/migrations/tidy-td2d-member-name-formula-2026-08-12.ts'
	},
	{
		undated: 'scripts/migrations/tidy-td3-type-labels.ts',
		dated: 'scripts/migrations/tidy-td3-type-labels-2026-08-12.ts'
	},
	{
		undated: 'scripts/migrations/tidy-td4-entity-visibility.ts',
		dated: 'scripts/migrations/tidy-td4-entity-visibility-2026-08-12.ts'
	}
];

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
	encoding: 'utf8'
}).trim();

interface Offender {
	file: string;
	line: number;
	text: string;
}

function collectOffenders(): Offender[] {
	const tracked = execFileSync('git', ['ls-files'], {
		cwd: repoRoot,
		encoding: 'utf8'
	})
		.split('\n')
		.filter(Boolean);

	const offenders: Offender[] = [];
	for (const file of tracked) {
		if (ALLOWED_PATHS.some((p) => p.test(file))) continue;
		const content = readFileSync(join(repoRoot, file), 'utf8');
		if (!/polyphony/i.test(content)) continue;
		const lines = content.split('\n');
		lines.forEach((text, idx) => {
			if (!/polyphony/i.test(text)) return;
			if (ALLOWED_LINE_PATTERNS.some((p) => p.test(text))) return;
			if (
				ALLOWED_SCOPED_LINE_PATTERNS.some(
					(s) => s.path.test(file) && s.line.test(text)
				)
			)
				return;
			offenders.push({ file, line: idx + 1, text: text.trim() });
		});
	}
	return offenders;
}

describe('#407 polyphony history fence', () => {
	it('no live polyphony reference remains outside the historic allowlist', () => {
		const offenders = collectOffenders();
		const byFile = new Map<string, number>();
		for (const o of offenders) {
			byFile.set(o.file, (byFile.get(o.file) ?? 0) + 1);
		}
		const fileList = [...byFile.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([file, count]) => `  ${file} (${count})`)
			.join('\n');
		expect(
			offenders.length,
			`${offenders.length} live 'polyphony' occurrence(s) across ${byFile.size} file(s) outside the historic allowlist:\n${fileList}`
		).toBe(0);
	});

	it('the six tidy-td* scripts carry their 2026-08-12 run date in the filename', () => {
		for (const { undated, dated } of TIDY_SCRIPT_RENAMES) {
			expect(existsSync(join(repoRoot, dated)), `missing: ${dated}`).toBe(true);
			expect(
				existsSync(join(repoRoot, undated)),
				`undated name still present: ${undated}`
			).toBe(false);
		}
	});
});
