// @vitest-environment happy-dom
// A section with more or fewer than one _parent value shows loudly on /roster.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);

const { loadRosterMock, assignMock, unassignMock, createMock, reorderMock, deleteMock, reparentMock } =
	vi.hoisted(() => ({
		loadRosterMock: vi.fn(),
		assignMock: vi.fn(),
		unassignMock: vi.fn(),
		createMock: vi.fn(),
		reorderMock: vi.fn(),
		deleteMock: vi.fn(),
		reparentMock: vi.fn()
	}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createMock,
	reorderSections: reorderMock,
	deleteSection: deleteMock,
	reparentSection: reparentMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { RosterRow } from '$lib/roster/rosterData';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const DB_ENTITY = 'db-1';

function sectionWireEntities(damagedParents: Array<{ reference: string; entity_type?: string }> = [
	{ reference: DB_ENTITY, entity_type: 'database' },
	{ reference: DB_ENTITY, entity_type: 'database' }
]) {
	return [
		{
			_id: 'sec-sop',
			name: [{ string: 'Soprano' }],
			display_order: [{ number: 1 }],
			_parent: [{ reference: DB_ENTITY, entity_type: 'database' }]
		},
		{
			_id: 'sec-tenor',
			name: [{ string: 'Tenor' }],
			display_order: [{ number: 2 }],
			_parent: [{ reference: DB_ENTITY, entity_type: 'database' }]
		},
		{
			_id: 'sec-alto',
			name: [{ string: 'Alto' }],
			display_order: [{ number: 3 }],
			_parent: damagedParents
		}
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], dbEntityId: DB_ENTITY },
		{ memberId: 'm-tara', personId: 'p-tara', name: 'Tara Oja', email: 'tara@x.com', sectionIds: ['sec-tenor'], dbEntityId: DB_ENTITY }
	];
}

function stubGlobalFetch(entities: unknown[] = sectionWireEntities()) {
	const stub = vi.fn().mockImplementation((url: RequestInfo | URL) => {
		const u = String(url);
		if (u.includes('_type.string=section')) {
			return Promise.resolve(json({ entities, count: entities.length }));
		}
		return Promise.resolve(json({ entities: [], count: 0 }));
	});
	vi.stubGlobal('fetch', stub);
	return stub;
}

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	stubGlobalFetch();
	loadRosterMock.mockImplementation(() => Promise.resolve(toListRead(fixtureRows())));
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	reparentMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadRosterMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createMock.mockReset();
	reorderMock.mockReset();
	deleteMock.mockReset();
	reparentMock.mockReset();
	resetAppState();
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderRosterWithDamage(
	damagedParents: Array<{ reference: string; entity_type?: string }>
): Promise<HTMLElement> {
	vi.unstubAllGlobals();
	stubGlobalFetch(sectionWireEntities(damagedParents));
	return renderRoster();
}

async function renderRoster(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	return container;
}

