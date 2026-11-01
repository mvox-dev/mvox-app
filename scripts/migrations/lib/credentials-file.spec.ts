// The runner reads credentials.env itself, so a run is one plain command with no `source` first.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCredentialsFile } from './credentials-file';

function file(text: string): string {
	const path = join(mkdtempSync(join(tmpdir(), 'creds-')), 'credentials.env');
	writeFileSync(path, text);
	return path;
}

describe('loadCredentialsFile', () => {
	it('sets each KEY=value, unquoting, skipping comments and blank lines; the file wins over env', () => {
		const env: Record<string, string | undefined> = { MVOX_CREDE_DB: 'from-env' };
		loadCredentialsFile(file("# note\n\nMVOX_CREDE_DB=mvox_crede\nMVOX_CREDE_API_KEY='k=1 x'\nB=\"two\"\n"), env);
		expect(env).toEqual({ MVOX_CREDE_DB: 'mvox_crede', MVOX_CREDE_API_KEY: 'k=1 x', B: 'two' });
	});

	it('a missing file fails loudly with its path', () => {
		expect(() => loadCredentialsFile('/nonexistent/credentials.env', {})).toThrow('/nonexistent/credentials.env');
	});

	it('a line it cannot read fails with the line number, never the line', () => {
		const run = () => loadCredentialsFile(file('A=1\nsecret-value-here\n'), {});
		expect(run).toThrow('line 2');
		expect(run).not.toThrow('secret-value-here');
	});
});
