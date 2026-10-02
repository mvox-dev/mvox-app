// Which exports of the lib modules lead to an Entu write, followed through imports and re-exports.
import { stripComments } from './commentRules';

// A deliberate pinned text check: a new write module is a seam once written. Comments don't count.
const WRITE_METHOD = /method:\s*['"`](POST|DELETE|PUT|PATCH)['"`]/;
const DECLARATION =
	/^(export\s+)?(default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;

export const writesToEntu = (source: string) => WRITE_METHOD.test(stripComments(source));

// Forms parseModule cannot follow; a guard spec fails on any of them in src/lib or src/routes.
const UNTRACEABLE: ReadonlyArray<[RegExp, string]> = [
	[/export\s+\*\s+as\s+[\w$]+\s+from\s*['"][.$]/, 'export * as ns from'],
	[/export\s*\{[^}]*\bdefault\b[^}]*\}\s*from\s*['"][.$]/, 'export { default } from'],
	[/(?:const|let|var)\s+[\w$]+\s*=\s*(?:await\s+)?import\(\s*['"][.$]/, 'a whole module from import()'],
	[/import\(\s*['"][.$][^'"]*['"]\s*\)\s*\.then/, 'import().then'],
	[/export\s+default\s*\{/, 'a default-exported object'],
	[/export\s+default\s+(?:async\s+)?(?:function\s*\*?\s*\(|class\s*[{e]|\()/, 'anonymous export default']
];

export function untraceableForms(source: string): string[] {
	const code = stripComments(source);
	return UNTRACEABLE.filter(([pattern]) => pattern.test(code)).map(([, label]) => label);
}

export type Resolve = (specifier: string, fromFile: string) => string | null;

interface Binding {
	module: string;
	name: string;
}

interface ModuleShape {
	chunks: Map<string, string>;
	exported: Map<string, string>;
	imports: Map<string, Binding>;
	namespaces: Map<string, string>;
	reexports: Binding[];
	starReexports: string[];
}

/** The value bindings a `{ a, b as c, type T }` clause names, as [imported, local] pairs. */
export function namedBindings(clause: string): Array<[string, string]> {
	return clause
		.split(',')
		.map((b) => b.trim())
		.filter((b) => b.length > 0 && !/^type\s/.test(b))
		.map((b) => {
			const [imported, local] = b.split(/\s+as\s+/);
			return [imported.trim(), (local ?? imported).trim()];
		});
}

function parseModule(path: string, source: string, resolve: Resolve): ModuleShape {
	const code = stripComments(source);
	const shape: ModuleShape = {
		chunks: new Map(),
		exported: new Map(),
		imports: new Map(),
		namespaces: new Map(),
		reexports: [],
		starReexports: []
	};
	const importPattern = /import\s+(type\s+)?([^;]*?)\s*from\s*['"]([^'"]+)['"]/g;
	for (const [, typeOnly, clause, specifier] of code.matchAll(importPattern)) {
		const module = typeOnly ? null : resolve(specifier, path);
		if (!module) continue;
		const named = clause.match(/\{([\s\S]*)\}/)?.[1];
		for (const [name, local] of named ? namedBindings(named) : []) {
			shape.imports.set(local, { module, name });
		}
		const namespace = clause.match(/\*\s+as\s+([\w$]+)/)?.[1];
		if (namespace) shape.namespaces.set(namespace, module);
		const defaultImport = clause.match(/^\s*([A-Za-z_$][\w$]*)\s*(,|$)/)?.[1];
		if (defaultImport) shape.imports.set(defaultImport, { module, name: 'default' });
	}
	const dynamicPattern = /const\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;
	for (const [, clause, specifier] of code.matchAll(dynamicPattern)) {
		const module = resolve(specifier, path);
		if (!module) continue;
		for (const [name, local] of namedBindings(clause.replace(/:/g, ' as '))) {
			shape.imports.set(local, { module, name });
		}
	}
	const reexportPattern = /export\s+(type\s+)?(\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g;
	for (const [, typeOnly, clause, specifier] of code.matchAll(reexportPattern)) {
		const module = typeOnly ? null : resolve(specifier, path);
		if (!module) continue;
		if (clause === '*') shape.starReexports.push(module);
		for (const [name, exported] of clause === '*' ? [] : namedBindings(clause.slice(1, -1))) {
			shape.reexports.push({ module, name: `${name}\u0000${exported}` });
		}
	}
	for (const [, clause] of code.matchAll(/export\s*\{([^}]*)\}(?!\s*from\b)/g)) {
		for (const [local, exported] of namedBindings(clause)) shape.exported.set(exported, local);
	}
	for (const [, local] of code.matchAll(/^export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/gm)) {
		shape.exported.set('default', local);
	}
	let current: string | null = null;
	for (const line of code.split('\n')) {
		const declared = line.match(DECLARATION);
		if (declared) {
			current = declared[3];
			if (declared[1]) shape.exported.set(declared[2] ? 'default' : current, current);
			shape.chunks.set(current, '');
		}
		if (current) shape.chunks.set(current, shape.chunks.get(current) + line + '\n');
	}
	return shape;
}

const mentions = (body: string, name: string) =>
	new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}\\b`).test(body);

/** Every export that writes, per module: it issues a non-GET itself, or reaches, through its
 *  own body, a local or an imported binding that does. Iterated to a fixpoint, so cycles end. */
export function writingExports(
	sources: ReadonlyMap<string, string>,
	resolve: Resolve
): Map<string, Set<string>> {
	const shapes = new Map([...sources].map(([p, s]) => [p, parseModule(p, s, resolve)] as const));
	const writing = new Map([...shapes.keys()].map((p) => [p, new Set<string>()] as const));
	const writes = (b: Binding) => writing.get(b.module)?.has(b.name) ?? false;
	let grew = true;
	while (grew) {
		grew = false;
		for (const [path, shape] of shapes) {
			const local = new Set<string>();
			let localGrew = true;
			while (localGrew) {
				localGrew = false;
				for (const [name, body] of shape.chunks) {
					if (local.has(name)) continue;
					const reaches =
						WRITE_METHOD.test(body) ||
						[...local].some((l) => l !== name && mentions(body, l)) ||
						[...shape.imports].some(([l, b]) => writes(b) && mentions(body, l)) ||
						[...shape.namespaces].some(([ns, module]) =>
							[...body.matchAll(new RegExp(`\\b${ns}\\.([\\w$]+)`, 'g'))].some(([, m]) =>
								writes({ module, name: m })
							)
						);
					if (reaches) {
						local.add(name);
						localGrew = true;
					}
				}
			}
			const out = writing.get(path)!;
			const add = (name: string) => {
				if (!out.has(name)) {
					out.add(name);
					grew = true;
				}
			};
			for (const [exported, localName] of shape.exported) {
				const imported = shape.imports.get(localName);
				if (local.has(localName) || (imported && writes(imported))) add(exported);
			}
			for (const { module, name } of shape.reexports) {
				const [imported, exported] = name.split('\u0000');
				if (writes({ module, name: imported })) add(exported);
			}
			for (const module of shape.starReexports) {
				for (const name of writing.get(module) ?? []) add(name);
			}
		}
	}
	return writing;
}
