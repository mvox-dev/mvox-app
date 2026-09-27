// #361 RED — PERSON NAMES RENDER THROUGH THE MARKER: the structural guard.
//
// The runtime specs pin each site that exists today; this guard is what makes
// a NEW usage in the same files fail the build. In the listed files, a member
// name may reach element content only through PersonName (or, for a sentence
// with the name baked in, inside a RedactedText). A bare text interpolation of
// a member-name expression outside both is a leak the capture would keep.
//
// What is NOT flagged, on purpose:
//   - attribute positions (`name={person.name}`, `aria-label={m.x({ name })}`)
//     — PersonName's own prop, and the uncovered aria-label channel recorded
//     in redact.ts;
//   - <option> content — an <option> cannot hold a marker; those sites are
//     recorded in redact.ts's uncovered channels instead;
//   - <script> and comments.
//
// FAIL-CLOSED ON VACUUM: every listed file must exist and import PersonName —
// a guard scanning files that moved away proves nothing.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = [
	'src/routes/admin/+page.svelte',
	'src/routes/+page.svelte',
	'src/routes/event/[id]/+page.svelte',
	'src/routes/library/+page.svelte',
	'src/lib/components/attendance/AttendanceSurface.svelte',
	'src/lib/components/attendance/SeasonSummary.svelte',
	'src/lib/components/profile/ProfileField.svelte'
] as const;

