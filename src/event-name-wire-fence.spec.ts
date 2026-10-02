// #420 fence: an event's name rides the wire as `event_name`, never `name`.

// No fallback read of `name`; seasons, series and non-event types keep a bare `name`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { findSourceFiles } from '$lib/testing/soleLiteralGuard';

const LIB_ROOT = 'src/lib';

function tsSourceFiles(dir: string): string[] {
	return findSourceFiles(dir, ['.ts'], { excludeSpecs: true }).sort();
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
		const src = readFileSync('src/lib/entity/entityCreateEvent.ts', 'utf8');
		// The '(' anchors the exact function: 'createEvent' alone prefix-matches createEventSeries.
		const start = src.indexOf('export async function createEvent(');
		expect(start, 'createEvent not found in entityCreateEvent.ts').toBeGreaterThan(-1);
		const nextExport = src.indexOf('\nexport ', start + 1);
		const body = src.slice(start, nextExport === -1 ? undefined : nextExport);
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
				// The trailing `&` excludes event_series, whose `name` is allowed.
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

// (*MVOX:Tallis*)
