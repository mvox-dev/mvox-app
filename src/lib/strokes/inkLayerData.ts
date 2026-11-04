// Her ink layer in Entu (#1069), the sole layer create path: one private child of her person per
// edition and file, created on her own key. Its grants are its own, not the person's (profile).
import { isTruncated } from '$lib/entu/listRead';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';
import { overwriteEntityValues, replaceEntityProperty } from '$lib/entu/replaceProperty';
import { postEntity } from '$lib/entity/entityCreateShared';
import { resolveTypeId } from '$lib/seasons/entuSeasons';
import { joinLogs, type InkLog } from './inkLog';

export const INK_LAYER_TYPE = 'ink_layer';
// One per device that made one offline before it saw another's; more is damaged data.
const LAYER_LIMIT = 10;

export interface LayerPart {
	personId: string;
	editionId: string;
	fileId: string;
}

export interface InkLayer {
	_id: string;
	pages: Array<{ _id: string; page: number; log: InkLog }>;
	place?: { _id: string; page: number };
}

type WireValue = { _id: string; string?: string; number?: number };
type WireLayer = { _id: string; page_ink?: WireValue[]; last_page?: WireValue[] };

/** The file is a value on the edition entity: Entu's property read names that entity. */
export async function editionOfFile(cfg: EntuCfg, fileId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
	const res = await entuFetch(cfg.db, `property/${fileId}`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`editionOfFile: file ${fileId}: HTTP ${res.status}`);
	const body = (await res.json()) as { entity?: string };
	if (!body.entity) throw new Error(`editionOfFile: file ${fileId} names no entity`);
	return body.entity;
}

// A value that cannot be read throws: overwriting it would lose the marks it holds.
function pageOf(value: WireValue): { _id: string; page: number; log: InkLog } {
	try {
		const { page, v, strokes, erased } = JSON.parse(value.string ?? '') as InkLog & { page: number };
		if (!Number.isInteger(page) || v !== 1 || !Array.isArray(strokes) || !Array.isArray(erased)) {
			throw new Error('not a page log');
		}
		return { _id: value._id, page, log: { v, strokes, erased } };
	} catch (error) {
		throw new Error(`ink value ${value._id} cannot be read: ${String(error)}`);
	}
}

function layerOf(raw: WireLayer): InkLayer {
	const place = raw.last_page?.[0];
	return {
		_id: raw._id,
		pages: (raw.page_ink ?? []).map(pageOf),
		...(typeof place?.number === 'number' && { place: { _id: place._id, page: place.number } })
	};
}

/** Every layer of hers for the part, oldest first: two offline devices may each have made one. */
export async function findInkLayers(
	cfg: EntuCfg,
	part: LayerPart,
	fetchImpl: typeof fetch = fetch
): Promise<InkLayer[]> {
	const { personId, editionId, fileId } = part;
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=${INK_LAYER_TYPE}&_parent.reference=${personId}&edition.reference=${editionId}&file.string=${fileId}&props=_id,page_ink,last_page&sort=_created.datetime&limit=${LAYER_LIMIT}`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`findInkLayers: HTTP ${res.status}`);
	const body = (await res.json()) as { count?: number; entities?: WireLayer[] };
	const raw = body.entities ?? [];
	// A layer left unread would have its marks dropped by the next join: past the bound, stop.
	if (isTruncated(raw.length, body.count)) {
		throw new Error(`findInkLayers: ${body.count} layers for file ${fileId}, over ${LAYER_LIMIT}`);
	}
	return raw.map(layerOf);
}

export async function createInkLayer(
	cfg: EntuCfg,
	part: LayerPart,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const typeId = await resolveTypeId(cfg, INK_LAYER_TYPE, fetchImpl);
	const props: Array<{ type: string; reference?: string; string?: string; boolean?: boolean }> = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: part.personId },
		{ type: '_inheritrights', boolean: false },
		{ type: '_sharing', string: 'private' },
		{ type: 'edition', reference: part.editionId },
		{ type: 'file', string: part.fileId }
	];
	return postEntity(cfg, 'createInkLayer', props, fetchImpl);
}

/** Reads the page's value, joins `log` into it and replaces that one value; other pages stay. */
export async function writeInkPage(
	cfg: EntuCfg,
	layerId: string,
	page: number,
	log: InkLog,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${layerId}?props=page_ink`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`writeInkPage: layer ${layerId} lookup: HTTP ${res.status}`);
	const body = (await res.json()) as { entity?: WireLayer };
	const held = (body.entity?.page_ink ?? []).map(pageOf).filter((p) => p.page === page);
	const joined = joinLogs(...held.map((p) => p.log), log);
	await overwriteEntityValues(
		cfg,
		layerId,
		[{ value: { type: 'page_ink', string: JSON.stringify({ page, ...joined }) }, existing: held }],
		fetchImpl,
		'writeInkPage'
	);
}

export async function writeInkPlace(
	cfg: EntuCfg,
	layerId: string,
	page: number,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await replaceEntityProperty(cfg, layerId, { type: 'last_page', number: page }, fetchImpl, 'writeInkPlace');
}

async function createdAt(cfg: EntuCfg, propertyId: string, fetchImpl: typeof fetch): Promise<string> {
	const res = await entuFetch(cfg.db, `property/${propertyId}`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`latestPlace: page value ${propertyId}: HTTP ${res.status}`);
	const at = ((await res.json()) as { created?: { at?: unknown } }).created?.at;
	if (typeof at !== 'string') throw new Error(`latestPlace: page value ${propertyId} carries no created.at`);
	return at;
}

/** Her page: the value Entu took last. Entu gives that time only on the property read. */
export async function latestPlace(
	cfg: EntuCfg,
	layers: InkLayer[],
	fetchImpl: typeof fetch = fetch
): Promise<number | null> {
	const places = layers.flatMap((l) => (l.place ? [l.place] : []));
	if (places.length <= 1) return places[0]?.page ?? null;
	const times = await Promise.all(places.map((p) => createdAt(cfg, p._id, fetchImpl)));
	let latest = 0;
	times.forEach((at, i) => {
		if (Date.parse(at) > Date.parse(times[latest])) latest = i;
	});
	return places[latest].page;
}

// (*MVOX:Josquin*)
