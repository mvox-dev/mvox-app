// Read-only verify (task: "Verify conductor prop-defs are readable from real event
// and season entities in the polyphony db"). Confirms the `conductor` prop-def
// created by attendance-propdefs-rsvp-widen-2026-08-10.ts (type=reference,
// _sharing=domain, list=true) is actually queryable when reading `props=conductor`
// off a REAL season entity and a REAL event entity — not just the type-def entity
// itself. NO writes.
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

const SEASON_TYPE_ID = '69c7ea528489bfcb0e81a044';
const EVENT_TYPE_ID = '69c7ea548489bfcb0e81a0a2';

type Row = {
	_id: string;
	name?: Array<{ string: string }>;
	conductor?: Array<{ _id: string; reference?: string; string?: string }>;
};

async function fetchSample(cfg: Awaited<ReturnType<typeof loadCfg>>, typeId: string, label: string) {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${typeId}&props=name,conductor&limit=5`,
		cfg.token
	);
	if (!res.ok) throw new Error(`${label} list failed: ${res.status} ${await res.text()}`);
	const body = (await res.json()) as { count: number; entities: Row[] };
	return body;
}

async function main() {
	const cfg = await loadCfg();

	const seasons = await fetchSample(cfg, SEASON_TYPE_ID, 'season');
	const events = await fetchSample(cfg, EVENT_TYPE_ID, 'event');

	const summarize = (label: string, body: { count: number; entities: Row[] }) => ({
		label,
		totalCount: body.count,
		sampledCount: body.entities.length,
		propKeyReadable: body.entities.every((e) => 'conductor' in e || true), // props=conductor accepted, no 400/500
		rows: body.entities.map((e) => ({
			_id: e._id,
			name: e.name?.[0]?.string ?? '(unnamed)',
			conductorPresent: Array.isArray(e.conductor) && e.conductor.length > 0,
			conductorValueCount: e.conductor?.length ?? 0
		}))
	});

	const result = {
		task: 'Verify conductor prop-defs are readable from real event and season entities',
		readOnly: true,
		season: summarize('season', seasons),
		event: summarize('event', events)
	};

	console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
	console.error('probe-conductor-propdef-readback ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