// Bare member-name expressions, as TEXT interpolations (`{expr}` in content).
const NAME_EXPRS: ReadonlyArray<[RegExp, string]> = [
	[/\{\s*person\.name\s*\}/g, '{person.name}'],
	[/\{\s*member\.name\s*\}/g, '{member.name}'],
	[/\{\s*rate\.name\s*\}/g, '{rate.name}'],
	[/\{\s*conductor\.name\s*\}/g, '{conductor.name}'],
	[/\{\s*memberNames\.get\(/g, '{memberNames.get(…)}'],
	[/\{\s*seasonConductorLabel\(/g, '{seasonConductorLabel(…)}'],
	[/\{\s*detail\.conductorNames\.join\(/g, '{detail.conductorNames.join(…)}'],
	// #361 review F1 — the event page's RSVP tally card. Its map holds
	// `row.name`, the same overlaid displayed name as every other site.
	[/\{\s*tallyCardNames\[/g, '{tallyCardNames[…]}']
];

// Sentences with the name baked in — must sit INSIDE a RedactedText. The
// invite surface carries two (its submit button renders `submitLabel`, which
// is admin_invite_submit_person({ name }) once a person is picked; the
// mint-error message is admin_invite_mint_error({ name })).
const SENTENCE_EXPRS: ReadonlyArray<[RegExp, string]> = [
	[/\{\s*m\.admin_roles_remove\(/g, 'admin_roles_remove'],
	[/\{\s*m\.library_copy_lent_to\(/g, 'library_copy_lent_to'],
	[/\{\s*submitLabel\s*\}/g, 'admin_invite_submit_person (submitLabel)'],
	[/m\.admin_invite_mint_error\(/g, 'admin_invite_mint_error']
];

const SENTENCE_FILES = [...FILES, 'src/lib/components/admin/InviteSurface.svelte'] as const;

/** Markup only: scripts, styles and comments blanked (same length, so indices hold). */
function markup(src: string): string {
	const blank = (s: string) => s.replace(/[^\n]/g, ' ');
	return src
		.replace(/<script[\s\S]*?<\/script>/g, blank)
		.replace(/<style[\s\S]*?<\/style>/g, blank)
		.replace(/<!--[\s\S]*?-->/g, blank)
		.replace(/<option\b[\s\S]*?<\/option>/g, blank);
}

/** True when index `i` sits between an opening <RedactedText …> and its close. */
function insideRedactedText(src: string, i: number): boolean {
	const before = src.slice(0, i);
	const open = before.lastIndexOf('<RedactedText');
	const close = before.lastIndexOf('</RedactedText>');
	return open !== -1 && open > close;
}

/** True when the `{` at index i is an attribute value (`attr={…}`). */
function isAttribute(src: string, i: number): boolean {
	return /=\s*$/.test(src.slice(Math.max(0, i - 3), i));
}

function lineOf(src: string, i: number): number {
	return src.slice(0, i).split('\n').length;
}

describe('#361 — the guard scans real files (fail-closed, never a vacuum)', () => {
	for (const file of FILES) {
		it(`${file} exists and imports PersonName`, () => {
			const abs = resolve(process.cwd(), file);
			expect(existsSync(abs), `${file} must exist`).toBe(true);
			const src = readFileSync(abs, 'utf-8');
			const imports =
				/import\s+PersonName\s+from\s+'\$lib\/components\/PersonName\.svelte'|import\s+PersonName\s+from\s+'\.\.\/PersonName\.svelte'/.test(
					src
				);
			expect(imports, `${file} must import PersonName`).toBe(true);
		});
	}
});

describe('#361 — no bare member-name interpolation outside PersonName/RedactedText', () => {
	for (const file of FILES) {
		it(`${file}: every member-name text interpolation goes through the marker`, () => {
			const src = markup(readFileSync(resolve(process.cwd(), file), 'utf-8'));
			const bare: string[] = [];
			for (const [re, label] of NAME_EXPRS) {
				for (const hit of src.matchAll(re)) {
					const i = hit.index ?? 0;
					if (isAttribute(src, i) || insideRedactedText(src, i)) continue;
					bare.push(`${file}:${lineOf(src, i)} ${label}`);
				}
			}
			expect(bare).toEqual([]);
		});
	}
});

describe('#361 — name-bearing sentences sit whole inside a RedactedText', () => {
	it('admin_roles_remove (both roles lists), library_copy_lent_to and the two invite sentences are each wrapped', () => {
		const found: Record<string, number> = Object.fromEntries(
			SENTENCE_EXPRS.map(([, label]) => [label, 0])
		);
		const bare: string[] = [];
		for (const file of SENTENCE_FILES) {
			const src = markup(readFileSync(resolve(process.cwd(), file), 'utf-8'));
			for (const [re, label] of SENTENCE_EXPRS) {
				for (const hit of src.matchAll(re)) {
					const i = hit.index ?? 0;
					found[label] += 1;
					if (!insideRedactedText(src, i)) bare.push(`${file}:${lineOf(src, i)} ${label}`);
				}
			}
		}
		// Non-vacuous: the sites exist (two Remove buttons, one lent-to badge,
		// the invite submit button, the invite mint-error message).
		expect(found).toEqual({
			admin_roles_remove: 2,
			library_copy_lent_to: 1,
			'admin_invite_submit_person (submitLabel)': 1,
			admin_invite_mint_error: 1
		});
		expect(bare).toEqual([]);
	});
});

// #361 review F1 — THE CLOSED RULE. Everything above enumerates the
// expression shapes we already know leak, so it is silent on a shape nobody
// listed: that is how the RSVP tally card's `tallyCardNames[memberId]` passed
// a green guard. This block inverts the burden. It finds EVERY bare text
// interpolation that reads a `name`-ish value in the listed files and demands
// one of three things of each:
//
//   1. it sits inside a marker (a site converted to PersonName does not even
//      reach here — the name moved into PersonName's `name=` ATTRIBUTE), or
//   2. every name-ish token in it is listed below as a value that is NOT a
//      person's name (an event's name, a season's, a file's), or
//   3. it fails.
//
// So a NEW `{someone.name}` on these surfaces fails until someone either
// wraps it or writes down, here, why it is not a person — which is #361's
// done-when. The list is per-file on purpose: `row.name` is a schedule row on
// the event page, but a roster row (a person) elsewhere, so a global
// vocabulary would hand out the wrong exemption.
const NOT_A_PERSONS_NAME: Readonly<Record<string, readonly string[]>> = {
	'src/routes/admin/+page.svelte': [
		'nameMarker.name' // the collective's own name, in the admin header
	],
	'src/routes/+page.svelte': [
		'selected.name', // the selected collective
		'ms.name', // a manageable season
		'seasonManageDeleteName', // a season, in the delete confirmation
		'seasonManageName', // a season, in the edit field
		'series.name', // an event series
		'eventCreateSeriesDefaults.name' // the series an event inherits from
	],
	'src/routes/event/[id]/+page.svelte': [
		'detail.name', // the event's own name
		'row.name' // a schedule (agenda) row
	],
	'src/routes/library/+page.svelte': [
		'work.name', // catalogue: a work
		'edition.name', // catalogue: an edition
		'copy.name', // catalogue: a physical copy
		'copyName', // the copy label inside the my-loans sentence
		'file.filename', // an uploaded score file
		'broken.filename',
		'filename'
	],
	'src/lib/components/attendance/AttendanceSurface.svelte': [
		'item.name' // the AgendaItem this panel belongs to
	],
	'src/lib/components/attendance/SeasonSummary.svelte': [],
	'src/lib/components/profile/ProfileField.svelte': [],
	'src/lib/components/admin/InviteSurface.svelte': []
};

/** Does this expression read something `name`-ish at all? */
const NAME_ISH = /(?:\.\s*names?\b|\b[A-Za-z_$][\w$]*[Nn]ames?\b|\bfilenames?\b)/;

/**
 * Every bare TEXT interpolation in `src` as [index, expression]. Attribute
 * values (`attr={…}`) and block tags (`{#if}`, `{:else}`, `{/each}`,
 * `{@render}`) are skipped WHOLE, so an attribute's interior never leaks in.
 */
function textInterpolations(src: string): Array<[number, string]> {
	const out: Array<[number, string]> = [];
	let i = 0;
	while (i < src.length) {
		if (src[i] !== '{') {
			i += 1;
			continue;
		}
		let depth = 0;
		let j = i;
		for (; j < src.length; j += 1) {
			if (src[j] === '{') depth += 1;
			else if (src[j] === '}') {
				depth -= 1;
				if (depth === 0) break;
			}
		}
		if (j >= src.length) break; // unbalanced tail — nothing more to read
		const isBlockTag = /^\{\s*[#/:@]/.test(src.slice(i, i + 3));
		if (!isAttribute(src, i) && !isBlockTag) out.push([i, src.slice(i, j + 1)]);
		i = j + 1;
	}
	return out;
}

/**
 * The name-ish VALUE tokens an expression reads. Paraglide message ids are
 * stripped first: `m.event_detail_series_field_name()` names a translation,
 * not a person, and an id ending in `_name` is not a value at all.
 */
function nameTokens(expr: string): string[] {
	const stripped = expr.replace(/\bm\.[a-z0-9_]+/g, 'm.MSG');
	const chains = stripped.match(/[A-Za-z_$][\w$]*(?:\s*\.\s*[\w$]+)*/g) ?? [];
	const out = new Set<string>();
	for (const raw of chains) {
		const chain = raw.replace(/\s+/g, '');
		const last = chain.split('.').pop() ?? '';
		if (/^(?:names?|filenames?)$/i.test(last) || /[Nn]ames?$/.test(last)) out.add(chain);
	}
	return [...out];
}

/** The name-ish text interpolations of one file, as [index, expr, tokens]. */
function nameIshSites(file: string): Array<[number, string, string[]]> {
	const src = markup(readFileSync(resolve(process.cwd(), file), 'utf-8'));
	return textInterpolations(src)
		.filter(([, expr]) => NAME_ISH.test(expr))
		.map(([i, expr]) => [i, expr, nameTokens(expr)]);
}

describe('#361 — a name-ish interpolation is marked, or written down as not-a-person', () => {
	for (const [file, exempt] of Object.entries(NOT_A_PERSONS_NAME)) {
		it(`${file}: every name-ish text interpolation is marked or exempt`, () => {
			const src = markup(readFileSync(resolve(process.cwd(), file), 'utf-8'));
			const bare: string[] = [];
			for (const [i, , tokens] of nameIshSites(file)) {
				if (insideRedactedText(src, i)) continue;
				// No name VALUE in it — an i18n label whose message id merely
				// ends in `_name`. Nothing personal can render here.
				if (tokens.length === 0) continue;
				const unexplained = tokens.filter((t) => !exempt.includes(t));
				if (unexplained.length === 0) continue;
				bare.push(
					`${file}:${lineOf(src, i)} reads ${unexplained.join(', ')} — wrap it in PersonName, ` +
						`or add it to NOT_A_PERSONS_NAME with the reason it is not a person`
				);
			}
			expect(bare).toEqual([]);
		});
	}

	// NON-VACUOUS, both ways: the scanner really reads these files, and no
	// exemption is stale. A token that no longer appears is a hole standing
	// open for the next expression that happens to reuse the name.
	it('the scanner matches real interpolations, and every exemption is still in use', () => {
		const scanned = Object.keys(NOT_A_PERSONS_NAME).reduce(
			(n, file) => n + nameIshSites(file).length,
			0
		);
		expect(scanned, 'the scanner must actually match name-ish interpolations').toBeGreaterThan(15);

		const stale: string[] = [];
		for (const [file, tokens] of Object.entries(NOT_A_PERSONS_NAME)) {
			const seen = new Set(nameIshSites(file).flatMap(([, , t]) => t));
			for (const token of tokens) if (!seen.has(token)) stale.push(`${file}: ${token}`);
		}
		expect(stale, 'remove exemptions whose expression is gone').toEqual([]);
	});
});

// (*MVOX:Tallis* — #361 RED: person-name marker guard)
// (*MVOX:Josquin* — #361 review F1: the closed name-ish rule)
