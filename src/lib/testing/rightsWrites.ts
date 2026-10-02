// Every rights write in src/, found by its wire shape, checked against docs/rights-writes.md.
import { stripComments } from './commentRules';

export const RIGHTS_WRITES_DOC = 'docs/rights-writes.md';
export const VALUE_DELETE = 'value DELETE';

export interface RightsWrite {
	file: string;
	fn: string;
	write: string;
}

export interface Untraceable {
	file: string;
	line: number;
	form: string;
}

export const RIGHTS_WRITES_REGISTER: readonly RightsWrite[] = [
	{ file: 'src/lib/admin/roleManagement.ts', fn: 'grantRole', write: '_editor' },
	{ file: 'src/lib/admin/roleManagement.ts', fn: 'grantRole', write: VALUE_DELETE },
	{ file: 'src/lib/admin/roleManagement.ts', fn: 'revokeOwnGrant', write: VALUE_DELETE },
	{ file: 'src/lib/invite/inviteCreate.ts', fn: 'createInvite', write: '_editor' },
	{ file: 'src/lib/profile/profileData.ts', fn: 'createProfile', write: '_inheritrights' },
	{ file: 'src/lib/profile/profileData.ts', fn: 'createProfile', write: '_sharing' },
	{ file: 'src/lib/profile/profileData.ts', fn: 'createProfile', write: '_owner' }
];

const SOURCE_FILE = /\.(ts|svelte)$/;

export function selectScannedFiles(paths: string[]): string[] {
	return paths.filter(
		(path) =>
			path.startsWith('src/') &&
			SOURCE_FILE.test(path) &&
			!path.endsWith('.spec.ts') &&
			!path.startsWith('src/lib/testing/')
	);
}

const NAMES = '_sharing|_inheritrights|_owner|_editor|_viewer|_expander|_noaccess';
const TYPED = new RegExp(`\\btype:\\s*(['"\`])(${NAMES})\\1`, 'g');
const LITERAL = new RegExp(`(['"\`])(?:${NAMES})\\1`, 'g');
const BUILT = /(['"`])_\1\s*\+|`_\$\{/;
// A read names the property as a key, a member or a query field; message text does not count.
const READS_RIGHTS = new RegExp(`[.=,](?:${NAMES})\\b|\\b(?:${NAMES})\\??:`);
const VALUE_DELETE_CALL = /property\/[\s\S]*method:\s*['"`]DELETE['"`]/;
const DECLARATION =
	/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;

const isUnionMember = (line: string, start: number, end: number) =>
	/(^|[^|])\|$/.test(line.slice(0, start).trimEnd()) ||
	/^\|(?!\|)/.test(line.slice(end).trimStart());

export function scanRightsWrites(
	file: string,
	source: string
): { writes: RightsWrite[]; untraceable: Untraceable[] } {
	const lines = stripComments(source).split('\n');
	const writes: RightsWrite[] = [];
	const untraceable: Untraceable[] = [];
	const chunks = new Map<string, string>();
	let fn = '(top level)';
	lines.forEach((line, i) => {
		fn = line.match(DECLARATION)?.[1] ?? fn;
		chunks.set(fn, (chunks.get(fn) ?? '') + line + '\n');
		const typed = [...line.matchAll(TYPED)];
		for (const m of typed) writes.push({ file, fn, write: m[2] });
		const loose = [...line.matchAll(LITERAL)].filter(
			(m) =>
				!typed.some((t) => m.index >= t.index && m.index < t.index + t[0].length) &&
				!isUnionMember(line, m.index, m.index + m[0].length)
		);
		if (loose.length > 0) {
			untraceable.push({ file, line: i + 1, form: 'a rights name outside a type: key' });
		}
		if (BUILT.test(line)) {
			untraceable.push({ file, line: i + 1, form: 'a rights name built at run time' });
		}
	});
	if (READS_RIGHTS.test(lines.join('\n'))) {
		for (const [name, body] of chunks) {
			if (VALUE_DELETE_CALL.test(body)) writes.push({ file, fn: name, write: VALUE_DELETE });
		}
	}
	return { writes, untraceable };
}

const keyOf = (w: RightsWrite) => `${w.file}#${w.fn}#${w.write}`;

export function registerMismatch(
	found: readonly RightsWrite[],
	register: readonly RightsWrite[]
): { unlisted: RightsWrite[]; stale: RightsWrite[] } {
	const listed = new Set(register.map(keyOf));
	const seen = new Set(found.map(keyOf));
	const unlisted = [...new Map(found.map((w) => [keyOf(w), w])).values()].filter(
		(w) => !listed.has(keyOf(w))
	);
	return { unlisted, stale: register.filter((w) => !seen.has(keyOf(w))) };
}

const cell = (text: string) => text.trim().replace(/^`(.*)`$/, '$1');

export function docRows(markdown: string): Array<RightsWrite & { reason: string }> {
	return markdown
		.split('\n')
		.filter((line) => line.startsWith('| `'))
		.map((line) => {
			const [file, fn, write, reason] = line.split('|').slice(1, 5).map(cell);
			return { file, fn, write, reason };
		});
}
