// @vitest-environment happy-dom
//
// #124 RED — gate #114 F1/F2 through the MEMBER-PICKER path, END-TO-END on the
// real live shape. Integration: actual /roster route component, real
// SectionPicker, real groupBySection, and — unlike every earlier create-section
// page spec — the REAL sectionData (listSections parses a live-shaped wire
// payload) and the REAL sectionActions (createSection/assignMemberSection hit
// the stubbed fetch seam, so the WIRE SHAPE of the writes is asserted, not a
// mock's call log). Only `loadRoster` and global fetch are stubbed.
//
// COMPLEMENTARY to page.roster-create-section-entry.spec.ts: that file pins
// the NEW page-level create affordance the SPIKE's discoverability findings
// call for; THIS file pins that the existing picker path itself must survive
// REAL tap timing — because under trusted-event sequencing it currently cannot
// create a section at all:
//
//   a real tap on "+ New section…" flushes Svelte between listeners (microtask
//   checkpoint after each callback of a trusted event's dispatch), the
//   `{#if !creating}` swap unmounts the tapped button, and the picker's
//   window-level outside-click dismissal then misreads the DETACHED target as
//   an outside click and closes the whole picker — form and all. Deterministic
//   on every real browser; invisible to synthetic dispatch, which never
//   checkpoints mid-bubble. Root-cause anatomy and fix-shape options in
//   SectionPicker.trusted-tap.spec.ts; the `trustedClick` helper below
//   reproduces the trusted sequencing faithfully.
//
// The fixtures are the live MULTI-ORG shape (2026-08-12 spike probe: 133
// active members across five orgs, 16 sections across four — real entity ids
// below), so the org-threading assertions run against the exact conditions of
// the TU.6 gate walk, not a single-org idealization. The F3 (empty-section
// remove) half of the gate lives in page.roster-empty-remove.spec.ts.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const { loadRosterMock } = vi.hoisted(() => ({ loadRosterMock: vi.fn() }));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
// sectionData and sectionActions are NOT mocked — the REAL read parses the
// live-shaped wire and the REAL writes hit the fetch stub below.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { RosterRow } from '$lib/roster/rosterData';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── live wire fixture (verbatim shape + real ids, 2026-08-12 spike probe;
//    reparented to the single DATABASE entity per #161 — collective = database,
//    so a live db now carries exactly one collective, not several) ────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065'; // the database entity — THE (only) collective
const ORG_TAM = ORG_EFK; // #161: no more foreign collectives sharing one db's section list
const EFK_SOPRANO = '69c7f8728489bfcb0e81b07b';
const EFK_BASS = '69c7f8768489bfcb0e81b163'; // 0 members live — the gate's own "Bass (0)"
const TAM_BASS = '69c7f88a8489bfcb0e81b5bc'; // 0 members live — a second "Bass (0)" in the same collective
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

/** All sections in ONE payload — the live db's actual answer to listSections'
 *  unscoped `_type.string=section` query, every root parented to the SAME
 *  database entity (#161: single collective per db). Two "Bass" roots, both
 *  empty — the exact two-Bass-(0) screen the gate walk photographed. */
function liveSectionsWire(): unknown {
	return {
		entities: [
			wireSection(EFK_SOPRANO, 'Soprano', 1, ORG_EFK, 'Polyphony'),
			wireSection(EFK_BASS, 'Bass', 15, ORG_EFK, 'Polyphony'),
			wireSection(TAM_TENOR, 'I Tenor', 10, ORG_TAM, 'Polyphony'),
			wireSection(TAM_BASS, 'Bass', 16, ORG_TAM, 'Polyphony')
		],
		count: 4,
		limit: 500,
		skip: 0
	};
}

/** Multi-org rows, exactly as the live unscoped member query yields them: the
 *  ALPHABETICALLY-FIRST member belongs to the FOREIGN org (live: rows span five
 *  orgs, so whoever sorts first sets `currentOrgId` under the current code —
 *  that arbitrariness IS finding F3). The viewer ('person-p') is an EFK member. */
function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-tam-aabel',
			personId: 'p-aabel',
			name: 'Aabel Tamm',
			email: 'aabel@x.com',
			sectionIds: [TAM_TENOR],
			orgId: ORG_TAM
		},
		{
			memberId: 'm-efk-mari',
			personId: 'p-mari',
			name: 'Mari Mets',
			email: 'mari@x.com',
			sectionIds: [EFK_SOPRANO],
			orgId: ORG_EFK
		},
		{
			memberId: 'm-viewer',
			personId: 'person-p',
			name: 'Zelda Viewer',
			email: 'zelda@x.com',
			sectionIds: [],
			orgId: ORG_EFK
		}
	];
}

