// #407 (Mihkel 2026-09-18): 'polyphony' as the frozen Entu db survives only as dated history.
// Walks every tracked file; classifies by referent: polyphony.uk, the archived prototype and
// the musical term are other things. Full rationale per entry: git log -p on this file.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Whole files/dirs the fence never reads.
export const ALLOWED_PATHS: ReadonlyArray<RegExp> = [
	// Frozen history: run ledgers, probes, dated migrations, memory, inboxes, dated docs.
	/^scripts\/migrations\/seed-results\//,
	/^scripts\/migrations\/probes\//,
	/^scripts\/migrations\/(lib\/)?[^/]+-2026-[^/]+\.ts$/,
	/^teams\/mvox-dev\/memory\//,
	/^teams\/mvox-dev\/inboxes\//,
	/^teams\/mvox-dev\/memory-adoption\//,
	/^teams\/mvox-dev\/docs\/architecture-decisions\.md$/,
	/^teams\/mvox-dev\/docs\/design-notes\/(email-trust|library-subtree|onboarding|org-rights-isolation|participation|programs|roles-as-rights|seasons-events|section-structure|work-edition-model)\.md$/,
	/^docs\/design\//,
	/^teams\/mvox-dev\/docs\/health-report-.*\.md$/,
	/^docs\/superpowers\//,
	// polyphony.uk referent (legacy web app, colour anchors) on lines without the '.uk' token.
	/^docs\/runbook\/provisioning\.md$/,
	/^src\/app\.css$/,
	/^src\/lib\/events\/eventTypeStyles\.ts$/,
	/^src\/lib\/events\/eventTypeStyles\.spec\.ts$/,
	// Musical term (composer etymology), and this fence itself.
	/^teams\/mvox-dev\/prompts\/byrd\.md$/,
	/^teams\/mvox-dev\/prompts\/palestrina\.md$/,
	/^src\/polyphony-history-fence\.spec\.ts$/,
	// Byte-pinned by their own fences (#318/#320); they name the probed db verbatim.
	/^docs\/architecture\/entu-rights-and-visibility-model\.md$/,
	/^src\/rights-model-identifiers\.spec\.ts$/
];

// Lines allowed anywhere: the other referents.
export const ALLOWED_LINE_PATTERNS: ReadonlyArray<RegExp> = [
	/polyphony\.uk/i,
	/~\/projects\/polyphony/,
	/vocal polyphony/i,
	/polyphony prototype/i,
	/polyphony harvest/i
];

// Lines allowed only in named paths: dated citations, roster etymology.
export const ALLOWED_SCOPED_LINE_PATTERNS: ReadonlyArray<{
	path: RegExp;
	line: RegExp;
}> = [
	{ path: /^docs\/architecture\//, line: /20\d{2}-\d{2}-\d{2}/ },
	{ path: /^teams\/mvox-dev\/roster\.json$/, line: /"origin":/ }
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

});
