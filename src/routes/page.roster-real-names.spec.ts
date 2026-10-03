// @vitest-environment happy-dom
// The roster shows real names when the admin setting says so, end to end.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { json } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

interface DbWire {
	dbEntityId: string;
	members: Array<{ id: string; person: string }>;
	archived?: Array<{ id: string; person: string }>;
	profiles: Record<string, { name: string; email?: string }>;
	toggle: boolean | 'absent';
	records: Array<{ id: string; person?: string; name?: string }>;
	recordsGate?: Promise<void>;
	bulkRecordsFailFrom?: number;
	lookupRecords?: Array<{ id: string; person?: string; name?: string }>;
	viewerPersonId?: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

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
		],
		_owner: fx.viewerPersonId ? [{ reference: fx.viewerPersonId }] : []
	};
}

function stubWire(byDb: Record<string, DbWire>): ReturnType<typeof vi.fn> {
	const bulkRecordReads = new Map<DbWire, number>();
	const fetchMock = vi.fn().mockImplementation(async (url: string) => {
		const u = String(url);
		const dbMatch = /invalid\/([^/]+)\//.exec(u);
		const fx = dbMatch ? byDb[dbMatch[1]] : undefined;
		if (!fx) return json({ entities: [] }, 200, JSON_HEADERS);
		if (u.includes('props=entu_user')) {
			return json({
				entity: {
					_viewer: [{ _id: 'gr-1', reference: 'p-self', property_type: '_editor' }],
					entu_user: [{ _id: 'eu-1', uid: 'u1', provider: 'test' }]
				}
			}, 200, JSON_HEADERS);
		}
		if (u.includes('_type.string=admin_member_record')) {
			if (fx.recordsGate) await fx.recordsGate;
			if (!u.includes('person.reference=') && fx.bulkRecordsFailFrom !== undefined) {
				const seen = bulkRecordReads.get(fx) ?? 0;
				bulkRecordReads.set(fx, seen + 1);
				if (seen >= fx.bulkRecordsFailFrom) return json({}, 503, JSON_HEADERS);
			}
			const rows =
				u.includes('person.reference=') && fx.lookupRecords !== undefined
					? fx.lookupRecords
					: fx.records;
			return json({
				entities: rows.map((r) => ({
					_id: r.id,
					...(r.person !== undefined ? { person: [{ reference: r.person }] } : {}),
					...(r.name !== undefined ? { name: [{ string: r.name }] } : {})
				}))
			}, 200, JSON_HEADERS);
		}
		if (u.includes('_type.string=member') && u.includes('status.string=archived')) {
			return json(
				{ entities: (fx.archived ?? []).map((m) => wireMember(fx, m)) },
				200,
				JSON_HEADERS
			);
		}
		if (u.includes('_type.string=member')) {
			return json({ entities: fx.members.map((m) => wireMember(fx, m)) }, 200, JSON_HEADERS);
		}
		if (u.includes('_type.string=section')) {
			return json({ entities: [], count: 0 }, 200, JSON_HEADERS);
		}
		if (u.includes('_type.string=database')) {
			return json({ entities: [{ _id: fx.dbEntityId }] }, 200, JSON_HEADERS);
		}
		if (u.includes(`entity/${fx.dbEntityId}`) && u.includes('roster_show_real_names')) {
			return json({
				entity: {
					_id: fx.dbEntityId,
					...(fx.toggle === 'absent'
						? {}
						: { roster_show_real_names: [{ _id: 'v-toggle', boolean: fx.toggle }] })
				}
			}, 200, JSON_HEADERS);
		}
		if (u.includes('_type.string=profile')) {
			const pm = /_parent\.reference=([^&]+)/.exec(u);
			const personId = pm ? decodeURIComponent(pm[1]) : '';
			const p = fx.profiles[personId];
			return json({
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
			}, 200, JSON_HEADERS);
		}
		return json({ entities: [] }, 200, JSON_HEADERS);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function sampledbFixture(toggle: boolean | 'absent'): DbWire {
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
	signIn();
}

function setAuthedWithTwoCollectives() {
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'other-choir', name: 'Other Choir', personId: 'person-b' }
		]
	});
}

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
	resetAppState();
	resetAdmin();
});

