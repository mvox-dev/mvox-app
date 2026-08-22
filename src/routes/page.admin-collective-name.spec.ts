// @vitest-environment happy-dom
//
// #165 RED — editable collective name on the /admin page.
//
// WHAT is edited: the `mvox_collective` MARKER entity's `name` — the display
// name members see in the collective picker and the agenda header. NOT the
// database entity's `name` (platform identifier, untouched).
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   Data seam: src/lib/collectives/collectiveName.ts (new — its own wire
//   contract is pinned in src/lib/collectives/collectiveName.spec.ts):
//     resolveCollectiveNameMarker(cfg) → { markerId, name } | null
//     updateCollectiveName(cfg, markerId, name) → Promise<void>
//
//   src/routes/admin/+page.svelte — on the READY state:
//     • admin-collective-name — the collective display name, sourced from the
//       MARKER resolution (never the store's picker label: the store label is
//       a snapshot from discovery; the marker read is authoritative here).
//       Resolution rides the page's existing load — a FAILED marker read lands
//       in load-error + retry like every sibling resolution (house rule: a
//       broken read is never rendered as an absence).
//     • admin-collective-name-edit — the pencil <button> next to the name,
//       carrying an accessible name (same inline-edit pattern as
//       src/routes/event/[id]/+page.svelte). Rendered only when the marker
//       resolved (null marker → neither name nor pencil, nothing to edit).
//     • tap → admin-collective-name-input, a text input PRE-FILLED with the
//       current name, carrying its own aria-label (the pencil unmounts while
//       editing, so it cannot name the textbox).
//     • Enter CONFIRMS: updateCollectiveName(cfg, markerId, draft) fires, the
//       editor closes at once and the display shows the new name optimistically
//       (the written value IS authoritative — no reload, #165 AC).
//     • the pencil is DISABLED while the write is in flight, re-enabled when
//       it settles (#165 AC).
//     • on success the SELECTED COLLECTIVE STORE entry for this db is renamed
//       too, so the picker + agenda header reflect the new name WITHOUT a full
//       page reload (#165 AC — collectiveState is the single source both read).
//     • Escape and blur DISMISS: editor closes, display keeps the old name,
//       NOTHING is written. NOTE this deliberately diverges from the event
//       page's blur-confirms: #165's acceptance criteria pin "Dismissing
//       (Escape / blur) cancels without writing" for THIS surface.
//     • a FAILED write reverts the display to the pre-edit name and shows
//       admin-collective-name-error (role=alert) — never a silent success.
//
// Assertions match on DATA (names, testids, mock calls), never translated
// sentences — full-fallback paraglide proxy, same posture as
// page.event-editing.spec.ts.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Full-fallback paraglide mock — every key renders `[key {params}]`.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

// Mock every data seam at its module boundary — same scaffolding as
// page.admin.spec.ts, plus the NEW collectiveName seam under test.
const h = vi.hoisted(() => ({
	listAdminsMock: vi.fn(),
	addAdminMock: vi.fn(),
	removeAdminMock: vi.fn(),
	listLibrariansMock: vi.fn(),
	addLibrarianMock: vi.fn(),
	removeLibrarianMock: vi.fn(),
	resolveAdminMock: vi.fn(),
	resolveLibrarianMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	loadRosterMock: vi.fn(),
	resolveParentMock: vi.fn(),
	resolveOrgMock: vi.fn(),
	createInviteMock: vi.fn(),
	resolveCollectiveNameMarkerMock: vi.fn(),
	updateCollectiveNameMock: vi.fn()
}));
vi.mock('$lib/admin/roleManagement', () => ({
	fetchRights: vi.fn(),
	listAdmins: h.listAdminsMock,
	addAdmin: h.addAdminMock,
	removeAdmin: h.removeAdminMock,
	listLibrarians: h.listLibrariansMock,
	addLibrarian: h.addLibrarianMock,
	removeLibrarian: h.removeLibrarianMock
}));
vi.mock('$lib/nav/adminStore', () => ({
	resolveAdmin: h.resolveAdminMock
}));
vi.mock('$lib/library/librarianStore', () => ({
	resolveLibrarian: h.resolveLibrarianMock
}));
vi.mock('$lib/collective/databaseEntity', () => ({
	resolveDatabaseEntityId: h.resolveDatabaseEntityIdMock
}));
vi.mock('$lib/roster/rosterData', () => ({
	loadRoster: h.loadRosterMock
}));
vi.mock('$lib/invite/inviteData', () => ({
	resolvePersonParentId: h.resolveParentMock,
	resolveOrgId: h.resolveOrgMock,
	createInvite: h.createInviteMock
}));
// The seam under test — GREEN creates the real module; the page must consume
// it through THIS boundary.
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: h.resolveCollectiveNameMarkerMock,
	updateCollectiveName: h.updateCollectiveNameMock
}));
// Sever the $env chain + goto — same discipline as page.admin.spec.ts.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './admin/+page.svelte';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	selectedCollectiveStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const CFG = { db: 'polyphony', token: 'jwt-admin' };