describe('/roster — a section with ≠1 `_parent` values renders as DAMAGED DATA, loudly (#264 item 5)', () => {
	it('groups view: the damaged marker renders, names the section via the roster_section_parent_damaged message, and the REST of the roster still renders', async () => {
		const container = await renderRoster();

		const marker = await waitFor(() => {
			const el = q(container, 'section-parent-damaged-sec-alto');
			expect(el, 'damaged-data marker for sec-alto').not.toBeNull();
			return el!;
		});
		expect(marker.textContent).toContain('roster_section_parent_damaged');
		expect(marker.textContent).toContain('Alto');

		expect(q(container, 'section-group-sec-sop')).not.toBeNull();
		expect(q(container, 'section-group-sec-tenor')).not.toBeNull();
		expect(q(container, 'section-parent-damaged-sec-sop')).toBeNull();
		expect(q(container, 'section-parent-damaged-sec-tenor')).toBeNull();
	});

	it('arrange mode: the damaged node offers NO arrange affordances (no enabled indent/unindent, nothing draggable), the marker stays visible, and clean rows keep their controls', async () => {
		const container = await renderRoster();

		await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		expect(q(container, 'section-parent-damaged-sec-alto')).not.toBeNull();

		expect(
			container.querySelector('[data-testid="arrange-indent-sec-alto"]:not([disabled])')
		).toBeNull();
		expect(
			container.querySelector('[data-testid="arrange-unindent-sec-alto"]:not([disabled])')
		).toBeNull();
		expect(
			container.querySelector('[data-testid="arrange-row-sec-alto"][draggable="true"]')
		).toBeNull();

		const tenorIndent = container.querySelector<HTMLButtonElement>(
			'[data-testid="arrange-indent-sec-tenor"]'
		);
		expect(tenorIndent).not.toBeNull();
		expect(tenorIndent!.disabled).toBe(false);
	});

	it('arrange mode: ArrowRight on the GRABBED damaged row is refused — no reparent write, no failure banner', async () => {
		const container = await renderRoster();

		await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		const damagedRow = q(container, 'arrange-row-sec-alto');
		expect(damagedRow, 'arrange row for the damaged section').not.toBeNull();

		await fireEvent.keyDown(damagedRow!, { key: ' ' });
		await waitFor(() => {
			expect(damagedRow!.getAttribute('aria-grabbed')).toBe('true');
		});
		await fireEvent.keyDown(damagedRow!, { key: 'ArrowRight' });

		expect(reparentMock).not.toHaveBeenCalled();
		expect(reorderMock).not.toHaveBeenCalled();
		expect(q(container, 'section-reorder-error')).toBeNull();
		expect(q(container, 'section-parent-damaged-sec-alto')).not.toBeNull();

		await fireEvent.keyDown(damagedRow!, { key: 'ArrowLeft' });
		expect(reparentMock).not.toHaveBeenCalled();
		expect(q(container, 'section-reorder-error')).toBeNull();

		await fireEvent.keyDown(damagedRow!, { key: 'Escape' });
		await waitFor(() => {
			expect(damagedRow!.getAttribute('aria-grabbed')).toBe('false');
		});

		const tenorRow = q(container, 'arrange-row-sec-tenor');
		expect(tenorRow).not.toBeNull();
		await fireEvent.keyDown(tenorRow!, { key: ' ' });
		await waitFor(() => {
			expect(tenorRow!.getAttribute('aria-grabbed')).toBe('true');
		});
		await fireEvent.keyDown(tenorRow!, { key: 'ArrowRight' });
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
	});

	const unattributableShapes: Array<{
		label: string;
		parents: Array<{ reference: string; entity_type?: string }>;
	}> = [
		{
			label: 'two SECTION refs (a half-landed sub-section indent/unindent)',
			parents: [
				{ reference: 'sec-sop', entity_type: 'section' },
				{ reference: 'sec-tenor', entity_type: 'section' }
			]
		},
		{ label: 'ZERO `_parent` values', parents: [] }
	];

	for (const shape of unattributableShapes) {
		it(`groups view: a damaged section with ${shape.label} still renders its marker and name (no database ref to scope it by)`, async () => {
			const container = await renderRosterWithDamage(shape.parents);

			const marker = await waitFor(() => {
				const el = q(container, 'section-parent-damaged-sec-alto');
				expect(el, 'damaged-data marker for sec-alto').not.toBeNull();
				return el!;
			});
			expect(marker.textContent).toContain('roster_section_parent_damaged');
			expect(marker.textContent).toContain('Alto');

			expect(q(container, 'section-group-sec-alto')).not.toBeNull();
			expect(q(container, 'section-group-sec-sop')).not.toBeNull();
			expect(q(container, 'section-group-sec-tenor')).not.toBeNull();
			expect(q(container, 'section-parent-damaged-sec-sop')).toBeNull();
			expect(q(container, 'section-parent-damaged-sec-tenor')).toBeNull();
		});

		it(`arrange mode: a damaged section with ${shape.label} renders its marker and offers NO arrange affordances`, async () => {
			const container = await renderRosterWithDamage(shape.parents);

			await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
			await waitFor(() => {
				expect(q(container, 'roster-arrange-list')).not.toBeNull();
			});

			expect(q(container, 'section-parent-damaged-sec-alto')).not.toBeNull();
			expect(
				container.querySelector('[data-testid="arrange-indent-sec-alto"]:not([disabled])')
			).toBeNull();
			expect(
				container.querySelector('[data-testid="arrange-unindent-sec-alto"]:not([disabled])')
			).toBeNull();
			expect(
				container.querySelector('[data-testid="arrange-row-sec-alto"][draggable="true"]')
			).toBeNull();

			const tenorIndent = container.querySelector<HTMLButtonElement>(
				'[data-testid="arrange-indent-sec-tenor"]'
			);
			expect(tenorIndent).not.toBeNull();
			expect(tenorIndent!.disabled).toBe(false);
		});
	}
});

// (*MVOX:Tallis*)
