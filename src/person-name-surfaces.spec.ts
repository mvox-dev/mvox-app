// #619 — A NAME IN AN <option> OR AN ARIA-LABEL HAS A STATED REASON: the capture
// marker cannot wrap native option text or an attribute, so every name or label value
// read there is either a person picked or named by design, or written down as not a person.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { svelteSurfaces } from '$lib/testing/svelteSurfaces';
import { nameSurfaceSites, nameTokens } from '$lib/testing/nameSurfaceScan';

type Reasons = Readonly<Record<string, Readonly<Record<string, string>>>>;

// Rulings in the issue body (PO, Gama, 2026-10-02 and 2026-10-06).
const PERSON_NAME_SURFACES: Reasons = {
	'src/lib/roster/RosterPersonSelect.svelte': {
		'option.label': 'it is a member picker, so it shows names by design'
	},
	'src/lib/components/attendance/AttendanceSurface.svelte': {
		'member.name':
			'the conductor marks attendance per named member: the pill label ("Present: Ann") ' +
			'and the RSVP mark (:173) on the same row'
	},
	'src/lib/components/admin/InviteSurface.svelte': {
		'p.name': 'the uninvited-person picker: choosing whom to invite'
	},
	'src/lib/library/CopyRow.svelte': {
		'memberNames.get': 'the borrower picker: choosing who borrows'
	},
	'src/lib/agenda/ConductorChip.svelte': {
		name: 'the remove button says whom it removes ("Remove Ann")'
	}
};

const NOT_A_PERSONS_NAME: Reasons = {
	'src/lib/agenda/AgendaList.svelte': { 'item.name': 'the event name' },
	'src/lib/agenda/AgendaMonthView.svelte': { 'item.name': 'the event name' },
	'src/lib/agenda/EventCreateFormFields.svelte': {
		'season.name': 'a season',
		'series.name': 'an event series'
	},
	'src/lib/agenda/RepertoireElement.svelte': { 'opt.label': 'a work or programme option' },
	'src/lib/agenda/RepertoireWorkRow.svelte': {
		'row.workName': 'a repertoire work',
		'opt.label': 'an edition option, or a status word'
	},
	'src/lib/agenda/SeasonCardHeader.svelte': {
		seasonManageDeleteName: 'the season being deleted'
	},
	'src/lib/agenda/SeasonManageFields.svelte': { label: 'a date field label message' },
	'src/lib/agenda/SeasonManageSeries.svelte': { 'series.name': 'an event series' },
	'src/lib/components/SegmentedPill.svelte': {
		label: 'its own label prop; each caller is scanned at its <SegmentedPill label=…>'
	},
	'src/lib/components/admin/InviteSurface.svelte': { 'c.name': 'a collective (database)' },
	'src/lib/components/attendance/AttendanceSurface.svelte': {
		'status.label': 'the attendance status word'
	},
	'src/lib/components/attendance/TakeAttendanceButton.svelte': { eventName: 'the event name' },
	'src/lib/events/EventScheduleRow.svelte': { 'row.name': 'a schedule (agenda) row' },
	'src/lib/events/EventSeriesPicker.svelte': { 'option.name': 'an event series' },
	'src/lib/library/BulkCheckoutPanel.svelte': { 'edition.name': 'a catalogue edition' },
	'src/lib/sections/SectionArrangeRow.svelte': { 'row.name': 'a section' },
	'src/lib/sections/SectionPicker.svelte': { 'node.name': 'a section' },
	'src/routes/+page.svelte': { 'c.name': 'a collective' }
};

function read(file: string): string {
	return readFileSync(resolve(process.cwd(), file), 'utf-8');
}

function reasonsFor(file: string, ...lists: Reasons[]): string[] {
	return lists.flatMap((list) => Object.keys(list[file] ?? {}));
}

/** The sites in one file whose name token has no reason on the given lists. */
function unexplained(file: string, source: string, ...lists: Reasons[]): string[] {
	const exempt = reasonsFor(file, ...lists);
	return nameSurfaceSites(source)
		.filter((site) => !exempt.includes(site.token))
		.map(
			(site) =>
				`${file}:${site.line} ${site.surface} reads ${site.token} — keep names out of it, ` +
				'or add it to PERSON_NAME_SURFACES (with a PO ruling) or NOT_A_PERSONS_NAME with its reason'
		);
}

