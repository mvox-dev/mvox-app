// Sends her waiting ink to Entu and reads hers back (#1069), on her own key only. A send joins
// into what Entu holds, so nothing another device sent is lost; an item leaves the device only
// after Entu took it. No answer retries on this sync's own backoff; an ended session stops it.
import { derived, get } from 'svelte/store';
import { authStore } from '$lib/auth/session';
import { getToken } from '$lib/auth/storage';
import { isAuthExpiredError } from '$lib/entu/auth-expired';
import { cfgFor, type EntuCfg } from '$lib/entu/cfg';
import { compositeKey, type FileKey } from '$lib/files/idb';
import { online } from '$lib/net/online';
import { reportProblem } from '$lib/problems/reportProblem';
import {
	createInkLayer,
	editionOfFile,
	findInkLayers,
	latestPlace,
	writeInkPage,
	writeInkPlace
} from './inkLayerData';
import { joinLogs, type InkLog } from './inkLog';
import type { InkStore, RemoteInk } from './inkStore';
import type { InkSyncItem, InkSyncQueue } from './inkSyncQueue';

export const INK_SYNC_LOCK = 'mvox-ink-sync';
export const FIRST_RETRY_MS = 15_000;
const MAX_RETRY_MS = 5 * 60_000;

export interface InkSyncDeps {
	queue: InkSyncQueue;
	device: InkStore;
	fetchImpl?: typeof fetch;
}

export interface InkSync {
	flush(): Promise<void>;
	pull(part: FileKey): Promise<RemoteInk | null>;
	start(): () => void;
	cancel(): void;
}

function liveToken(): string | null {
	const auth = get(authStore);
	if (auth.status !== 'authenticated' || auth.expMs <= Date.now()) return null;
	return getToken();
}

/** Signed in as this part's owner: nobody else's key ever reads or writes her layer. */
function ownerToken(part: FileKey): string | null {
	const auth = get(authStore);
	if (auth.status !== 'authenticated' || auth.personIdByDb[part.db] !== part.personId) return null;
	return liveToken();
}

export function createInkSync({ queue, device, fetchImpl = (...a) => fetch(...a) }: InkSyncDeps): InkSync {
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	let retryMs = FIRST_RETRY_MS;
	let running: Promise<void> | null = null;
	let again = false;
	const editions = new Map<string, string>();
	const layers = new Map<string, string>();
	// One report per collective until a send there lands: a refusal repeats on every page.
	const reported = new Set<string>();

	async function editionOf(cfg: EntuCfg, fileId: string): Promise<string> {
		const key = compositeKey(cfg.db, '', fileId);
		const known = editions.get(key);
		if (known) return known;
		const id = await editionOfFile(cfg, fileId, fetchImpl);
		editions.set(key, id);
		return id;
	}

	async function layerParts(cfg: EntuCfg, part: FileKey) {
		const editionId = await editionOf(cfg, part.fileId);
		return { personId: part.personId, editionId, fileId: part.fileId };
	}

	// Her oldest layer takes the writes; a second one, made offline elsewhere, is still read.
	async function layerFor(cfg: EntuCfg, part: FileKey): Promise<string> {
		const key = compositeKey(part.db, part.personId, part.fileId);
		const known = layers.get(key);
		if (known) return known;
		const layerPart = await layerParts(cfg, part);
		const [first] = await findInkLayers(cfg, layerPart, fetchImpl);
		const id = first?._id ?? (await createInkLayer(cfg, layerPart, fetchImpl));
		layers.set(key, id);
		return id;
	}

	async function send(cfg: EntuCfg, item: InkSyncItem): Promise<void> {
		const layerId = await layerFor(cfg, item);
		if (item.kind === 'place') return writeInkPlace(cfg, layerId, item.page, fetchImpl);
		await writeInkPage(cfg, layerId, item.page, await device.load(item), fetchImpl);
	}

	function retryLater(): void {
		if (retryTimer) return;
		retryTimer = setTimeout(() => {
			retryTimer = null;
			if (get(online)) void flush();
		}, retryMs);
		retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
	}

	async function waiting(): Promise<boolean> {
		const auth = get(authStore);
		if (auth.status !== 'authenticated') return false;
		for (const [db, personId] of Object.entries(auth.personIdByDb)) {
			if ((await queue.list({ db, personId })).length > 0) return true;
		}
		return false;
	}

	async function drain(): Promise<void> {
		if (!(await waiting())) return;
		if (!navigator.locks) throw new Error('ink sync: this browser has no navigator.locks');
		await navigator.locks.request(INK_SYNC_LOCK, async () => {
			const auth = get(authStore);
			const token = liveToken();
			if (auth.status !== 'authenticated' || !token) return;
			let refused = false;
			for (const [db, personId] of Object.entries(auth.personIdByDb)) {
				const identity = { db, personId };
				const cfg = cfgFor(db, token);
				for (const item of await queue.list(identity)) {
					try {
						await send(cfg, item);
					} catch (error) {
						if (isAuthExpiredError(error)) return;
						if (error instanceof TypeError) return retryLater();
						refused = true;
						const key = compositeKey(db, personId, '');
						if (!reported.has(key)) {
							reported.add(key);
							reportProblem({ area: 'part', action: 'syncing the marks', error, owner: identity });
						}
						continue;
					}
					reported.delete(compositeKey(db, personId, ''));
					await queue.done(item);
				}
			}
			if (refused) retryLater();
			else if (!retryTimer) retryMs = FIRST_RETRY_MS;
		});
	}

	// A save during a send sets `again`: the queue is read once more before the flush settles.
	function flush(): Promise<void> {
		if (!get(online)) return Promise.resolve();
		if (running) {
			again = true;
			return running;
		}
		running = (async () => {
			try {
				do {
					again = false;
					await drain();
				} while (again);
			} finally {
				running = null;
			}
		})();
		return running;
	}

	async function pull(part: FileKey): Promise<RemoteInk | null> {
		const token = ownerToken(part);
		if (!get(online) || !token) return null;
		const cfg = cfgFor(part.db, token);
		const found = await findInkLayers(cfg, await layerParts(cfg, part), fetchImpl);
		if (found[0]) layers.set(compositeKey(part.db, part.personId, part.fileId), found[0]._id);
		const pages: Record<number, InkLog> = {};
		for (const layer of found) {
			for (const { page, log } of layer.pages) pages[page] = joinLogs(pages[page] ?? log, log);
		}
		return { pages, page: await latestPlace(cfg, found, fetchImpl) };
	}

	function start(): () => void {
		let ready = false;
		const run = () => flush().catch((error) => reportProblem({ area: 'part', action: 'syncing the marks', error }));
		return derived([online, authStore], ([isOnline, auth]) => isOnline && auth.status === 'authenticated').subscribe(
			(now) => {
				if (now && !ready) run();
				ready = now;
			}
		);
	}

	function cancel(): void {
		if (retryTimer) clearTimeout(retryTimer);
		retryTimer = null;
		retryMs = FIRST_RETRY_MS;
		reported.clear();
	}

	return { flush, pull, start, cancel };
}

// (*MVOX:Josquin*)
