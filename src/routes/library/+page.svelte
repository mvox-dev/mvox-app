<script lang="ts">
	// #54/#73 — the library: works, editions and copies with availability from lending, the
	// member's own loans, and the librarian's tools. The page owns every load and every write.
	import { openPart } from '$lib/parts/openPart';
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import { formatLoanChainLabel, type Edition, type Work } from '$lib/library/libraryData';
	// #434 — the library's own cache-backed entry points; the shared readers stay unused here.
	import {
		loadLibraryListing,
		loadLibraryEditions,
		loadLibraryCopies,
		refreshLibraryLendings,
		loadLibrarianState,
		loadLibrarianPickers,
		loadLibrarianMemberNames,
		resolveWriteLibraryId,
		loadMyMemberId,
		loadMyLoanCopyNames,
		loadMyLoanCopyChains
	} from '$lib/library/libraryPageData';
	import AsOfLine from '$lib/components/offline/AsOfLine.svelte';
	import { resetServedFromCache, servedFromCache } from '$lib/entu/readCache';
	import { librarianStore, resetLibrarian } from '$lib/library/librarianStore';
	import { createLending, returnLending, bulkCheckout } from '$lib/library/lendingActions';
	import { createWork, createEdition } from '$lib/entity/entityCreate';
	import { uploadEditionFiles, formatFileSize } from '$lib/library/editionFiles';
	import { getAppByteStore } from '$lib/files/appByteStore';
	import { listSeasons } from '$lib/seasons/entuSeasons';
	import { currentSeason } from '$lib/attendance/conductorLogic';
	import { listRepertoireItems, type RepertoireItem } from '$lib/repertoire/repertoireData';
	import { isAuthExpiredError } from '$lib/entu/request';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { createRouteLoadMachine, type RouteLoadStatus } from '$lib/loading/routeLoad';
	import { writesAvailable } from '$lib/net/online';
	import { createLendingView } from '$lib/library/lendingView';
	import {
		applyLendings,
		applyUploadFailures,
		closeEditionDraft,
		closeWorkForm,
		createBulkCheckout,
		createEditionDrafts,
		createEditionFilesState,
		createLibraryState,
		createWorkForm,
		endUpload,
		markUploadBatchError,
		resetBulkCheckout,
		resetTree,
		setEditionDraftError,
		setEditionDraftPending,
		startUpload,
		updateEditionFiles,
		workFormView,
		type TreeActions
	} from '$lib/library/libraryState';
	import MyLoansSection from '$lib/library/MyLoansSection.svelte';
	import BulkCheckoutPanel from '$lib/library/BulkCheckoutPanel.svelte';
	import InlineCreateForm from '$lib/library/InlineCreateForm.svelte';
	import WorkRow from '$lib/library/WorkRow.svelte';
	import { withItem, without } from '$lib/collections/immutable';

	const selected = $derived($selectedCollectiveStore);
	const isOffline = $derived(!$writesAvailable);
	const isLibrarian = $derived($librarianStore === 'librarian');

	let status = $state<RouteLoadStatus>('loading');
	const lib = $state(createLibraryState());
	const view = createLendingView(lib);
	let bulk = $state(createBulkCheckout());
	let workForm = $state(createWorkForm());
	let editionDrafts = $state(createEditionDrafts());
	const fileUploads = $state(createEditionFilesState());
	let myMemberId = $state<string | null>(null);
	let returnError = $state('');

	// #321 — one page-level notice whichever list read came back truncated.
	let worksPartial = $state(false);
	let lendingsPartial = $state(false);
	let editionsPartialWorkIds = $state<Set<string>>(new Set());
	let copiesPartialEditionIds = $state<Set<string>>(new Set());
	const libraryPartial = $derived(
		worksPartial ||
			lendingsPartial ||
			editionsPartialWorkIds.size > 0 ||
			copiesPartialEditionIds.size > 0
	);

	// #351 — one keys-only query per load, never a per-row get(), which counts as an open.
	// The last query issued wins: an earlier one resolving late describes an older store.
	let presenceSeq = 0;
	function refreshPresence(db: string, personId: string, isCurrent: () => boolean): void {
		const seq = ++presenceSeq;
		// Badges are supplementary: even a synchronous store failure must not take the tree down.
		try {
			getAppByteStore()
				.heldFileIds(db, personId)
				.then((ids) => {
					if (seq !== presenceSeq || !isCurrent()) return;
					lib.heldFileIds = new Set(ids);
				})
				.catch((e) => {
					console.error('library: file presence read failed', e);
				});
		} catch (e) {
			console.error('library: file presence read failed', e);
		}
	}

	// #321 — a picker claim must never outlive the options it described.
	function resetLibrarianPickerPartial(): void {
		lib.optionsPartial = false;
		lib.membersPartial = false;
	}

	async function submitCreateWork(): Promise<void> {
		if (workForm.pending) return;
		if (isOffline) return;
		workForm.error = null;
		workForm.status = '';
		const current = selected;
		const token = getToken();
		if (!current || !token) {
			console.error('library: create work with no cfg', {
				hasCollective: !!current,
				hasToken: !!token
			});
			workForm.error = m.library_create_work_error;
			return;
		}
		const name = workForm.name.trim();
		if (!name) {
			workForm.error = m.library_create_work_name_required;
			return;
		}
		const composer = workForm.composer.trim();
		const cfg = { db: current.db, token };

		let newId: string;
		workForm.pending = true;
		try {
			// The parent is resolved live: a GET inside a write never answers from the cache.
			const libraryId = await resolveWriteLibraryId(cfg);
			if (!libraryId) throw new Error('submitCreateWork: no library entity under this collective');
			newId = await createWork(cfg, { name, composer, libraryEntityId: libraryId });
		} catch (e) {
			console.error('library: create work failed', name, e);
			workForm.error = m.library_create_work_error;
			return;
		} finally {
			workForm.pending = false;
		}

		lib.works = [...lib.works, { id: newId, name, composer }];
		workForm.status = m.library_create_work_created({ name });
		closeWorkForm(workForm);
	}

	const routeLoad = createRouteLoadMachine({
		name: 'library',
		selected: () => selected,
		setStatus: (s) => {
			status = s;
		},
		reset: ({ isSwitch }) => {
			resetTree(lib);
			worksPartial = false;
			lendingsPartial = false;
			editionsPartialWorkIds = new Set();
			copiesPartialEditionIds = new Set();
			// #300 — only a switch clears the bulk selection; a refresh keeps one in progress.
			if (isSwitch) resetBulkCheckout(bulk);
		},
		onNoCollective: () => {
			lib.works = [];
			worksPartial = false;
		},
		async load({ cfg, selected: current, isCurrent }) {
			resetServedFromCache();
			const listing = await loadLibraryListing(cfg);
			if (!isCurrent()) return;
			lib.works = listing.works.items;
			worksPartial = listing.works.truncated;
			lendingsPartial = applyLendings(lib, listing);
			status = 'ready';

			// Cache-backed, so my-loans survives offline; a rejection must not take the listing down.
			loadMyMemberId(cfg, current.personId)
				.then((id) => {
					if (isCurrent()) myMemberId = id;
				})
				.catch((e) => {
					console.error('library: my-loans member resolution failed', e);
				});

			refreshPresence(cfg.db, current.personId, isCurrent);

			// #92 — repertoire badges for the current season only; supplementary, so a failure logs.
			listSeasons(cfg)
				.then((seasons) => {
					if (!isCurrent()) return;
					const season = currentSeason(seasons, new Date());
					if (!season) return;
					return listRepertoireItems(cfg, season.id).then((items) => {
						if (!isCurrent()) return;
						const byWorkId = new Map<string, RepertoireItem>();
						for (const item of items) {
							if (item.status === 'active' || item.status === 'learning') {
								byWorkId.set(item.workId, item);
							}
						}
						lib.repertoireByWorkId = byWorkId;
					});
				})
				.catch((e) => {
					console.error('library: repertoire badge load failed', e);
				});
		}
	});

	function loadForSelected(): Promise<void> {
		return routeLoad.loadForSelected();
	}

	// Fetch only; the node stays expanded across a retry.
	async function loadEditionsFor(workId: string): Promise<void> {
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		lib.editionNodeStatus = new Map(lib.editionNodeStatus).set(workId, 'loading');
		try {
			const result = await loadLibraryEditions({ db: current.db, token }, workId);
			lib.editionsByWork = new Map(lib.editionsByWork).set(workId, result.items);
			editionsPartialWorkIds = withItem(editionsPartialWorkIds, workId, result.truncated);
			lib.editionNodeStatus = new Map(lib.editionNodeStatus).set(workId, 'idle');
		} catch (e) {
			// #107 — an expired session on a node read shows the page's session notice.
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				return;
			}
			console.error('library: editions load failed', workId, e);
			lib.editionNodeStatus = new Map(lib.editionNodeStatus).set(workId, 'error');
		}
	}

	function toggleWork(workId: string): void {
		if (lib.expandedWorks.has(workId)) {
			lib.expandedWorks = without(lib.expandedWorks, workId);
			return;
		}
		lib.expandedWorks = new Set(lib.expandedWorks).add(workId);
		if (lib.editionsByWork.has(workId)) return;
		void loadEditionsFor(workId);
	}

	async function submitCreateEdition(workId: string): Promise<void> {
		if (editionDrafts.pending.has(workId)) return;
		if (isOffline) return;
		setEditionDraftError(editionDrafts, workId, null);
		editionDrafts.statuses = new Map(editionDrafts.statuses).set(workId, '');
		const current = selected;
		const token = getToken();
		if (!current || !token) {
			console.error('library: create edition with no cfg', {
				hasCollective: !!current,
				hasToken: !!token,
				workId
			});
			setEditionDraftError(editionDrafts, workId, m.library_create_edition_error);
			return;
		}
		const name = (editionDrafts.name.get(workId) ?? '').trim();
		if (!name) {
			setEditionDraftError(editionDrafts, workId, m.library_create_edition_name_required);
			return;
		}
		const publisher = (editionDrafts.publisher.get(workId) ?? '').trim();
		const cfg = { db: current.db, token };

		// A collective switch during the create must not insert into the new collective's tree.
		const g = routeLoad.generation;

		let newId: string;
		setEditionDraftPending(editionDrafts, workId, true);
		try {
			newId = await createEdition(cfg, { name, publisher, workId });
		} catch (e) {
			console.error('library: create edition failed', workId, name, e);
			setEditionDraftError(editionDrafts, workId, m.library_create_edition_error);
			return;
		} finally {
			setEditionDraftPending(editionDrafts, workId, false);
		}

		if (!routeLoad.isCurrent(g)) return;

		const list = lib.editionsByWork.get(workId) ?? [];
		lib.editionsByWork = new Map(lib.editionsByWork).set(workId, [
			...list,
			{ id: newId, name, publisher, externalLinks: [], files: [] }
		]);
		editionDrafts.statuses = new Map(editionDrafts.statuses).set(
			workId,
			m.library_create_edition_created({ name })
		);
		closeEditionDraft(editionDrafts, workId);
	}

	async function loadCopiesFor(editionId: string): Promise<void> {
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		lib.copyNodeStatus = new Map(lib.copyNodeStatus).set(editionId, 'loading');
		try {
			const result = await loadLibraryCopies({ db: current.db, token }, editionId);
			lib.copiesByEdition = new Map(lib.copiesByEdition).set(editionId, result.items);
			copiesPartialEditionIds = withItem(copiesPartialEditionIds, editionId, result.truncated);
			lib.copyNodeStatus = new Map(lib.copyNodeStatus).set(editionId, 'idle');
		} catch (e) {
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				return;
			}
			console.error('library: copies load failed', editionId, e);
			lib.copyNodeStatus = new Map(lib.copyNodeStatus).set(editionId, 'error');
		}
	}

	function toggleEdition(editionId: string): void {
		if (lib.expandedEditions.has(editionId)) {
			lib.expandedEditions = without(lib.expandedEditions, editionId);
			return;
		}
		lib.expandedEditions = new Set(lib.expandedEditions).add(editionId);
		if (lib.copiesByEdition.has(editionId)) return;
		void loadCopiesFor(editionId);
	}

	async function handleAttachFiles(editionId: string, fileList: FileList | null): Promise<void> {
		if (!fileList || fileList.length === 0) return;
		if (isOffline) return;
		const files = Array.from(fileList);
		const current = selected;
		const token = getToken();
		if (!current || !token) {
			console.error('library: attach files with no cfg', {
				hasCollective: !!current,
				hasToken: !!token,
				editionId
			});
			markUploadBatchError(fileUploads, editionId);
			return;
		}
		const cfg = { db: current.db, token };

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

	function handleOpenEditionFile(fileId: string, work: Work, edition: Edition, filename: string): void {
		if (!selected) return;
		openPart(selected.db, fileId, {
			work: work.name,
			composer: work.composer,
			edition: edition.name,
			filename
		});
	}

	// #74 — one work: preselect it. A new work clears the edition; a new edition, the borrowers.
	$effect(() => {
		if (lib.works.length === 1) {
			bulk.workId = lib.works[0].id;
		}
	});

	$effect(() => {
		void bulk.workId;
		bulk.editionId = '';
	});

	$effect(() => {
		void bulk.editionId;
		bulk.members = new Set();
	});

	$effect(() => {
		void selected;
		loadForSelected().catch((e) => {
			console.error('library: load failed', e);
			status = 'load-error';
		});
	});

	// #72 — keyed on `selected`: back to 'loading' on every selection, so a stale
	// collective's late answer never lands. The pickers load before the tools show.
	let librarianGen = 0;
	$effect(() => {
		const current = selected;
		if (!current) {
			++librarianGen;
			resetLibrarian();
			resetLibrarianPickerPartial();
			return;
		}
		resetLibrarian();
		resetLibrarianPickerPartial();
		loadLibrarian(current);
	});

	function retryLibrarianLoad(): void {
		if (!selected) return;
		resetLibrarianPickerPartial();
		loadLibrarian(selected);
	}

	function loadLibrarian(current: { db: string; personId: string }): void {
		const g = ++librarianGen;
		const token = getToken();
		const cfg = { db: current.db, token: token ?? '' };
		loadLibrarianState(cfg, current.personId).then(async (result) => {
			if (g !== librarianGen) return;
			if (result.state === 'librarian') {
				try {
					const {
						editions: editionsRead,
						copies: copiesRead,
						members: membersRead
					} = await loadLibrarianPickers(cfg);
					if (g !== librarianGen) return;
					lib.allEditions = editionsRead.items;
					lib.allCopies = copiesRead.items;
					lib.allMembers = membersRead.items;
					lib.optionsPartial = editionsRead.truncated || copiesRead.truncated;
					lib.membersPartial = membersRead.truncated;
					const memberIdList = membersRead.items.map((mbr) => mbr.memberId);
					loadLibrarianMemberNames(cfg, memberIdList)
						.then((names) => {
							if (g === librarianGen) lib.memberNames = names;
						})
						.catch((e) => console.error('library: member name resolution failed', e));
				} catch (e) {
					console.error('library: checkout data load failed', e);
					if (g !== librarianGen) return;
					librarianStore.set('error');
					return;
				}
			}
			if (g !== librarianGen) return;
			librarianStore.set(result.state);
		});
	}

	// #76 — picking a member checks out at once. Lendings are re-read after the write, so
	// availability is server-confirmed, never an optimistic flip.
	async function handleInlineCheckout(copyId: string, memberId: string): Promise<void> {
		if (isOffline) return;
		lib.inlineCheckoutErrors = without(lib.inlineCheckoutErrors, copyId);
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		const cfg = { db: current.db, token };
		try {
			const libraryId = await resolveWriteLibraryId(cfg);
			if (!libraryId) throw new Error('handleInlineCheckout: no library entity under this collective');
			await createLending(cfg, libraryId, {
				copyId,
				memberId,
				assignedAt: new Date().toISOString().slice(0, 10)
			});
			// Stores without serving: the live answer or a rejection, never pre-write availability.
			const refreshed = await refreshLibraryLendings(cfg);
			lendingsPartial = applyLendings(lib, refreshed);
		} catch (e) {
			console.error('library: inline checkout failed', copyId, e);
			const errNext = new Map(lib.inlineCheckoutErrors);
			errNext.set(copyId, e instanceof Error ? e.message : m.library_inline_checkout_error());
			lib.inlineCheckoutErrors = errNext;
		}
	}

	async function handleReturn(lendingId: string): Promise<void> {
		if (isOffline) return;
		returnError = '';
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		const cfg = { db: current.db, token };
		try {
			await returnLending(cfg, lendingId);
			const refreshed = await refreshLibraryLendings(cfg);
			lendingsPartial = applyLendings(lib, refreshed);
		} catch (e) {
			console.error('library: return failed', e);
			returnError = e instanceof Error ? e.message : 'Return failed';
		}
	}

	async function handleBulkCheckout(): Promise<void> {
		if (isOffline) return;
		bulk.error = '';
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		if (!bulk.editionId || bulk.members.size === 0) return;
		const cfg = { db: current.db, token };
		const activeLendings = lib.lendings.filter((l) => l.returnedAt === '');
		try {
			const libraryId = await resolveWriteLibraryId(cfg);
			if (!libraryId) throw new Error('handleBulkCheckout: no library entity under this collective');
			const result = await bulkCheckout(cfg, libraryId, {
				editionId: bulk.editionId,
				memberIds: [...bulk.members],
				assignedAt: new Date().toISOString().slice(0, 10),
				...(bulk.dueDate ? { assignedUntil: bulk.dueDate } : {})
			}, activeLendings);
			if (result.failed.length > 0) {
				bulk.error = `${result.failed.length} checkout(s) failed`;
			}
			const refreshed = await refreshLibraryLendings(cfg);
			lendingsPartial = applyLendings(lib, refreshed);
			bulk.members = new Set();
			bulk.dueDate = '';
		} catch (e) {
			console.error('library: bulk checkout failed', e);
			bulk.error = e instanceof Error ? e.message : 'Bulk checkout failed';
		}
	}

	const treeActions: TreeActions = {
		toggleWork,
		loadEditions: loadEditionsFor,
		toggleEdition,
		loadCopies: loadCopiesFor,
		setCopySortKey: (key) => {
			lib.copySortKey = key;
		},
		checkout: handleInlineCheckout,
		returnLending: handleReturn,
		attachFiles: handleAttachFiles,
		openFile: handleOpenEditionFile,
		submitEdition: submitCreateEdition,
		fileSize: (bytes) => formatFileSize(bytes)
	};
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.library_title()}</h1>

		<!-- #321 — a truncated list is a standing fact: visible, never sr-only, and gone
		     once every read is complete. -->
		{#if libraryPartial}
			<p
				data-testid="library-partial-notice"
				role="status"
				class="rounded-md border border-dashed border-ink-4 p-2 text-sm text-ink-2"
			>
				{m.library_partial_notice()}
			</p>
		{/if}

		{#if isLibrarian}
			<section data-testid="librarian-tools" class="rounded-md border border-dashed border-ink-5 px-4 py-3 text-sm">
				{m.library_librarian_tools()}

				<!-- #434 — the one reason for every write control on the page that is disabled
				     offline, said once, where only the viewer holding those controls sees it. -->
				{#if isOffline}
					<p data-testid="library-write-unavailable" class="mt-2 text-xs text-ink-2">
						{m.write_unavailable_no_signal()}
					</p>
				{/if}

				<BulkCheckoutPanel
					bind:bulk
					works={lib.works}
					allEditions={lib.allEditions}
					allMembers={lib.allMembers}
					memberNames={lib.memberNames}
					optionsPartial={lib.optionsPartial}
					membersPartial={lib.membersPartial}
					{view}
					{isOffline}
					submit={handleBulkCheckout}
				/>

				<InlineCreateForm
					kind="work"
					view={workFormView(workForm)}
					{isOffline}
					submit={submitCreateWork}
				/>
			</section>
		{:else if $librarianStore === 'error'}
			<div data-testid="librarian-load-error" class="flex items-center gap-2" role="alert">
				<p class="text-xs text-red-700">{m.library_librarian_load_error()}</p>
				<button
					type="button"
					data-testid="librarian-retry-load"
					class="text-xs underline"
					onclick={retryLibrarianLoad}
				>
					{m.library_librarian_retry()}
				</button>
			</div>
		{/if}

		{#if returnError}
			<p data-testid="return-error" class="text-xs text-red-700" role="alert">{returnError}</p>
		{/if}

		<MyLoansSection
			{selected}
			lendings={lib.lendings}
			{myMemberId}
			works={lib.works}
			allCopies={lib.allCopies}
			allEditions={lib.allEditions}
			loadCopyNames={(...a) => loadMyLoanCopyNames(...a)}
			loadCopyChains={(...a) => loadMyLoanCopyChains(...a)}
			chainLabel={(chain) => formatLoanChainLabel(chain)}
		/>

		<!-- #434 — set to the oldest readAt of any read this load served from the cache. -->
		{#if status === 'ready' && $servedFromCache}
			<AsOfLine readAt={$servedFromCache} testid="library-as-of" class="mb-3" />
		{/if}

		{#if status === 'no-collective'}
			<p data-testid="library-no-collective" class="text-sm">{m.library_no_collective()}</p>
		{:else if status === 'loading'}
			<div data-testid="library-skeleton" class="flex flex-col gap-3" aria-hidden="true" aria-busy="true">
				{#each [0, 1, 2] as row (row)}
					<div class="flex animate-pulse flex-col gap-1.5 py-2">
						<div class="h-3 w-1/2 rounded bg-ink-5"></div>
						<div class="h-2.5 w-1/3 rounded bg-ink-5"></div>
					</div>
				{/each}
			</div>
		{:else if status === 'session-expired'}
			<SessionExpiredNotice />
		{:else if status === 'load-error'}
			<div data-testid="library-load-error" class="flex flex-col gap-2" role="alert">
				<p class="text-sm text-red-700">{m.library_load_error()}</p>
				<button
					type="button"
					data-testid="library-retry-load"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={() => loadForSelected()}
				>
					{m.library_retry()}
				</button>
			</div>
		{:else if lib.works.length === 0}
			<div data-testid="library-empty" class="flex min-h-[30vh] items-center justify-center">
				<p class="font-display text-xl text-ink-2">{m.library_empty()}</p>
			</div>
		{:else}
			<ul data-testid="library-work-list" class="flex flex-col gap-1">
				{#each lib.works as work (work.id)}
					<WorkRow
						{work}
						{lib}
						bind:drafts={editionDrafts}
						files={fileUploads}
						{view}
						actions={treeActions}
						{isLibrarian}
						{isOffline}
					/>
				{/each}
			</ul>
		{/if}
	</div>
</main>
