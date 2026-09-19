// @vitest-environment happy-dom
//
// #352 RED — the profile page's STORAGE section: "Remove downloaded parts
// from this device". #343 ruled that logout and token expiry do NOT clear the
// byte store; the honest answer to a shared device is a control the person
// can actually reach — this section is that control.
//
// CONTRACT (GREEN implements in src/routes/profile/+page.svelte, on top of
// the #352 store members pinned in src/lib/files/byteStore.storage-controls.spec.ts):
//
//   THE SECTION — [data-testid="profile-storage"], inside the ready branch
//   (the storage answer is scoped to the signed-in (db, personId) identity,
//   so there is nothing truthful to show without a selected collective).
//   Headed by an <h2> from profile_storage_title.
//
//   THIS ACCOUNT ON THIS DEVICE — [data-testid="profile-storage-mine"]:
//   count + total size (profile_storage_mine_summary, params count + size),
//   and the parts NAMED, one row per held fileId
//   ([data-testid="profile-storage-part-{fileId}"]).
//     NAMING IS ONLINE-PATH ONLY IN THIS SLICE: the issue's "the list the
//     page already has" is stale — /profile loads no parts data today. The
//     fileId→filename join comes from the library metadata read
//     (listAllEditions: each edition's files[] carries {id, filename}), which
//     needs the network. OFFLINE naming (reading names without a fetch) is
//     #353's scope, not this slice's — GREEN must say so in a comment
//     (source pin below: the page cites #353). A FAILED metadata read
//     degrades to count + size with no names — never a crash, and the
//     destructive control keeps working (removal must not depend on being
//     able to pretty-print what is removed).
//
//   THE READ IS NEVER AN OPEN (#351's trap, again): the section's numbers
//   come from usageForPartition/usageForOthers and the ids from heldFileIds —
//   the page must NOT call store.get() to render, because a get() stamps an
//   open and would collapse LRU eviction order to profile-visit order.
//
//   EVERYTHING ELSE ON THIS DEVICE — [data-testid="profile-storage-others"]:
//   count and size ONLY, NO TITLES. PO ruling, verbatim from #352:
//
//     > The device may hold bytes for other identities — a second singer, or
//     > this same human in another collective. Two things are simultaneously
//     > true: the member must not be told the device is clean when it is not,
//     > and the app must not become the convenient way to read another
//     > person's repertoire. Devtools already exposes everything to anyone
//     > determined; a titled list in our own UI would lower that bar for the
//     > merely curious, which is a different population.
//     >
//     > So: say that other downloads are present, size them, do not name
//     > them, and offer "Remove everything downloaded on this device" as a
//     > second, separately-confirmed action.
//
//   The "others" bucket INCLUDES the same human's partition in another
//   collective (partitions are (db, personId) — identity-C precedent from
//   the pinned store suites).
//
//   TWO DESTRUCTIVE ACTIONS, THE HOUSE ARMED-SLOT PATTERN (the season-manage
//   delete / linked-accounts picker precedent — an armed-state var, a
//   confirm/cancel pair REPLACING the trigger, focus handed to the confirm on
//   arm and back to the trigger on cancel; NEVER window.confirm, NEVER a
//   modal):
//     - [data-testid="profile-storage-remove-mine"] arms
//       -remove-mine-confirm / -remove-mine-cancel, beside a note
//       ([data-testid="profile-storage-remove-mine-note"],
//       profile_storage_remove_mine_note) stating plainly that the parts
//       will need a network to open again.
//     - [data-testid="profile-storage-remove-all"] arms its OWN pair
//       (-remove-all-confirm / -remove-all-cancel) with its own note
//       (profile_storage_remove_all_note). Confirming clears EVERY partition
//       on the device — including identities not signed in.
//     - The two arm INDEPENDENTLY; each confirm fires ONLY its own action.
//
//   FENCES: nothing here touches auth — the #343 RETAIN suite
//   (src/lib/auth/storage.spec.ts) passes UNMODIFIED beside this file. No
//   string may claim the bytes were secure/private/encrypted/protected
//   (locale pins at the bottom, all four locales, et kaitstud/turvaline
//   family included).
//
// INTEGRATION (house rule): the ACTUAL /profile route renders; only the read
// seams and the $lib/files/appByteStore persistence seam are substituted.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

const h = vi.hoisted(() => ({
	listMyProfilesMock: vi.fn(),
	listAllEditionsMock: vi.fn()
}));
// Mock ONLY the network reads; keep the pure helpers real.
vi.mock('$lib/profile/profileData', async () => {
	const actual = await vi.importActual<typeof import('$lib/profile/profileData')>(
		'$lib/profile/profileData'
	);
	return { ...actual, listMyProfiles: h.listMyProfilesMock };
});
vi.mock('$lib/profile/linkedIdentities', () => ({
	listLinkedIdentities: vi.fn().mockResolvedValue({ identities: [] })
}));
vi.mock('$lib/collective/rosterNames', () => ({
	readRosterNamesSetting: vi
		.fn()
		.mockResolvedValue({ dbEntityId: 'db-entity-x', showRealNames: false }),
	updateRosterShowRealNames: vi.fn()
}));
// The fileId→filename join source (online path — see the header note).
vi.mock('$lib/library/libraryData', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>(
		'$lib/library/libraryData'
	);
	return { ...actual, listAllEditions: h.listAllEditionsMock };
});
// The byte-store seam: the page reaches persistence ONLY through
// getAppByteStore, so the spec substitutes an in-memory fake.
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));

