// @vitest-environment happy-dom
// #756: the event page reports its own answer read and its work-rows read when they fail.
import 'fake-indexeddb/auto';
import { render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

beforeEach(editorTokenAtNow);

vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);
vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './+page.svelte';
import { cleanupRealTimersResetTypes, editorTokenAtNow } from '$lib/testing/pages/event';
import { RIGHTS_URL, SELF_EDITOR, seasonEntity, setAuthed } from '$lib/testing/pages/eventRsvp';
import { bareEventEntity } from '$lib/testing/pages/eventFixtures';
import { reportProblem } from '$lib/testing/mocks/session';

function renderPage(failing: string, event: Record<string, unknown> = {}) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes(failing)) return json({}, 500);
			if (url === RIGHTS_URL) return json({ entity: SELF_EDITOR });
			if (url.includes('/entity/ev1')) return json({ entity: { ...bareEventEntity(), ...event } });
			if (url.includes('/entity/season1')) return json({ entity: seasonEntity() });
			return json({ entities: [] });
		})
	);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed();
	return render(Page);
}

beforeEach(() => reportProblem.mockReset());
afterEach(cleanupRealTimersResetTypes);

describe('/event/[id] reports a failed read (#756)', () => {
	it.each([
		{
			read: 'your answer',
			failing: 'rsvp&_parent.reference=p-viewer&event.reference=ev1',
			area: 'event',
			action: 'loading your answer'
		},
		{
			read: 'the work rows',
			failing: '_type.string=program_item',
			area: 'event',
			action: 'loading the work rows'
		},
		{ read: 'the schedule', failing: '_type.string=schedule_item', action: 'loading the schedule' },
		{
			read: 'the answer tally',
			failing: '_type.string=rsvp&event.reference=ev1',
			action: 'loading the answer tally'
		},
		{
			read: 'the attendance',
			failing: '_type.string=attendance&_parent.reference=ev1',
			event: { start_datetime: [{ datetime: '2026-08-01T16:00:00.000Z' }] },
			action: 'loading the attendance'
		},
		{
			read: 'the series options',
			failing: '_type.string=event_series',
			event: { _editor: [{ reference: 'p-viewer' }] },
			action: 'loading the series options'
		}
	] as Array<{ read: string; failing: string; event?: object; area?: string; action: string }>)(
		'a failed read of $read is reported',
		async ({ failing, event, area = 'event', action }) => {
			renderPage(failing, event as Record<string, unknown>);
			await waitFor(() => {
				expect(reportProblem.mock.calls).toEqual([[{ area, action, error: expect.any(Error) }]]);
			});
		}
	);
});