// The MARKER's display name deliberately differs from the store's picker label
// ('Polyphony') — an implementation echoing the store label instead of the
// marker read would pass a same-name fixture and prove nothing.
const MARKER = { markerId: 'marker-1', name: 'Koor Polyphony' };

const ROSTER = [{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' }];
const ANNA = { id: 'p-anna', name: 'Anna Arro', role: 'owner' as const, valueIds: ['pv-own'] };

function selectPolyphony() {
	setToken('jwt-admin');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'admin-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function loadOk() {
	h.resolveAdminMock.mockResolvedValue('admin');
	h.resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue({ persons: [ANNA], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	h.loadRosterMock.mockResolvedValue(ROSTER);
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveOrgMock.mockResolvedValue('org-1');
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ ...MARKER });
	h.updateCollectiveNameMock.mockResolvedValue(undefined);
}

function q<T extends HTMLElement>(root: ParentNode, testid: string): T | null {
	return root.querySelector(`[data-testid="${testid}"]`) as T | null;
}

async function renderReady() {
	const rendered = render(Page);
	await waitFor(() => {
		expect(q(rendered.container, 'admin-roles-admins')).not.toBeNull();
	});
	return rendered;
}

/** Ready + the name surface rendered; answers { container, nameEl, pencil }. */
async function renderWithName() {
	const { container } = await renderReady();
	await waitFor(() => {
		expect(q(container, 'admin-collective-name')).not.toBeNull();
		expect(q(container, 'admin-collective-name-edit')).not.toBeNull();
	});
	return {
		container,
		nameEl: q<HTMLElement>(container, 'admin-collective-name')!,
		pencil: q<HTMLButtonElement>(container, 'admin-collective-name-edit')!
	};
}

/** Tap the pencil, wait for the inline input. */
async function openEditor(container: HTMLElement): Promise<HTMLInputElement> {
	const pencil = q<HTMLButtonElement>(container, 'admin-collective-name-edit')!;
	await fireEvent.click(pencil);
	let input: HTMLInputElement | null = null;
	await waitFor(() => {
		input = q<HTMLInputElement>(container, 'admin-collective-name-input');
		expect(input).not.toBeNull();
	});
	return input!;
}

/** A promise whose settlement the test controls — for in-flight assertions. */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	for (const mock of Object.values(h)) mock.mockReset();
});

