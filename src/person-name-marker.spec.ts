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
	[/\{\s*detail\.conductorNames\.join\(/g, '{detail.conductorNames.join(…)}']
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

// (*MVOX:Tallis* — #361 RED: person-name marker guard)
