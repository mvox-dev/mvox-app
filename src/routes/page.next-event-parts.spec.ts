// @vitest-environment happy-dom
// #945: the next event's card says how many of its parts are on this device, with Download all.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock,
	listFullAgenda: listFullAgendaMock
}));
const { loadFullAgendaMock, listFullAgendaMock } = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	listFullAgendaMock: vi.fn()
}));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).repertoireActionsModule(await importOriginal())
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule({ afterNavigate: vi.fn() })
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleStubs')).rsvpDataModule()
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule({ lists: 'bare' })
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).worksModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', async () =>
	(await import('$lib/testing/mocks/files')).appLabelStoreModule()
);

import Page from './+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { resetRetentionForTests } from '$lib/files/retention';
import { resetAppState } from '$lib/testing/appReset';
import { loadWorksByEventIdMock } from '$lib/testing/moduleHandles';
import { signFileUrlMock } from '$lib/testing/mocks/files';
import { agendaEvent, setAuthedWithTwoCollectives } from '$lib/testing/pages/agendaWorks';
import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import { goOffline, goOnline } from '$lib/testing/networkSignal';
import { pdfData } from '$lib/testing/pages/event';

let fakeByteStore: FakeByteStore;
const P = { db: 'sampledb', personId: 'person-p' };

const soon = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
const event = (id: string, days: number, eventType: string) => ({
	...agendaEvent(id, `Event ${id}`),
	startDatetime: soon(days),
	eventType
});

function row(fileId: string) {
	return {
		id: `ri-${fileId}`,
		kind: 'repertoire' as const,
		workId: 'work-1',
		editionId: 'ed-1',
		workName: 'Spem in alium',
		composer: 'Thomas Tallis',
		status: 'active' as const,
		editionName: '',
		ordinal: null,
		fileId,
		externalLinks: [],
		canBorrow: false,
		notes: ''
	};
}

// Signing answers per file; 'fail' throws, a promise waits for the test.
let signing: Record<string, 'ok' | 'fail' | Promise<void>> = {};
let fetchBehaviour: 'ok' | 'throw' | 'too-large' = 'ok';

function agendaFor(db: string) {
	return db === 'crede'
		? fullAgendaResult({ upcoming: [event('ev-c1', 2, 'rehearsal')], seasonId: 'season-c' })
		: fullAgendaResult({
				upcoming: [event('ev-1', 2, 'rehearsal'), event('ev-2', 9, 'concert')],
				seasonId: 'season-1'
			});
}

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	resetRetentionForTests();
	signing = {};
	fetchBehaviour = 'ok';
	loadFullAgendaMock.mockImplementation(async () => agendaFor(get(selectedCollectiveDbStore) ?? ''));
	listFullAgendaMock.mockImplementation(async (cfg: { db: string }) => agendaFor(cfg.db));
	loadWorksByEventIdMock.mockImplementation(async (cfg: { db: string }) =>
		cfg.db === 'crede'
			? { 'ev-c1': [row('file-c1')] }
			: { 'ev-1': [row('file-a1'), row('file-a2')], 'ev-2': [row('file-b1')] }
	);
	signFileUrlMock.mockImplementation(async (_cfg: unknown, fileId: string) => {
		const how = signing[fileId] ?? 'fail';
		if (how === 'fail') throw new Error(`sign ${fileId}: 403`);
		if (how !== 'ok') await how;
		return `https://s3.example/signed-${fileId}`;
	});
	vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
		const url = String(input);
		if (!url.startsWith('https://s3.example/'))
			return new Response(JSON.stringify({ entities: [] }), { status: 200 });
		if (fetchBehaviour === 'throw') throw new TypeError('Failed to fetch');
		const headers: Record<string, string> = { 'content-type': 'application/pdf' };
		if (fetchBehaviour === 'too-large') headers['content-length'] = String(300 * 1024 * 1024);
		return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers });
	});
});

afterEach(async () => {
	cleanup();
	await goOnline();
	loadFullAgendaMock.mockReset();
	listFullAgendaMock.mockReset();
	loadWorksByEventIdMock.mockReset();
	signFileUrlMock.mockReset();
	vi.unstubAllGlobals();
	resetAppState();
});

const byId = (root: ParentNode, id: string) => root.querySelector(`[data-testid="${id}"]`);
const count = (held: number, total: number) =>
	`[agenda_parts_on_device ${JSON.stringify({ held, total })}]`;

async function partsLine(container: HTMLElement, eventId: string, held: number, total: number) {
	await vi.waitFor(() => {
		expect(byId(container, `agenda-next-parts-${eventId}`)?.textContent).toContain(
			count(held, total)
		);
	});
	return byId(container, `agenda-next-parts-${eventId}`) as HTMLElement;
}

function downloadButton(line: HTMLElement) {
	return line.querySelector<HTMLButtonElement>('button');
}

