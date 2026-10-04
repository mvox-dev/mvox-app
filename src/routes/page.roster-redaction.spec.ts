// @vitest-environment happy-dom
// #357 — the record editor's five PII fields render through RedactedField on the real route:
// default-inert without the toggle, marked on every field, and a CSS overlay, never a mutation.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/roster/memberLifecycle', async () =>
	(await import('$lib/testing/mocks/roster')).memberLifecycleModule()
);
vi.mock('$lib/roster/memberRecord', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).memberRecordModule(importOriginal, { writes: true })
);
vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);
vi.mock('$lib/library/librarianStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/library')).readyLibrarianModule(importOriginal)
);
vi.mock('$lib/invite/inviteData', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).inviteWritesModule(importOriginal, { withdraw: false })
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
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
import { REDACT_ATTR, REDACT_TOGGLE_ATTR } from '$lib/redact/redact';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import {
	createMemberRecordMock,
	deactivateMemberMock,
	listDeactivateBlockersMock,
	listInactiveMembersMock,
	loadInactiveRosterMock,
	loadMemberRecordMock,
	loadRosterMock,
	reinstateMemberMock,
	updateMemberRecordMock
} from '$lib/testing/mocks/roster';
import { listMyProfilesMock } from '$lib/testing/mocks/session';
import { rosterTwo } from '$lib/testing/pages/rosterFixtures';
import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';

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
	resetAppState();
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

// happy-dom caches a selector result per element and returns it stale after the toggle flips,
// so each test evaluates each selector once, in one toggle state, on a fresh render.
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
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/roster/MemberRecordEditor.svelte'),
			'utf-8'
		);
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