afterEach(() => {
	cleanup();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

// ── display (integration: the surface lives on the REAL /admin route) ────────

describe('/admin — collective name display', () => {
	it('READY renders the MARKER resolution\'s name with a pencil button — the real admin route, not an isolated component', async () => {
		selectPolyphony();
		loadOk();

		const { container, nameEl, pencil } = await renderWithName();

		// The marker's name, NOT the store's picker label.
		expect(nameEl.textContent).toContain('Koor Polyphony');
		// The resolution ran against the selected collective's cfg.
		expect(h.resolveCollectiveNameMarkerMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG)
		);
		// The pencil is a real, enabled button with an accessible name (the
		// pattern src/routes/event/[id]/+page.svelte pins: aria-label or
		// text content — an icon-only button must not be nameless).
		expect(pencil.disabled).toBe(false);
		const accessible = (pencil.getAttribute('aria-label') ?? '') + (pencil.textContent ?? '');
		expect(accessible.trim()).not.toBe('');
		// #165 review F3 — a 44px-tall target that also spans the field, the
		// whole-field shape #157 settled on for event/[id]. `min-h-11` on its own
		// with `p-0` collapses the width to the ~12px ✎ glyph.
		const classes = Array.from(pencil.classList);
		expect(classes, 'the rename control must reserve a 44px-tall touch target').toContain(
			'min-h-11'
		);
		expect(classes, 'the WHOLE field is the target, not the ✎ glyph').toContain('w-full');
		// The value lives INSIDE the button — that is what makes the field the target.
		expect(pencil.querySelector('#admin-collective-name-value')?.textContent).toBe(
			'Koor Polyphony'
		);
		// The role sections still render alongside — this is the SAME page.
		expect(q(container, 'admin-roles-admins')).not.toBeNull();
	});

	it('no marker in the db (resolution → null): neither name nor pencil — nothing to edit', async () => {
		selectPolyphony();
		loadOk();
		h.resolveCollectiveNameMarkerMock.mockResolvedValue(null);

		const { container } = await renderReady();

		// The page CONSULTED the marker seam and got null — not "never asked"
		// (without this the assertion pair below would pass vacuously in RED).
		expect(h.resolveCollectiveNameMarkerMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG)
		);
		expect(q(container, 'admin-collective-name')).toBeNull();
		expect(q(container, 'admin-collective-name-edit')).toBeNull();
	});

	it('an empty-name marker renders a labelled, non-blank placeholder control — never a blank heading', async () => {
		selectPolyphony();
		loadOk();
		h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: '' });

		const { container } = await renderReady();

		// The control still renders (this is NOT the null-marker "nothing to
		// edit" case above) — it just has no name YET.
		const nameEl = q<HTMLElement>(container, 'admin-collective-name')!;
		expect(nameEl).not.toBeNull();
		const pencil = q<HTMLButtonElement>(container, 'admin-collective-name-edit')!;
		expect(pencil).not.toBeNull();
		// The value slot is never blank — a placeholder fills it, so the
		// control carries a real accessible name (an empty heading/label is
		// the screen-reader trap this pins against).
		const value = pencil.querySelector('#admin-collective-name-value');
		expect(value?.textContent?.trim()).not.toBe('');
		expect(value?.textContent).toBe('[admin_collective_name_unnamed]');
		// The pencil itself is still openable — the placeholder is not a
		// disabled/decorative state.
		expect(pencil.disabled).toBe(false);
	});

	it('a FAILED marker read lands in load-error + retry — never rendered as "no name" (house rule)', async () => {
		selectPolyphony();
		loadOk();
		h.resolveCollectiveNameMarkerMock.mockRejectedValueOnce(new Error('marker query 500'));

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'admin-roles-load-error')).not.toBeNull();
		});

		// Retry is real: with the backend recovered, the same button reaches ready.
		const retry = q<HTMLButtonElement>(container, 'admin-roles-retry-load')!;
		await fireEvent.click(retry);
		await waitFor(() => {
			expect(q(container, 'admin-collective-name')).not.toBeNull();
		});
	});
});

// ── the edit flow ─────────────────────────────────────────────────────────────