import ProfilePage from './profile/+page.svelte';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { isMessageEmpty, messagePatterns, type MessageFile } from '$lib/testing/messageFile.js';

let fakeByteStore: FakeByteStore;

const q = (c: HTMLElement, testid: string) => c.querySelector(`[data-testid="${testid}"]`);

// ── identities on the device ─────────────────────────────────────────────────
// P is signed in. B is a second singer on the same collective's db. C is the
// SAME human (same personId) in ANOTHER collective — the pinned identity-C
// precedent: C's holdings land in the "everything else" bucket.
const P = { db: 'sampledb', personId: 'person-p' };
const OTHER_B = { db: 'sampledb', personId: 'person-b' };
const OTHER_C = { db: 'crede', personId: 'person-p' };
const ALL_IDENTITIES = [P, OTHER_B, OTHER_C];

const MINE_FILE_1 = 'file-anthem'; // 40 B — 'Ave Maria — Soprano.pdf'
const MINE_FILE_2 = 'file-motet'; // 24 B — 'Sicut cervus — Alto.pdf'
const OTHER_FILE_B = 'file-bass'; // 10 B — titled in the SAME collective's metadata
const OTHER_FILE_C = 'file-credo'; // 30 B — another collective entirely

const MINE_NAME_1 = 'Ave Maria — Soprano.pdf';
const MINE_NAME_2 = 'Sicut cervus — Alto.pdf';
// The temptation fixture: B's file IS titled in metadata the page fetches —
// the others bucket must still not name it.
const OTHER_TITLE_B = 'Secret Bass Part.pdf';
const OTHER_TITLE_C = 'Crede Credo — Tenor.pdf';

function fileData(n: number) {
	return {
		bytes: new Uint8Array(n).fill(7).buffer,
		filetype: 'application/pdf',
		sha256: `sha-${n}`
	};
}

/** Test-side size ledger, so the installed usage members below can answer
 *  from heldFor() WITHOUT calling fakeByteStore.get() — get() is an open, and
 *  one spec here pins that a profile render performs none. */
const SIZE_BY_FILE: Record<string, number> = {
	[MINE_FILE_1]: 40,
	[MINE_FILE_2]: 24,
	[OTHER_FILE_B]: 10,
	[OTHER_FILE_C]: 30
};

/** Seed the device: mine = 2 parts / 64 B; others = 2 parts / 40 B. */
function seedDevice(): void {
	fakeByteStore.seed(P, MINE_FILE_1, fileData(40));
	fakeByteStore.seed(P, MINE_FILE_2, fileData(24));
	fakeByteStore.seed(OTHER_B, OTHER_FILE_B, fileData(10));
	fakeByteStore.seed(OTHER_C, OTHER_FILE_C, fileData(30));
}

type Usage = { count: number; size: number };
type StorageControls = {
	usageForPartition: ReturnType<typeof vi.fn>;
	usageForOthers: ReturnType<typeof vi.fn>;
	clearAllPartitions: ReturnType<typeof vi.fn>;
};

/** Installs the #352 store members on the fake (they land on the REAL
 *  interface via byteStore.storage-controls.spec.ts; here they answer LIVE
 *  from the fake's own state, so the page's re-query after a removal shows
 *  moved numbers). Returns the spies. */
function installStorageControls(): StorageControls {
	function usageOf(db: string, personId: string): Usage {
		const held = fakeByteStore.heldFor(db, personId);
		return {
			count: held.length,
			size: held.reduce((sum, fileId) => sum + (SIZE_BY_FILE[fileId] ?? 0), 0)
		};
	}
	const controls: StorageControls = {
		usageForPartition: vi.fn(async (db: string, personId: string) => usageOf(db, personId)),
		usageForOthers: vi.fn(async (db: string, personId: string) => {
			let count = 0;
			let size = 0;
			for (const id of ALL_IDENTITIES) {
				if (id.db === db && id.personId === personId) continue;
				const u = usageOf(id.db, id.personId);
				count += u.count;
				size += u.size;
			}
			return { count, size };
		}),
		// Clears via evict(), NOT via clearPartition — so a clearPartition spy
		// in the tests below counts ONLY page-side calls, and "the all-confirm
		// never calls clearPartition" is a real assertion, not a tautology.
		clearAllPartitions: vi.fn(async () => {
			for (const id of ALL_IDENTITIES) {
				for (const fileId of fakeByteStore.heldFor(id.db, id.personId)) {
					await fakeByteStore.evict(id as never, fileId);
				}
			}
		})
	};
	Object.assign(fakeByteStore as unknown as Record<string, unknown>, controls);
	return controls;
}

