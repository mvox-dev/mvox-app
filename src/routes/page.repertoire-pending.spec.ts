// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
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
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleStubs')).rsvpDataModule()
);
vi.mock('$lib/roster/rosterData', () => ({
	loadRoster: vi.fn(async () => ({ items: [], total: 0, truncated: false }))
}));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn(),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));

import Page from './+page.svelte';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock } from '$lib/testing/routeMocks';
import { loadFullAgendaMock } from '$lib/testing/moduleHandles';

type EntityRaw = Record<string, unknown>;

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

function repertoireItem(id: string, name: string, workId: string): EntityRaw {
	return {
		_id: id,
		name: [{ string: name }],
		work: [{ reference: workId }],
		status: [{ string: 'active' }]
	};
}

function programItem(id: string, name: string, editionId: string, ordinal: number): EntityRaw {
	return {
		_id: id,
		name: [{ string: name }],
		edition: [{ reference: editionId }],
		ordinal: [{ number: ordinal }]
	};
}

interface DbWorld {
	repertoireItems: EntityRaw[];
	programItems: EntityRaw[];
}

interface WorldOptions {
	dbs: Record<string, DbWorld>;
	failWrites?: () => boolean;
	gate?: (url: string, method: string) => Promise<void> | undefined;
}

function installWorld(options: WorldOptions) {
	const failWrites = options.failWrites ?? (() => false);
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [
				{
					id: 'ev-1',
					name: 'Rehearsal',
					startDatetime: future,
					durationMinutes: 90,
					location: '',
					conductors: [],
					owners: [],
					editors: ['person-p']
				}
			],
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: ['person-p']
		})
	);

	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const db = url.match(/entu-test\.invalid\/([^/]+)\//)?.[1] ?? '';
		const world = options.dbs[db] ?? { repertoireItems: [], programItems: [] };
		if (method !== 'GET') await options.gate?.(url, method);

		if (method === 'DELETE') {
			if (failWrites()) return json({ error: 'nope' }, 500);
			const id = url.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			world.repertoireItems = world.repertoireItems.filter((e) => e._id !== id);
			world.programItems = world.programItems.filter((e) => e._id !== id);
			return json({ deleted: true });
		}
		if (method === 'POST' && /\/entity(\?|$)/.test(url)) {
			if (failWrites()) return json({ error: 'nope' }, 500);
			const props = JSON.parse(String(init?.body ?? '[]')) as Array<Record<string, unknown>>;
			const editionId = String(props.find((p) => p.type === 'edition')?.reference ?? '');
			const ordinal = Number(props.find((p) => p.type === 'ordinal')?.number ?? 0);
			world.programItems = [...world.programItems, programItem('pi-new', 'pi-new', editionId, ordinal)];
			return json({ _id: 'pi-new' });
		}
		if (method === 'POST') {
			if (failWrites()) return json({ error: 'nope' }, 500);
			return json({ _id: 'ok' });
		}

		if (url.includes('?props=')) {
			const itemId = url.split('/').pop()?.split('?')[0];
			return json({ entity: { ordinal: [{ _id: `val-${itemId}` }], status: [{ _id: 'val-s' }] } });
		}
		if (url.includes('_type.string=entity')) return json({ entities: [{ _id: 'type-1' }] });
		if (url.includes('_type.string=work')) {
			return json({
				entities: [
					{ _id: 'work-1', name: [{ string: 'Spem in alium' }] },
					{ _id: 'work-2', name: [{ string: 'Nunc dimittis' }] },
					{ _id: 'work-3', name: [{ string: 'Locus iste' }] }
				]
			});
		}
		if (url.includes('_type.string=edition')) {
			return json({
				entities: [1, 2, 3].map((n) => ({
					_id: `ed-${n}`,
					name: [{ string: `ed-${n}` }],
					_parent: [{ reference: `work-${n}`, entity_type: 'work' }]
				}))
			});
		}
		if (url.includes('_type.string=copy')) return json({ entities: [] });
		if (url.includes('_type.string=program_item')) return json({ entities: world.programItems });
		if (url.includes('_type.string=repertoire_item')) return json({ entities: world.repertoireItems });
		return json({ entities: [] });
	});

	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function setAuthed() {
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'crede', name: 'Crede', personId: 'person-p' }
		]
	});
}

