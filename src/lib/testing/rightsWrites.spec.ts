// A fence over source text, comments ignored: every rights write in src/ is listed with its reason.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
	RIGHTS_WRITES_DOC,
	RIGHTS_WRITES_REGISTER,
	VALUE_DELETE,
	docRows,
	registerMismatch,
	scanRightsWrites,
	selectScannedFiles,
	type RightsWrite
} from './rightsWrites';

const ROOT = process.cwd();
const FILE = 'src/lib/planted/plantedRights.ts';

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

const fn = (name: string, ...body: string[]) =>
	[`export async function ${name}(id: string) {`, ...body.map((l) => `\t${l}`), '}'].join('\n');

const byKey = (a: RightsWrite, b: RightsWrite) =>
	`${a.file}#${a.fn}#${a.write}`.localeCompare(`${b.file}#${b.fn}#${b.write}`);

describe('#700 — the rights-write rules, each shown by a planted example', () => {
	it('a typed rights prop is a write of that property, in its function', () => {
		const source = fn('plantGrant', "return [{ type: '_viewer', reference: id }];");
		expect(scanRightsWrites(FILE, source)).toEqual({
			writes: [{ file: FILE, fn: 'plantGrant', write: '_viewer' }],
			untraceable: []
		});
	});

	it('a planted write not on the register fails as unlisted; listed, it passes', () => {
		const { writes } = scanRightsWrites(FILE, fn('plantGrant', 'return [{ type: "_owner" }];'));
		const planted = { file: FILE, fn: 'plantGrant', write: '_owner' };
		expect(registerMismatch(writes, RIGHTS_WRITES_REGISTER).unlisted).toEqual([planted]);
		expect(registerMismatch(writes, [planted])).toEqual({ unlisted: [], stale: [] });
	});

	it('a register entry the scan no longer finds is stale', () => {
		const gone = { file: FILE, fn: 'removed', write: '_sharing' };
		expect(registerMismatch([], [gone])).toEqual({ unlisted: [], stale: [gone] });
	});

	it('a commented-out write is no write', () => {
		const source = fn('plantQuiet', "// return [{ type: '_editor', reference: id }];", 'return [];');
		expect(scanRightsWrites(FILE, source)).toEqual({ writes: [], untraceable: [] });
	});

	it('a value DELETE in a module that reads rights is a rights write', () => {
		const source = [
			"const READ = 'entity/x?props=_owner,_editor';",
			fn('plantRevoke', "await entuFetch(db, `property/${id}`, token, { method: 'DELETE' });")
		].join('\n');
		expect(scanRightsWrites(FILE, source).writes).toEqual([
			{ file: FILE, fn: 'plantRevoke', write: VALUE_DELETE }
		]);
	});

	it('a value DELETE in a module that names a rights property only in text is no rights write', () => {
		const source = fn(
			'plantClear',
			"await entuFetch(db, `property/${id}`, token, { method: 'DELETE' });",
			'throw new Error(`refused: the person lacks self-_editor`);'
		);
		expect(scanRightsWrites(FILE, source).writes).toEqual([]);
	});

	it('a rights name outside a type: key, or built at run time, is untraceable', () => {
		const source = fn(
			'plantHidden',
			"await clearEntityProperty(cfg, id, '_sharing');",
			"const tier = '_expander';",
			'const built = `_${tier}`;',
			"return [{ type: '_' + tier }];"
		);
		expect(scanRightsWrites(FILE, source)).toEqual({
			writes: [],
			untraceable: [
				{ file: FILE, line: 2, form: 'a rights name outside a type: key' },
				{ file: FILE, line: 3, form: 'a rights name outside a type: key' },
				{ file: FILE, line: 4, form: 'a rights name built at run time' },
				{ file: FILE, line: 5, form: 'a rights name built at run time' }
			]
		});
	});

	it('a rights name beside a logical or is untraceable, not a union member', () => {
		const source = fn('plantOr', "const tier = override || '_owner';", "return tier ?? '_editor' || x;");
		expect(scanRightsWrites(FILE, source).untraceable).toEqual([
			{ file: FILE, line: 2, form: 'a rights name outside a type: key' },
			{ file: FILE, line: 3, form: 'a rights name outside a type: key' }
		]);
	});

	it('a rights name as a type union member is no write', () => {
		const source = [
			"type Raw = Pick<Wire, '_id' | '_owner'>;",
			'type Tier =',
			"\t| '_owner'",
			"\t| '_editor';"
		].join('\n');
		expect(scanRightsWrites(FILE, source)).toEqual({ writes: [], untraceable: [] });
	});

	it('reads the doc table as register rows, each with its reason', () => {
		const doc = [
			'| File | Function | Property | Reason |',
			'|---|---|---|---|',
			`| \`${FILE}\` | \`plantGrant\` | \`_owner\` | Why it is needed. |`,
			`| \`${FILE}\` | \`plantRevoke\` | ${VALUE_DELETE} |  |`
		].join('\n');
		expect(docRows(doc)).toEqual([
			{ file: FILE, fn: 'plantGrant', write: '_owner', reason: 'Why it is needed.' },
			{ file: FILE, fn: 'plantRevoke', write: VALUE_DELETE, reason: '' }
		]);
	});

	it('scans .ts and .svelte under src/, never specs or the testing helpers', () => {
		expect(
			selectScannedFiles([
				'src/lib/a.ts',
				'src/routes/b.svelte',
				'src/lib/a.spec.ts',
				'src/lib/c.js',
				'scripts/d.ts',
				'src/lib/testing/realNamesFence.ts'
			])
		).toEqual(['src/lib/a.ts', 'src/routes/b.svelte']);
	});
});

describe('#700 — every rights write in src/ is on the register and in the doc', () => {
	const files = selectScannedFiles(
		walk(resolve(ROOT, 'src')).map((path) => relative(ROOT, path).split('\\').join('/'))
	);
	const scans = files.map((file) => scanRightsWrites(file, readFileSync(resolve(ROOT, file), 'utf-8')));
	const writes = scans.flatMap((s) => s.writes);

	it('scans the real tree, not a vacuum', () => {
		expect(files.length).toBeGreaterThan(150);
		expect(writes.length).toBeGreaterThan(0);
	});

	it('no rights name appears in a form the scan cannot follow', () => {
		expect(scans.flatMap((s) => s.untraceable)).toEqual([]);
	});

	it('the register lists exactly the rights writes found', () => {
		expect(registerMismatch(writes, RIGHTS_WRITES_REGISTER)).toEqual({ unlisted: [], stale: [] });
	});

	it(`${RIGHTS_WRITES_DOC} lists exactly the register, each row with a reason`, () => {
		const rows = docRows(readFileSync(resolve(ROOT, RIGHTS_WRITES_DOC), 'utf-8'));
		expect(rows.filter((r) => r.reason.length === 0)).toEqual([]);
		expect(rows.map(({ file, fn, write }) => ({ file, fn, write })).sort(byKey)).toEqual(
			[...RIGHTS_WRITES_REGISTER].sort(byKey)
		);
	});
});

describe('#700 — the related-spec run reaches the rights-write check', () => {
	it('test:changed runs this spec by path, which --changed never collects', () => {
		const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
			scripts: Record<string, string>;
		};
		expect(pkg.scripts['test:changed']).toContain('src/lib/testing/rightsWrites.spec.ts');
	});
});