// ── fetch stub: live-shaped reads + recorded writes ─────────────────────────────

const calls: Array<{ url: string; method: string; body: string | null }> = [];

function stubFetch(): void {
	const fetchMock = vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
		const u = String(url);
		const method = init?.method ?? 'GET';
		calls.push({ url: u, method, body: typeof init?.body === 'string' ? init.body : null });
		const json = (payload: unknown, status = 200) =>
			Promise.resolve(
				new Response(JSON.stringify(payload), {
					status,
					headers: { 'Content-Type': 'application/json' }
				})
			);
		// resolveTypeId's type-definition lookup (`name.string=section`).
		if (u.includes('_type.string=entity') && u.includes('name.string=section')) {
			return json({ entities: [{ _id: TYPE_SECTION }], count: 1 });
		}
		// listSections' unscoped section read.
		if (u.includes('_type.string=section')) {
			return json(liveSectionsWire());
		}
		// createSection's entity POST (`POST {base}/{db}/entity`, no id segment).
		if (method === 'POST' && /\/entity$/.test(u.split('?')[0])) {
			return json({ _id: NEW_SECTION_ID });
		}
		// assignMemberSection's per-member POST (`POST {base}/{db}/entity/{id}`).
		if (method === 'POST') {
			return json({ _id: 'prop-appended' });
		}
		return json({ entities: [], count: 0 });
	});
	vi.stubGlobal('fetch', fetchMock);
}

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	calls.length = 0;
	resetTypeIdCache(); // the type-id cache is module-scope — never let it leak across cases
	loadRosterMock.mockResolvedValue(fixtureRows());
	stubFetch();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadRosterMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	// Sections default collapsed (#110 finding #9); these specs are about the
	// create flow and the remove gate, so expand everything up front.
	const toggleAll = q(container, 'roster-view-chip-expanded') as HTMLElement | null;
	if (toggleAll) {
		await fireEvent.click(toggleAll);
		await waitFor(() => {
			expect(container.querySelector('[data-testid^="roster-row-"]')).not.toBeNull();
		});
	}
	return container;
}

/**
 * Dispatch a click with TRUSTED-EVENT event-loop semantics — the component's
 * own handlers first, then a microtask checkpoint (Svelte's flush), and only
 * then the window-level listeners, carrying the ORIGINAL target (which the
 * flush may have unmounted). This is how a real browser sequences a hardware
 * tap; synthetic dispatch runs the whole path with no checkpoint, which is how
 * the F1 defect passed every earlier page spec. Full anatomy in
 * SectionPicker.trusted-tap.spec.ts.
 */
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

