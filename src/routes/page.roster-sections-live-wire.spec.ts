// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

const { loadRosterMock } = vi.hoisted(() => ({ loadRosterMock: vi.fn() }));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import Page from './roster/+page.svelte';
import type { RosterRow } from '$lib/roster/rosterData';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const DB_ENTITY = '69c7f8718489bfcb0e81b065';
const SEC_SOPRANO = '69c7f8728489bfcb0e81b07b';
const SEC_SOPRANO_II = '69c7f8798489bfcb0e81b207';
const SEC_ALTO = '69c7f8748489bfcb0e81b0cd';

type WireParent = {
	_id: string;
	reference: string;
	property_type: string;
	string: string;
	entity_type: string;
};

function wireSection(
	id: string,
	name: string,
	displayOrder: number,
	parent: WireParent
): Record<string, unknown> {
	return {
		_id: id,
		_parent: [parent],
		display_order: [{ _id: `do-${id}`, number: displayOrder }],
		name: [{ _id: `nm-${id}`, string: name }]
	};
}

const databaseParent = (dbEntityId: string, dbName: string): WireParent => ({
	_id: `pv-db-${dbEntityId}`,
	reference: dbEntityId,
	property_type: '_parent',
	string: dbName,
	entity_type: 'database'
});

const sectionParent = (sectionId: string, sectionName: string): WireParent => ({
	_id: `pv-sec-${sectionId}`,
	reference: sectionId,
	property_type: '_parent',
	string: sectionName,
	entity_type: 'section'
});

function correctedWire(): unknown {
	return {
		entities: [
			wireSection(SEC_SOPRANO, 'Soprano', 1, databaseParent(DB_ENTITY, 'Sampledb')),
			wireSection(SEC_SOPRANO_II, 'Soprano II', 3, sectionParent(SEC_SOPRANO, 'Soprano')),
			wireSection(SEC_ALTO, 'Alto', 4, databaseParent(DB_ENTITY, 'Sampledb'))
		],
		count: 3,
		limit: 500,
		skip: 0
	};
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: [SEC_SOPRANO_II],
			dbEntityId: DB_ENTITY
		}
	];
}

function stubSectionsFetch(payload: unknown): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn().mockImplementation((url: string) => {
		if (String(url).includes('_type.string=section')) {
			return Promise.resolve(
				new Response(JSON.stringify(payload), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			);
		}
		return Promise.resolve(
			new Response(JSON.stringify({ entities: [], count: 0 }), { status: 200 })
		);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadRosterMock.mockReset();
	resetAppState();
	resetAdmin();
});

async function renderReady() {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
	});
	const toggleAll = container.querySelector('[data-testid="roster-view-chip-expanded"]') as HTMLElement | null;
	if (toggleAll) {
		await fireEvent.click(toggleAll);
	}
	return container;
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

describe('/roster over the REAL listSections — CORRECTED data: a section-parented Soprano II renders NESTED (the acceptance shape for the live data fix)', () => {
	it("Soprano II's group renders INSIDE Soprano's group at data-depth 1, with Ada's row in it; Soprano's header roll-up counts her", async () => {
		stubSectionsFetch(correctedWire());
		const container = await renderReady();

		const soprano = q(container, `section-group-${SEC_SOPRANO}`) as HTMLElement;
		const nested = soprano.querySelector(
			`[data-testid="section-group-${SEC_SOPRANO_II}"]`
		) as HTMLElement;
		expect(nested).not.toBeNull();
		expect(nested.getAttribute('data-depth')).toBe('1');
		expect(nested.querySelector('[data-testid="roster-row-m-ada"]')).not.toBeNull();
		expect(q(container, `section-header-${SEC_SOPRANO}`)?.textContent).toContain('(1)');
	});

	it('sections without a section parent stay top level: Alto renders at depth 0, not nested anywhere', async () => {
		stubSectionsFetch(correctedWire());
		const container = await renderReady();

		const alto = q(container, `section-group-${SEC_ALTO}`) as HTMLElement;
		expect(alto).not.toBeNull();
		expect(alto.getAttribute('data-depth')).toBe('0');
		expect(alto.parentElement?.closest('[data-testid^="section-group-"]')).toBeNull();
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
