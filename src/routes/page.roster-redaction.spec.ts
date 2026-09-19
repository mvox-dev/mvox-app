// @vitest-environment happy-dom
//
// #357 RED — capture redaction ON THE REAL ROUTE: the admin roster record
// editor's five PII fields (real name, phone, email, birth date, id_code)
// render through the shared RedactedField component, so every one of them
// carries the capture-redaction marker — pinned at the ROUTE level so GREEN
// cannot satisfy the unit layer (RedactedField.spec.ts) without wiring the
// component into the actual page.
//
//   (1) DEFAULT-INERT — the load-bearing constraint. Without the
//       html[data-redacting] root toggle, marked fields render their values
//       exactly as before: every existing PII-value spec
//       (page.roster-record-editor, page.roster-real-names, the invite
//       suites) stays green BYTE-UNMODIFIED, and the explicit pin here
//       asserts values visible + zero overlay attr/selector effect.
//   (2) MARKER COVERAGE — each of the five editor fields sits inside a
//       [data-redact] wrapper on the real route, and the page SOURCE renders
//       them through <RedactedField> (component-level marker, #357's rule) —
//       not through five hand-marked inline <input>s, the seed-188
//       per-call-site anti-pattern.
//   (3) TOGGLE WIRING — with data-redacting set on <html>, every marked
//       wrapper matches the CSS rule's exact selector (pinned by literal
//       string in redact.spec.ts), and the DOM values are UNTOUCHED: the
//       mechanism is a CSS overlay, never a value mutation. jsdom/happy-dom
//       cannot screenshot — the PIXEL claim (hatch actually covers the value
//       in a capture, redacted-not-blank) rides the manual capture checklist
//       in the landing comment.
//
//   The invite-link row (#357's other listed surface) has NO rendered value
//   to mark since #360 made invite links copy-only — the composed URL never
//   enters the DOM (pinned in page.roster-invite-copy.spec.ts /
//   page.admin-invite.spec.ts, byte-unmodified). The reason is documented
//   beside the marker's definition and pinned in redact.spec.ts.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const {
	loadRosterMock,
	listSectionsMock,
	deactivateMemberMock,
	reinstateMemberMock,
	loadInactiveRosterMock,
	listInactiveMembersMock,
	listDeactivateBlockersMock,
	loadMemberRecordMock,
	createMemberRecordMock,
	updateMemberRecordMock,
	listMyProfilesMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	deactivateMemberMock: vi.fn(),
	reinstateMemberMock: vi.fn(),
	loadInactiveRosterMock: vi.fn(),
	listInactiveMembersMock: vi.fn(),
	listDeactivateBlockersMock: vi.fn(),
	loadMemberRecordMock: vi.fn(),
	createMemberRecordMock: vi.fn(),
	updateMemberRecordMock: vi.fn(),
	listMyProfilesMock: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRosterWithRealNames: loadRosterMock }));
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: deactivateMemberMock,
	reinstateMember: reinstateMemberMock,
	loadInactiveRoster: loadInactiveRosterMock,
	listInactiveMembers: listInactiveMembersMock,
	listDeactivateBlockers: listDeactivateBlockersMock
}));
vi.mock('$lib/roster/memberRecord', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/memberRecord')>()),
	loadMemberRecord: loadMemberRecordMock,
	createMemberRecord: createMemberRecordMock,
	updateMemberRecord: updateMemberRecordMock
}));
vi.mock('$lib/profile/profileData', async (importActual) => ({
	...(await importActual<typeof import('$lib/profile/profileData')>()),
	listMyProfiles: listMyProfilesMock
}));
vi.mock('$lib/library/librarianStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/library/librarianStore')>()),
	resolveMyLibraryId: vi.fn().mockResolvedValue('lib-1'),
	resolveLibrarian: vi.fn().mockResolvedValue({ state: 'ready', libraryId: 'lib-1' })
}));
vi.mock('$lib/invite/inviteData', async (importActual) => ({
	...(await importActual<typeof import('$lib/invite/inviteData')>()),
	createInvite: vi.fn(),
	mintSelfLinkInvite: vi.fn()
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import { REDACT_ATTR, REDACT_TOGGLE_ATTR } from '$lib/redact/redact';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import type { RosterRow } from '$lib/roster/rosterData';
import { toListRead } from '$lib/testing/listReadFixtures';

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

const rosterTwo: RosterRow[] = [
	{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com', sectionIds: [], dbEntityId: 'db-1' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [], dbEntityId: 'db-1' }
];

// The full-record fixture: every one of the five PII values present, so the
// default-inert pin can assert each renders VERBATIM without the toggle.
const fullRecord = {
	state: 'one' as const,
	record: {
		_id: 'rec-1',
		name: 'Recorded Name',
		phone: '+372 5550000',
		email: 'berta@example.com',
		birthdate: '1985-11-02',
		id_code: '48511020000'
	}
};

// The five PII field testids — IDENTICAL to the pre-extraction inline markup
// (page.roster-record-editor.spec.ts locates them by these exact strings,
// byte-unmodified; a testid drift breaks that suite, not just this one).
const PII_FIELD_TESTIDS = [
	'roster-record-name',
	'roster-record-phone',
	'roster-record-email',
	'roster-record-birthdate',
	'roster-record-id-code'
] as const;

const EXPECTED_VALUES: Record<(typeof PII_FIELD_TESTIDS)[number], string> = {
	'roster-record-name': 'Recorded Name',
	'roster-record-phone': '+372 5550000',
	'roster-record-email': 'berta@example.com',
	'roster-record-birthdate': '1985-11-02',
	'roster-record-id-code': '48511020000'
};

const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`);
const field = (c: HTMLElement, id: string) => {
	const el = q(c, id) as HTMLInputElement | null;
	expect(el, `${id} must render in the open editor`).not.toBeNull();
	return el!;
};

beforeEach(() => {
	loadRosterMock.mockResolvedValue(toListRead(rosterTwo));
	listSectionsMock.mockResolvedValue([]);
	listDeactivateBlockersMock.mockResolvedValue([]);
	deactivateMemberMock.mockResolvedValue(undefined);
	reinstateMemberMock.mockResolvedValue(undefined);
	loadInactiveRosterMock.mockResolvedValue(toListRead([]));
	listInactiveMembersMock.mockResolvedValue(toListRead([]));
	loadMemberRecordMock.mockResolvedValue(fullRecord);
	createMemberRecordMock.mockResolvedValue('rec-new');
	updateMemberRecordMock.mockResolvedValue(undefined);
	listMyProfilesMock.mockResolvedValue([]);
});

afterEach(() => {
	cleanup();
	document.documentElement.removeAttribute(REDACT_TOGGLE_ATTR);
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
});

async function renderRosterAsAdmin() {
	const utils = render(Page);
	setAuthedWithOneCollective();
	adminStore.set('admin');
	await waitFor(() => expect(q(utils.container, 'section-toggle-unassigned')).not.toBeNull());
	await fireEvent.click(q(utils.container, 'section-toggle-unassigned')!);
	await waitFor(() => expect(q(utils.container, 'roster-row-m2')).not.toBeNull());
	return utils;
}

async function openEditor(container: HTMLElement, memberId: string) {
	const card = q(container, `roster-row-card-${memberId}`);
	expect(card, `#302 collapsed-card activator roster-row-card-${memberId} must render`).not.toBeNull();
	await fireEvent.click(card!);
	await waitFor(() => {
		const li = q(container, `roster-row-${memberId}`)!;
		expect(li.querySelector('[data-testid="roster-record-name"]')).not.toBeNull();
	});
}

// INSTRUMENT NOTE (probed 2026-09-15): happy-dom caches selector evaluations
// per element+selector — a matches()/querySelector() result computed under
// one toggle state is returned STALE after the state flips. So each test
// evaluates each selector against each element AT MOST ONCE, in a single
// toggle state, on a fresh render; off-state and on-state live in SEPARATE
// tests, never as a toggle round-trip on one element.
describe('(1) DEFAULT-INERT — without the root toggle, marked fields render values NORMALLY (the constraint that keeps every existing PII-value spec green byte-unmodified)', () => {
	it('all five PII values render verbatim; <html> carries no toggle; no field matches the redaction selector', async () => {
		const { container } = await renderRosterAsAdmin();
		await openEditor(container, 'm2');
		expect(document.documentElement.hasAttribute(REDACT_TOGGLE_ATTR)).toBe(false);
		for (const id of PII_FIELD_TESTIDS) {
			expect(field(container, id).value, `${id} value visible without the toggle`).toBe(
				EXPECTED_VALUES[id]
			);
			expect(
				field(container, id)
					.closest(`[${REDACT_ATTR}]`)!
					.matches(`html[${REDACT_TOGGLE_ATTR}] [${REDACT_ATTR}]`),
				`${id}: the pinned CSS selector must match NOTHING in default rendering`
			).toBe(false);
		}
	});
});

describe('(2) marker coverage — every mapped PII surface carries the marker on the REAL route, at the component level', () => {
	it(`each of the five editor fields sits inside a [${REDACT_ATTR}] wrapper`, async () => {
		const { container } = await renderRosterAsAdmin();
		await openEditor(container, 'm2');
		for (const id of PII_FIELD_TESTIDS) {
			expect(
				field(container, id).closest(`[${REDACT_ATTR}]`),
				`${id} must render inside a capture-redaction marker`
			).not.toBeNull();
		}
	});

	it('the page SOURCE renders the five fields through <RedactedField> — component-level marker, never five hand-marked inline inputs (the seed-188 anti-pattern #357 names)', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/routes/roster/+page.svelte'), 'utf-8');
		expect(source, 'imports the shared component').toContain(
			"$lib/components/RedactedField.svelte"
		);
		const usages = source.match(/<RedactedField/g) ?? [];
		expect(usages.length, 'all five PII fields go through the component').toBeGreaterThanOrEqual(5);
		for (const id of PII_FIELD_TESTIDS) {
			expect(source, `${id} still authored at the call site (as the component's testid prop)`).toContain(id);
			expect(
				source,
				`${id} must NOT remain a raw inline <input> — the marker lives on the component`
			).not.toMatch(new RegExp(`<input[^>]*data-testid="${id}"`));
		}
	});
});

describe('(3) toggle wiring — html[data-redacting] engages the pinned selector; the DOM value never mutates (jsdom cannot screenshot: the pixel claim rides the manual capture checklist)', () => {
	it('with the toggle set, every marked wrapper matches the exact CSS selector — and every DOM value stays untouched (disengagement is pinned by the default-inert test on its own fresh render)', async () => {
		document.documentElement.setAttribute(REDACT_TOGGLE_ATTR, '');
		const { container } = await renderRosterAsAdmin();
		await openEditor(container, 'm2');
		for (const id of PII_FIELD_TESTIDS) {
			const wrapper = field(container, id).closest(`[${REDACT_ATTR}]`)!;
			expect(
				wrapper.matches(`html[${REDACT_TOGGLE_ATTR}] [${REDACT_ATTR}]`),
				`${id} wrapper engages under the root toggle`
			).toBe(true);
			// Redaction is a CSS overlay: the value stays in the DOM untouched
			// (mutating it would corrupt bind:value and the save round-trip).
			expect(field(container, id).value).toBe(EXPECTED_VALUES[id]);
		}
	});
});
