// @vitest-environment happy-dom
// The roster record editor: who can open it, and how it opens in place.
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/roster/memberRecord', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).memberRecordModule(importOriginal, { writes: true })
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './roster/+page.svelte';
import { adminStore } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import {
	createMemberRecordMock,
	loadMemberRecordMock,
	loadRosterMock,
	updateMemberRecordMock
} from '$lib/testing/mocks/roster';
import { altoSection, rosterTwo } from '$lib/testing/pages/rosterFixtures';
import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import { renderRosterAs } from '$lib/testing/pages/rosterRender';
import {
	nameInput,
	openEditor,
	q,
	useRecordEditorPage
} from '$lib/testing/pages/rosterRecordEditor';

useRecordEditorPage();

describe('(A) card activator — admin-only, whole-block, every display view (#302: pencil retired)', () => {
	it("admin sees the card activator on another member's row", async () => {
		const { container } = await renderRosterAs('admin');
		expect(q(container, 'roster-row-card-m2')).not.toBeNull();
	});

	it("the activator IS present on the admin's OWN row — the contract has no self-row exclusion (deactivate-guard copy-paste trap)", async () => {
		const { container } = await renderRosterAs('admin');
		expect(q(container, 'roster-row-card-m1')).not.toBeNull();
	});

	it('a non-admin sees NO activator anywhere — absent, not disabled (whole-block gating)', async () => {
		const { container } = await renderRosterAs('not-admin');
		expect(container.querySelector('[data-testid^="roster-row-card-"]')).toBeNull();
	});

	it('accessible name per #262: a static sr-only label composed with the row\'s visible member name INSIDE the button — never a templated aria-label', async () => {
		const { container } = await renderRosterAs('admin');
		const btn = q(container, 'roster-row-card-m2')!;
		expect(btn.textContent).toContain('[roster_record_edit_label]');
		expect(btn.textContent).toContain('Berta Bass');
		expect(btn.getAttribute('aria-label')).toBeNull();
	});

	it('flat (alphabetical) list call site: the activator renders there too', async () => {
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(q(container, 'roster-sort-toggle')!);
		await waitFor(() => expect(q(container, 'roster-flat-list')).not.toBeNull());
		expect(q(container, 'roster-row-card-m2')).not.toBeNull();
	});

	it('section-group call site: a member inside an expanded section group carries the activator', async () => {
		listSectionsMock.mockResolvedValue([altoSection]);
		loadRosterMock.mockResolvedValue(toListRead([
			...rosterTwo,
			{ memberId: 'm3', personId: 'pp-3', name: 'Cara Cantus', email: 'cara@example.com', sectionIds: ['sec-alto'], dbEntityId: 'db-1' }
		]));
		const utils = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('admin');
		await waitFor(() => expect(q(utils.container, 'section-toggle-sec-alto')).not.toBeNull());
		await fireEvent.click(q(utils.container, 'section-toggle-sec-alto')!);
		await waitFor(() => expect(q(utils.container, 'roster-row-m3')).not.toBeNull());
		expect(q(utils.container, 'roster-row-card-m3')).not.toBeNull();
	});

	it('arrange mode renders no member rows — no activator by construction', async () => {
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(q(container, 'roster-view-chip-arrange')!);
		await waitFor(() => expect(q(container, 'roster-arrange-list')).not.toBeNull());
		expect(container.querySelector('[data-testid^="roster-row-card-"]')).toBeNull();
	});
});

describe('(B) editor opens IN PLACE — #222 same-frame idiom, one at a time', () => {
	it('the editor renders INSIDE the member\'s own <li> — no dialog/drawer/overlay anywhere', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		const li = q(container, 'roster-row-m2')!;
		expect(li.querySelector('[data-testid="roster-record-name"]')).not.toBeNull();
		expect(li.querySelector('[data-testid="roster-record-phone"]')).not.toBeNull();
		expect(li.querySelector('[data-testid="roster-record-email"]')).not.toBeNull();
		expect(li.querySelector('[data-testid="roster-record-birthdate"]')).not.toBeNull();
		expect(container.querySelector('[role="dialog"]')).toBeNull();
	});

	it('opening runs the ONE record lookup for that member (the editor-open read only — since 0d1af3d the save re-reads independently)', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(loadMemberRecordMock).toHaveBeenCalledTimes(1);
		expect(loadMemberRecordMock.mock.calls[0][0]).toEqual(
			expect.objectContaining({ db: 'sampledb' })
		);
		expect(loadMemberRecordMock.mock.calls[0][1]).toBe('pp-2');
	});

	it('ONE editor open at a time: opening a second row\'s editor closes the first', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await openEditor(container, 'm1');
		const m2li = q(container, 'roster-row-m2')!;
		expect(m2li.querySelector('[data-testid="roster-record-name"]')).toBeNull();
		const m1li = q(container, 'roster-row-m1')!;
		expect(m1li.querySelector('[data-testid="roster-record-name"]')).not.toBeNull();
	});

	it('close-without-save creates nothing and writes nothing', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-cancel')!);
		await waitFor(() => expect(nameInput(container)).toBeNull());
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
	});
});

describe('(D) damaged data — more than one record (#264: loud, no guessing, no writes)', () => {
	it('surfaces a role=alert that names NO member and carries an EntuRef to the person, renders NO editor fields, and never writes', async () => {
		loadMemberRecordMock.mockResolvedValue({ state: 'damaged', count: 2 });
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(q(container, 'roster-row-card-m2')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-damaged-m2');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect((alert.textContent ?? '').replace(/\s+/g, '')).toBe('[roster_record_damaged]pp-2');
		expect(alert.textContent).not.toContain('Berta Bass');
		expect(alert.textContent).not.toContain('berta@example.com');
		const links = alert.querySelectorAll('a');
		expect(links).toHaveLength(1);
		expect(links[0].textContent?.trim()).toBe('pp-2');
		expect(links[0].getAttribute('href')).toBe('https://entu.app/sampledb/pp-2');
		expect(links[0].getAttribute('title')).toBe('pp-2');
		expect(nameInput(container)).toBeNull();
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
	});
});

describe('(F) privacy fence — non-admins never get the fields in the DOM', () => {
	it('no editor field testid exists anywhere for a non-admin (whole-block gating, not hidden/disabled)', async () => {
		const { container } = await renderRosterAs('not-admin');
		expect(container.querySelector('[data-testid="roster-record-name"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-record-phone"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-record-email"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-record-birthdate"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-record-id-code"]')).toBeNull();
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
