// @vitest-environment happy-dom
// The profile sharing tier updates on a first-time save.
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

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
import {
	ProfileSaveError,
	applyFieldMoveMock,
	applyProfileSaveMock
} from '$lib/testing/mocks/profile';
import { listMyProfilesMock } from '$lib/testing/mocks/session';
import {
	cleanupResetGate,
	displayValue,
	resetSaveMocks,
	selectSampledb
} from '$lib/testing/pages/profile';

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const btn = (c: HTMLElement, testid: string) =>
	q(c, `[data-testid="${testid}"]`) as HTMLButtonElement;

async function openEditor(
	container: HTMLElement,
	field: 'name' | 'email'
): Promise<HTMLInputElement> {
	const activator = q(
		container,
		`[data-testid="profile-${field}-edit"]`
	) as HTMLButtonElement | null;
	expect(activator, `profile-${field}-edit must render in display state`).not.toBeNull();
	await fireEvent.click(activator!);
	let editorInput: HTMLInputElement | null = null;
	await waitFor(() => {
		editorInput = q(container, `[data-testid="profile-${field}"]`) as HTMLInputElement | null;
		expect(editorInput).not.toBeNull();
	});
	return editorInput!;
}

const CREATED_DOMAIN = { _id: 'server-dom-1', name: 'Ada', email: '', _sharing: 'domain' as const };

function armFirstTimeUserThenCreated() {
	listMyProfilesMock.mockResolvedValueOnce([]); // initial load — clean db
	listMyProfilesMock.mockResolvedValue([CREATED_DOMAIN]); // any read after the create
	applyProfileSaveMock.mockResolvedValue({ profileId: CREATED_DOMAIN._id });
}

async function renderFirstTimeProfile(): Promise<HTMLElement> {
	selectSampledb();
	const { container } = render(Page);
	await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
	return container;
}

async function typeNameAndSave(container: HTMLElement, value: string): Promise<void> {
	const nameInput = await openEditor(container, 'name');
	await fireEvent.input(nameInput, { target: { value } });
	await fireEvent.blur(nameInput);
	await waitFor(() => expect(applyProfileSaveMock).toHaveBeenCalledTimes(1));
	expect(applyProfileSaveMock.mock.calls[0][0]).toMatchObject({
		level: 'domain',
		existingId: null,
		fields: { name: value, email: '' }
	});
}

beforeEach(resetSaveMocks);

afterEach(cleanupResetGate);

