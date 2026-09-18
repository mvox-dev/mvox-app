// #384 — the strict half: a task missing any required field is refused with
// the field named; both body shapes (issue-form headings, legacy frontmatter)
// parse to the same TaskIssue.
import { describe, expect, it } from 'vitest';
import { parseIssue, parseTaskIssue, type RawIssue } from './issue-model';

const base: Omit<RawIssue, 'body'> = {
	number: 400,
	title: 'A singer can do the thing',
	state: 'open',
	labels: ['task', 'ready'],
	issueType: 'Task'
};

const formBody = `### Slugline

Laulja saab asja tehtud

### Lead

Üks lause, mis ütleb kellele ja mida.

### What

Today the singer cannot do the thing.

### Done when

- [ ] The singer does the thing
- [ ] The board shows it

### Parent epic

362

### Rights rules relied on

ER-1, ER-27

(*PO:Gama*)`;

const frontmatterBody = `---
slugline: "Laulja saab asja tehtud"
lead: "Üks lause, mis ütleb kellele ja mida."
---

Today the singer cannot do the thing.

## Done when

- [ ] The singer does the thing

(*PO:Gama*)`;

describe('parseTaskIssue — both shapes parse', () => {
	it('parses the issue-form shape completely', () => {
		const r = parseTaskIssue({ ...base, body: formBody });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.task.slugline).toBe('Laulja saab asja tehtud');
		expect(r.task.doneWhen).toEqual(['The singer does the thing', 'The board shows it']);
		expect(r.task.epic).toBe(362);
		expect(r.task.rightsRules).toEqual(['ER-1', 'ER-27']);
		expect(r.task.author).toBe('(*PO:Gama*)');
		expect(r.task.motion).toEqual(['ready']);
	});

	it('parses the legacy frontmatter shape (done-when under a ## heading)', () => {
		const r = parseTaskIssue({ ...base, body: frontmatterBody });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.task.slugline).toBe('Laulja saab asja tehtud');
		expect(r.task.doneWhen).toEqual(['The singer does the thing']);
		expect(r.task.epic).toBeUndefined();
	});
});

describe('parseTaskIssue — refusals name every missing field', () => {
	it('refuses an empty body with all fields listed, never throws', () => {
		const r = parseTaskIssue({ ...base, body: '' });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.missing).toEqual(
			expect.arrayContaining(['slugline', 'lead', 'done when (at least one checkable statement)', 'author (in-body marker, or a personal account)'])
		);
	});

	it('refuses a wrong issue type by naming what it is', () => {
		const r = parseTaskIssue({ ...base, issueType: 'Bug', body: formBody });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.missing).toEqual(['issue type is Bug, not Task']);
	});

	it('refuses an empty done-when checklist — an empty contract is not a task', () => {
		const body = formBody.replace('- [ ] The singer does the thing\n- [ ] The board shows it', 'soon');
		const r = parseTaskIssue({ ...base, body });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.missing).toEqual(['done when (at least one checkable statement)']);
	});

	it("treats the form's _No response_ placeholder as absent", () => {
		const body = formBody.replace('362', '_No response_');
		const r = parseTaskIssue({ ...base, body });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.task.epic).toBeUndefined();
	});
});