/** Walk to the open create form via trusted taps — the live gate's own path. */
async function openCreateForm(container: HTMLElement, memberId: string): Promise<void> {
	await trustedClick(q(container, `section-picker-trigger-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `section-picker-menu-${memberId}`)).not.toBeNull();
	});
	await trustedClick(q(container, 'section-picker-new') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'section-create-form')).not.toBeNull();
	});
}

/** Every recorded POST body to the bare `/entity` create endpoint, parsed. */
function createPosts(): unknown[] {
	return calls
		.filter((c) => c.method === 'POST' && /\/entity$/.test(c.url.split('?')[0]))
		.map((c) => JSON.parse(c.body ?? 'null'));
}

// ── F1: creation works END-TO-END on the live shape (type name, submit, appears) ─

describe('/roster #124 F1 — section creation end-to-end: real tap timing, real write layer, live-shaped tree', () => {
	it('the viewer taps "+ New section…" on her own row, types a name, submits: ONE create POST goes out with the full pinned body — _type as a reference, _parent = HER org (never an org-lookup guess), name, explicit public _sharing', async () => {
		const container = await renderReady();

		await openCreateForm(container, 'm-viewer');
		await fireEvent.input(q(container, 'section-create-name') as HTMLElement, {
			target: { value: 'Tenor' }
		});
		await trustedClick(q(container, 'section-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createPosts()).toHaveLength(1);
		});
		// Full-shape equality — a partial match here is how wire bugs shipped before
		// (#partial-assertions-hide-bugs).
		expect(createPosts()[0]).toEqual([
			{ type: '_type', reference: TYPE_SECTION },
			{ type: '_parent', reference: ORG_EFK },
			{ type: 'name', string: 'Tenor' },
			{ type: '_sharing', string: 'public' }
		]);
		// The page knows the org — the data layer must never fall back to the
		// `_type.string=organization&limit=1` guess (umbrella-federation trap).
		expect(calls.some((c) => c.url.includes('_type.string=organization'))).toBe(false);
	});

	it('…and the new section APPEARS in the roster list: a new group renders, titled with the typed name, with the viewer\'s row inside it (assign round-tripped) and out of Unassigned', async () => {
		const container = await renderReady();

		await openCreateForm(container, 'm-viewer');
		await fireEvent.input(q(container, 'section-create-name') as HTMLElement, {
			target: { value: 'Tenor' }
		});
		await trustedClick(q(container, 'section-create-submit') as HTMLElement);

		await waitFor(() => {
			// `?? null` — a missing outer group makes the chained `?.querySelector`
			// read `undefined`, and `undefined` is not `=== null`, so a bare
			// `.not.toBeNull()` on it passes VACUOUSLY on the very first (too-early)
			// poll instead of making `waitFor` retry until the group actually
			// exists. Normalizing to `null` restores the intended "keep polling
			// until it's really there" semantics.
			expect(
				q(container, `section-group-${NEW_SECTION_ID}`)?.querySelector(
					'[data-testid="roster-row-m-viewer"]'
				) ?? null
			).not.toBeNull();
		});
		expect(q(container, `section-header-${NEW_SECTION_ID}`)?.textContent).toContain('Tenor');
		expect(
			q(container, 'section-group-unassigned')?.querySelector(
				'[data-testid="roster-row-m-viewer"]'
			) ?? null
		).toBeNull();
		// The assign write is REAL too: exactly one member POST carrying the new
		// section as an appended `_parent` reference.
		const assignPost = calls.find(
			(c) => c.method === 'POST' && c.url.split('?')[0].endsWith('/entity/m-viewer')
		);
		expect(assignPost).toBeDefined();
		expect(JSON.parse(assignPost!.body ?? 'null')).toEqual([
			{ type: '_parent', reference: NEW_SECTION_ID }
		]);
		// No refetch — the appearance is local-state insertion (pinned contract).
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});
});

// ── F2: SUB-SECTION creation under a parent works on the live shape ─────────────

describe('/roster #124 F2 — sub-section creation under a parent section (unblocks gate check 2)', () => {
	it('name + parent "Soprano" submitted through real tap timing: the create POST carries _parent = the SOPRANO SECTION id, and the new group renders NESTED inside Soprano\'s group at depth 1 with the viewer\'s row in it', async () => {
		const container = await renderReady();

		await openCreateForm(container, 'm-viewer');
		await fireEvent.input(q(container, 'section-create-name') as HTMLElement, {
			target: { value: 'Soprano II' }
		});
		await fireEvent.change(q(container, 'section-create-parent') as HTMLElement, {
			target: { value: EFK_SOPRANO }
		});
		await trustedClick(q(container, 'section-create-submit') as HTMLElement);

		// No duplicate refusal (another org's flat tree must not block it) — the
		// write went out, parented to the SECTION, sharing explicit.
		expect(q(container, 'section-create-error')).toBeNull();
		await waitFor(() => {
			expect(createPosts()).toHaveLength(1);
		});
		expect(createPosts()[0]).toEqual([
			{ type: '_type', reference: TYPE_SECTION },
			{ type: '_parent', reference: EFK_SOPRANO },
			{ type: 'name', string: 'Soprano II' },
			{ type: '_sharing', string: 'public' }
		]);

		// …and it RENDERS as a sub-section: nested inside Soprano's group, WITH the
		// viewer's row inside it (the assign round-trip, not just the create).
		// `?? null` — see the F1 spec's identical note: a missing nested element
		// makes the chained `?.querySelector` read `undefined`, which is not
		// `=== null`, so a bare `.not.toBeNull()` would pass vacuously on the very
		// first (too-early) poll instead of making `waitFor` retry for real.
		await waitFor(() => {
			expect(
				q(container, `section-group-${EFK_SOPRANO}`)?.querySelector(
					`[data-testid="section-group-${NEW_SECTION_ID}"]`
				) ?? null
			).not.toBeNull();
			expect(
				q(container, `section-group-${NEW_SECTION_ID}`)?.querySelector(
					'[data-testid="roster-row-m-viewer"]'
				) ?? null
			).not.toBeNull();
		});
		const newGroup = q(container, `section-group-${NEW_SECTION_ID}`) as HTMLElement;
		expect(newGroup.getAttribute('data-depth')).toBe('1');
		expect(newGroup.querySelector('[data-testid="roster-row-m-viewer"]')).not.toBeNull();
	});
});

// (*MVOX:Tallis* — #124 RED, gate #114 F1/F2: the picker create path end-to-end
//  under trusted-event timing, real write layer, live multi-org shape)