describe('/profile — #160 sharing tier reactivity on first save', () => {
	it('sanity (issue step 4): a first-time user renders the tier picker with the non-active tiers disabled', async () => {
		armFirstTimeUserThenCreated();
		const container = await renderFirstTimeProfile();

		for (const field of ['name', 'email'] as const) {
			for (const level of ['private', 'domain', 'public'] as const) {
				expect(
					btn(container, `profile-vis-${field}-${level}`),
					`tier picker must render ${field}/${level}`
				).not.toBeNull();
			}
		}
		expect(btn(container, 'profile-vis-name-domain').getAttribute('aria-pressed')).toBe('true');
		expect(btn(container, 'profile-vis-name-public').disabled).toBe(true);
		expect(btn(container, 'profile-vis-email-public').disabled).toBe(true);
	});

	it('AC1: after the first save creates the profile entity, the public tier becomes enabled — NO reload', async () => {
		armFirstTimeUserThenCreated();
		const container = await renderFirstTimeProfile();

		expect(btn(container, 'profile-vis-name-public').disabled).toBe(true);

		await typeNameAndSave(container, 'Ada');

		await waitFor(() => {
			expect(
				btn(container, 'profile-vis-name-public').disabled,
				'public must become selectable once the profile entity exists — without a page reload'
			).toBe(false);
		});
		expect(btn(container, 'profile-vis-name-domain').getAttribute('aria-pressed')).toBe('true');
		expect(displayValue(container, 'name')).toBe('Ada');
	});

	it('AC1 (email): a field with NO value keeps its tiers disabled — the entity existing is not enough', async () => {
		armFirstTimeUserThenCreated();
		const container = await renderFirstTimeProfile();
		expect(btn(container, 'profile-vis-email-private').disabled).toBe(true);

		await typeNameAndSave(container, 'Ada');

		await waitFor(() => expect(btn(container, 'profile-vis-name-public').disabled).toBe(false));

		expect(
			btn(container, 'profile-vis-email-private').disabled,
			'email holds no value — its tiers must stay disabled, not become dead-enabled'
		).toBe(true);
		expect(btn(container, 'profile-vis-email-public').disabled).toBe(true);
		expect(btn(container, 'profile-vis-email-domain').getAttribute('aria-pressed')).toBe('true');
	});

	it('AC1 (email, positive): once email HOLDS a value the tiers wake up and a click really moves it', async () => {
		armFirstTimeUserThenCreated();
		const container = await renderFirstTimeProfile();
		await typeNameAndSave(container, 'Ada');
		await waitFor(() => expect(btn(container, 'profile-vis-name-public').disabled).toBe(false));

		applyProfileSaveMock.mockResolvedValue({ profileId: CREATED_DOMAIN._id });
		const emailInput = await openEditor(container, 'email');
		await fireEvent.input(emailInput, { target: { value: 'ada@example.org' } });
		await fireEvent.blur(emailInput);
		await waitFor(() => expect(applyProfileSaveMock).toHaveBeenCalledTimes(2));
		expect(applyProfileSaveMock.mock.calls[1][0]).toMatchObject({
			level: 'domain',
			existingId: CREATED_DOMAIN._id,
			fields: { name: 'Ada', email: 'ada@example.org' }
		});

		await waitFor(() =>
			expect(
				btn(container, 'profile-vis-email-public').disabled,
				'email now holds a value at domain — public must become a real move target'
			).toBe(false)
		);

		applyFieldMoveMock.mockReturnValueOnce(new Promise(() => {})); // never settles
		await fireEvent.click(btn(container, 'profile-vis-email-public'));

		await waitFor(() => expect(applyFieldMoveMock).toHaveBeenCalledTimes(1));
		expect(applyFieldMoveMock.mock.calls[0][0]).toMatchObject({
			field: 'email',
			fromLevel: 'domain',
			toLevel: 'public',
			value: 'ada@example.org',
			srcId: CREATED_DOMAIN._id,
			dstId: null,
			srcSibling: 'Ada'
		});
	});

	it('AC2: full first-session flow — create via autosave, then move name to PUBLIC, no reload anywhere', async () => {
		armFirstTimeUserThenCreated();
		const container = await renderFirstTimeProfile();
		await typeNameAndSave(container, 'Ada');

		const d = deferred<{
			field: 'name';
			fromLevel: 'domain';
			toLevel: 'public';
			targetId: string;
			sourceId: string;
		}>();
		applyFieldMoveMock.mockReturnValueOnce(d.promise);

		await waitFor(() =>
			expect(btn(container, 'profile-vis-name-public').disabled).toBe(false)
		);
		await fireEvent.click(btn(container, 'profile-vis-name-public'));

		await waitFor(() => expect(applyFieldMoveMock).toHaveBeenCalledTimes(1));
		expect(applyFieldMoveMock.mock.calls[0][0]).toMatchObject({
			field: 'name',
			fromLevel: 'domain',
			toLevel: 'public',
			value: 'Ada',
			srcId: CREATED_DOMAIN._id,
			dstId: null
		});

		listMyProfilesMock.mockResolvedValue([
			{ _id: 'server-pub-1', name: 'Ada', email: '', _sharing: 'public' }
		]);
		d.resolve({
			field: 'name',
			fromLevel: 'domain',
			toLevel: 'public',
			targetId: 'server-pub-1',
			sourceId: CREATED_DOMAIN._id
		});

		await waitFor(() => {
			expect(btn(container, 'profile-vis-name-public').getAttribute('aria-pressed')).toBe('true');
		});
		expect(displayValue(container, 'name')).toBe('Ada');
	});
});

