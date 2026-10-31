// The library page's writes, over state the page owns and hands in as getters.
import { m } from '$lib/paraglide/messages.js';
import { cfgFor, type EntuCfg } from '$lib/entu/cfg';
import type { Collective } from '$lib/collectives/types';
import type { RouteLoadMachine } from '$lib/loading/routeLoad';
import { refreshLibraryLendings, resolveWriteLibraryId } from '$lib/library/libraryPageData';
import {
	bulkCheckout,
	createLending,
	returnLending,
	type BulkResult
} from '$lib/library/lendingActions';
import type { CollectiveIdentity } from '$lib/collectives/store';
import { createWork, createEdition } from '$lib/entity/entityCreate';
import { uploadEditionFiles } from '$lib/library/editionFiles';
import { isActiveLending } from '$lib/library/libraryData';
import { without } from '$lib/collections/immutable';
import { localDayKey } from '$lib/preferences/timeFormat';
import { reportProblem } from '$lib/problems/reportProblem';
import { problemOwnerNow } from '$lib/problems/problemLog';
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

	// Loans read for one collective never land on another's page.
	async function refreshLendings(cfg: EntuCfg, g: number): Promise<void> {
		const refreshed = await refreshLibraryLendings(cfg);
		if (routeLoad.isCurrent(g)) ctx.setLendingsPartial(applyLendings(lib, refreshed));
	}

	async function submitCreateWork(): Promise<void> {
		if (ctx.workForm().pending) return;
		if (ctx.isOffline()) return;
		ctx.workForm().error = null;
		ctx.workForm().status = '';
		const current = ctx.selected();
		if (!current) {
			const reason = 'no collective is selected';
			reportProblem({ area: 'library', action: 'creating a work', reason });
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

		const g = routeLoad.generation;
		const owner = problemOwnerNow();
		let newId: string;
		ctx.workForm().pending = true;
		try {
			// The parent is resolved live: a GET inside a write never answers from the cache.
			const libraryId = await requireWriteLibraryId(cfg, 'submitCreateWork');
			newId = await createWork(cfg, { name, composer, libraryEntityId: libraryId });
		} catch (e) {
			reportProblem({ area: 'library', action: 'creating a work', error: e, owner });
			if (routeLoad.isCurrent(g)) ctx.workForm().error = m.library_create_work_error;
			return;
		} finally {
			ctx.workForm().pending = false;
		}

		if (!routeLoad.isCurrent(g)) return;
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
			const reason = 'no collective is selected';
			reportProblem({ area: 'library', action: 'creating an edition', reason });
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
		const owner = problemOwnerNow();

		let newId: string;
		setEditionDraftPending(ctx.editionDrafts(), workId, true);
		try {
			newId = await createEdition(cfg, { name, publisher, workId });
		} catch (e) {
			reportProblem({ area: 'library', action: 'creating an edition', error: e, owner });
			if (routeLoad.isCurrent(g)) {
				setEditionDraftError(ctx.editionDrafts(), workId, m.library_create_edition_error);
			}
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
			const reason = 'no collective is selected';
			reportProblem({ area: 'library', action: 'attaching files', reason });
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
			if (routeLoad.isCurrent(g)) {
				reportProblem({ area: 'library', action: 'attaching files', error: e });
				markUploadBatchError(fileUploads, editionId);
			} else console.error('library: attach files failed', editionId, e);
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
		for (const { reason } of result.failed) {
			reportProblem({ area: 'library', action: 'attaching a file', reason });
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
		const g = routeLoad.generation;
		const owner = problemOwnerNow();
		try {
			const libraryId = await requireWriteLibraryId(cfg, 'handleInlineCheckout');
			await createLending(cfg, libraryId, {
				copyId,
				memberId,
				assignedAt: localDayKey(new Date())
			});
		} catch (e) {
			reportProblem({ area: 'library', action: 'checking out a copy', error: e, owner });
			if (routeLoad.isCurrent(g)) setInlineCheckoutError(copyId, m.library_inline_checkout_error());
			return;
		}
		// Stores without serving: the live answer or a rejection, never pre-write availability.
		if (!(await refreshAfterWrite(cfg, owner, g)) && routeLoad.isCurrent(g)) {
			setInlineCheckoutError(copyId, m.library_lendings_refresh_error());
		}
	}

	function setInlineCheckoutError(copyId: string, message: string): void {
		lib.inlineCheckoutErrors = new Map(lib.inlineCheckoutErrors).set(copyId, message);
	}

	// The write landed: a failed re-read must not read as a failed write, or a retry lends twice.
	async function refreshAfterWrite(
		cfg: EntuCfg,
		owner: CollectiveIdentity | null,
		g: number
	): Promise<boolean> {
		if (!routeLoad.isCurrent(g)) return true;
		try {
			await refreshLendings(cfg, g);
			return true;
		} catch (e) {
			reportProblem({ area: 'library', action: 'refreshing the loans', error: e, owner });
			return false;
		}
	}

	async function handleReturn(lendingId: string): Promise<void> {
		if (ctx.isOffline()) return;
		ctx.setReturnError('');
		const current = ctx.selected();
		if (!current) return;
		const cfg = cfgFor(current.db);
		const g = routeLoad.generation;
		const owner = problemOwnerNow();
		try {
			await returnLending(cfg, lendingId);
		} catch (e) {
			reportProblem({ area: 'library', action: 'returning a copy', error: e, owner });
			if (routeLoad.isCurrent(g)) ctx.setReturnError(m.library_return_error());
			return;
		}
		if (!(await refreshAfterWrite(cfg, owner, g)) && routeLoad.isCurrent(g)) {
			ctx.setReturnError(m.library_lendings_refresh_error());
		}
	}

	function reportBulkFailures(
		failed: BulkResult['failed'],
		total: number,
		owner: CollectiveIdentity | null
	): void {
		const reasons = failed
			.filter((f) => !f.expired)
			.map((f) => (f.copyId ? `${f.copyId}: ${f.error}` : f.error));
		if (reasons.length === 0) return;
		const reason = `${failed.length} of ${total} checkouts failed: ${reasons.join('; ')}`;
		reportProblem({ area: 'library', action: 'checking out copies', reason, owner });
	}

	async function handleBulkCheckout(): Promise<void> {
		if (ctx.isOffline()) return;
		ctx.bulk().error = '';
		const current = ctx.selected();
		if (!current) return;
		if (!ctx.bulk().editionId || ctx.bulk().members.size === 0) return;
		const cfg = cfgFor(current.db);
		const activeLendings = lib.lendings.filter(isActiveLending);
		const memberIds = [...ctx.bulk().members];
		const g = routeLoad.generation;
		const owner = problemOwnerNow();
		let result: BulkResult;
		try {
			const libraryId = await requireWriteLibraryId(cfg, 'handleBulkCheckout');
			result = await bulkCheckout(cfg, libraryId, {
				editionId: ctx.bulk().editionId,
				memberIds,
				assignedAt: localDayKey(new Date()),
				...(ctx.bulk().dueDate ? { assignedUntil: ctx.bulk().dueDate } : {})
			}, activeLendings);
		} catch (e) {
			reportProblem({ area: 'library', action: 'checking out copies', error: e, owner });
			if (routeLoad.isCurrent(g)) ctx.bulk().error = m.library_bulk_checkout_error();
			return;
		}
		let partial = '';
		if (result.failed.length > 0) {
			const counts = { failed: result.failed.length, total: memberIds.length };
			partial = m.library_bulk_checkout_partial(counts);
			reportBulkFailures(result.failed, memberIds.length, owner);
		}
		if (!routeLoad.isCurrent(g)) return;
		ctx.bulk().error = partial;
		const refreshed = await refreshAfterWrite(cfg, owner, g);
		if (!routeLoad.isCurrent(g)) return;
		// A failed re-read is its own fact, said after any partial one.
		if (refreshed) {
			ctx.bulk().members = new Set();
			ctx.bulk().dueDate = '';
		} else {
			ctx.bulk().error = [partial, m.library_lendings_refresh_error()].filter(Boolean).join(' ');
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
