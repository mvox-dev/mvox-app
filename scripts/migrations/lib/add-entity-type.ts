// The add-entity-type op: one schema-of-record type-def and its prop-defs onto a db (#1071).
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';
import {
	createPropDef,
	createTypeDef,
	findPropDefIds,
	findTypeDefIds,
	resolveMetaTypeIds,
	resolveTypeIdByName
} from './ensure-schema-type';
import * as extensions from './mvox-schema-extensions';
import type { MvoxEntityDef } from './mvox-schema-extensions';
import { TYPE_TEXT, type TypeText } from './mvox-type-text';
import type { AddEntityTypeOp, OpRunner } from './work-order';

function isEntityDef(value: unknown): value is MvoxEntityDef {
	return typeof value === 'object' && value !== null && 'properties' in value && 'inheritsRights' in value;
}

export function entityDefByName(name: string): { def: MvoxEntityDef; text: TypeText } {
	const defs = Object.values(extensions).filter(isEntityDef).filter((d) => d.name === name);
	if (defs.length === 0) throw new Error(`type '${name}' is not in the schema of record (mvox-schema-extensions.ts)`);
	if (defs.length > 1) throw new Error(`type '${name}' is defined ${defs.length} times in the schema of record`);
	const [def] = defs;
	if (def.addFrom) throw new Error(`type '${name}' has add_from, which add-entity-type does not wire`);
	const text = TYPE_TEXT[name];
	if (!text) throw new Error(`type '${name}' has no label or description in mvox-type-text.ts`);
	return { def, text };
}

const FIELDS = ['name', 'type', 'mandatory', 'list', '_sharing', '_inheritrights'] as const;
type Field = (typeof FIELDS)[number];

// A field Entu holds more than once (#445) reads as 'duplicated', never as its first value.
async function readDef(cfg: EntuCfg, id: string, fetchImpl: typeof fetch): Promise<Record<Field, string>> {
	const res = await entuFetch(cfg.db, `entity/${id}?props=${FIELDS.join(',')}`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`post-check: reading ${id} failed: HTTP ${res.status}`);
	const entity = ((await res.json()) as { entity?: Record<string, Array<Record<string, unknown>>> }).entity ?? {};
	const read = (field: Field) => {
		const values = entity[field] ?? [];
		if (values.length > 1) return 'duplicated';
		const value = values[0]?.string ?? values[0]?.boolean;
		if (value !== undefined) return String(value);
		return field === 'mandatory' || field === 'list' ? 'false' : '(absent)';
	};
	return Object.fromEntries(FIELDS.map((f) => [f, read(f)])) as Record<Field, string>;
}

function compare(drift: string[], label: string, actual: Record<Field, string>, expected: Partial<Record<Field, string>>) {
	for (const [field, want] of Object.entries(expected)) {
		const got = actual[field as Field];
		if (got !== want) drift.push(`${label} ${field} is '${got}', the definition says '${want}'`);
	}
}

export const addEntityType: OpRunner<AddEntityTypeOp> = {
	describe: (op) => `add-entity-type ${op.type}`,
	target: (op) => ({ type: op.type }),
	done: 'created',
	plan(op) {
		const { def } = entityDefByName(op.type);
		return [
			`POST type-def ${def.name}: _sharing ${def.sharing}, _inheritrights ${def.inheritsRights}`,
			...def.properties.map((p) => {
				const flags = [p.type, p.required ? 'mandatory' : '', p.list ? 'list' : ''].filter(Boolean);
				return `POST prop-def ${def.name}.${p.name}: ${flags.join(', ')}, _sharing ${p.sharing ?? def.sharing}`;
			})
		];
	},
	async preCheck(cfg, op, fetchImpl) {
		const { def } = entityDefByName(op.type);
		const { entityMetaTypeId } = await resolveMetaTypeIds(cfg, fetchImpl);
		for (const parent of def.parents) await resolveTypeIdByName(cfg, entityMetaTypeId, parent.entity, fetchImpl);
		const found = await findTypeDefIds(cfg, entityMetaTypeId, def.name, fetchImpl);
		if (found.length > 0) {
			throw new Error(`type '${def.name}' already exists (${found.join(', ')}): this op only adds a new one`);
		}
	},
	async execute(cfg, op, fetchImpl, created) {
		const { def, text } = entityDefByName(op.type);
		const { entityMetaTypeId, propertyMetaTypeId } = await resolveMetaTypeIds(cfg, fetchImpl);
		const typeDef = { name: def.name, sharing: def.sharing, inheritsRights: def.inheritsRights, ...text };
		const typeId = await createTypeDef(cfg, entityMetaTypeId, typeDef, fetchImpl);
		created.push({ name: def.name, id: typeId });
		for (const prop of def.properties) {
			const id = await createPropDef(cfg, propertyMetaTypeId, typeId, def.name, def.sharing, prop, fetchImpl);
			created.push({ name: `${def.name}.${prop.name}`, id });
		}
	},
	async postCheck(cfg, op, fetchImpl) {
		const { def } = entityDefByName(op.type);
		const { entityMetaTypeId, propertyMetaTypeId } = await resolveMetaTypeIds(cfg, fetchImpl);
		const typeIds = await findTypeDefIds(cfg, entityMetaTypeId, def.name, fetchImpl);
		if (typeIds.length !== 1) throw new Error(`post-check: ${typeIds.length} type-defs named '${def.name}', not one`);
		const drift: string[] = [];
		const type = await readDef(cfg, typeIds[0], fetchImpl);
		compare(drift, def.name, type, { _sharing: def.sharing, _inheritrights: String(def.inheritsRights) });
		const props = new Map<string, Record<Field, string>>();
		for (const id of await findPropDefIds(cfg, propertyMetaTypeId, typeIds[0], fetchImpl)) {
			const prop = await readDef(cfg, id, fetchImpl);
			if (props.has(prop.name)) drift.push(`${def.name}.${prop.name} has two prop-defs`);
			props.set(prop.name, prop);
		}
		for (const spec of def.properties) {
			const label = `${def.name}.${spec.name}`;
			const actual = props.get(spec.name);
			props.delete(spec.name);
			if (!actual) {
				drift.push(`${label} has no prop-def`);
				continue;
			}
			compare(drift, label, actual, {
				type: spec.type,
				mandatory: String(spec.required ?? false),
				list: String(spec.list ?? false),
				_sharing: spec.sharing ?? def.sharing
			});
		}
		for (const name of props.keys()) drift.push(`${def.name}.${name} is not in the definition`);
		if (drift.length > 0) throw new Error(`post-check: ${drift.join('; ')}`);
	}
};

// (*MVOX:Josquin*)