describe('/profile — #160 no regression on the already-loaded profile', () => {
	const LOADED_DOMAIN = {
		_id: 'server-dom-1',
		name: 'Ada',
		email: '',
		_sharing: 'domain' as const
	};

	async function renderWithLoaded(profiles: typeof LOADED_DOMAIN[]): Promise<HTMLElement> {
		listMyProfilesMock.mockResolvedValue(profiles);
		selectSampledb();
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
		await waitFor(() => expect(displayValue(container, 'name')).toBe(profiles[0].name));
		return container;
	}

	it('a loaded profile holding name but NOT email leaves the email tiers disabled', async () => {
		const container = await renderWithLoaded([LOADED_DOMAIN]);

		expect(btn(container, 'profile-vis-name-public').disabled).toBe(false);

		expect(btn(container, 'profile-vis-email-private').disabled).toBe(true);
		expect(btn(container, 'profile-vis-email-public').disabled).toBe(true);
	});

	it('the symmetric case: a loaded profile holding email but NOT name leaves the name tiers disabled', async () => {
		const container = await renderWithLoaded([
			{ ...LOADED_DOMAIN, name: '', email: 'ada@example.org' }
		]);

		expect(btn(container, 'profile-vis-email-public').disabled).toBe(false);
		expect(btn(container, 'profile-vis-name-public').disabled).toBe(true);
	});

	it('re-saving a loaded field REPLACES its holder — one domain entry, no conflict or repair banner', async () => {
		const container = await renderWithLoaded([LOADED_DOMAIN]);
		applyProfileSaveMock.mockResolvedValue({ profileId: LOADED_DOMAIN._id });

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada Lovelace' } });
		await fireEvent.blur(nameInput);
		await waitFor(() => expect(applyProfileSaveMock).toHaveBeenCalledTimes(1));
		expect(applyProfileSaveMock.mock.calls[0][0]).toMatchObject({
			level: 'domain',
			existingId: LOADED_DOMAIN._id,
			fields: { name: 'Ada Lovelace', email: '' }
		});

		await waitFor(() =>
			expect(btn(container, 'profile-vis-name-domain').getAttribute('aria-busy')).toBeNull()
		);
		expect(q(container, '[data-testid="profile-visibility-repair-name"]')).toBeNull();
		expect(q(container, '[data-testid="profile-vis-name-conflict-note"]')).toBeNull();

		applyFieldMoveMock.mockReturnValueOnce(new Promise(() => {})); // never settles
		expect(btn(container, 'profile-vis-name-public').disabled).toBe(false);
		await fireEvent.click(btn(container, 'profile-vis-name-public'));

		await waitFor(() => expect(applyFieldMoveMock).toHaveBeenCalledTimes(1));
		expect(applyFieldMoveMock.mock.calls[0][0]).toMatchObject({
			field: 'name',
			fromLevel: 'domain',
			toLevel: 'public',
			value: 'Ada Lovelace',
			srcId: LOADED_DOMAIN._id,
			dstId: null
		});
	});
});

describe('/profile — #160 a save that CLEARS a field still releases its saving marker', () => {
	const LOADED_PUBLIC = {
		_id: 'server-pub-1',
		name: 'Ada',
		email: 'ada@example.org',
		_sharing: 'public' as const
	};

	async function renderLoadedAtPublic(): Promise<HTMLElement> {
		listMyProfilesMock.mockResolvedValue([LOADED_PUBLIC]);
		selectSampledb();
		const { container } = render(Page);
		await waitFor(() => expect(displayValue(container, 'name')).toBe('Ada'));
		return container;
	}

	it('clearing the name held at PUBLIC leaves no tier reporting aria-busy', async () => {
		const container = await renderLoadedAtPublic();
		expect(btn(container, 'profile-vis-name-public').getAttribute('aria-pressed')).toBe('true');

		applyProfileSaveMock.mockResolvedValue({ profileId: LOADED_PUBLIC._id });
		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: '' } });
		await fireEvent.blur(nameInput);
		await waitFor(() => expect(applyProfileSaveMock).toHaveBeenCalledTimes(1));
		expect(applyProfileSaveMock.mock.calls[0][0]).toMatchObject({
			level: 'public',
			existingId: LOADED_PUBLIC._id,
			fields: { name: '', email: 'ada@example.org' }
		});

		await waitFor(() =>
			expect(btn(container, 'profile-vis-name-domain').getAttribute('aria-pressed')).toBe('true')
		);

		for (const level of ['private', 'domain', 'public'] as const) {
			expect(
				btn(container, `profile-vis-name-${level}`).getAttribute('aria-busy'),
				`name/${level} must not stay busy after the clearing save reconciled`
			).toBeNull();
		}
		expect(q(container, '[data-testid="profile-vis-name-domain-saving"]')).toBeNull();
		expect(btn(container, 'profile-vis-email-public').getAttribute('aria-pressed')).toBe('true');
		expect(btn(container, 'profile-vis-email-public').getAttribute('aria-busy')).toBeNull();
	});
});

