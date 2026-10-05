// Send a feedback now, or keep it on the device and send it on its owner's own key when it can.
import { derived, get } from 'svelte/store';
import { authStore } from '$lib/auth/session';
import { getToken } from '$lib/auth/storage';
import { isAuthExpiredError } from '$lib/entu/auth-expired';
import { selectedCollectiveIdentityStore } from '$lib/collectives/store';
import { online } from '$lib/net/online';
import { findMyMemberId } from '$lib/rsvp/rsvpData';
import { createFeedback, type CreateFeedbackInput } from './feedbackActions';
import { capturePage, feedbackMetadata, readAppVersion } from './pageMetadata';
import { getSavedFeedbackStore, type SavedFeedback, type SavedFeedbackStore } from './savedFeedback';

export type FeedbackDraft = Omit<CreateFeedbackInput, 'metadata'>;
export type SendOutcome = 'sent' | 'saved' | 'after-sign-in';

interface SendDeps {
	fetchImpl?: typeof fetch;
	store?: SavedFeedbackStore | null;
}

const SEND_LOCK = 'mvox-saved-feedback-send';

function liveToken(): string | null {
	const auth = get(authStore);
	if (auth.status !== 'authenticated' || auth.expMs <= Date.now()) return null;
	return getToken();
}

async function deliver(item: SavedFeedback, token: string, fetchImpl: typeof fetch): Promise<void> {
	const cfg = { db: item.db, token };
	const metadata = feedbackMetadata(item.page, await readAppVersion(fetchImpl));
	const memberId = await findMyMemberId(cfg, item.personId, fetchImpl);
	if (!memberId) throw new Error(`sendFeedback: no active member row in '${item.db}'`);
	const { screenshot, strokes, description, pagePath } = item;
	await createFeedback(cfg, memberId, { screenshot, strokes, description, pagePath, metadata }, fetchImpl);
}

export async function sendFeedback(
	draft: FeedbackDraft,
	{ fetchImpl = fetch, store = getSavedFeedbackStore() }: SendDeps = {}
): Promise<SendOutcome> {
	const identity = get(selectedCollectiveIdentityStore);
	if (!identity) throw new Error('sendFeedback: no collective is selected');
	const item: SavedFeedback = {
		id: crypto.randomUUID(),
		...identity,
		...draft,
		page: capturePage(draft.pagePath)
	};
	const keep = async (outcome: SendOutcome) => {
		if (!store) throw new Error('sendFeedback: this device cannot keep feedback to send later');
		await store.put(item);
		return outcome;
	};

	if (!get(online)) return keep('saved');
	const token = liveToken();
	if (!token) return keep('after-sign-in');
	try {
		await deliver(item, token, fetchImpl);
		return 'sent';
	} catch (e) {
		if (isAuthExpiredError(e)) return keep('after-sign-in');
		// fetch rejects with a TypeError only when the request never got an answer.
		if (e instanceof TypeError) return keep('saved');
		throw e;
	}
}

// The lock spans every tab, and an item leaves the device only after Entu has confirmed it.
export async function sendSavedFeedback({
	fetchImpl = fetch,
	store = getSavedFeedbackStore()
}: SendDeps = {}): Promise<void> {
	if (!store) return;
	if (!navigator.locks) throw new Error('sendSavedFeedback: this browser has no navigator.locks');
	await navigator.locks.request(SEND_LOCK, async () => {
		const auth = get(authStore);
		const token = liveToken();
		if (auth.status !== 'authenticated' || !token) return;
		for (const [db, personId] of Object.entries(auth.personIdByDb)) {
			for (const item of await store.list(db, personId)) {
				try {
					await deliver(item, token, fetchImpl);
				} catch (e) {
					if (isAuthExpiredError(e) || e instanceof TypeError) return;
					console.error('a saved feedback could not be sent; it stays on the device', e);
					continue;
				}
				await store.delete(db, personId, item.id);
			}
		}
	});
}

export function startSendingSavedFeedback(): () => void {
	let ready = false;
	return derived(
		[online, authStore],
		([isOnline, auth]) => isOnline && auth.status === 'authenticated'
	).subscribe((now) => {
		if (now && !ready) {
			sendSavedFeedback().catch((e) => console.error('sending saved feedback failed', e));
		}
		ready = now;
	});
}

// (*MVOX:Josquin*)
