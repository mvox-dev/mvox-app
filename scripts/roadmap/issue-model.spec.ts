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
	const bugBody = `### What was seen

"Couldn't save — tap to try again" on today's rehearsal.

### Where

mvox.eu agenda, iPhone Brave

### Who is affected

üks crede laulja`;

	it('parses a form-filed bug authored by a personal account — no marker needed', () => {
		const r = parseIssue({ ...base, issueType: 'Bug', body: bugBody, authorLogin: 'mitselek-mobile' });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.issue.kind).toBe('bug');
		if (r.issue.kind !== 'bug') return;
		expect(r.issue.where).toBe('mvox.eu agenda, iPhone Brave');
		expect(r.issue.author).toBe('mitselek-mobile');
	});

	it('refuses a bug from the shared account with no marker — that login names nobody', () => {
		const r = parseIssue({ ...base, issueType: 'Bug', body: bugBody, authorLogin: 'mitselek' });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.missing).toEqual(['author (in-body marker, or a personal account)']);
	});

	it('parses a feature: the request verbatim, nothing else required', () => {
		const r = parseIssue({
			...base,
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
