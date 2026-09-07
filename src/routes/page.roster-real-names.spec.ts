// @vitest-environment happy-dom
//
// #269 RED — roster renders real names when the admin setting says so, pinned
// END-TO-END through the ACTUAL roster route with the REAL producer chain:
// loadRoster, listSections, the database-entity resolve, the toggle read and
// the admin_member_record read are all the real modules — ONLY the wire
// (global fetch) is stubbed. Contract: issue #269 body + release ruling
// (2026-09-07) + scope ruling ("roster only for now", 2026-09-06). Runs on the
// post-#268 tree: the baseline INCLUDES the record-editor pencil — the fence
// is toggle-off vs toggle-on ON THIS TREE, not vs a historical snapshot.
//
// Pinned here:
//   1. RESOLUTION RULE at the widget: `roster-row-name` shows the
//      admin_member_record name IFF the collective's roster_show_real_names is
//      true AND that member's record carries a non-empty name; otherwise the
//      profile name exactly as today. SAME element, SAME class, SAME position
//      — only the string differs.
//   2. FALLBACK SILENT AND COMPLETE: mixed rows are indistinguishable — a
//      record-backed row and a fallback row have identical class lists and
//      identical DOM shape; no placeholder, no marker, no new user-facing
//      string anywhere (silent fallback needs no i18n key — under the
//      paraglide proxy mock any new string would surface as a bracketed key).
//   3. TOGGLE OFF (default, absent → false): rendering identical to the
//      toggle-less behavior on THIS tree (pencil included), records present
//      server-side notwithstanding — and NO admin_member_record request at
//      all. The explicit negative.
//   4. SCOPE — roster page rows ONLY. SectionPicker keeps the PROFILE name
//      (DECISION pinned: its aria strings name the member for a
//      section-assignment action, out of #269's contracted surface; stated
//      choice, flagged for the live round). The INACTIVE panel stays
//      profile-names in v1 (separate span, separate inactiveRows path —
//      deliberate letter-first boundary, flagged in the delivery report).
//   5. SORTING follows the DISPLAYED name at the page's sort sites: grouped
//      per-group order AND the flat list (fixture where real-name order
//      differs from profile-name order). No search exists on this page.
//   6. READS under the page's load(): toggle via the database entity
//      (props=roster_show_real_names), records via ONE bulk narrowed query
//      (props=person,name — the PO-ruled incidental-exposure fence; the
//      acceptance list's network check IS these URL pins). Members and admins
//      issue the SAME narrowed query. Deterministic collective-switch race:
//      a held stale settle writes nothing.
//   7. COLLECTIVE-WIDE / second-session semantics: the value is read from the
//      server per load — no client-side persistence.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

// REAL producer chain: rosterData, sectionData, collective/databaseEntity and
// the toggle read are deliberately NOT mocked. Only the wire is stubbed.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── wire fixtures ───────────────────────────────────────────────────────────

interface DbWire {
	dbEntityId: string;
	members: Array<{ id: string; person: string }>;
	archived?: Array<{ id: string; person: string }>;
	profiles: Record<string, { name: string; email?: string }>;
	toggle: boolean | 'absent';
	records: Array<{ id: string; person?: string; name?: string }>;
	/** When set, the admin_member_record response is HELD until this resolves
	 *  (the deterministic collective-switch race lever). */
	recordsGate?: Promise<void>;
	/** #269 review F2 — when set, the PER-PERSON record lookup
	 *  (`person.reference=…`, loadMemberRecord) answers with THIS list instead of
	 *  `records`. Lets a test express the live-reachable skew where the roster's
	 *  bulk read saw a record but the pencil's own lookup no longer does (the
	 *  record was deleted in between). */
	lookupRecords?: Array<{ id: string; person?: string; name?: string }>;
}