function mockLibraryMetadata(): void {
	h.listAllEditionsMock.mockResolvedValue(
		toListRead([
			{
				id: 'edition-1',
				name: 'Renaissance set',
				publisher: '',
				externalLinks: [],
				files: [
					{ id: MINE_FILE_1, filename: MINE_NAME_1, filesize: 40, filetype: 'application/pdf' },
					{ id: MINE_FILE_2, filename: MINE_NAME_2, filesize: 24, filetype: 'application/pdf' },
					{ id: OTHER_FILE_B, filename: OTHER_TITLE_B, filesize: 10, filetype: 'application/pdf' }
				]
			}
		])
	);
}

function signIn(): void {
	setToken('jwt-member');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

async function renderReady(): Promise<{ container: HTMLElement; controls: StorageControls }> {
	const controls = installStorageControls();
	h.listMyProfilesMock.mockResolvedValue([
		{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' as const }
	]);
	signIn();
	const { container } = render(ProfilePage);
	await waitFor(() => {
		expect(q(container, 'profile-field-name')).not.toBeNull();
	});
	return { container, controls };
}

/** Render with the full device fixture and wait for the section's numbers. */
async function renderStorageReady(): Promise<{
	container: HTMLElement;
	controls: StorageControls;
}> {
	seedDevice();
	mockLibraryMetadata();
	const out = await renderReady();
	await waitFor(() => {
		expect(q(out.container, 'profile-storage')).not.toBeNull();
		expect(q(out.container, 'profile-storage-mine')!.textContent).toMatch(/"count":2\b/);
	});
	return out;
}

async function armMine(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'profile-storage-remove-mine') as Element);
	await waitFor(() => expect(q(container, 'profile-storage-remove-mine-confirm')).not.toBeNull());
}

async function armAll(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'profile-storage-remove-all') as Element);
	await waitFor(() => expect(q(container, 'profile-storage-remove-all-confirm')).not.toBeNull());
}

beforeEach(() => {
	localStorage.clear();
	fakeByteStore = createFakeByteStore();
	h.listMyProfilesMock.mockReset();
	h.listAllEditionsMock.mockReset();
});