describe('#269 /roster end-to-end — toggle ON through the real producer chain', () => {
	it('the record-backed row shows the REAL name, the recordless row shows the profile name — in the SAME roster-row-name span with the SAME class (only the string differs)', async () => {
		stubWire({ sampledb: sampledbFixture(true) });
		const { container } = await renderRosterAs('admin');

		const m2span = rowNameSpan(container, 'm2');
		expect(m2span.textContent).toBe('Aaron Aardvark');
		const m1span = rowNameSpan(container, 'm1');
		expect(m1span.textContent).toBe('Alice Alto');

		expect(m2span.getAttribute('data-testid')).toBe('roster-row-name');
		expect(m2span.className).toBe('text-sm text-ink');
		expect(m1span.className).toBe(m2span.className);
		expect(m2span.tagName).toBe('SPAN');
		expect(q(container, 'roster-row-m2')!.firstElementChild).toBe(m2span);
	});

	it('NON-ADMIN members see the real names too (the toggle is collective-wide, not an admin-only view)', async () => {
		stubWire({ sampledb: sampledbFixture(true) });
		const { container } = await renderRosterAs('not-admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');
		expect(rowNameSpan(container, 'm1').textContent).toBe('Alice Alto');
	});
});

describe('#269 fallback — SILENT AND COMPLETE', () => {
	function shapeOf(li: Element, memberId: string): string[] {
		return [li as Element, ...Array.from(li.querySelectorAll('*'))].map((el) => {
			const testid = (el.getAttribute('data-testid') ?? '').split(memberId).join('{id}');
			return `${el.tagName}|${testid}|${el.className}`;
		});
	}

	it('a record-backed row and a fallback row have IDENTICAL class lists and DOM shape — only the text differs; no placeholder, no marker, no alert', async () => {
		stubWire({ sampledb: sampledbFixture(true) });
		const { container } = await renderRosterAs('not-admin');
		const m1li = q(container, 'roster-row-m1')!;
		const m2li = q(container, 'roster-row-m2')!;

		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');
		expect(shapeOf(m2li, 'm2')).toEqual(shapeOf(m1li, 'm1'));
		expect(m2li.className).toBe(m1li.className);

		expect(m1li.textContent).not.toContain('[');
		expect(m2li.textContent).not.toContain('[');
		expect(m1li.querySelector('[role="alert"]')).toBeNull();
		expect(m2li.querySelector('[role="alert"]')).toBeNull();
	});

	it('a record whose name was CLEARED falls back to the profile name silently — the toggle-on load still issues its ONE records read (the fallback is a join decision, never a skipped fetch)', async () => {
		const fx = sampledbFixture(true);
		fx.records = [{ id: 'rec-q', person: 'person-q', name: '' }];
		const fetchMock = stubWire({ sampledb: fx });
		const { container } = await renderRosterAs('admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Berta Bass');
		expect(rowNameSpan(container, 'm1').textContent).toBe('Alice Alto');
		const records = (fetchMock.mock.calls as Array<[unknown]>)
			.map((c) => String(c[0]))
			.filter((u) => u.includes('admin_member_record'));
		expect(records).toHaveLength(1);
	});

	it('a member carrying TWO records falls back to the profile name too — the overlay refuses to guess (matching what the #268 pencil says about her), and the row stays byte-identical to any other fallback row', async () => {
		const fx = sampledbFixture(true);
		fx.records = [
			{ id: 'rec-q1', person: 'person-q', name: 'Aaron Aardvark' },
			{ id: 'rec-q2', person: 'person-q', name: 'Zed Zither' }
		];
		stubWire({ sampledb: fx });
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

describe('#269 toggle OFF — identical to the toggle-less behavior on this tree', () => {
	it('toggle false + records present → profile names everywhere, NO admin_member_record request at all, the toggle itself read from the server — and the #268 pencil still renders (the baseline fence)', async () => {
		const fetchMock = stubWire({ sampledb: sampledbFixture(false) });
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

		expect(q(container, 'roster-row-card-m2')).not.toBeNull();
	});

	it('toggle key ABSENT (never set) → false: same rendering, same absence of any records fetch', async () => {
		const fetchMock = stubWire({ sampledb: sampledbFixture('absent') });
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

describe('#269 sorting — the page orders by what the rows DISPLAY', () => {
	it('grouped view: rows inside a group come in displayed-name order (Aaron before Alice, though profile order was Alice before Berta)', async () => {
		stubWire({ sampledb: sampledbFixture(true) });
		const { container } = await renderRosterAs('admin');
		const names = Array.from(
			container.querySelectorAll('[data-testid="roster-groups"] [data-testid="roster-row-name"]')
		).map((el) => el.textContent);
		expect(names).toEqual(['Aaron Aardvark', 'Alice Alto']);
	});

	it('flat view: the alphabetical list re-sorts by the displayed name too', async () => {
		stubWire({ sampledb: sampledbFixture(true) });
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(q(container, 'roster-sort-toggle')!);
		await waitFor(() => expect(q(container, 'roster-flat-list')).not.toBeNull());
		const names = Array.from(
			container.querySelectorAll('[data-testid="roster-flat-list"] [data-testid="roster-row-name"]')
		).map((el) => el.textContent);
		expect(names).toEqual(['Aaron Aardvark', 'Alice Alto']);
	});
});

describe('#469 scope — profileName surfaces keep the PROFILE name; the archived panel obeys the toggle (supersedes the #269 roster-only ruling)', () => {
	it('SectionPicker names the member by her PROFILE name in its control labels even while her row displays the real name (stated choice — section-assignment action, out of the contracted surface; flag for live review)', async () => {
		const fx = sampledbFixture(true);
		fx.viewerPersonId = 'person-p';
		stubWire({ sampledb: fx });
		const { container } = await renderRosterAs('admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');
		const add = q(container, 'section-picker-add-m2');
		expect(add, "the [+] renders on m2's row").not.toBeNull();
		const ariaLabel = add!.getAttribute('aria-label') ?? '';
		expect(ariaLabel).toContain('Berta Bass');
		expect(ariaLabel).not.toContain('Aaron Aardvark');
	});

	it('the #268 record-editor prefill uses the PROFILE name even when the row displays a real one (record deleted between the roster load and the pencil tap)', async () => {
		const fx = sampledbFixture(true);
		fx.lookupRecords = []; // deleted since the roster's bulk read → the create path
		stubWire({ sampledb: fx });
		const { container } = await renderRosterAs('admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');

		await fireEvent.click(q(container, 'roster-row-card-m2')!);
		await waitFor(() => expect(q(container, 'roster-record-name')).not.toBeNull());
		expect((q(container, 'roster-record-name') as HTMLInputElement).value).toBe('Berta Bass');
	});

	it('the ARCHIVED panel obeys the toggle too (#469, supersedes the v1 profile-only boundary): an archived member with a named record lists under her REAL name', async () => {
		stubWire({ sampledb: sampledbFixture(true) });
		const { container } = await renderRosterAs('admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');

		await fireEvent.click(q(container, 'roster-inactive-toggle')!);
		await waitFor(() => expect(q(container, 'roster-inactive-list')).not.toBeNull());
		const inactiveRow = q(container, 'inactive-member-row-m3')!;
		expect(inactiveRow).not.toBeNull();
		await waitFor(() => {
			expect(q(container, 'inactive-member-row-m3')!.textContent).toContain('Xena Xylophone');
		});
		expect(q(container, 'inactive-member-row-m3')!.textContent).not.toContain('Carla Cantus');
	});

	it('a records read that fails on the panel-open pass takes BOTH lists back to profile names together — never real names above profile names', async () => {
		const fx = sampledbFixture(true);
		fx.bulkRecordsFailFrom = 1;
		stubWire({ sampledb: fx });
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = await renderRosterAs('admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');

		await fireEvent.click(q(container, 'roster-inactive-toggle')!);
		await waitFor(() => expect(q(container, 'roster-inactive-list')).not.toBeNull());

		await waitFor(() => {
			expect(q(container, 'inactive-member-row-m3')!.textContent).toContain('Carla Cantus');
		});
		expect(q(container, 'inactive-member-row-m3')!.textContent).not.toContain('Xena Xylophone');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Berta Bass');
		errSpy.mockRestore();
	});

	it('opening the panel spends ONE toggle read and ONE bulk records read for BOTH lists', async () => {
		const fetchMock = stubWire({ sampledb: sampledbFixture(true) });
		const { container } = await renderRosterAs('admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');

		const urls = () => (fetchMock.mock.calls as Array<[unknown]>).map((c) => String(c[0]));
		const before = urls().length;
		await fireEvent.click(q(container, 'roster-inactive-toggle')!);
		await waitFor(() => expect(q(container, 'inactive-member-row-m3')).not.toBeNull());
		await waitFor(() => {
			expect(q(container, 'inactive-member-row-m3')!.textContent).toContain('Xena Xylophone');
		});

		const opened = urls().slice(before);
		expect(opened.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
		expect(
			opened.filter((u) => u.includes('admin_member_record') && !u.includes('person.reference='))
		).toHaveLength(1);
		expect(
			opened.filter((u) => u.includes('_type.string=member') && !u.includes('status.string=archived'))
		).toHaveLength(1);
	});
});

describe('#269 network — the acceptance list checks the wire, not just the screen', () => {
	function recordUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
		return (fetchMock.mock.calls as Array<[unknown]>)
			.map((c) => String(c[0]))
			.filter((u) => u.includes('admin_member_record'));
	}

	it('ONE bulk records query per roster load, projected person,name EXACTLY — and no load-time URL anywhere projects phone or birthdate (the PO-ruled incidental-exposure fence)', async () => {
		const fetchMock = stubWire({ sampledb: sampledbFixture(true) });
		const { container } = await renderRosterAs('admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');

		const records = recordUrls(fetchMock);
		expect(records).toHaveLength(1);
		expect(records[0]).toContain('_type.string=admin_member_record');
		expect(records[0]).toMatch(/props=person,name(&|$)/);
		expect(records[0]).toContain('limit=500');
		expect(records[0]).not.toMatch(/props=[^&]*\b(phone|email|birthdate)\b/);

		for (const u of (fetchMock.mock.calls as Array<[unknown]>).map((c) => String(c[0]))) {
			expect(u).not.toMatch(/props=[^&]*\b(phone|birthdate)\b/);
		}
	});

	it('members and admins issue the SAME narrowed query — no admin-widened variant', async () => {
		const adminFetch = stubWire({ sampledb: sampledbFixture(true) });
		await renderRosterAs('admin');
		const adminUrls = recordUrls(adminFetch);
		expect(adminUrls).toHaveLength(1);

		cleanup();
		vi.unstubAllGlobals();
		resetAppState();
		resetAdmin();
		resetTypeIdCache();

		const memberFetch = stubWire({ sampledb: sampledbFixture(true) });
		const { container } = await renderRosterAs('not-admin');
		expect(rowNameSpan(container, 'm2').textContent).toBe('Aaron Aardvark');
		const memberUrls = recordUrls(memberFetch);
		expect(memberUrls).toHaveLength(1);
		expect(memberUrls[0]).toBe(adminUrls[0]);
	});
});

describe('#269 per-load server read and the #259 switch discipline', () => {
	it('the value is read from the server on EVERY load — no client-side persistence: a fresh render after the server flipped the toggle shows the new state (the second-session/collective-wide acceptance)', async () => {
		stubWire({ sampledb: sampledbFixture(false) });
		let utils = await renderRosterAs('admin');
		expect(rowNameSpan(utils.container, 'm2').textContent).toBe('Berta Bass');

		cleanup();
		vi.unstubAllGlobals();

		stubWire({ sampledb: sampledbFixture(true) });
		utils = await renderRosterAs('admin');
		expect(rowNameSpan(utils.container, 'm2').textContent).toBe('Aaron Aardvark');
	});

	it('DETERMINISTIC switch race: a records read HELD across a collective switch settles into NOTHING — the new collective renders its own (toggle-off) profile names, and the stale real name never appears', async () => {
		let releaseRecords!: () => void;
		const gate = new Promise<void>((r) => (releaseRecords = r));
		const sampledb = sampledbFixture(true);
		sampledb.recordsGate = gate;
		const otherChoir: DbWire = {
			dbEntityId: 'db-ent-2',
			members: [{ id: 'm-bob', person: 'person-b' }],
			profiles: { 'person-b': { name: 'Bob Bass', email: 'bob@x.com' } },
			toggle: false,
			records: [{ id: 'rec-b', person: 'person-b', name: 'Robert Real' }]
		};
		const fetchMock = stubWire({ sampledb, 'other-choir': otherChoir });

		const { container } = render(Page);
		setAuthedWithTwoCollectives();
		adminStore.set('admin');

		await waitFor(() =>
			expect(
				(fetchMock.mock.calls as Array<[unknown]>)
					.map((c) => String(c[0]))
					.some((u) => u.includes('/sampledb/') && u.includes('admin_member_record'))
			).toBe(true)
		);

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => expect(q(container, 'section-toggle-unassigned')).not.toBeNull());
		await fireEvent.click(q(container, 'section-toggle-unassigned')!);
		await waitFor(() => expect(q(container, 'roster-row-m-bob')).not.toBeNull());
		expect(rowNameSpan(container, 'm-bob').textContent).toBe('Bob Bass');

		releaseRecords();
		await flush();
		await tick();
		expect(rowNameSpan(container, 'm-bob').textContent).toBe('Bob Bass');
		expect(q(container, 'roster-row-m2')).toBeNull();
		expect(container.textContent).not.toContain('Aaron Aardvark');
	});
});

// (*MVOX:Tallis*)