function jsonRes(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function wireMember(fx: DbWire, m: { id: string; person: string }) {
	return {
		_id: m.id,
		person: [{ reference: m.person }],
		_parent: [
			{
				_id: `pv-${m.id}`,
				reference: fx.dbEntityId,
				property_type: '_parent',
				string: 'Collective',
				entity_type: 'database'
			}
		]
	};
}

function stubWire(byDb: Record<string, DbWire>): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn().mockImplementation(async (url: string) => {
		const u = String(url);
		const dbMatch = /invalid\/([^/]+)\//.exec(u);
		const fx = dbMatch ? byDb[dbMatch[1]] : undefined;
		if (!fx) return jsonRes({ entities: [] });
		if (u.includes('_type.string=admin_member_record')) {
			if (fx.recordsGate) await fx.recordsGate;
			const rows =
				u.includes('person.reference=') && fx.lookupRecords !== undefined
					? fx.lookupRecords
					: fx.records;
			return jsonRes({
				entities: rows.map((r) => ({
					_id: r.id,
					...(r.person !== undefined ? { person: [{ reference: r.person }] } : {}),
					...(r.name !== undefined ? { name: [{ string: r.name }] } : {})
				}))
			});
		}
		if (u.includes('_type.string=member') && u.includes('status.string=archived')) {
			return jsonRes({ entities: (fx.archived ?? []).map((m) => wireMember(fx, m)) });
		}
		if (u.includes('_type.string=member')) {
			return jsonRes({ entities: fx.members.map((m) => wireMember(fx, m)) });
		}
		if (u.includes('_type.string=section')) {
			return jsonRes({ entities: [], count: 0 });
		}
		if (u.includes('_type.string=database')) {
			return jsonRes({ entities: [{ _id: fx.dbEntityId }] });
		}
		if (u.includes(`entity/${fx.dbEntityId}`) && u.includes('roster_show_real_names')) {
			return jsonRes({
				entity: {
					_id: fx.dbEntityId,
					...(fx.toggle === 'absent'
						? {}
						: { roster_show_real_names: [{ _id: 'v-toggle', boolean: fx.toggle }] })
				}
			});
		}
		if (u.includes('_type.string=profile')) {
			const pm = /_parent\.reference=([^&]+)/.exec(u);
			const personId = pm ? decodeURIComponent(pm[1]) : '';
			const p = fx.profiles[personId];
			return jsonRes({
				entities: p
					? [
							{
								_id: `prof-${personId}`,
								name: [{ string: p.name }],
								...(p.email ? { email: [{ string: p.email }] } : {}),
								_sharing: [{ string: 'domain' }]
							}
						]
					: []
			});
		}
		return jsonRes({ entities: [] });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

/** polyphony: viewer m1 (profile 'Alice Alto', NO record) + m2 (profile
 *  'Berta Bass', record 'Aaron Aardvark') — displayed order under the toggle
 *  (Aaron, Alice) DIFFERS from profile order (Alice, Berta), so sorting by the
 *  displayed name is observable. An archived m3 carries a record too, so the
 *  inactive panel's profile-name boundary is observable. */
function polyphonyFixture(toggle: boolean | 'absent'): DbWire {
	return {
		dbEntityId: 'db-ent-1',
		members: [
			{ id: 'm1', person: 'person-p' },
			{ id: 'm2', person: 'person-q' }
		],
		archived: [{ id: 'm3', person: 'person-r' }],
		profiles: {
			'person-p': { name: 'Alice Alto', email: 'alice@x.com' },
			'person-q': { name: 'Berta Bass', email: 'berta@x.com' },
			'person-r': { name: 'Carla Cantus', email: 'carla@x.com' }
		},
		toggle,
		records: [
			{ id: 'rec-q', person: 'person-q', name: 'Aaron Aardvark' },
			{ id: 'rec-r', person: 'person-r', name: 'Xena Xylophone' }
		]
	};
}

// ── harness ─────────────────────────────────────────────────────────────────

const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`);
const flush = () => new Promise((r) => setTimeout(r, 0));

function rowNameSpan(c: HTMLElement, memberId: string): HTMLElement {
	const li = q(c, `roster-row-${memberId}`);
	expect(li).not.toBeNull();
	const span = li!.querySelector('[data-testid="roster-row-name"]');
	expect(span).not.toBeNull();
	return span as HTMLElement;
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

function setAuthedWithTwoCollectives() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p', 'other-choir': 'person-b' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
			{ db: 'other-choir', name: 'Other Choir', personId: 'person-b' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

// Groups default COLLAPSED — expand Unassigned (fixture members land there).
async function renderRosterAs(admin: 'admin' | 'not-admin') {
	const utils = render(Page);
	setAuthedWithOneCollective();
	adminStore.set(admin);
	await waitFor(() => expect(q(utils.container, 'section-toggle-unassigned')).not.toBeNull());
	await fireEvent.click(q(utils.container, 'section-toggle-unassigned')!);
	await waitFor(() => expect(q(utils.container, 'roster-row-m2')).not.toBeNull());
	return utils;
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	resetTypeIdCache();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
});

// ── (1) resolution rule, end-to-end ─────────────────────────────────────────

describe('#269 /roster end-to-end — toggle ON through the real producer chain', () => {
	it('the record-backed row shows the REAL name, the recordless row shows the profile name — in the SAME roster-row-name span with the SAME class (only the string differs)', async () => {
		stubWire({ polyphony: polyphonyFixture(true) });
		const { container } = await renderRosterAs('admin');

		const m2span = rowNameSpan(container, 'm2');
		expect(m2span.textContent).toBe('Aaron Aardvark');
		const m1span = rowNameSpan(container, 'm1');
		expect(m1span.textContent).toBe('Alice Alto');

		// SAME element, SAME class, SAME position — the widget-detail pin.
		expect(m2span.getAttribute('data-testid')).toBe('roster-row-name');
		expect(m2span.className).toBe('text-sm text-ink');
		expect(m1span.className).toBe(m2span.className);
		expect(m2span.tagName).toBe('SPAN');
		// Position: the name span is the FIRST rendered element of the row.
		expect(q(container, 'roster-row-m2')!.firstElementChild).toBe(m2span);
	});

	it('NON-ADMIN members see the real names too (the toggle is collective-wide, not an admin-only view)', async () => {
		stubWire({ polyphony: polyphonyFixture(true) });
		const { container } = await renderRosterAs('not-admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');
		expect(rowNameSpan(container, 'm1').textContent).toBe('Alice Alto');
	});
});

// ── (2) mixed rows indistinguishable, silent fallback, zero new strings ─────

describe('#269 fallback — SILENT AND COMPLETE', () => {
	function shapeOf(li: Element, memberId: string): string[] {
		return [li as Element, ...Array.from(li.querySelectorAll('*'))].map((el) => {
			const testid = (el.getAttribute('data-testid') ?? '').split(memberId).join('{id}');
			return `${el.tagName}|${testid}|${el.className}`;
		});
	}

	it('a record-backed row and a fallback row have IDENTICAL class lists and DOM shape — only the text differs; no placeholder, no marker, no alert', async () => {
		stubWire({ polyphony: polyphonyFixture(true) });
		// Non-admin render: the rows carry no admin controls, so the shape
		// comparison is exactly the two members' visible name/email structure.
		const { container } = await renderRosterAs('not-admin');
		const m1li = q(container, 'roster-row-m1')!;
		const m2li = q(container, 'roster-row-m2')!;

		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');
		expect(shapeOf(m2li, 'm2')).toEqual(shapeOf(m1li, 'm1'));
		expect(m2li.className).toBe(m1li.className);

		// Zero new user-facing strings: under the paraglide proxy mock every
		// message renders as a bracketed key, so a marker/placeholder string
		// would surface as '[...]' inside the row. Silent fallback needs none.
		expect(m1li.textContent).not.toContain('[');
		expect(m2li.textContent).not.toContain('[');
		expect(m1li.querySelector('[role="alert"]')).toBeNull();
		expect(m2li.querySelector('[role="alert"]')).toBeNull();
	});

	it('a record whose name was CLEARED falls back to the profile name silently — the toggle-on load still issues its ONE records read (the fallback is a join decision, never a skipped fetch)', async () => {
		const fx = polyphonyFixture(true);
		fx.records = [{ id: 'rec-q', person: 'person-q', name: '' }];
		const fetchMock = stubWire({ polyphony: fx });
		const { container } = await renderRosterAs('admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Berta Bass');
		expect(rowNameSpan(container, 'm1').textContent).toBe('Alice Alto');
		const records = (fetchMock.mock.calls as Array<[unknown]>)
			.map((c) => String(c[0]))
			.filter((u) => u.includes('admin_member_record'));
		expect(records).toHaveLength(1);
	});

	it('a member carrying TWO records falls back to the profile name too — the overlay refuses to guess (matching what the #268 pencil says about her), and the row stays byte-identical to any other fallback row', async () => {
		const fx = polyphonyFixture(true);
		// The live-reachable damaged shape: the check-then-create is not atomic
		// across admins, so person-q can end up with two records. #264 house
		// semantics — surface loudly, refuse to guess — and on the roster row
		// "refuse to guess" IS the silent profile-name fallback.
		fx.records = [
			{ id: 'rec-q1', person: 'person-q', name: 'Aaron Aardvark' },
			{ id: 'rec-q2', person: 'person-q', name: 'Zed Zither' }
		];
		stubWire({ polyphony: fx });
		const { container } = await renderRosterAs('not-admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Berta Bass');
		expect(rowNameSpan(container, 'm1').textContent).toBe('Alice Alto');
		const m1li = q(container, 'roster-row-m1')!;
		const m2li = q(container, 'roster-row-m2')!;
		expect(shapeOf(m2li, 'm2')).toEqual(shapeOf(m1li, 'm1'));
		expect(m2li.textContent).not.toContain('[');
		expect(m2li.querySelector('[role="alert"]')).toBeNull();
	});
});

// ── (3) toggle off — the explicit negative, on THIS (post-#268) tree ────────

describe('#269 toggle OFF — identical to the toggle-less behavior on this tree', () => {
	it('toggle false + records present → profile names everywhere, NO admin_member_record request at all, the toggle itself read from the server — and the #268 pencil still renders (the baseline fence)', async () => {
		const fetchMock = stubWire({ polyphony: polyphonyFixture(false) });
		const { container } = await renderRosterAs('admin');

		expect(rowNameSpan(container, 'm1').textContent).toBe('Alice Alto');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Berta Bass');

		const all = (fetchMock.mock.calls as Array<[unknown]>).map((c) => String(c[0]));
		expect(all.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(
			all.filter(
				(u) => u.includes('entity/db-ent-1') && u.includes('props=roster_show_real_names')
			)
		).toHaveLength(1);

		// Post-#268 baseline: toggle-off is fenced against TOGGLE-ON, not against
		// a historical snapshot — the record-editor pencil belongs to both sides.
		expect(q(container, 'roster-row-record-edit-m2')).not.toBeNull();
	});

	it('toggle key ABSENT (never set) → false: same rendering, same absence of any records fetch', async () => {
		const fetchMock = stubWire({ polyphony: polyphonyFixture('absent') });
		const { container } = await renderRosterAs('admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Berta Bass');
		const all = (fetchMock.mock.calls as Array<[unknown]>).map((c) => String(c[0]));
		expect(all.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(
			all.filter(
				(u) => u.includes('entity/db-ent-1') && u.includes('props=roster_show_real_names')
			)
		).toHaveLength(1);
	});
});

// ── (5) sorting follows the displayed name ──────────────────────────────────

describe('#269 sorting — the page orders by what the rows DISPLAY', () => {
	it('grouped view: rows inside a group come in displayed-name order (Aaron before Alice, though profile order was Alice before Berta)', async () => {
		stubWire({ polyphony: polyphonyFixture(true) });
		const { container } = await renderRosterAs('admin');
		const names = Array.from(
			container.querySelectorAll('[data-testid="roster-groups"] [data-testid="roster-row-name"]')
		).map((el) => el.textContent);
		expect(names).toEqual(['Aaron Aardvark', 'Alice Alto']);
	});

	it('flat view: the alphabetical list re-sorts by the displayed name too', async () => {
		stubWire({ polyphony: polyphonyFixture(true) });
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(q(container, 'roster-sort-toggle')!);
		await waitFor(() => expect(q(container, 'roster-flat-list')).not.toBeNull());
		const names = Array.from(
			container.querySelectorAll('[data-testid="roster-flat-list"] [data-testid="roster-row-name"]')
		).map((el) => el.textContent);
		expect(names).toEqual(['Aaron Aardvark', 'Alice Alto']);
	});
});

// ── (4) scope — roster rows ONLY ────────────────────────────────────────────

describe('#269 scope — every other member-name surface keeps the PROFILE name', () => {
	// #269 review F1 — anchored on the LISTBOX's pre-existing aria-label (#99
	// review F1), NOT on the trigger: the trigger's accessible name is its own
	// visible section-list text and #269 must not touch it. Zero production
	// change is needed to satisfy this scope pin.
	it('SectionPicker names the member by her PROFILE name in its listbox aria-label even while her row displays the real name (stated choice — section-assignment action, out of the contracted surface; flag for live review)', async () => {
		stubWire({ polyphony: polyphonyFixture(true) });
		const { container } = await renderRosterAs('admin');
		// The row displays the real name…
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');
		// …while the picker's accessible name keeps the profile name.
		const trigger = q(container, 'section-picker-trigger-m2')!;
		expect(trigger).not.toBeNull();
		// The trigger keeps announcing WHICH SECTIONS she is in — its visible
		// text IS its accessible name, unchanged by #269.
		expect(trigger.getAttribute('aria-label')).toBeNull();
		await fireEvent.click(trigger);
		await waitFor(() => expect(q(container, 'section-picker-listbox-m2')).not.toBeNull());
		const ariaLabel = q(container, 'section-picker-listbox-m2')!.getAttribute('aria-label') ?? '';
		expect(ariaLabel).toContain('Berta Bass');
		expect(ariaLabel).not.toContain('Aaron Aardvark');
	});

	// #269 review F2 — the #268 create-path prefill reads `row.profileName`, never
	// the DISPLAYED `row.name`. Pinned on the live-reachable skew: the roster's
	// bulk read saw a record (so the row shows the real name) but the pencil's own
	// per-person lookup no longer does (the record was deleted in between). Reading
	// the displayed name there would resurrect a deleted real name into a fresh
	// create; reading `profileName` is what R4's "prefill from the profile" means.
	it('the #268 record-editor prefill uses the PROFILE name even when the row displays a real one (record deleted between the roster load and the pencil tap)', async () => {
		const fx = polyphonyFixture(true);
		fx.lookupRecords = []; // deleted since the roster's bulk read → the create path
		stubWire({ polyphony: fx });
		const { container } = await renderRosterAs('admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');

		await fireEvent.click(q(container, 'roster-row-record-edit-m2')!);
		await waitFor(() => expect(q(container, 'roster-record-name')).not.toBeNull());
		expect((q(container, 'roster-record-name') as HTMLInputElement).value).toBe('Berta Bass');
	});

	it('the INACTIVE panel stays profile-names in v1 (deliberate letter-first boundary): an archived member with a named record still lists under her profile name', async () => {
		stubWire({ polyphony: polyphonyFixture(true) });
		const { container } = await renderRosterAs('admin');
		// RED anchor on the contracted surface first:
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');

		await fireEvent.click(q(container, 'roster-inactive-toggle')!);
		await waitFor(() => expect(q(container, 'roster-inactive-list')).not.toBeNull());
		const inactiveRow = q(container, 'inactive-member-row-m3')!;
		expect(inactiveRow).not.toBeNull();
		expect(inactiveRow.textContent).toContain('Carla Cantus');
		expect(inactiveRow.textContent).not.toContain('Xena Xylophone');
	});
});

// ── (6) the reads: one narrowed bulk query, same for members and admins ─────

describe('#269 network — the acceptance list checks the wire, not just the screen', () => {
	function recordUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
		return (fetchMock.mock.calls as Array<[unknown]>)
			.map((c) => String(c[0]))
			.filter((u) => u.includes('admin_member_record'));
	}

	it('ONE bulk records query per roster load, projected person,name EXACTLY — and no load-time URL anywhere projects phone or birthdate (the PO-ruled incidental-exposure fence)', async () => {
		const fetchMock = stubWire({ polyphony: polyphonyFixture(true) });
		const { container } = await renderRosterAs('admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');

		const records = recordUrls(fetchMock);
		expect(records).toHaveLength(1);
		expect(records[0]).toContain('_type.string=admin_member_record');
		expect(records[0]).toMatch(/props=person,name(&|$)/);
		expect(records[0]).toContain('limit=500');
		// email is private on the record — the narrowed query must not carry it
		// (the profile read's own props=name,email,_sharing is the one legitimate
		// email projection on this page and is not a record query).
		expect(records[0]).not.toMatch(/props=[^&]*\b(phone|email|birthdate)\b/);

		for (const u of (fetchMock.mock.calls as Array<[unknown]>).map((c) => String(c[0]))) {
			expect(u).not.toMatch(/props=[^&]*\b(phone|birthdate)\b/);
		}
	});

	it('members and admins issue the SAME narrowed query — no admin-widened variant', async () => {
		const adminFetch = stubWire({ polyphony: polyphonyFixture(true) });
		await renderRosterAs('admin');
		const adminUrls = recordUrls(adminFetch);
		expect(adminUrls).toHaveLength(1);

		cleanup();
		vi.unstubAllGlobals();
		// Isolate the second phase as a genuinely SEPARATE page view (a different
		// member's own session) rather than a continuation of the admin phase's —
		// the module-singleton stores otherwise still carry the FIRST phase's
		// already-authenticated/already-selected state into the second render's
		// mount-time effect run, double-firing `loadForSelected` (once at mount on
		// the stale-but-valid leftover state, once more when `setAuthedWithOneCollective`
		// below re-notifies) — an artifact of reusing stores across two renders
		// inside one `it()`, not a roster-page or `loadRoster` behavior. Matches the
		// full reset this file's own `afterEach` already does between tests.
		authStore.set({ status: 'loading' });
		collectiveState.set({ status: 'loading' });
		selectedCollectiveDbStore.set(null);
		urlCollectiveDbStore.set(null);
		resetAdmin();
		resetTypeIdCache();

		const memberFetch = stubWire({ polyphony: polyphonyFixture(true) });
		const { container } = await renderRosterAs('not-admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');
		const memberUrls = recordUrls(memberFetch);
		expect(memberUrls).toHaveLength(1);
		expect(memberUrls[0]).toBe(adminUrls[0]);
	});
});

// ── (7) collective-wide semantics + the switch race ─────────────────────────

describe('#269 per-load server read and the #259 switch discipline', () => {
	it('the value is read from the server on EVERY load — no client-side persistence: a fresh render after the server flipped the toggle shows the new state (the second-session/collective-wide acceptance)', async () => {
		stubWire({ polyphony: polyphonyFixture(false) });
		let utils = await renderRosterAs('admin');
		expect(rowNameSpan(utils.container, 'm2').textContent).toBe('Berta Bass');

		cleanup();
		vi.unstubAllGlobals();

		stubWire({ polyphony: polyphonyFixture(true) });
		utils = await renderRosterAs('admin');
		expect(rowNameSpan(utils.container, 'm2').textContent).toBe('Aaron Aardvark');
	});

	it('DETERMINISTIC switch race: a records read HELD across a collective switch settles into NOTHING — the new collective renders its own (toggle-off) profile names, and the stale real name never appears', async () => {
		let releaseRecords!: () => void;
		const gate = new Promise<void>((r) => (releaseRecords = r));
		const polyphony = polyphonyFixture(true);
		polyphony.recordsGate = gate;
		const otherChoir: DbWire = {
			dbEntityId: 'db-ent-2',
			members: [{ id: 'm-bob', person: 'person-b' }],
			profiles: { 'person-b': { name: 'Bob Bass', email: 'bob@x.com' } },
			toggle: false,
			records: [{ id: 'rec-b', person: 'person-b', name: 'Robert Real' }]
		};
		const fetchMock = stubWire({ polyphony, 'other-choir': otherChoir });

		const { container } = render(Page);
		setAuthedWithTwoCollectives();
		adminStore.set('admin');

		// The polyphony load reaches its records read and BLOCKS there.
		await waitFor(() =>
			expect(
				(fetchMock.mock.calls as Array<[unknown]>)
					.map((c) => String(c[0]))
					.some((u) => u.includes('/polyphony/') && u.includes('admin_member_record'))
			).toBe(true)
		);

		// Switch mid-flight. The other-choir load (toggle off, nothing held)
		// completes and renders.
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => expect(q(container, 'section-toggle-unassigned')).not.toBeNull());
		await fireEvent.click(q(container, 'section-toggle-unassigned')!);
		await waitFor(() => expect(q(container, 'roster-row-m-bob')).not.toBeNull());
		expect(rowNameSpan(container, 'm-bob').textContent).toBe('Bob Bass');

		// The stale polyphony settle lands now — and must write NOTHING.
		releaseRecords();
		await flush();
		await tick();
		expect(rowNameSpan(container, 'm-bob').textContent).toBe('Bob Bass');
		expect(q(container, 'roster-row-m2')).toBeNull();
		expect(container.textContent).not.toContain('Aaron Aardvark');
	});
});

// (*MVOX:Tallis* — #269 RED, route-level: real producer chain, wire-stubbed)
