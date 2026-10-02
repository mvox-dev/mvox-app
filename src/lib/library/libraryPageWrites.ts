// The library page's writes, over state the page owns and hands in as getters.
import { m } from '$lib/paraglide/messages.js';
import { cfgFor } from '$lib/entu/cfg';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { Collective } from '$lib/collectives/types';
import type { RouteLoadMachine } from '$lib/loading/routeLoad';
import { refreshLibraryLendings, resolveWriteLibraryId } from '$lib/library/libraryPageData';
import { createLending, returnLending, bulkCheckout } from '$lib/library/lendingActions';
import { createWork, createEdition } from '$lib/entity/entityCreate';
import { uploadEditionFiles } from '$lib/library/editionFiles';
import { without } from '$lib/collections/immutable';
import {
	applyLendings,
	applyUploadFailures,
	closeEditionDraft,
	closeWorkForm,
	endUpload,
	markUploadBatchError,
	setEditionDraftError,
	setEditionDraftPending,
	startUpload,
	updateEditionFiles,
	type BulkCheckout,
	type EditionDrafts,
	type EditionFilesState,
	type LibraryState,
	type WorkForm
} from '$lib/library/libraryState';

export interface LibraryWriteContext {
	selected: () => Collective | null;
	isOffline: () => boolean;
	lib: LibraryState;
	workForm: () => WorkForm;
	editionDrafts: () => EditionDrafts;
	bulk: () => BulkCheckout;
	fileUploads: EditionFilesState;
	routeLoad: RouteLoadMachine;
	setLendingsPartial: (partial: boolean) => void;
	setReturnError: (message: string) => void;
}

