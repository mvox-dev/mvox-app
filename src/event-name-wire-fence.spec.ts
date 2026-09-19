// #420 fence — an EVENT's name rides the wire as `event_name`, never `name`.
//
// The app stopped reading and writing `name` on event entities when the name
// moved to `event_name` (#233 chain, S3). There is deliberately NO fallback
// read of `name`: an account on the frozen legacy db (#407) renders events
// blank by design (#420 body; the displayed-names fence is scoped to crede
// — Mihkel, 2026-09-18). This fence keeps the retired wire key from creeping
// back into event reads or writes.
//
// ALLOWED non-event `name` sites (the rename is events-only; these keep the
// bare `name` prop on purpose and are NOT matched by the rules below):
//   - season reads/writes            (entuSeasons.ts, seasonManage.ts)
//   - event_series reads/writes      (seasonManage.ts, entityCreate.ts
//                                     createSeason/createEventSeries,
//                                     eventConvert.ts step 2 create-series)
//   - series-by-id inheritance reads (`entity/${seriesId}` / `entity/${sid}`)
//   - work/edition/copy, link, profile, section, schedule_item,
//     repertoire_item, program_item, admin_member_record, mvox_collective
//     reads — all non-event entity types.
//
// Mechanical scan over real files, same posture as the #407 history fence /
// rights-model-identifiers (spec at src root).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIB_ROOT = 'src/lib';

function tsSourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			out.push(...tsSourceFiles(path));
		} else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
			out.push(path);
		}
	}
	return out.sort();
}

/** The bare tokens of the FIRST `props=` list on the line ([] when none). */
function propsTokens(line: string): string[] {
	const m = /[?&]props=([A-Za-z0-9_,]*)/.exec(line);
	return m ? m[1].split(',') : [];
}

function isComment(line: string): boolean {
	const t = line.trimStart();
	return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

describe('#420 — the retired `name` wire key stays out of event reads/writes', () => {
	it("createEvent writes `event_name` — `optional('name'` inside createEvent is retired", () => {
		const src = readFileSync('src/lib/entity/entityCreate.ts', 'utf8');
		// The '(' anchors the EXACT function — a bare 'createEvent' prefix-matches
		// createEventSeries (whose own `name` write is allowed and stays).
		const start = src.indexOf('export async function createEvent(');
		expect(start, 'createEvent not found in entityCreate.ts').toBeGreaterThan(-1);
		const nextExport = src.indexOf('\nexport ', start + 1);
		const body = src.slice(start, nextExport === -1 ? undefined : nextExport);
		// createSeason/createEventSeries keep optional('name', …) — season and
		// event_series own their `name` prop untouched. Only createEvent moved.
		expect(
			body.includes("optional('name'"),
			"createEvent still writes the retired `name` wire prop — it must write 'event_name'"
		).toBe(false);
	});

	it('no `_type.string=event` query and no `entity/${eventId}` read asks for the bare `name` prop', () => {
		const offenders: string[] = [];
		for (const file of tsSourceFiles(LIB_ROOT)) {
			const lines = readFileSync(file, 'utf8').split('\n');
			lines.forEach((line, i) => {
				if (isComment(line)) return;
				if (!propsTokens(line).includes('name')) return;
				// `_type.string=event&` matches the event type EXACTLY (the trailing
				// `&` excludes event_series, whose `name` is allowed); the template
				// `entity/${eventId}?` is the app's event-by-id read shape
				// (eventDetail.ts, eventConvert.ts).
				if (line.includes('_type.string=event&') || line.includes('entity/${eventId}?')) {
					offenders.push(`${file}:${i + 1}: ${line.trim()}`);
				}
			});
		}
		expect(
			offenders,
			'event wire reads must ask for `event_name`, never the retired `name`'
		).toEqual([]);
	});
});

// (*MVOX:Tallis* — #420 RED: event_name wire fence)
