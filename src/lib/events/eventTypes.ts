// src/lib/events/eventTypes.ts
//
// #132/T4 RED stub — the event-type suggestion seam for the event creation
// form. Contract pinned by src/routes/page.event-create.spec.ts:
//
//   - `listEventTypes(cfg, fetchImpl)` returns the collective's PRIOR
//     `event_type` values VERBATIM off the wire — duplicates included, wire
//     order preserved. ONE fetch:
//       entity?_type.string=event&props=event_type&limit=500
//   - Dedupe + sort is deliberately the PAGE's job (exact dedupe,
//     localeCompare order), NOT this module's: the page-level spec drives the
//     dedupe/sort behavior through this mocked seam, so a raw-with-duplicates
//     resolution is what the pinned tests feed it. A data layer that deduped
//     here would leave the page's behavior untested behind the mock.
//   - The read is LAZY: fired when the creation form opens, never on the
//     agenda visit itself (same posture as the roster read, pinned in
//     page.season-create.spec.ts).
//   - Non-2xx throws (fail loud, no silent success) — the form is what turns
//     that into UI.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export type { EntuCfg };

interface EventTypeEntity {
	event_type?: Array<{ string: string }>;
}

export async function listEventTypes(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<string[]> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=event&props=event_type&limit=500',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listEventTypes failed: ${res.status}`);
	const body = (await res.json()) as { entities?: EventTypeEntity[] };
	const entities = body.entities ?? [];
	return entities.flatMap((raw) => (raw.event_type ?? []).map((v) => v.string));
}

// (*MVOX:Tallis* — #132/T4 RED stub + contract)
// (*MVOX:Palestrina* — #132/T4 GREEN: listEventTypes)
