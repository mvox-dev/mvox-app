// @vitest-environment happy-dom
// #1049: the roster names toggle has no state the page can reach without a setting entity,
// so a change there is fired by hand: the error it shows keeps a report too.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import RosterNamesToggle from './RosterNamesToggle.svelte';
import { dbEditRight, resetDbEditRight } from '$lib/nav/dbRights';
import { resetAppState } from '$lib/testing/appReset';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import { q } from '$lib/testing/pages/dom';
import { signIn } from '$lib/testing/session';

useKeptProblems();

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	signIn({ selected: 'sampledb' });
	dbEditRight.set('editor');
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	resetDbEditRight();
	resetAppState();
});

describe('RosterNamesToggle — a change with no setting entity known (#1049)', () => {
	it('shows its error and keeps one report with the reason', async () => {
		const update = vi.fn();
		const { container } = render(RosterNamesToggle, {
			isOffline: false,
			generation: () => 1,
			activeContext: () => ({ cfg: { db: 'sampledb', token: 'jwt' }, personId: 'person-p' }),
			updateRosterShowRealNames: update
		});

		await fireEvent.change(q(container, 'profile-roster-names') as HTMLElement, { target: { value: 'real' } });

		await waitFor(() => expect(q(container, 'profile-roster-names-error')).not.toBeNull());
		await waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{
					area: 'profile',
					action: 'saving the roster names setting',
					detail: 'no roster names setting entity is known for this collective'
				}
			])
		);
		expect(update).not.toHaveBeenCalled();
	});
});

// (*MVOX:Josquin*)