describe('#945 — the next event shows how many of its parts are on this device', () => {
	it("the line sits on the next event's card only, counting the parts held", async () => {
		fakeByteStore.seed(P, 'file-a1', pdfData());
		setAuthedWithOneCollective();
		const { container } = render(Page);

		const line = await partsLine(container, 'ev-1', 1, 2);
		expect(byId(container, 'agenda-row-ev-1')?.contains(line)).toBe(true);
		expect(byId(container, 'agenda-row-ev-2')).not.toBeNull();
		expect(byId(container, 'agenda-next-parts-ev-2')).toBeNull();
		expect(downloadButton(line)?.textContent).toContain('[agenda_parts_download_all]');
	});

	it('an event with no parts gets no line', async () => {
		loadWorksByEventIdMock.mockImplementation(async () => ({ 'ev-1': [row('')] }));
		const heldSpy = vi.spyOn(fakeByteStore, 'heldFileIds');
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await vi.waitFor(() => expect(heldSpy).toHaveBeenCalled());
		await vi.waitFor(() => expect(byId(container, 'agenda-row-ev-1')).not.toBeNull());
		await new Promise((r) => setTimeout(r, 0));
		expect(byId(container, 'agenda-next-parts-ev-1')).toBeNull();
	});

	it('with every part held the line stays and there is no button', async () => {
		fakeByteStore.seed(P, 'file-a1', pdfData());
		fakeByteStore.seed(P, 'file-a2', pdfData());
		setAuthedWithOneCollective();
		const { container } = render(Page);

		const line = await partsLine(container, 'ev-1', 2, 2);
		expect(downloadButton(line)).toBeNull();
	});

	it('a filter that hides the next event leaves the line off the first visible card', async () => {
		fakeByteStore.seed(P, 'file-b1', pdfData());
		setAuthedWithOneCollective();
		const { container } = render(Page);
		await partsLine(container, 'ev-1', 0, 2);

		await fireEvent.click(byId(container, 'agenda-filter-concert') as HTMLElement);

		await vi.waitFor(() => expect(byId(container, 'agenda-row-ev-1')).toBeNull());
		expect(byId(container, 'agenda-row-ev-2')).not.toBeNull();
		expect(byId(container, 'agenda-next-parts-ev-2')).toBeNull();
	});
});

describe('#945 — Download all', () => {
	it('saves the missing parts, the count updates and the button goes', async () => {
		fakeByteStore.seed(P, 'file-a1', pdfData());
		setAuthedWithOneCollective();
		const { container } = render(Page);
		const line = await partsLine(container, 'ev-1', 1, 2);
		signing['file-a2'] = 'ok';

		await fireEvent.click(downloadButton(line)!);

		const after = await partsLine(container, 'ev-1', 2, 2);
		expect(fakeByteStore.heldFor(P.db, P.personId).sort()).toEqual(['file-a1', 'file-a2']);
		expect(downloadButton(after)).toBeNull();
		expect(byId(container, 'agenda-next-parts-failure')).toBeNull();
	});

	it('the button is disabled while the run goes on', async () => {
		setAuthedWithOneCollective();
		const { container } = render(Page);
		const line = await partsLine(container, 'ev-1', 0, 2);
		let release!: () => void;
		signing['file-a1'] = new Promise<void>((r) => (release = r));
		signing['file-a2'] = 'ok';

		await fireEvent.click(downloadButton(line)!);

		await vi.waitFor(() => expect(downloadButton(line)?.disabled).toBe(true));
		release();
		await partsLine(container, 'ev-1', 2, 2);
	});

	it.each([
		['a full device', 'agenda_parts_storage_full', 'quota'],
		['a part over the cap', 'agenda_parts_too_large', 'too-large'],
		['a download that does not start', 'agenda_parts_no_connection', 'fetch-throws'],
		['a failed part while offline', 'agenda_parts_no_connection', 'offline'],
		['a failed part while online', 'agenda_parts_download_failed', 'sign-fails']
	])('%s says why under the button', async (_name, key, cause) => {
		setAuthedWithOneCollective();
		const { container } = render(Page);
		const line = await partsLine(container, 'ev-1', 0, 2);
		if (cause !== 'sign-fails' && cause !== 'offline') signing = { 'file-a1': 'ok', 'file-a2': 'ok' };
		if (cause === 'quota')
			fakeByteStore.put = async () => {
				throw Object.assign(new Error('the quota is used up'), { name: 'QuotaExceededError' });
			};
		if (cause === 'too-large') fetchBehaviour = 'too-large';
		if (cause === 'fetch-throws') fetchBehaviour = 'throw';
		if (cause === 'offline') await goOffline();

		await fireEvent.click(downloadButton(line)!);

		await vi.waitFor(() => {
			expect(byId(container, 'agenda-next-parts-failure')?.textContent).toContain(`[${key}]`);
		});
		expect(byId(container, 'agenda-next-parts-failure')?.textContent?.match(/\[agenda_parts_/g)).toHaveLength(1);
		expect(downloadButton(line)?.disabled).toBe(false);
	});

	it('the message clears when the next run starts', async () => {
		setAuthedWithOneCollective();
		const { container } = render(Page);
		const line = await partsLine(container, 'ev-1', 0, 2);
		await fireEvent.click(downloadButton(line)!);
		await vi.waitFor(() => expect(byId(container, 'agenda-next-parts-failure')).not.toBeNull());
		let release!: () => void;
		signing['file-a1'] = new Promise<void>((r) => (release = r));

		await fireEvent.click(downloadButton(line)!);

		await vi.waitFor(() => expect(byId(container, 'agenda-next-parts-failure')).toBeNull());
		release();
	});

	it('a collective switch mid-run drops the run: no message, and the count is the new collective', async () => {
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		const line = await partsLine(container, 'ev-1', 0, 2);
		let release!: () => void;
		signing['file-a1'] = new Promise<void>((r) => (release = r));

		await fireEvent.click(downloadButton(line)!);
		await vi.waitFor(() => expect(signFileUrlMock.mock.calls.length).toBeGreaterThan(2));
		selectedCollectiveDbStore.set('crede');
		await partsLine(container, 'ev-c1', 0, 1);
		release();
		await new Promise((r) => setTimeout(r, 0));

		expect(byId(container, 'agenda-next-parts-failure')).toBeNull();
		expect(byId(container, 'agenda-next-parts-ev-c1')?.textContent).toContain(count(0, 1));
		expect(byId(container, 'agenda-next-parts-ev-1')).toBeNull();
	});
});

// (*MVOX:Josquin*)
