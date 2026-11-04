// A work order: one live data change with Mihkel's go, as YAML (docs/architecture/work-orders.md).
import { parseDocument, stringify, YAMLMap } from 'yaml';
import type { EntuCfg } from '$lib/entu/cfg';

export interface WorkOrderGo {
	by: string;
	at: string;
	quote: string;
}

export interface DeletePropertyOp {
	op: 'delete-property';
	entity: string;
	property: string;
	// filesize null: the live property has no size (an upload that never landed).
	expect: { type: string; filesize: number | null; filetype?: string };
}

// The type's whole definition and text come from the schema of record, never from the order.
export interface AddEntityTypeOp {
	op: 'add-entity-type';
	type: string;
}

export type WorkOrderOp = DeletePropertyOp | AddEntityTypeOp;

export interface WorkOrder {
	db: string;
	why: string;
	ref: string;
	go: WorkOrderGo;
	ops: WorkOrderOp[];
}

export interface CreatedId {
	name: string;
	id: string;
}

export interface WorkOrderOpResult {
	op: string;
	property?: string;
	type?: string;
	outcome: 'deleted' | 'created' | 'failed' | 'not-run';
	created?: CreatedId[];
	error?: string;
}

export interface WorkOrderResult {
	ran_at: string;
	outcome: 'done' | 'failed';
	ledger: string;
	ops: WorkOrderOpResult[];
}

// execute pushes each id it creates as it goes, so a failure mid-op still records them.
export interface OpRunner<T extends WorkOrderOp> {
	describe(op: T): string;
	target(op: T): Pick<WorkOrderOpResult, 'property' | 'type'>;
	done: 'deleted' | 'created';
	plan(op: T): string[];
	preCheck(cfg: EntuCfg, op: T, fetchImpl: typeof fetch): Promise<void>;
	execute(cfg: EntuCfg, op: T, fetchImpl: typeof fetch, created: CreatedId[]): Promise<void>;
	postCheck(cfg: EntuCfg, op: T, fetchImpl: typeof fetch): Promise<void>;
}

type Raw = Record<string, unknown>;

const FILE_NAME_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.yaml$/;
const DB_RE = /^[a-z0-9_]+$/;
const ENTU_ID_RE = /^[0-9a-f]{24}$/;
const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const FROZEN_DBS = ['polyphony'];
const TOP_KEYS = ['db', 'why', 'ref', 'go', 'ops', 'result'];
// type goes into a read URL. No filename or string: either can hold a name; orders are committed.
const PROPERTY_TYPE_RE = /^[a-z][a-z0-9_]*$/;
const DELETE_PROPERTY_EXPECT_KEYS = ['type', 'filesize', 'filetype'];

function fail(message: string): never {
	throw new Error(`work order: ${message}`);
}