describe('/profile — #160 the created-but-unconfirmed shell', () => {
	const LOADED_PUBLIC_NAME = {
		_id: 'server-pub-1',
		name: 'Ada',
		email: '',
		_sharing: 'public' as const
	};

	async function renderThenFailEmailCreate(): Promise<HTMLElement> {
		listMyProfilesMock.mockResolvedValue([LOADED_PUBLIC_NAME]);
		selectSampledb();
		const { container } = render(Page);
		await waitFor(() => expect(displayValue(container, 'name')).toBe('Ada'));

		applyProfileSaveMock.mockRejectedValueOnce(
			new ProfileSaveError('field write failed after create', 'server-dom-1')
		);
		const emailInput = await openEditor(container, 'email');
		await fireEvent.input(emailInput, { target: { value: 'ada@example.org' } });
		await fireEvent.blur(emailInput);
		await waitFor(() => expect(applyProfileSaveMock).toHaveBeenCalledTimes(1));
		expect(applyProfileSaveMock.mock.calls[0][0]).toMatchObject({
			level: 'domain',
			existingId: null
		});
		await waitFor(() => expect(q(container, '[data-testid="profile-email-error"]')).not.toBeNull());
		return container;
	}

	it('holds no value, so it must not wake the email tiers up', async () => {
		const container = await renderThenFailEmailCreate();

		expect(
			btn(container, 'profile-vis-email-public').disabled,
			'an empty shell is not a holder — the email tiers stay locked'
		).toBe(true);
		expect(btn(container, 'profile-vis-email-private').disabled).toBe(true);
		expect(btn(container, 'profile-vis-email-domain').getAttribute('aria-pressed')).toBe('true');
	});

	it('is REUSED by the retry — the second save UPDATES it instead of creating a duplicate', async () => {
		const container = await renderThenFailEmailCreate();

		applyProfileSaveMock.mockResolvedValue({ profileId: 'server-dom-1' });
		const emailInput = await openEditor(container, 'email');
		await fireEvent.input(emailInput, { target: { value: 'ada@example.com' } });
		await fireEvent.blur(emailInput);
		await waitFor(() => expect(applyProfileSaveMock).toHaveBeenCalledTimes(2));
		expect(applyProfileSaveMock.mock.calls[1][0]).toMatchObject({
			level: 'domain',
			existingId: 'server-dom-1'
		});

		await waitFor(() => expect(q(container, '[data-testid="profile-email-error"]')).toBeNull());
		expect(btn(container, 'profile-vis-email-public').disabled).toBe(false);
	});

	it('is the DESTINATION of a later move into that tier — no second domain entity', async () => {
		const container = await renderThenFailEmailCreate();

		applyFieldMoveMock.mockReturnValueOnce(new Promise(() => {})); // never settles
		expect(btn(container, 'profile-vis-name-domain').disabled).toBe(false);
		await fireEvent.click(btn(container, 'profile-vis-name-domain'));

		await waitFor(() => expect(applyFieldMoveMock).toHaveBeenCalledTimes(1));
		expect(applyFieldMoveMock.mock.calls[0][0]).toMatchObject({
			field: 'name',
			fromLevel: 'public',
			toLevel: 'domain',
			value: 'Ada',
			srcId: LOADED_PUBLIC_NAME._id,
			dstId: 'server-dom-1'
		});
	});
});

// (*MVOX:Tallis*)
