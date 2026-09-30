// #361 RED — PERSON NAMES RENDER THROUGH THE MARKER: in the listed files, a
// member name may reach element content only via PersonName, or (name baked
// into a sentence) inside a RedactedText — a bare interpolation outside both is a leak.

// Not flagged: attribute positions, <option> content, script/comments.
// FAIL-CLOSED ON VACUUM: every listed file must exist and import PersonName.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = [
	'src/routes/admin/+page.svelte',
	'src/routes/event/[id]/+page.svelte',
	'src/lib/library/BulkCheckoutPanel.svelte',
	'src/lib/components/agenda/EventCreateForm.svelte',
	'src/lib/components/agenda/SeasonCreateForm.svelte',
	'src/lib/components/agenda/SeasonManagePanel.svelte',
	'src/lib/components/attendance/AttendanceSurface.svelte',
	'src/lib/components/attendance/SeasonSummary.svelte',
	'src/lib/profile/ProfileField.svelte'
] as const;

const NAME_EXPRS: ReadonlyArray<[RegExp, string]> = [
	[/\{\s*person\.name\s*\}/g, '{person.name}'],
	[/\{\s*member\.name\s*\}/g, '{member.name}'],
	[/\{\s*rate\.name\s*\}/g, '{rate.name}'],
	[/\{\s*conductor\.name\s*\}/g, '{conductor.name}'],
	[/\{\s*memberNames\.get\(/g, '{memberNames.get(…)}'],
	[/\{\s*seasonConductorLabel\(/g, '{seasonConductorLabel(…)}'],
	[/\{\s*detail\.conductorNames\.join\(/g, '{detail.conductorNames.join(…)}'],
	[/\{\s*tallyCardNames\[/g, '{tallyCardNames[…]}'] // the RSVP tally card's overlaid name
];

// Sentences with the name baked in must sit INSIDE a RedactedText (the invite
// surface carries two: submitLabel, and the mint-error message).
const SENTENCE_EXPRS: ReadonlyArray<[RegExp, string]> = [
	[/\{\s*m\.admin_roles_remove\(/g, 'admin_roles_remove'],
	[/\{\s*m\.library_copy_lent_to\(/g, 'library_copy_lent_to'],
	[/\{\s*submitLabel\s*\}/g, 'admin_invite_submit_person (submitLabel)'],
	[/m\.admin_invite_mint_error\(/g, 'admin_invite_mint_error']
];

const SENTENCE_FILES = [
	...FILES,
	'src/lib/components/admin/InviteSurface.svelte',
	'src/lib/library/CopyRow.svelte'
] as const;

/** Markup only: scripts, styles and comments blanked (same length, so indices hold). */
function markup(src: string): string {
	const blank = (s: string) => s.replace(/[^\n]/g, ' ');
	return src
		.replace(/<script[\s\S]*?<\/script>/g, blank)
		.replace(/<style[\s\S]*?<\/style>/g, blank)
		.replace(/<!--[\s\S]*?-->/g, blank)
		.replace(/<option\b[\s\S]*?<\/option>/g, blank)
		// Prettier wraps a long closing tag as `</RedactedText\n\t>`; unnormalized,
		// the literal '</RedactedText>' search misses it and the file tail silently
		// reads as "inside a marker". Normalize in place, preserving length/newlines.
		.replace(
			/<\/RedactedText(\s*)>/g,
			(_m, ws: string) => '</RedactedText>' + ws.replace(/[^\n]/g, ' ')
		);
}

function insideRedactedText(src: string, i: number): boolean {
	const before = src.slice(0, i);
	const open = before.lastIndexOf('<RedactedText');
	const close = before.lastIndexOf('</RedactedText>');
	return open !== -1 && open > close;
}

function isAttribute(src: string, i: number): boolean {
	return /=\s*$/.test(src.slice(Math.max(0, i - 3), i));
}

function lineOf(src: string, i: number): number {
	return src.slice(0, i).split('\n').length;
}

// TEST THE INSTRUMENT: every rule below reads insideRedactedText, so a close
// tag it cannot see turns a whole region into a silent pass. These pin the
// two spellings Prettier actually produces.
describe('#361 — the guard itself: a wrapped closing tag still closes the marker', () => {
	const bare = '<p>{person.name}</p>';

	it('a one-line close tag closes it', () => {
		const src = markup(`<RedactedText>{m.x({ name })}</RedactedText>\n${bare}`);
		expect(insideRedactedText(src, src.indexOf('{person.name}'))).toBe(false);
	});

	it("Prettier's wrapped close tag (`</RedactedText\\n\\t>`) closes it too", () => {
		const src = markup(`<RedactedText\n\t>{m.x({ name })}</RedactedText\n\t>\n${bare}`);
		expect(insideRedactedText(src, src.indexOf('{person.name}'))).toBe(false);
	});

	it('an index genuinely between the tags is still reported inside', () => {
		const src = markup('<RedactedText\n\t>{m.x({ name: person.name })}</RedactedText\n\t>');
		expect(insideRedactedText(src, src.indexOf('person.name'))).toBe(true);
	});

	it('normalizing the close tag keeps source line numbers intact', () => {
		const src = markup('<RedactedText\n\t>a</RedactedText\n\t>\n{person.name}');
		expect(lineOf(src, src.indexOf('{person.name}'))).toBe(4);
	});

	it('the branch’s own wrapped closes are seen in the real files', () => {
		for (const file of ['src/lib/library/CopyRow.svelte', ...SENTENCE_FILES]) {
			const src = markup(readFileSync(resolve(process.cwd(), file), 'utf-8'));
			const opens = src.split('<RedactedText').length - 1;
			const closes = src.split('</RedactedText>').length - 1;
			expect(closes, `${file}: every <RedactedText> must have a visible close`).toBe(opens);
		}
	});
});

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
		// Non-vacuous: the sites exist (two Remove buttons, one lent-to badge, two invite sentences).
		expect(found).toEqual({
			admin_roles_remove: 2,
			library_copy_lent_to: 1,
			'admin_invite_submit_person (submitLabel)': 1,
			admin_invite_mint_error: 1
		});
		expect(bare).toEqual([]);
	});
});

// THE CLOSED RULE: the shapes above are silent on anything unlisted. This finds
// EVERY bare name-ish interpolation and demands a marker or a listed
// not-a-person token, per file (`row.name` is a schedule row here, a person elsewhere).
const NOT_A_PERSONS_NAME: Readonly<Record<string, readonly string[]>> = {
	'src/routes/admin/+page.svelte': ['nameMarker.name'],
	// the selected collective
	'src/routes/+page.svelte': ['selected.name'],
	// a season (manageable / delete confirm / edit field) or event series
	'src/lib/components/agenda/SeasonManagePanel.svelte': [
		'ms.name',
		'seasonManageDeleteName',
		'seasonManageName',
		'series.name'
	],
	'src/lib/components/agenda/EventCreateForm.svelte': ['eventCreateSeriesDefaults.name'],
	// the event's own name, and a schedule (agenda) row
	'src/routes/event/[id]/+page.svelte': ['detail.name', 'row.name'],
	'src/routes/library/+page.svelte': [],
	// catalogue name fields, and uploaded score filenames
	'src/lib/library/WorkRow.svelte': ['work.name'],
	'src/lib/library/EditionRow.svelte': ['edition.name'],
	'src/lib/library/CopyRow.svelte': ['copy.name'],
	'src/lib/library/MyLoansSection.svelte': ['copyName'],
	'src/lib/library/EditionFiles.svelte': ['file.filename', 'broken.filename', 'filename'],
	'src/lib/library/BulkCheckoutPanel.svelte': [],
	// the AgendaItem this panel belongs to
	'src/lib/components/attendance/AttendanceSurface.svelte': ['item.name'],
	'src/lib/components/attendance/SeasonSummary.svelte': [],
	'src/lib/profile/ProfileField.svelte': [],
	'src/lib/profile/RosterNamesToggle.svelte': [],
	'src/lib/profile/LinkedAccountsSection.svelte': ['scopeName'],
	'src/lib/profile/ProfileStorageSection.svelte': ['storagePartNames'],
	'src/lib/components/admin/InviteSurface.svelte': []
};

const NAME_ISH = /(?:\.\s*names?\b|\b[A-Za-z_$][\w$]*[Nn]ames?\b|\bfilenames?\b)/;

// Every bare TEXT interpolation as [index, expression] — attribute values and
// block tags (`{#if}`, `{:else}`, `{/each}`, `{@render}`) skipped whole.
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

// The name-ish VALUE tokens an expression reads (Paraglide message ids stripped first).
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
				if (tokens.length === 0) continue; // no name VALUE, just an id ending in `_name`
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

	// NON-VACUOUS, both ways: the scanner really matches, and no exemption is stale.
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

// (*MVOX:Tallis* — #361 RED — Josquin: closed name-ish rule + instrument self-test)