export function createLibraryWrites(ctx: LibraryWriteContext) {
	const { lib, fileUploads, routeLoad } = ctx;

	async function requireWriteLibraryId(cfg: EntuCfg, fn: string): Promise<string> {
		const libraryId = await resolveWriteLibraryId(cfg);
		if (!libraryId) throw new Error(`${fn}: no library entity under this collective`);
		return libraryId;
	}

	async function refreshLendings(cfg: EntuCfg): Promise<void> {
		const refreshed = await refreshLibraryLendings(cfg);
		ctx.setLendingsPartial(applyLendings(lib, refreshed));
	}

	async function submitCreateWork(): Promise<void> {
		if (ctx.workForm().pending) return;
		if (ctx.isOffline()) return;
		ctx.workForm().error = null;
		ctx.workForm().status = '';
		const current = ctx.selected();
		if (!current) {
			console.error('library: create work with no collective');
			ctx.workForm().error = m.library_create_work_error;
			return;
		}
		const name = ctx.workForm().name.trim();
		if (!name) {
			ctx.workForm().error = m.library_create_work_name_required;
			return;
		}
		const composer = ctx.workForm().composer.trim();
		const cfg = cfgFor(current.db);

		let newId: string;
		ctx.workForm().pending = true;
		try {
			// The parent is resolved live: a GET inside a write never answers from the cache.
			const libraryId = await requireWriteLibraryId(cfg, 'submitCreateWork');
			newId = await createWork(cfg, { name, composer, libraryEntityId: libraryId });
		} catch (e) {
			console.error('library: create work failed', name, e);
			ctx.workForm().error = m.library_create_work_error;
			return;
		} finally {
			ctx.workForm().pending = false;
		}

		lib.works = [...lib.works, { id: newId, name, composer }];
		ctx.workForm().status = m.library_create_work_created({ name });
		closeWorkForm(ctx.workForm());
	}

	async function submitCreateEdition(workId: string): Promise<void> {
		if (ctx.editionDrafts().pending.has(workId)) return;
		if (ctx.isOffline()) return;
		setEditionDraftError(ctx.editionDrafts(), workId, null);
		ctx.editionDrafts().statuses = new Map(ctx.editionDrafts().statuses).set(workId, '');
		const current = ctx.selected();
		if (!current) {
			console.error('library: create edition with no collective', { workId });
			setEditionDraftError(ctx.editionDrafts(), workId, m.library_create_edition_error);
			return;
		}
		const name = (ctx.editionDrafts().name.get(workId) ?? '').trim();
		if (!name) {
			setEditionDraftError(ctx.editionDrafts(), workId, m.library_create_edition_name_required);
			return;
		}
		const publisher = (ctx.editionDrafts().publisher.get(workId) ?? '').trim();
		const cfg = cfgFor(current.db);

		// A collective switch during the create must not insert into the new collective's tree.
		const g = routeLoad.generation;

		let newId: string;
		setEditionDraftPending(ctx.editionDrafts(), workId, true);
		try {
			newId = await createEdition(cfg, { name, publisher, workId });
		} catch (e) {
			console.error('library: create edition failed', workId, name, e);
			setEditionDraftError(ctx.editionDrafts(), workId, m.library_create_edition_error);
			return;
		} finally {
			setEditionDraftPending(ctx.editionDrafts(), workId, false);
		}

		if (!routeLoad.isCurrent(g)) return;

		const list = lib.editionsByWork.get(workId) ?? [];
		lib.editionsByWork = new Map(lib.editionsByWork).set(workId, [
			...list,
			{ id: newId, name, publisher, externalLinks: [], files: [] }
		]);
		ctx.editionDrafts().statuses = new Map(ctx.editionDrafts().statuses).set(
			workId,
			m.library_create_edition_created({ name })
		);
		closeEditionDraft(ctx.editionDrafts(), workId);
	}

	async function handleAttachFiles(editionId: string, fileList: FileList | null): Promise<void> {
		if (!fileList || fileList.length === 0) return;
		if (ctx.isOffline()) return;
		const files = Array.from(fileList);
		const current = ctx.selected();
		if (!current) {
			console.error('library: attach files with no collective', { editionId });
			markUploadBatchError(fileUploads, editionId);
			return;
		}
		const cfg = cfgFor(current.db);

		// Both halves of a mixed result apply only if no collective switch happened meanwhile.
		const g = routeLoad.generation;
		startUpload(fileUploads, editionId);

		let result: Awaited<ReturnType<typeof uploadEditionFiles>>;
		try {
			result = await uploadEditionFiles(cfg, editionId, files);
		} catch (e) {
			console.error('library: attach files failed', editionId, e);
			if (routeLoad.isCurrent(g)) markUploadBatchError(fileUploads, editionId);
			return;
		} finally {
			endUpload(fileUploads, editionId);
		}

		if (!routeLoad.isCurrent(g)) return;

		if (result.uploaded.length > 0) {
			updateEditionFiles(lib, editionId, (existing) => [
				...existing,
				...result.uploaded.map((u) => ({
					id: u.propertyId,
					filename: u.filename,
					filesize: u.filesize,
					filetype: u.filetype
				}))
			]);
			fileUploads.statuses = new Map(fileUploads.statuses).set(
				editionId,
				m.library_edition_file_uploaded({
					filenames: result.uploaded.map((u) => u.filename).join(', ')
				})
			);
		}
		applyUploadFailures(fileUploads, editionId, result.failed);
	}

	// #76 — picking a member checks out at once. Lendings are re-read after the write, so
	// availability is server-confirmed, never an optimistic flip.
	async function handleInlineCheckout(copyId: string, memberId: string): Promise<void> {
		if (ctx.isOffline()) return;
		lib.inlineCheckoutErrors = without(lib.inlineCheckoutErrors, copyId);
		const current = ctx.selected();
		if (!current) return;
		const cfg = cfgFor(current.db);
		try {
			const libraryId = await requireWriteLibraryId(cfg, 'handleInlineCheckout');
			await createLending(cfg, libraryId, {
				copyId,
				memberId,
				assignedAt: new Date().toISOString().slice(0, 10)
			});
			// Stores without serving: the live answer or a rejection, never pre-write availability.
			await refreshLendings(cfg);
		} catch (e) {
			console.error('library: inline checkout failed', copyId, e);
			const errNext = new Map(lib.inlineCheckoutErrors);
			errNext.set(copyId, e instanceof Error ? e.message : m.library_inline_checkout_error());
			lib.inlineCheckoutErrors = errNext;
		}
	}

	async function handleReturn(lendingId: string): Promise<void> {
		if (ctx.isOffline()) return;
		ctx.setReturnError('');
		const current = ctx.selected();
		if (!current) return;
		const cfg = cfgFor(current.db);
		try {
			await returnLending(cfg, lendingId);
			await refreshLendings(cfg);
		} catch (e) {
			console.error('library: return failed', e);
			ctx.setReturnError(e instanceof Error ? e.message : 'Return failed');
		}
	}

	async function handleBulkCheckout(): Promise<void> {
		if (ctx.isOffline()) return;
		ctx.bulk().error = '';
		const current = ctx.selected();
		if (!current) return;
		if (!ctx.bulk().editionId || ctx.bulk().members.size === 0) return;
		const cfg = cfgFor(current.db);
		const activeLendings = lib.lendings.filter((l) => l.returnedAt === '');
		try {
			const libraryId = await requireWriteLibraryId(cfg, 'handleBulkCheckout');
			const result = await bulkCheckout(cfg, libraryId, {
				editionId: ctx.bulk().editionId,
				memberIds: [...ctx.bulk().members],
				assignedAt: new Date().toISOString().slice(0, 10),
				...(ctx.bulk().dueDate ? { assignedUntil: ctx.bulk().dueDate } : {})
			}, activeLendings);
			if (result.failed.length > 0) {
				ctx.bulk().error = `${result.failed.length} checkout(s) failed`;
			}
			await refreshLendings(cfg);
			ctx.bulk().members = new Set();
			ctx.bulk().dueDate = '';
		} catch (e) {
			console.error('library: bulk checkout failed', e);
			ctx.bulk().error = e instanceof Error ? e.message : 'Bulk checkout failed';
		}
	}

	return {
		submitCreateWork,
		submitCreateEdition,
		handleAttachFiles,
		handleInlineCheckout,
		handleReturn,
		handleBulkCheckout
	};
}