describe('bug / feature / epic parsers and dispatch', () => {
	// #405: a field report and a one-line request are INTAKE — filed, not
	// released — so they carry no motion label. Release is what adds the
	// slugline/lead requirement, and these three tests are about authorship
	// and shape, not about release.
	const intake: Omit<RawIssue, 'body'> = { ...base, labels: [] };
	const bugBody = `### What was seen

"Couldn't save — tap to try again" on today's rehearsal.

### Where

mvox.eu agenda, iPhone Brave

### Who is affected

üks crede laulja`;

	it('parses a form-filed bug authored by a personal account — no marker needed', () => {
		const r = parseIssue({ ...intake, issueType: 'Bug', body: bugBody, authorLogin: 'mitselek-mobile' });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.issue.kind).toBe('bug');
		if (r.issue.kind !== 'bug') return;
		expect(r.issue.where).toBe('mvox.eu agenda, iPhone Brave');
		expect(r.issue.author).toBe('mitselek-mobile');
	});

	it('refuses a bug from the shared account with no marker — that login names nobody', () => {
		const r = parseIssue({ ...intake, issueType: 'Bug', body: bugBody, authorLogin: 'mitselek' });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.missing).toEqual(['author (in-body marker, or a personal account)']);
	});

	it('parses a feature: the request verbatim, nothing else required', () => {
		const r = parseIssue({
			...intake,
			issueType: 'Feature',
			body: `### The request\n\nwhen adding a link, prepend https:// silently\n\n(*PO:Gama*)`
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.issue.kind).toBe('feature');
		if (r.issue.kind !== 'feature') return;
		expect(r.issue.request).toBe('when adding a link, prepend https:// silently');
	});

	it('parses an epic with children by reference; empty children list is normal', () => {
		const r = parseIssue({
			...base,
			issueType: 'Epic',
			body: `### Slugline\n\nVäravad loevad Entu õigusi\n\n### Lead\n\nRakendus ei otsusta ise.\n\n### The story\n\nEvery gate reads the grants Entu returned.\n\n### Children\n\n- #363\n- #372\n\n(*PO:Gama*)`
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.issue.kind).toBe('epic');
		if (r.issue.kind !== 'epic') return;
		expect(r.issue.children).toEqual([363, 372]);
	});

	it('refuses an unknown type by name', () => {
		const r = parseIssue({ ...base, issueType: 'Chore', body: formBody });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.missing[0]).toContain('Chore');
	});
});

describe('the last form section swallows trailing prose (#388 live catch)', () => {
	it('parent epic still parses when free text follows it', () => {
		const body = formBody.replace('362\n\n### Rights rules relied on\n\nER-1, ER-27', '362\n\nOriginal: #380, re-filed as a live test.');
		const r = parseTaskIssue({ ...base, body });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.task.epic).toBe(362);
	});
});

/**
 * #405 — the public board reads Estonian whatever the kind.
 *
 * Mihkel, 2026-09-18: *"the board is a public surface and thus should read
 * homogenous"*. The requirement follows STATE, not kind: intake still files
 * without a slugline, a released issue does not. #374 and #375 are the live
 * instance — both sat on the public board in English until the day this landed.
 *
 * (*PO:Gama*)
 */
describe('#405 — a released issue carries a slugline and a lead, whatever its kind', () => {
	const intake: Omit<RawIssue, 'body'> = { ...base, labels: [] };
	const bugBody = `### What was seen\n\nThe write was refused.\n\n### Where\n\nmvox.eu agenda, iPhone\n\n(*PO:Gama*)`;
	const featureBody = `### The request\n\nprepend https:// silently\n\n(*PO:Gama*)`;
	const faced = (body: string) =>
		`### Slugline\n\nÜks rida tahvlile\n\n### Lead\n\nÜks lause, mis ütleb kellele ja mida.\n\n${body}`;

	for (const [kind, body] of [
		['Bug', bugBody],
		['Feature', featureBody]
	] as const) {
		it(`refuses a released ${kind} with no slugline and no lead, naming each`, () => {
			const r = parseIssue({ ...intake, labels: ['ready'], issueType: kind, body });
			expect(r.ok).toBe(false);
			if (r.ok) return;
			expect(r.missing).toEqual([
				'slugline (released issues carry one, any kind)',
				'lead (released issues carry one, any kind)'
			]);
		});

		it(`parses the same ${kind} while it is still intake — no motion label, no requirement`, () => {
			const r = parseIssue({ ...intake, issueType: kind, body });
			expect(r.ok).toBe(true);
		});

		it(`parses a released ${kind} once it has both`, () => {
			const r = parseIssue({ ...intake, labels: ['prepped'], issueType: kind, body: faced(body) });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect(r.issue.slugline).toBe('Üks rida tahvlile');
		});
	}

	it('any motion label releases, not only `ready` — `in research` is already in front of the team', () => {
		const r = parseIssue({ ...intake, labels: ['in research'], issueType: 'Bug', body: bugBody });
		expect(r.ok).toBe(false);
	});

	it('names a missing slugline ONCE for a released Task, not twice — the kind rule and the release rule ask for the same field', () => {
		const r = parseIssue({
			...intake,
			labels: ['ready'],
			issueType: 'Task',
			body: `### Done when\n\n- [ ] The singer does the thing\n\n(*PO:Gama*)`
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.missing.filter((m) => m.startsWith('slugline'))).toHaveLength(1);
	});
});
