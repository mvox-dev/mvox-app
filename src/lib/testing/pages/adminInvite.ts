// Invite page harness: the setup its specs had word for word.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { expect } from 'vitest';
import Page from '../../../routes/admin/invite/+page.svelte';
import { resetAppState } from '$lib/testing/appReset';
import {
	createInviteMock,
	resolveInviteParentMock,
	resolveParentMock
} from '$lib/testing/mocks/admin';
import { jwt, selectSampledb } from './admin';
import { q } from './dom';

export const MINTED_TOKEN = jwt({ db: 'sampledb', entityId: 'p1', iat: 1, exp: 4_102_444_800 });

export const EXPECTED_URL = () => `${window.location.origin}/invite/${MINTED_TOKEN}`;

const originalClipboardDesc = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

export function cleanupRestoreClipboard(): void {
	cleanup();
	if (originalClipboardDesc) {
		Object.defineProperty(navigator, 'clipboard', originalClipboardDesc);
	} else {
		Reflect.deleteProperty(navigator, 'clipboard');
	}
	resetAppState();
}

export async function renderDone(): Promise<{ container: HTMLElement }> {
	selectSampledb();
	resolveParentMock.mockResolvedValue('parent-1');
	resolveInviteParentMock.mockResolvedValue('org-1');
	createInviteMock.mockResolvedValue({
		personId: 'p1',
		memberId: 'm1',
		inviteToken: MINTED_TOKEN
	});
	const { container } = render(Page);
	await waitFor(() => {
		const submit = q<HTMLButtonElement>(container, 'invite-admin-submit');
		expect(submit && !submit.disabled).toBe(true);
	});
	await fireEvent.click(q(container, 'invite-admin-submit') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'invite-admin-result')).not.toBeNull();
	});
	return { container };
}

// (*MVOX:Josquin*)
