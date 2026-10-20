// Turns `<team> <pubkey>` lines into authorized_keys lines whose only command is the server.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TEAM = /^[a-z0-9-]+$/;
const KEY = /^[a-z0-9@.-]+ [A-Za-z0-9+/]+={0,3}( [^"\n]*)?$/;

export function makeAuthorizedKeys(input: string): string {
	return input
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '' && !line.startsWith('#'))
		.map((line) => {
			const [team, ...rest] = line.split(/\s+/);
			if (!TEAM.test(team)) throw new Error(`bad team: ${JSON.stringify(team)}`);
			const key = rest.join(' ');
			if (key === '') throw new Error(`no key for team ${team}`);
			if (!KEY.test(key)) throw new Error(`bad key for team ${team}`);
			return `restrict,command="/usr/local/bin/feedback-mcp --team ${team}" ${key}\n`;
		})
		.join('');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.stdout.write(makeAuthorizedKeys(readFileSync(process.argv[2], 'utf8')));
}