afterEach(() => {
	cleanup();
	localStorage.clear();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

// ── the section: mine named, others counted-and-sized only ──────────────────

describe('/profile — storage section: this account on this device', () => {
	it('renders the section with an <h2> title, the mine summary (count 2, 64 bytes) and BOTH part names', async () => {
		const { container } = await renderStorageReady();

		const section = q(container, 'profile-storage')!;
		const heading = section.querySelector('h2');
		expect(heading, 'the section needs its own h2').not.toBeNull();
		expect(heading!.textContent).toContain('[profile_storage_title]');

		const mine = q(container, 'profile-storage-mine')!;
		expect(mine.textContent).toContain('profile_storage_mine_summary');
		expect(mine.textContent).toMatch(/"count":2\b/);
		// #352 (review F2) — the size param arrives HUMAN-FORMATTED (the shared
		// formatFileSize the library page's file rows use), never a raw byte
		// count: a normal offline library reads "46.0 MB", not "48237194".
		expect(mine.textContent).toContain('"size":"64 B"');

		await waitFor(() => {
			expect(q(container, `profile-storage-part-${MINE_FILE_1}`)).not.toBeNull();
		});
		expect(q(container, `profile-storage-part-${MINE_FILE_1}`)!.textContent).toContain(
			MINE_NAME_1
		);
		expect(q(container, `profile-storage-part-${MINE_FILE_2}`)!.textContent).toContain(
			MINE_NAME_2
		);
	});

	it('asks the store for the SIGNED-IN identity only, and NEVER renders via get() — a profile visit must not stamp opens', async () => {
		const getSpy = vi.spyOn(fakeByteStore, 'get');
		const { container, controls } = await renderStorageReady();
		expect(q(container, 'profile-storage-others')).not.toBeNull();

		expect(controls.usageForPartition).toHaveBeenCalledWith('sampledb', 'person-p');
		expect(controls.usageForOthers).toHaveBeenCalledWith('sampledb', 'person-p');
		// Never scoped queries FOR another identity — the others answer is the
		// aggregate member's job, not a per-partition sweep from page code.
		for (const call of controls.usageForPartition.mock.calls) {
			expect(call).toEqual(['sampledb', 'person-p']);
		}
		// THE #351 TRAP: get() is an open. Rendering this section reads
		// presence + usage, never bytes.
		expect(getSpy).not.toHaveBeenCalled();
	});

	it('no selected collective → no storage section (there is no identity to scope the answer to)', async () => {
		seedDevice();
		mockLibraryMetadata();
		installStorageControls();
		setToken('jwt-member');
		collectiveState.set({ status: 'ready', collectives: [], erroredDbs: [] });
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set(null);
		const { container } = render(ProfilePage);
		await waitFor(() => expect(q(container, 'profile-no-collective')).not.toBeNull());
		expect(q(container, 'profile-storage')).toBeNull();
	});

	it('a FAILED metadata read degrades to count + size with no names — and the destructive control still works', async () => {
		seedDevice();
		h.listAllEditionsMock.mockRejectedValue(new Error('library metadata unreachable'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const { container } = await renderReady();
			await waitFor(() => {
				expect(q(container, 'profile-storage-mine')!.textContent).toMatch(/"count":2\b/);
			});
			expect(q(container, `profile-storage-part-${MINE_FILE_1}`)).toBeNull();
			expect(q(container, `profile-storage-part-${MINE_FILE_2}`)).toBeNull();

			const clearPartitionSpy = vi.spyOn(fakeByteStore, 'clearPartition');
			await armMine(container);
			await fireEvent.click(q(container, 'profile-storage-remove-mine-confirm') as Element);
			await waitFor(() => {
				expect(clearPartitionSpy).toHaveBeenCalledWith('sampledb', 'person-p');
			});
		} finally {
			consoleError.mockRestore();
			consoleWarn.mockRestore();
		}
	});
});

describe('/profile — storage section: everything else on this device (count + size, NO titles)', () => {
	it('reports others as count 2 / 40 bytes — including the same human\'s OTHER-collective partition', async () => {
		const { container } = await renderStorageReady();
		const others = q(container, 'profile-storage-others')!;
		expect(others.textContent).toContain('profile_storage_others_summary');
		// B (10 B, same db, other person) + C (30 B, same person, other db):
		// the count says 2 because BOTH are "else" — partitions are the pair.
		expect(others.textContent).toMatch(/"count":2\b/);
		// Human-formatted, same as the mine summary (#352 review F2).
		expect(others.textContent).toContain('"size":"40 B"');
	});

	it('a megabyte-scale holding reads in MB, not in raw bytes (#352 review F2)', async () => {
		fakeByteStore.seed(P, MINE_FILE_1, fileData(4));
		SIZE_BY_FILE[MINE_FILE_1] = 48_237_194;
		try {
			mockLibraryMetadata();
			const { container } = await renderReady();
			await waitFor(() => {
				expect(q(container, 'profile-storage-mine')!.textContent).toMatch(/"count":1\b/);
			});
			const mine = q(container, 'profile-storage-mine')!.textContent!;
			expect(mine).toContain('"size":"46.0 MB"');
			expect(mine).not.toContain('48237194');
		} finally {
			SIZE_BY_FILE[MINE_FILE_1] = 40;
		}
	});

	it('renders NO title strings for other identities — not in the others block, not anywhere in the section (PO ruling)', async () => {
		const { container } = await renderStorageReady();
		const section = q(container, 'profile-storage')!;
		// B's file IS titled in the metadata this very page fetched — the
		// temptation is real and must be refused in markup, not by luck.
		expect(section.innerHTML).not.toContain(OTHER_TITLE_B);
		expect(section.innerHTML).not.toContain(OTHER_TITLE_C);
		expect(q(container, `profile-storage-part-${OTHER_FILE_B}`)).toBeNull();
		expect(q(container, `profile-storage-part-${OTHER_FILE_C}`)).toBeNull();
		// And the whole page carries no other-identity titles either.
		expect(container.innerHTML).not.toContain(OTHER_TITLE_B);
		expect(container.innerHTML).not.toContain(OTHER_TITLE_C);
	});
});

// ── remove mine: armed-slot two-step ─────────────────────────────────────────

describe('/profile — "Remove downloaded parts from this device" is a two-step armed confirm', () => {
	it('the trigger writes NOTHING — it swaps in confirm/cancel plus the needs-network-again note, and hands focus to the confirm', async () => {
		const { container } = await renderStorageReady();
		const clearPartitionSpy = vi.spyOn(fakeByteStore, 'clearPartition');

		expect(q(container, 'profile-storage-remove-mine-confirm')).toBeNull();
		expect(q(container, 'profile-storage-remove-mine-cancel')).toBeNull();
		expect(q(container, 'profile-storage-remove-mine-note')).toBeNull();

		await armMine(container);

		// The trigger itself is GONE while armed — one control, one meaning.
		expect(q(container, 'profile-storage-remove-mine')).toBeNull();
		expect(q(container, 'profile-storage-remove-mine-cancel')).not.toBeNull();
		expect(q(container, 'profile-storage-remove-mine-note')!.textContent).toContain(
			'[profile_storage_remove_mine_note]'
		);
		expect(clearPartitionSpy).not.toHaveBeenCalled();
		// Focus custody: the trigger left the DOM, the confirm holds focus.
		await waitFor(() => {
			expect(document.activeElement?.getAttribute('data-testid')).toBe(
				'profile-storage-remove-mine-confirm'
			);
		});
	});

	it('cancel disarms: the trigger returns with focus, nothing was removed', async () => {
		const { container } = await renderStorageReady();
		const clearPartitionSpy = vi.spyOn(fakeByteStore, 'clearPartition');
		await armMine(container);

		await fireEvent.click(q(container, 'profile-storage-remove-mine-cancel') as Element);

		await waitFor(() => expect(q(container, 'profile-storage-remove-mine')).not.toBeNull());
		expect(q(container, 'profile-storage-remove-mine-confirm')).toBeNull();
		expect(clearPartitionSpy).not.toHaveBeenCalled();
		expect(fakeByteStore.heldFor(P.db, P.personId).sort()).toEqual([MINE_FILE_1, MINE_FILE_2]);
		await waitFor(() => {
			expect(document.activeElement?.getAttribute('data-testid')).toBe(
				'profile-storage-remove-mine'
			);
		});
	});

	it('confirm clears EXACTLY the signed-in partition: usage drops, names vanish, others untouched, the next get() misses', async () => {
		const { container, controls } = await renderStorageReady();
		const clearPartitionSpy = vi.spyOn(fakeByteStore, 'clearPartition');
		await armMine(container);

		await fireEvent.click(q(container, 'profile-storage-remove-mine-confirm') as Element);

		await waitFor(() => {
			expect(clearPartitionSpy).toHaveBeenCalledTimes(1);
			expect(clearPartitionSpy).toHaveBeenCalledWith('sampledb', 'person-p');
		});
		// The mine action never reaches for the device-wide member.
		expect(controls.clearAllPartitions).not.toHaveBeenCalled();
		// The store half: own partition empty, other partitions intact.
		expect(fakeByteStore.heldFor(P.db, P.personId)).toEqual([]);
		expect(fakeByteStore.heldFor(OTHER_B.db, OTHER_B.personId)).toEqual([OTHER_FILE_B]);
		expect(fakeByteStore.heldFor(OTHER_C.db, OTHER_C.personId)).toEqual([OTHER_FILE_C]);
		// usage() dropped by exactly the removed 64 bytes.
		expect(await fakeByteStore.usage()).toBe(40);
		// The next open of a removed id MISSES — that miss IS the refetch path.
		expect(await fakeByteStore.get(P, MINE_FILE_1)).toBeUndefined();

		// The page tells the new truth: mine at zero, names gone, others as before.
		await waitFor(() => {
			expect(q(container, 'profile-storage-mine')!.textContent).toMatch(/"count":0\b/);
		});
		expect(q(container, `profile-storage-part-${MINE_FILE_1}`)).toBeNull();
		expect(q(container, `profile-storage-part-${MINE_FILE_2}`)).toBeNull();
		expect(q(container, 'profile-storage-others')!.textContent).toMatch(/"count":2\b/);
	});
});

// ── remove everything: its OWN separately-confirmed action ──────────────────

describe('/profile — "Remove everything downloaded on this device" is separately confirmed and device-wide', () => {
	it('arms independently of remove-mine: both pairs can stand at once, and cancelling one leaves the other armed', async () => {
		const { container } = await renderStorageReady();

		await armMine(container);
		// Arming mine did NOT arm (or remove) the other trigger.
		expect(q(container, 'profile-storage-remove-all')).not.toBeNull();
		expect(q(container, 'profile-storage-remove-all-confirm')).toBeNull();

		await armAll(container);
		expect(q(container, 'profile-storage-remove-mine-confirm')).not.toBeNull();
		expect(q(container, 'profile-storage-remove-all-confirm')).not.toBeNull();
		expect(q(container, 'profile-storage-remove-all-note')!.textContent).toContain(
			'[profile_storage_remove_all_note]'
		);

		await fireEvent.click(q(container, 'profile-storage-remove-mine-cancel') as Element);
		await waitFor(() => expect(q(container, 'profile-storage-remove-mine')).not.toBeNull());
		expect(q(container, 'profile-storage-remove-all-confirm')).not.toBeNull();
	});

	it('each confirm fires ONLY its own action: the all-confirm calls clearAllPartitions and never clearPartition', async () => {
		const { container, controls } = await renderStorageReady();
		const clearPartitionSpy = vi.spyOn(fakeByteStore, 'clearPartition');
		await armAll(container);
		expect(controls.clearAllPartitions).not.toHaveBeenCalled();

		await fireEvent.click(q(container, 'profile-storage-remove-all-confirm') as Element);

		await waitFor(() => expect(controls.clearAllPartitions).toHaveBeenCalledTimes(1));
		// Page code went through the device-wide member — never a partition
		// sweep of its own invention (page code cannot enumerate partitions,
		// and a sweep over the ones it CAN name would miss not-signed-in
		// identities: the exact holdings this action exists to clear).
		expect(clearPartitionSpy).not.toHaveBeenCalled();
	});

	it('after the all-confirm, EVERY partition is empty — including the identity that is not signed in', async () => {
		const { container } = await renderStorageReady();
		await armAll(container);

		await fireEvent.click(q(container, 'profile-storage-remove-all-confirm') as Element);

		await waitFor(() => {
			expect(fakeByteStore.heldFor(P.db, P.personId)).toEqual([]);
		});
		expect(fakeByteStore.heldFor(OTHER_B.db, OTHER_B.personId)).toEqual([]);
		expect(fakeByteStore.heldFor(OTHER_C.db, OTHER_C.personId)).toEqual([]);
		expect(await fakeByteStore.usage()).toBe(0);
		await waitFor(() => {
			expect(q(container, 'profile-storage-mine')!.textContent).toMatch(/"count":0\b/);
			expect(q(container, 'profile-storage-others')!.textContent).toMatch(/"count":0\b/);
		});
	});
});

// ── a FAILED removal is a user-visible answer, not a console line ───────────
//
// #352 review F1. The whole point of this control is that a member on a shared
// device gets a TRUE answer. A rejected clear that only console.errors leaves
// the original numbers on screen with no word that nothing was deleted — which
// is indistinguishable from a removal that worked. Same shape the page already
// uses for its other mutating action (rosterError → profile-roster-names-error).

describe('/profile — a removal that FAILS says so, and the numbers stay honest', () => {
	it('remove-mine rejects → profile-storage-error appears AND the counts still show the PRE-removal numbers', async () => {
		const { container } = await renderStorageReady();
		const clearPartitionSpy = vi
			.spyOn(fakeByteStore, 'clearPartition')
			.mockRejectedValue(new Error('IndexedDB transaction aborted'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			expect(q(container, 'profile-storage-error')).toBeNull();
			await armMine(container);

			await fireEvent.click(q(container, 'profile-storage-remove-mine-confirm') as Element);

			await waitFor(() => {
				expect(q(container, 'profile-storage-error')).not.toBeNull();
			});
			const err = q(container, 'profile-storage-error')!;
			expect(err.getAttribute('role'), 'a failed removal must be announced').toBe('alert');
			expect(err.textContent).toContain('[profile_storage_remove_error]');
			// The parts are STILL HELD, and the page says the pre-removal numbers —
			// never a fabricated zero, never a silently unchanged screen.
			expect(clearPartitionSpy).toHaveBeenCalledTimes(1);
			expect(fakeByteStore.heldFor(P.db, P.personId).sort()).toEqual([MINE_FILE_1, MINE_FILE_2]);
			expect(q(container, 'profile-storage-mine')!.textContent).toMatch(/"count":2\b/);
			expect(q(container, 'profile-storage-mine')!.textContent).toContain('"size":"64 B"');
			expect(q(container, `profile-storage-part-${MINE_FILE_1}`)).not.toBeNull();
			// The slot disarms either way: the trigger comes back so the member can retry.
			await waitFor(() => expect(q(container, 'profile-storage-remove-mine')).not.toBeNull());
		} finally {
			consoleError.mockRestore();
		}
	});

	it('remove-all rejects → the same named error, with every partition still intact', async () => {
		const { container, controls } = await renderStorageReady();
		controls.clearAllPartitions.mockRejectedValue(new Error('IndexedDB transaction aborted'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await armAll(container);

			await fireEvent.click(q(container, 'profile-storage-remove-all-confirm') as Element);

			await waitFor(() => {
				expect(q(container, 'profile-storage-error')!.textContent).toContain(
					'[profile_storage_remove_error]'
				);
			});
			expect(fakeByteStore.heldFor(P.db, P.personId).sort()).toEqual([MINE_FILE_1, MINE_FILE_2]);
			expect(fakeByteStore.heldFor(OTHER_B.db, OTHER_B.personId)).toEqual([OTHER_FILE_B]);
			expect(fakeByteStore.heldFor(OTHER_C.db, OTHER_C.personId)).toEqual([OTHER_FILE_C]);
			expect(q(container, 'profile-storage-others')!.textContent).toMatch(/"count":2\b/);
			expect(q(container, 'profile-storage-others')!.textContent).toContain('"size":"40 B"');
		} finally {
			consoleError.mockRestore();
		}
	});

	it('a SUCCEEDING removal renders no error node, and a retry after a failure clears the stale one', async () => {
		const { container } = await renderStorageReady();
		const clearPartitionSpy = vi
			.spyOn(fakeByteStore, 'clearPartition')
			.mockRejectedValueOnce(new Error('IndexedDB transaction aborted'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await armMine(container);
			await fireEvent.click(q(container, 'profile-storage-remove-mine-confirm') as Element);
			await waitFor(() => expect(q(container, 'profile-storage-error')).not.toBeNull());

			// Second attempt goes through (the mock rejected ONCE).
			await armMine(container);
			await fireEvent.click(q(container, 'profile-storage-remove-mine-confirm') as Element);

			await waitFor(() => {
				expect(q(container, 'profile-storage-mine')!.textContent).toMatch(/"count":0\b/);
			});
			expect(clearPartitionSpy).toHaveBeenCalledTimes(2);
			expect(q(container, 'profile-storage-error'), 'the stale error must not survive').toBeNull();
		} finally {
			consoleError.mockRestore();
		}
	});
});

// ── the name join is a CATALOGUE-SIZED network read: scope it ───────────────
//
// #352 review F3. listAllEditions fetches every edition in the collective with
// its file metadata, purely to build a fileId→filename map for the handful of
// downloaded parts. A settings page must not pay that when it cannot change
// what is shown. (#353's stored-filename record is the durable fix.)

describe('/profile — the fileId→filename join only fires when it can change the answer', () => {
	it('nothing downloaded → the catalogue read never happens (the section still renders its zeroes)', async () => {
		mockLibraryMetadata();
		const { container } = await renderReady();

		await waitFor(() => {
			expect(q(container, 'profile-storage')).not.toBeNull();
		});
		expect(q(container, 'profile-storage-mine')!.textContent).toMatch(/"count":0\b/);
		expect(h.listAllEditionsMock).not.toHaveBeenCalled();
	});

	it('a remove-confirm re-reads the NUMBERS but never re-fetches the catalogue', async () => {
		const { container } = await renderStorageReady();
		expect(h.listAllEditionsMock).toHaveBeenCalledTimes(1);
		await armMine(container);

		await fireEvent.click(q(container, 'profile-storage-remove-mine-confirm') as Element);

		await waitFor(() => {
			expect(q(container, 'profile-storage-mine')!.textContent).toMatch(/"count":0\b/);
		});
		// The removal only SHRANK the held-id set — the names in hand still
		// describe whatever survived, so a second catalogue read buys nothing.
		expect(h.listAllEditionsMock).toHaveBeenCalledTimes(1);
	});

	it('a TRUNCATED catalogue read says so — an unnamed held part is an unanswered lookup, not a nameless part', async () => {
		seedDevice();
		// The read came back capped: MINE_FILE_2 lives beyond the cap, so the
		// page cannot name it — and must not let that silence read as "no name".
		h.listAllEditionsMock.mockResolvedValue({
			items: [
				{
					id: 'edition-1',
					name: 'Renaissance set',
					publisher: '',
					externalLinks: [],
					files: [
						{ id: MINE_FILE_1, filename: MINE_NAME_1, filesize: 40, filetype: 'application/pdf' }
					]
				}
			],
			total: 900,
			truncated: true
		});
		const { container } = await renderReady();

		await waitFor(() => {
			expect(q(container, 'profile-storage-names-partial')).not.toBeNull();
		});
		expect(q(container, `profile-storage-part-${MINE_FILE_1}`)!.textContent).toContain(MINE_NAME_1);
		expect(q(container, `profile-storage-part-${MINE_FILE_2}`)).toBeNull();
		expect(q(container, 'profile-storage-names-partial')!.textContent).toContain(
			'[profile_storage_names_partial]'
		);
	});

	it('a COMPLETE read that named every held part stays silent — no partial notice', async () => {
		const { container } = await renderStorageReady();
		await waitFor(() => {
			expect(q(container, `profile-storage-part-${MINE_FILE_2}`)).not.toBeNull();
		});
		expect(q(container, 'profile-storage-names-partial')).toBeNull();
	});

	it('a FAILED read is not reported as a truncation — it has no list to be partial about', async () => {
		seedDevice();
		h.listAllEditionsMock.mockRejectedValue(new Error('library metadata unreachable'));
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const { container } = await renderReady();
			await waitFor(() => {
				expect(q(container, 'profile-storage-mine')!.textContent).toMatch(/"count":2\b/);
			});
			expect(q(container, 'profile-storage-names-partial')).toBeNull();
		} finally {
			consoleWarn.mockRestore();
		}
	});
});

// ── the controls are native, classed buttons (#335) ─────────────────────────

describe('/profile — storage controls are native classed <button>s', () => {
	it('both triggers and both armed pairs: tagName BUTTON, type="button", a non-empty class (#335 — an unclassed control is invisible)', async () => {
		const { container } = await renderStorageReady();
		await armMine(container);
		await armAll(container);
		const testids = [
			'profile-storage-remove-mine-confirm',
			'profile-storage-remove-mine-cancel',
			'profile-storage-remove-all-confirm',
			'profile-storage-remove-all-cancel'
		];
		for (const testid of testids) {
			const el = q(container, testid) as HTMLButtonElement;
			expect(el, `${testid} missing`).not.toBeNull();
			expect(el.tagName, testid).toBe('BUTTON');
			expect(el.getAttribute('type'), `${testid} needs type="button"`).toBe('button');
			expect(el.className.trim().length, `${testid} must carry a class`).toBeGreaterThan(0);
		}
		// The triggers, on a fresh render (they are gone while armed above).
		cleanup();
		fakeByteStore = createFakeByteStore();
		const second = await renderStorageReady();
		for (const testid of ['profile-storage-remove-mine', 'profile-storage-remove-all']) {
			const el = q(second.container, testid) as HTMLButtonElement;
			expect(el, `${testid} missing`).not.toBeNull();
			expect(el.tagName, testid).toBe('BUTTON');
			expect(el.getAttribute('type'), `${testid} needs type="button"`).toBe('button');
			expect(el.className.trim().length, `${testid} must carry a class`).toBeGreaterThan(0);
		}
	});
});

// ── source pin: this slice's naming is the ONLINE path; offline is #353 ─────

describe('/profile — the page states the naming-scope boundary where the reader meets it', () => {
	it('src/routes/profile/+page.svelte cites #353 as the owner of offline naming', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/routes/profile/+page.svelte'),
			'utf-8'
		);
		expect(source).toMatch(/#353/);
		expect(source).toMatch(/offline/i);
	});
});

// ── wording honesty, all four locales ────────────────────────────────────────

describe('#352 — string honesty (byteStore.ts:8 — a correctness boundary, NOT a security boundary)', () => {
	const localeFiles = ['en', 'et', 'lv', 'uk'] as const;
	const STORAGE_KEYS = [
		'profile_storage_title',
		'profile_storage_mine_summary',
		'profile_storage_others_summary',
		'profile_storage_remove_mine',
		'profile_storage_remove_mine_note',
		'profile_storage_remove_mine_confirm',
		'profile_storage_remove_all',
		'profile_storage_remove_all_note',
		'profile_storage_remove_all_confirm',
		'profile_storage_cancel',
		// #352 (review) — the failure and partial-names strings are storage
		// strings too: the sweep covers them or they are the one place a
		// secure/protected claim could still slip in.
		'profile_storage_remove_error',
		'profile_storage_names_partial'
	] as const;
	// The secure/private/encrypted/protected/was-safe family, across all four
	// locales: en private/secure/protected/encrypted/safe, et privaatne/
	// kaitstud/turvaline/krüpteeritud, lv privāts/aizsargāts/drošs/šifrēts,
	// uk приватний/захищений/безпечний/зашифрований.
	const FORBIDDEN = [
		/priv/i,
		/secur/i,
		/protect/i,
		/encrypt/i,
		/\bsafe\b/i,
		/kaitst/i,
		/turval/i,
		/krüpt/i,
		/aizsarg/i,
		/droš/i,
		/šifr/i,
		/захищ/i,
		/прив/i,
		/безпеч/i,
		/шифр/i
	];

	function readLocale(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it('every storage key exists, non-empty, in all four locales', () => {
		for (const locale of localeFiles) {
			const messages = readLocale(locale);
			for (const key of STORAGE_KEYS) {
				expect(isMessageEmpty(messages[key]), `${locale}: ${key} missing or empty`).toBe(false);
			}
		}
	});

	it('no storage value in ANY locale claims the bytes were secure, private, encrypted, protected or safe', () => {
		for (const locale of localeFiles) {
			const messages = readLocale(locale);
			for (const key of STORAGE_KEYS) {
				for (const pattern of messagePatterns(messages[key])) {
					for (const forbidden of FORBIDDEN) {
						expect(
							pattern,
							`${locale}: ${key} = "${pattern}" matches ${forbidden}`
						).not.toMatch(forbidden);
					}
				}
			}
		}
	});

	it('the remove-mine confirm note states the consequence: the parts will need a network again (en pin)', () => {
		const en = readLocale('en');
		const patterns = messagePatterns(en['profile_storage_remove_mine_note']);
		expect(patterns.length).toBeGreaterThan(0);
		for (const pattern of patterns) {
			expect(pattern).toMatch(/network|internet|connection|download/i);
		}
	});

	it('the failure string states what is TRUE after a failed removal: nothing went, the parts are still here (en pin)', () => {
		const en = readLocale('en');
		const patterns = messagePatterns(en['profile_storage_remove_error']);
		expect(patterns.length).toBeGreaterThan(0);
		for (const pattern of patterns) {
			expect(pattern).toMatch(/still/i);
			expect(pattern).toMatch(/device/i);
		}
	});

	it('the summaries no longer bake a unit into the string — {size} carries its own (#352 review F2)', () => {
		for (const locale of localeFiles) {
			const messages = readLocale(locale);
			for (const key of ['profile_storage_mine_summary', 'profile_storage_others_summary']) {
				for (const pattern of messagePatterns(messages[key])) {
					// en bytes / et+lv baiti / uk байт — a hardcoded unit forecloses
					// the human formatting the page now applies to {size}.
					expect(pattern, `${locale}: ${key}`).not.toMatch(/\bbytes?\b|baiti|байт/i);
				}
			}
		}
	});

	it('the summaries carry BOTH params in every locale — a count without a size (or vice versa) is half an answer', () => {
		for (const locale of localeFiles) {
			const messages = readLocale(locale);
			for (const key of ['profile_storage_mine_summary', 'profile_storage_others_summary']) {
				for (const pattern of messagePatterns(messages[key])) {
					expect(pattern, `${locale}: ${key}`).toContain('{count}');
					expect(pattern, `${locale}: ${key}`).toContain('{size}');
				}
			}
		}
	});
});

// (*MVOX:Tallis*)