function isMap(value: unknown): value is Raw {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(raw: Raw, key: string, where: string): string {
	const value = raw[key];
	if (typeof value !== 'string' || !value.trim()) fail(`${where}${key} must be a non-blank string`);
	return value;
}

function onlyKeys(raw: Raw, allowed: readonly string[], where: string): void {
	for (const key of Object.keys(raw)) {
		if (!allowed.includes(key)) fail(`${where}${key}: unknown key '${key}'`);
	}
}

function entuId(raw: Raw, key: string, where: string): string {
	const value = raw[key];
	if (typeof value !== 'string' || !ENTU_ID_RE.test(value)) fail(`${where}${key} must be a 24-hex Entu id`);
	return value;
}

function refuseEmails(value: unknown, where: string): void {
	if (typeof value === 'string' && value.includes('@')) fail(`${where} contains '@': orders hold no emails`);
	if (Array.isArray(value)) value.forEach((v, i) => refuseEmails(v, `${where}[${i}]`));
	if (isMap(value)) for (const [k, v] of Object.entries(value)) refuseEmails(v, `${where}.${k}`);
}

function parseGo(raw: unknown): WorkOrderGo {
	if (!isMap(raw)) fail('go is missing: no live write without a go from Mihkel');
	onlyKeys(raw, ['by', 'at', 'quote'], 'go.');
	const by = text(raw, 'by', 'go.');
	if (by !== 'Mihkel') fail(`go.by is '${by}': only Mihkel gives the go`);
	const at = text(raw, 'at', 'go.');
	if (!ISO_TIME_RE.test(at) || Number.isNaN(Date.parse(at))) fail(`go.at '${at}' must be an ISO date and time`);
	return { by, at, quote: text(raw, 'quote', 'go.') };
}

function parseDeleteProperty(raw: Raw, where: string): DeletePropertyOp {
	onlyKeys(raw, ['op', 'entity', 'property', 'expect'], where);
	const expectRaw = raw.expect;
	if (!isMap(expectRaw)) fail(`${where}expect must be a map`);
	onlyKeys(expectRaw, DELETE_PROPERTY_EXPECT_KEYS, `${where}expect.`);
	const type = text(expectRaw, 'type', `${where}expect.`);
	if (!PROPERTY_TYPE_RE.test(type)) fail(`${where}expect.type '${type}' must match ${PROPERTY_TYPE_RE}`);
	const { filesize } = expectRaw;
	if (!('filesize' in expectRaw) || !(filesize === null || Number.isInteger(filesize))) {
		fail(`${where}expect.filesize must be a whole number, or null for no size`);
	}
	const expect: DeletePropertyOp['expect'] = { type, filesize: filesize as number | null };
	if ('filetype' in expectRaw) expect.filetype = text(expectRaw, 'filetype', `${where}expect.`);
	return {
		op: 'delete-property',
		entity: entuId(raw, 'entity', where),
		property: entuId(raw, 'property', where),
		expect
	};
}

function parseAddEntityType(raw: Raw, where: string): AddEntityTypeOp {
	onlyKeys(raw, ['op', 'type'], where);
	const type = text(raw, 'type', where);
	if (!PROPERTY_TYPE_RE.test(type)) fail(`${where}type '${type}' must match ${PROPERTY_TYPE_RE}`);
	return { op: 'add-entity-type', type };
}

// One entry per op; the runner keeps a matching entry that executes it.
const OP_PARSERS: Record<string, (raw: Raw, where: string) => WorkOrderOp> = {
	'delete-property': parseDeleteProperty,
	'add-entity-type': parseAddEntityType
};

function parseOp(raw: unknown, index: number): WorkOrderOp {
	const where = `ops[${index}].`;
	if (!isMap(raw)) fail(`${where.slice(0, -1)} must be a map`);
	const parser = typeof raw.op === 'string' ? OP_PARSERS[raw.op] : undefined;
	if (!parser) fail(`${where.slice(0, -1)}: unknown op '${String(raw.op)}'`);
	return parser(raw, where);
}

export function parseWorkOrder(source: string, fileName: string): WorkOrder {
	if (!FILE_NAME_RE.test(fileName)) fail(`file name '${fileName}' must be YYYY-MM-DD-<slug>.yaml`);
	const doc = parseDocument(source);
	if (doc.errors.length > 0) fail(`not valid YAML: ${doc.errors[0].message}`);
	const raw: unknown = doc.toJS();
	if (!isMap(raw)) fail('the file must hold a YAML map');
	onlyKeys(raw, TOP_KEYS, '');
	if ('result' in raw) fail('this order is spent: it has a result, so it never runs again');
	refuseEmails(raw, 'order');
	const db = text(raw, 'db', '');
	if (FROZEN_DBS.includes(db)) fail(`db '${db}' is frozen: no writes`);
	if (!DB_RE.test(db)) fail(`db '${db}' is not a database name`);
	const go = parseGo(raw.go);
	if (!Array.isArray(raw.ops) || raw.ops.length === 0) fail('ops must list at least one op');
	return { db, why: text(raw, 'why', ''), ref: text(raw, 'ref', ''), go, ops: raw.ops.map(parseOp) };
}

const GO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function assertGoFresh(go: WorkOrderGo, now: Date): void {
	const age = now.getTime() - Date.parse(go.at);
	if (age < 0) fail(`go.at ${go.at} is in the future`);
	if (age > GO_MAX_AGE_MS) fail(`go.at ${go.at} is older than 7 days: ask Mihkel for a new go`);
}

export function authorizedByFromGo(go: WorkOrderGo, fileName: string): string {
	return `${go.by}, ${go.at}, work order ${fileName}`;
}

export function withResult(source: string, result: WorkOrderResult): string {
	const doc = parseDocument(source);
	if (!(doc.contents instanceof YAMLMap)) fail('the file must hold a YAML map');
	if (doc.has('result')) fail('this order already has a result');
	return `${source.trimEnd()}\n${stringify({ result })}`;
}
