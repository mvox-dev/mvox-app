// Reads ~/.config/mvox/credentials.env into env, so a run needs no `source` first.
import { readFileSync } from 'node:fs';

const LINE_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

// The file wins over env, so what runs never depends on the caller's shell. Values never leave.
export function loadCredentialsFile(path: string, env: Record<string, string | undefined>): void {
	let text: string;
	try {
		text = readFileSync(path, 'utf-8');
	} catch {
		throw new Error(`credentials file ${path} cannot be read`);
	}
	for (const [index, raw] of text.split('\n').entries()) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const match = LINE_RE.exec(line);
		if (!match) throw new Error(`credentials file ${path}: line ${index + 1} is not KEY=value`);
		const value = match[2];
		const quoted = value.length >= 2 && (value[0] === "'" || value[0] === '"') && value.at(-1) === value[0];
		env[match[1]] = quoted ? value.slice(1, -1) : value;
	}
}
