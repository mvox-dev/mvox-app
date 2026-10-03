// /roster section create end to end with real taps: body, parent, the new row appears.
// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const { loadRosterMock } = vi.hoisted(() => ({ loadRosterMock: vi.fn() }));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { RosterRow } from '$lib/roster/rosterData';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { json } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const ORG_EFK = '69c7f8718489bfcb0e81b065'; // the database entity — THE collective
const EFK_SOPRANO = '69c7f8728489bfcb0e81b07b';
const EFK_BASS = '69c7f8768489bfcb0e81b163';
const TAM_TENOR = '69c7f8878489bfcb0e81b506';
const TYPE_SECTION = '69c7ea498489bfcb0e819ea3'; // the `section` type-definition entity
const NEW_SECTION_ID = 'sec-new-live';

function wireSection(id: string, name: string, displayOrder: number, dbEntityId: string, dbName: string) {
	return {
		_id: id,
		_parent: [
			{
				_id: `pv-${id}`,
				reference: dbEntityId,
				property_type: '_parent',
				string: dbName,
				entity_type: 'database'
			}
		],
		display_order: [{ _id: `do-${id}`, number: displayOrder }],
		name: [{ _id: `nm-${id}`, string: name }]
	};
}

function liveSectionsWire(): unknown {
	return {
		entities: [
			wireSection(EFK_SOPRANO, 'Soprano', 1, ORG_EFK, 'Sampledb'),
			wireSection(EFK_BASS, 'Bass', 15, ORG_EFK, 'Sampledb'),
			wireSection(TAM_TENOR, 'I Tenor', 10, ORG_EFK, 'Sampledb')
		],
		count: 3,
		limit: 500,
		skip: 0
	};
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-efk-mari',
			personId: 'p-mari',
			name: 'Mari Mets',
			email: 'mari@x.com',
			sectionIds: [EFK_SOPRANO],
			dbEntityId: ORG_EFK
		},
		{
			memberId: 'm-viewer',
			personId: 'person-p',
			name: 'Zelda Viewer',
			email: 'zelda@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		}
	];
}

const calls: Array<{ url: string; method: string; body: string | null }> = [];

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function stubFetch(): void {
	const fetchMock = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
		const u = String(url);
		const method = init?.method ?? 'GET';
		calls.push({ url: u, method, body: typeof init?.body === 'string' ? init.body : null });
		if (u.includes('_type.string=entity') && u.includes('name.string=section')) {
			return json({ entities: [{ _id: TYPE_SECTION }], count: 1 }, 200, JSON_HEADERS);
		}
		if (u.includes('_type.string=section')) {
			return json(liveSectionsWire(), 200, JSON_HEADERS);
		}
		if (method === 'POST' && /\/entity$/.test(u.split('?')[0])) {
			return json({ _id: NEW_SECTION_ID }, 200, JSON_HEADERS);
		}
		return json({ entities: [], count: 0 }, 200, JSON_HEADERS);
	});
	vi.stubGlobal('fetch', fetchMock);
}

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	calls.length = 0;
	resetTypeIdCache(); // the type-id cache is module-scope — never let it leak across cases
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	stubFetch();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadRosterMock.mockReset();
	resetAppState();
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderArrangeReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
	});
	return container;
}

async function trustedClick(el: HTMLElement): Promise<void> {
	const stopAtDocument = (e: Event) => e.stopPropagation();
	document.addEventListener('click', stopAtDocument);
	try {
		await fireEvent.click(el);
	} finally {
		document.removeEventListener('click', stopAtDocument);
	}
	const continued = new MouseEvent('click', { bubbles: false, cancelable: true });
	Object.defineProperty(continued, 'target', { value: el, configurable: true });
	window.dispatchEvent(continued);
	await Promise.resolve();
}

async function openCreateForm(container: HTMLElement): Promise<void> {
	await trustedClick(q(container, 'roster-new-section') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-new-section-form')).not.toBeNull();
	});
}

function createPosts(): unknown[] {
	return calls
		.filter((c) => c.method === 'POST' && /\/entity$/.test(c.url.split('?')[0]))
		.map((c) => JSON.parse(c.body ?? 'null'));
}

describe('/roster #124 F1 — section creation end-to-end: real tap timing, real write layer, live-shaped tree (re-driven through roster-new-section per #470)', () => {
	it('the admin opens the arrange entry, types a name, submits: ONE create POST goes out with the full pinned body — _type as a reference, _parent = HER org (never an org-lookup guess), name, no rights fields (#699)', async () => {
		const container = await renderArrangeReady();

		await openCreateForm(container);
		await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
			target: { value: 'Tenor' }
		});
		await trustedClick(q(container, 'roster-new-section-submit') as HTMLElement);

		await waitFor(() => {
			expect(createPosts()).toHaveLength(1);
		});
		expect(createPosts()[0]).toEqual([
			{ type: '_type', reference: TYPE_SECTION },
			{ type: '_parent', reference: ORG_EFK },
			{ type: 'name', string: 'Tenor' }
		]);
		expect(calls.some((c) => c.url.includes('_type.string=organization'))).toBe(false);
	});

	it('…and the new section APPEARS: the arrange row renders, titled with the typed name, the success is ANNOUNCED (role=status non-empty), and nothing refetches', async () => {
		const container = await renderArrangeReady();

		await openCreateForm(container);
		await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
			target: { value: 'Tenor' }
		});
		await trustedClick(q(container, 'roster-new-section-submit') as HTMLElement);

		await waitFor(() => {
			expect(q(container, `arrange-row-${NEW_SECTION_ID}`)).not.toBeNull();
		});
		expect(q(container, `arrange-rename-${NEW_SECTION_ID}`)?.textContent).toContain('Tenor');
		const status = q(container, 'roster-section-create-status');
		expect(status).not.toBeNull();
		expect(status?.getAttribute('role')).toBe('status');
		await waitFor(() => {
			expect(status?.textContent?.trim()).not.toBe('');
		});
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});
});

describe('/roster #124 F2 — sub-section creation under a parent section (re-driven through roster-new-section per #470)', () => {
	it('name + parent "Soprano" submitted through real tap timing: the create POST carries _parent = the SOPRANO SECTION id, and the new arrange row renders at data-depth 1', async () => {
		const container = await renderArrangeReady();

		await openCreateForm(container);
		await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
			target: { value: 'Soprano II' }
		});
		await fireEvent.change(q(container, 'roster-new-section-parent') as HTMLElement, {
			target: { value: EFK_SOPRANO }
		});
		await trustedClick(q(container, 'roster-new-section-submit') as HTMLElement);

		expect(q(container, 'roster-new-section-error')).toBeNull();
		await waitFor(() => {
			expect(createPosts()).toHaveLength(1);
		});
		expect(createPosts()[0]).toEqual([
			{ type: '_type', reference: TYPE_SECTION },
			{ type: '_parent', reference: EFK_SOPRANO },
			{ type: 'name', string: 'Soprano II' }
		]);

		await waitFor(() => {
			expect(q(container, `arrange-row-${NEW_SECTION_ID}`)).not.toBeNull();
		});
		expect(q(container, `arrange-row-${NEW_SECTION_ID}`)?.getAttribute('data-depth')).toBe('1');
	});
});

// (*MVOX:Tallis*)