describe('#619 — the guard itself: what it reads as a name', () => {
	const sites = (src: string) => nameSurfaceSites(src).map((s) => `${s.surface} ${s.token}`);

	it('a name in <option> content is caught', () => {
		expect(sites('<option value={p.id}>{person.name}</option>')).toEqual(['option person.name']);
	});

	it('a name in an aria-label is caught, whole-value or inside a quoted string', () => {
		expect(sites('<button aria-label={m.x({ name: member.name })}>x</button>')).toEqual([
			'aria-label member.name'
		]);
		expect(sites('<button aria-label="Remove {conductor.name}">x</button>')).toEqual([
			'aria-label conductor.name'
		]);
	});

	it('the ariaLabel prop, an ariaLabel option key and a SegmentedPill label are aria-labels', () => {
		expect(sites('<Chip ariaLabel={m.x({ name })} />')).toEqual(['aria-label name']);
		expect(sites('<P options={[{ ariaLabel: m.x({ name: a.name }), v: 1 }]} />')).toEqual([
			'aria-label a.name'
		]);
		expect(sites('<SegmentedPill testid="t" label={m.x({ name: b.name })} />')).toEqual([
			'aria-label b.name'
		]);
	});

	it('a generic label value counts: a picker fed names shows them as option.label', () => {
		expect(sites('<option value={o.id}>{o.label}</option>')).toEqual(['option o.label']);
	});

	it('a lookup through a *Names map and a shorthand { name } key are caught', () => {
		expect(nameTokens('{memberNames.get(id) || m.unknown()}')).toEqual(['memberNames.get']);
		expect(nameTokens('{m.remove({ name })}')).toEqual(['name']);
	});

	it('message ids, object keys, plain words and string literals are not values', () => {
		expect(nameTokens('{m.season_manage_name_label()}')).toEqual([]);
		expect(nameTokens("{m.x({ name: row.id, other: 'a name' })}")).toEqual([]);
		expect(sites('<option value="">Pick a name</option>')).toEqual([]);
	});

	it('scripts, comments and other components’ label props are not read', () => {
		const src = [
			'<script>const x = { ariaLabel: person.name };</script>',
			'<!-- <option>{person.name}</option> -->',
			'<ProfileField label={person.name} />'
		].join('\n');
		expect(sites(src)).toEqual([]);
	});

	it('reports the source line of the site', () => {
		const src = '<script>\n\tlet a = 1;\n</script>\n\n<b aria-label={p.name}></b>';
		expect(nameSurfaceSites(src)).toEqual([{ line: 5, surface: 'aria-label', token: 'p.name' }]);
	});
});

describe('#619 — every option and aria-label name has a stated reason', () => {
	for (const file of svelteSurfaces()) {
		it(`${file}: no unexplained name in <option> content or an aria-label`, () => {
			expect(unexplained(file, read(file), PERSON_NAME_SURFACES, NOT_A_PERSONS_NAME)).toEqual([]);
		});
	}
});

describe('#619 — the lists stay true, and a new site fails', () => {
	it('every listed reason is still in use, and each ruling names a real site', () => {
		const stale: string[] = [];
		for (const list of [PERSON_NAME_SURFACES, NOT_A_PERSONS_NAME]) {
			for (const [file, reasons] of Object.entries(list)) {
				const seen = new Set(nameSurfaceSites(read(file)).map((s) => s.token));
				for (const token of Object.keys(reasons)) if (!seen.has(token)) stale.push(`${file}: ${token}`);
			}
		}
		expect(stale, 'remove reasons whose site is gone').toEqual([]);
		expect(Object.keys(PERSON_NAME_SURFACES)).toHaveLength(5);
	});

	it('a person name added to a new aria-label fails, naming the file and line', () => {
		const file = 'src/lib/agenda/ConductorChip.svelte';
		const planted = `${read(file)}\n<span aria-label={m.x({ name: person.name })}></span>\n`;
		const line = planted.split('\n').length - 1;
		expect(unexplained(file, planted, PERSON_NAME_SURFACES, NOT_A_PERSONS_NAME)).toEqual([
			expect.stringMatching(new RegExp(`^${file}:${line} aria-label reads person\\.name`))
		]);
	});

	it('dropping a ruling fails each of its files by name', () => {
		for (const file of Object.keys(PERSON_NAME_SURFACES)) {
			const failures = unexplained(file, read(file), NOT_A_PERSONS_NAME);
			expect(failures.length, `${file} must fail without its ruling`).toBeGreaterThan(0);
			for (const failure of failures) expect(failure.startsWith(`${file}:`)).toBe(true);
		}
	});
});

// (*MVOX:Josquin* — #619)