describe('/admin — collective name editing', () => {
	it('tapping the pencil opens an inline text input PRE-FILLED with the current name, carrying its own aria-label', async () => {
		selectPolyphony();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);

		expect(input.value).toBe('Koor Polyphony');
		expect((input.getAttribute('aria-label') ?? '').trim()).not.toBe('');
		// The pencil unmounts (or at minimum stops being a second tab stop)
		// while the editor is open — same shape as the event page.
		expect(q(container, 'admin-collective-name-edit')).toBeNull();
		// Nothing has been written yet.
		expect(h.updateCollectiveNameMock).not.toHaveBeenCalled();
	});

	it('Enter confirms: updateCollectiveName(cfg, markerId, draft) fires ONCE and the display shows the new name without a reload', async () => {
		selectPolyphony();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Uus Koorinimi' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(h.updateCollectiveNameMock).toHaveBeenCalledTimes(1);
		});
		expect(h.updateCollectiveNameMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG),
			'marker-1',
			'Uus Koorinimi'
		);

		// The editor closed and the display holds the NEW name — no re-read, no
		// page reload (#165 AC).
		await waitFor(() => {
			expect(q(container, 'admin-collective-name-input')).toBeNull();
			expect(q(container, 'admin-collective-name')!.textContent).toContain('Uus Koorinimi');
		});
	});

	it('a successful write renames the selected collective in the STORE — picker + agenda header reflect it without reload (#165 AC)', async () => {
		selectPolyphony();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Uus Koorinimi' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(get(selectedCollectiveStore)?.name).toBe('Uus Koorinimi');
		});
		// Still the same collective — only the label moved.
		expect(get(selectedCollectiveStore)?.db).toBe('polyphony');
		expect(container).toBeTruthy();
	});

	// #165 review F4 — the read side (`resolveCollectiveNameMarker`) TRIMS, so a
	// raw write would round-trip padding: the marker would hold '  Uus Nimi  ',
	// the picker label would carry it until the next reload, and that reload
	// would silently trim it back — a write that appears to do something and
	// then undoes itself.
	it('the draft is TRIMMED before it reaches the wire and the store', async () => {
		selectPolyphony();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: '   Uus Koorinimi   ' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(h.updateCollectiveNameMock).toHaveBeenCalledTimes(1);
		});
		expect(h.updateCollectiveNameMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG),
			'marker-1',
			'Uus Koorinimi'
		);
		await waitFor(() => {
			expect(get(selectedCollectiveStore)?.name).toBe('Uus Koorinimi');
		});
	});

	it('a whitespace-only edit of an UNCHANGED name writes nothing — trimming makes it the no-change case', async () => {
		selectPolyphony();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Koor Polyphony   ' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(q(container, 'admin-collective-name-input')).toBeNull();
		});
		expect(h.updateCollectiveNameMock).not.toHaveBeenCalled();
		expect(q(container, 'admin-collective-name')!.textContent).toContain('Koor Polyphony');
	});

	// #165 review F2 / #105 R2 — Enter is a KEYBOARD dismissal, so it owes the
	// pencil its focus back exactly like Escape does. The restore cannot happen
	// while the write is in flight (the pencil is `disabled`, and focus() is a
	// no-op on a disabled element), so it lands once the write settles.
	it('Enter hands focus back to the pencil once the write settles — a keyboard admin is never stranded on <body>', async () => {
		selectPolyphony();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Uus Koorinimi' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			const pencil = q<HTMLButtonElement>(container, 'admin-collective-name-edit');
			expect(pencil).not.toBeNull();
			expect(pencil!.disabled).toBe(false);
			expect(document.activeElement).toBe(pencil);
		});
	});

	it('Enter on an UNCHANGED name restores focus too (the no-write branch owes it the same)', async () => {
		selectPolyphony();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			const pencil = q<HTMLButtonElement>(container, 'admin-collective-name-edit');
			expect(pencil).not.toBeNull();
			expect(document.activeElement).toBe(pencil);
		});
		expect(h.updateCollectiveNameMock).not.toHaveBeenCalled();
	});

	it('Escape dismisses: editor closes, the OLD name stands, NOTHING is written', async () => {
		selectPolyphony();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Peaaegu Muudetud' } });
		await fireEvent.keyDown(input, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'admin-collective-name-input')).toBeNull();
		});
		expect(q(container, 'admin-collective-name')!.textContent).toContain('Koor Polyphony');
		expect(q(container, 'admin-collective-name')!.textContent).not.toContain('Peaaegu Muudetud');
		expect(h.updateCollectiveNameMock).not.toHaveBeenCalled();
	});

	it('blur dismisses too — #165 pins blur-cancels for THIS surface (unlike the event page\'s blur-confirms)', async () => {
		selectPolyphony();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Peaaegu Muudetud' } });
		await fireEvent.blur(input);

		await waitFor(() => {
			expect(q(container, 'admin-collective-name-input')).toBeNull();
		});
		expect(q(container, 'admin-collective-name')!.textContent).toContain('Koor Polyphony');
		expect(h.updateCollectiveNameMock).not.toHaveBeenCalled();
	});

	it('the pencil is DISABLED while the write is in flight, re-enabled when it settles (#165 AC)', async () => {
		selectPolyphony();
		loadOk();
		const gate = deferred<void>();
		h.updateCollectiveNameMock.mockReturnValue(gate.promise);

		const { container } = await renderWithName();
		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Uus Koorinimi' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		// The editor closes at once; the pencil is back but INERT while the
		// write is out.
		await waitFor(() => {
			const pencil = q<HTMLButtonElement>(container, 'admin-collective-name-edit');
			expect(pencil).not.toBeNull();
			expect(pencil!.disabled).toBe(true);
		});

		gate.resolve();
		await waitFor(() => {
			expect(q<HTMLButtonElement>(container, 'admin-collective-name-edit')!.disabled).toBe(
				false
			);
		});
	});

	it('a FAILED write reverts the display to the pre-edit name and shows a visible alert — never a silent success', async () => {
		selectPolyphony();
		loadOk();
		h.updateCollectiveNameMock.mockRejectedValue(new Error('POST failed: 403'));

		const { container } = await renderWithName();
		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Uus Koorinimi' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(q(container, 'admin-collective-name-error')).not.toBeNull();
		});
		const error = q<HTMLElement>(container, 'admin-collective-name-error')!;
		expect(error.getAttribute('role')).toBe('alert');
		// The raw error message stays OUT of the DOM (localized copy only).
		expect(error.textContent).not.toContain('403');
		// The display reverted — the server still holds the old name.
		expect(q(container, 'admin-collective-name')!.textContent).toContain('Koor Polyphony');
		expect(q(container, 'admin-collective-name')!.textContent).not.toContain('Uus Koorinimi');
		// The store label did NOT move either.
		expect(get(selectedCollectiveStore)?.name).toBe('Polyphony');
	});
});

// (*MVOX:Tallis* — #165 RED)
