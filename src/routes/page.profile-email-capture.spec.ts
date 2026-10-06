// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { textNodesContaining, markerOf } from '$lib/testing/nameMarker';
import { REDACT_ATTR, REDACT_TOGGLE_ATTR, withRedaction } from '$lib/redact/redact';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);
vi.mock('$lib/profile/applyProfileSave', async () =>
	(await import('$lib/testing/mocks/profile')).applyProfileSaveModule('shared')
);
vi.mock('$lib/profile/fieldMove', async (importOriginal) =>
	(await import('$lib/testing/mocks/profile')).fieldMoveModule(importOriginal)
);
const linked = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('$lib/profile/linkedIdentities', () => ({ listLinkedIdentities: linked.list }));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './profile/+page.svelte';
import { listMyProfilesMock } from '$lib/testing/mocks/session';
import { clearAll, setUser } from '$lib/auth/storage';
import {
	realTimersCleanupResetGate,
	resetSaveMocks,
	selectSampledb
} from '$lib/testing/pages/profile';

const PROFILE_EMAIL = 'ada@x.io';
const SIGNED_IN_EMAIL = 'signed@x.io';
const LINKED_EMAIL = 'linked@x.io';
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);

async function renderSeeded(): Promise<HTMLElement> {
	selectSampledb();
	setUser({ _id: 'u1', email: SIGNED_IN_EMAIL, name: 'Ada' });
	listMyProfilesMock.mockResolvedValue([
		{ _id: 'prof-dom', name: 'Ada', email: PROFILE_EMAIL, _sharing: 'domain' }
	]);
	const { container } = render(Page);
	await waitFor(() =>
		expect(q(container, '[data-testid="profile-linked-identity-eu-1"]')).not.toBeNull()
	);
	return container;
}

/** Every email under `root` (text or input value), and those that sit outside a marker. */
function sweep(root: Element): { found: string[]; unmarked: string[] } {
	const found = new Set<string>();
	const unmarked: string[] = [];
	const where = (el: Element | null) =>
		el?.closest('[data-testid]')?.getAttribute('data-testid') ?? el?.tagName ?? '?';
	for (const node of textNodesContaining(root, '@')) {
		for (const email of node.textContent?.match(EMAIL) ?? []) {
			found.add(email);
			if (!markerOf(node)) unmarked.push(`${email} @ ${where(node.parentElement)}`);
		}
	}
	for (const el of root.querySelectorAll('input')) {
		for (const email of el.value.match(EMAIL) ?? []) {
			found.add(email);
			if (!el.closest(`[${REDACT_ATTR}]`)) unmarked.push(`${email} @ input ${where(el)}`);
		}
	}
	return { found: [...found].sort(), unmarked };
}

beforeEach(() => {
	resetSaveMocks();
	linked.list.mockReset().mockResolvedValue({
		identities: [{ _id: 'eu-1', uid: 'uid-g-1', provider: 'google', email: LINKED_EMAIL }],
		pendingInvites: 0
	});
});

afterEach(() => {
	realTimersCleanupResetGate();
	clearAll({ preserveProvider: false });
});

describe('#618 — /profile: no unmarked email in a capture', () => {
	it.each([
		['shown', false],
		['being edited', true]
	] as const)('with redaction engaged and the profile email %s, every email on the page is marked', async (_label, edit) => {
		const container = await renderSeeded();
		if (edit) {
			await fireEvent.click(q(container, '[data-testid="profile-email-edit"]') as HTMLElement);
			await waitFor(() => expect(q(container, '[data-testid="profile-email"]')).not.toBeNull());
		}
		const result = await withRedaction(async () => {
			expect(document.documentElement.hasAttribute(REDACT_TOGGLE_ATTR)).toBe(true);
			return sweep(document.body);
		});
		expect(result.found).toEqual([LINKED_EMAIL, PROFILE_EMAIL, SIGNED_IN_EMAIL].sort());
		expect(result.unmarked).toEqual([]);
	});
});

// (*MVOX:Josquin* — #618 RED: every email on /profile marked in a capture)