function gateOn(method: string, fragment: string, promise: Promise<void>) {
	return (url: string, m: string) => (m === method && url.includes(fragment) ? promise : undefined);
}

function qa(scope: ParentNode, testid: string): HTMLElement[] {
	return Array.from(scope.querySelectorAll(`[data-testid="${testid}"]`));
}

function names(container: HTMLElement): Array<string | undefined> {
	return qa(container, 'work-name').map((el) => el.textContent?.trim());
}

async function expandWorks(container: HTMLElement, rowCount: number): Promise<void> {
	await waitFor(() => {
		expect(qa(container, 'works-line').length).toBe(1);
	});
	if (qa(container, 'work-row').length === 0) await fireEvent.click(qa(container, 'works-line')[0]);
	await waitFor(() => {
		expect(qa(container, 'work-row').length).toBe(rowCount);
	});
}

beforeEach(() => {
	resetTypeIdCache();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	resetAppState();
});

describe('#551 — agenda: a move or remove keeps pending until it settles', () => {
	it('a works read landing mid-move keeps the moved order and still shows the added row', async () => {
		const gate = deferred();
		installWorld({
			dbs: {
				sampledb: {
					repertoireItems: [],
					programItems: [programItem('pi-a', 'First', 'ed-1', 0), programItem('pi-b', 'Second', 'ed-2', 1)]
				}
			},
			gate: gateOn('POST', '/entity/pi-', gate.promise)
		});
		setAuthed();
		const { container } = render(Page);
		await expandWorks(container, 2);

		await fireEvent.click(qa(container, 'work-manage-move-up')[1]);
		expect(names(container)).toEqual(['Nunc dimittis', 'Spem in alium']);

		await fireEvent.change(qa(container, 'work-manage-add-programme-select')[0], {
			target: { value: 'ed-3' }
		});
		await fireEvent.click(qa(container, 'work-manage-add-programme-button')[0]);

		await waitFor(() => {
			expect(names(container)).toEqual(['Nunc dimittis', 'Spem in alium', 'Locus iste']);
		});
		gate.resolve();
	});

	it('a remove rejected after a collective switch leaves the new collective’s works alone', async () => {
		const gate = deferred();
		installWorld({
			dbs: {
				sampledb: { repertoireItems: [repertoireItem('ri-1', 'Spem in alium', 'work-1')], programItems: [] },
				crede: { repertoireItems: [repertoireItem('cri-1', 'Nunc dimittis', 'work-2')], programItems: [] }
			},
			failWrites: () => true,
			gate: gateOn('DELETE', '/entity/ri-1', gate.promise)
		});
		setAuthed();
		const { container } = render(Page);
		await expandWorks(container, 1);

		await fireEvent.click(qa(container, 'work-manage-remove')[0]);
		await waitFor(() => {
			expect(qa(container, 'work-row').length).toBe(0);
		});

		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		await expandWorks(container, 1);
		expect(names(container)).toEqual(['Nunc dimittis']);

		gate.resolve();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(names(container)).toEqual(['Nunc dimittis']);
		expect(qa(container, 'repertoire-manage-error')).toEqual([]);
	});
});

describe('#605 — agenda: a settled repertoire change says saved', () => {
	it('the card carries a polite status region that reads saved once a status change settles', async () => {
		installWorld({
			dbs: {
				sampledb: { repertoireItems: [repertoireItem('ri-1', 'Spem in alium', 'work-1')], programItems: [] }
			}
		});
		setAuthed();
		const { container } = render(Page);
		await expandWorks(container, 1);

		const status = () => qa(container, 'repertoire-manage-status');
		expect(status().map((el) => [el.getAttribute('role'), el.getAttribute('aria-live')])).toEqual([
			['status', 'polite']
		]);
		expect(status()[0].textContent?.trim()).toBe('');

		await fireEvent.click(qa(container, 'work-status-retired')[0]);
		await waitFor(() => {
			expect(status()[0].textContent?.trim()).toBe('[repertoire_manage_saved]');
		});
		expect(qa(container, 'repertoire-manage-error')).toEqual([]);
	});
});
