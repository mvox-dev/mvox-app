// Send a feedback now, or keep it on the device and send it on its owner's own key when it can.
import { derived, get } from 'svelte/store';
import { authStore } from '$lib/auth/session';
import { getToken } from '$lib/auth/storage';
import { isAuthExpiredError } from '$lib/entu/auth-expired';
import { selectedCollectiveIdentityStore } from '$lib/collectives/store';
import { online } from '$lib/net/online';
import { findMyMemberId } from '$lib/rsvp/rsvpData';
import { createFeedback, discardFeedback, type CreateFeedbackInput } from './feedbackActions';
import { capturePage, feedbackMetadata, readAppVersion } from './pageMetadata';
import { getSavedFeedbackStore, type SavedFeedback, type SavedFeedbackStore } from './savedFeedback';

export type FeedbackDraft = Omit<CreateFeedbackInput, 'metadata'>;
export type SendOutcome = 'sent' | 'saved' | 'after-sign-in';

interface SendDeps {
	fetchImpl?: typeof fetch;
	store?: SavedFeedbackStore | null;
}

const SEND_LOCK = 'mvox-saved-feedback-send';
export const FIRST_RETRY_MS = 15_000;
const MAX_RETRY_MS = 5 * 60_000;

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryMs = FIRST_RETRY_MS;

// The online flag can stay true with no uplink, so a send that got no answer retries on a backoff.
function retryLater(deps: SendDeps): void {
	if (retryTimer) return;
	retryTimer = setTimeout(() => {
		retryTimer = null;
		if (!get(online)) return;
		sendSavedFeedback(deps).catch((e) => console.error('sending saved feedback failed', e));
	}, retryMs);
	retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
}

export function cancelSavedFeedbackRetry(): void {
	if (retryTimer) clearTimeout(retryTimer);
	retryTimer = null;
	retryMs = FIRST_RETRY_MS;
}

function liveToken(): string | null {
	const auth = get(authStore);
	if (auth.status !== 'authenticated' || auth.expMs <= Date.now()) return null;
	return getToken();
}

async function deliver(
	item: SavedFeedback,
	token: string,
	fetchImpl: typeof fetch,
	persist?: (item: SavedFeedback) => Promise<void>
): Promise<void> {
	const cfg = { db: item.db, token };
	// An earlier attempt was cut off after its create: replace that entity, never add a second.
	if (item.entityId) await discardFeedback(cfg, item.entityId, fetchImpl);
	const metadata = feedbackMetadata(item.page, await readAppVersion(fetchImpl));
	const memberId = await findMyMemberId(cfg, item.personId, fetchImpl);
	if (!memberId) throw new Error(`sendFeedback: no active member row in '${item.db}'`);
	const { screenshot, strokes, description, pagePath } = item;
	const input = { screenshot, strokes, description, pagePath, metadata };
	await createFeedback(cfg, memberId, input, fetchImpl, async (id) => {
		item.entityId = id;
		await persist?.(item);
	});
}

export async function sendFeedback(
	draft: FeedbackDraft,
	{ fetchImpl = fetch, store = getSavedFeedbackStore() }: SendDeps = {}
): Promise<SendOutcome> {
	const deps = { fetchImpl, store };
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
		if (!(e instanceof TypeError)) throw e;
		const outcome = await keep('saved');
		retryLater(deps);
		return outcome;
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
					await deliver(item, token, fetchImpl, (kept) => store.put(kept));
				} catch (e) {
					if (isAuthExpiredError(e)) return;
					if (e instanceof TypeError) return retryLater({ fetchImpl, store });
					console.error('a saved feedback could not be sent; it stays on the device', e);
					continue;
				}
				await store.delete(db, personId, item.id);
			}
		}
		if (!retryTimer) retryMs = FIRST_RETRY_MS;
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
