// The rules from common-prompt.md "Source Comments", on every code file this branch changes.
import { describe, expect, it } from 'vitest';
import { changedFiles, checkChangedFiles } from '$lib/testing/commentRules';

describe('comment rules on the files this change touches', () => {
	it('no changed code file breaks the comment rules', () => {
		const found = checkChangedFiles(changedFiles()).map(
			(v) => `${v.file}:${v.line} ${v.rule} — ${v.detail}`
		);
		expect(found).toEqual([]);
	});
});
