// @vitest-environment happy-dom
import { fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/adminCopy')).adminMessages({
		admin_invite_copy: () => '[admin_invite_copy]',
		admin_invite_copied: () => '[admin_invite_copied]',
		admin_invite_copy_error: () => '[admin_invite_copy_error]',
		admin_invite_create_another: () => '[admin_invite_create_another]'
	})
);

const h = vi.hoisted(() => {
	return {
		createCopierSpy: vi.fn()
	};
});
vi.mock('$lib/invite/inviteData', async () =>
	(await import('$lib/testing/mocks/admin')).inviteDataModule({ errors: true })
);
vi.mock('$lib/invite/copy-invite-link', async (importActual) => {
	const actual = await importActual<typeof import('$lib/invite/copy-invite-link')>();
	h.createCopierSpy.mockImplementation(actual.createInviteLinkCopier);
	return { ...actual, createInviteLinkCopier: h.createCopierSpy };
});
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './admin/invite/+page.svelte';
import {
	createInviteMock,
	resolveInviteParentMock,
	resolveParentMock
} from '$lib/testing/mocks/admin';
import { EXPECTED_URL, cleanupRestoreClipboard, renderDone } from '$lib/testing/pages/adminInvite';
import { q } from '$lib/testing/pages/dom';

function installWriteText(): ReturnType<typeof vi.fn> {
	const writeText = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, 'clipboard', {
		value: { writeText },
		configurable: true,
		writable: true
	});
	return writeText;
}

beforeEach(() => {
	resolveParentMock.mockReset();
	resolveInviteParentMock.mockReset();
	createInviteMock.mockReset();
	h.createCopierSpy.mockClear();
});

afterEach(cleanupRestoreClipboard);

describe('#346/#360 InviteSurface rides the shared copy module', () => {
	it('a BUTTON-click copy runs through createInviteLinkCopier, and its getText yields the surface\'s own inviteLink', async () => {
		const { container } = await renderDone();
		const writeText = installWriteText();

		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		expect(writeText).toHaveBeenCalledWith(EXPECTED_URL());

		expect(h.createCopierSpy).toHaveBeenCalled();
		const getText = h.createCopierSpy.mock.calls[0][0] as () => string;
		expect(getText()).toBe(EXPECTED_URL());
	});
});

// (*MVOX:Tallis* — #346 RED: the extract's wiring pin — InviteSurface's copy
