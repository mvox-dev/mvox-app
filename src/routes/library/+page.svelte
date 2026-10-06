<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import PartialNotice from '$lib/components/PartialNotice.svelte';
	// #54/#73 — the library: works, editions and copies with availability from lending, the
	// member's own loans, and the librarian's tools. The page owns every load and every write.
	import { openPart } from '$lib/parts/openPart';
	import { m } from '$lib/paraglide/messages.js';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import { formatLoanChainLabel, type Edition, type Work } from '$lib/library/libraryData';
	// #434 — the library's own cache-backed entry points; the shared readers stay unused here.
	import {
		loadLibraryListing,
		loadMyMemberId,
		loadMyLoanCopyNames,
		loadMyLoanCopyChains
	} from '$lib/library/libraryPageData';
	import { createLibraryTreeLoads, createLibrarianLoad } from '$lib/library/libraryPageLoads';
	import { createLibraryWrites } from '$lib/library/libraryPageWrites';
	import AsOfLine from '$lib/components/offline/AsOfLine.svelte';
	import { resetServedFromCache, servedFromCache } from '$lib/entu/readCache';
	import { librarianStore } from '$lib/library/librarianStore';
	import { formatFileSize } from '$lib/library/editionFiles';
	import { createPresenceRefresh } from '$lib/files/presenceRefresh';
	import { listSeasons } from '$lib/seasons/entuSeasons';
	import { currentSeason } from '$lib/attendance/conductorLogic';
	import { listRepertoireItems, type RepertoireItem } from '$lib/repertoire/repertoireData';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { createRouteLoadMachine, type RouteLoadStatus } from '$lib/loading/routeLoad';
	import { writesAvailable } from '$lib/net/online';
	import { createLendingView } from '$lib/library/lendingView';
	import {
		applyLendings,
		createBulkCheckout,
		createEditionDrafts,
		createEditionFilesState,
		createLibraryState,
		createWorkForm,
		resetBulkCheckout,
		resetTree,
		workFormView,
		type TreeActions
	} from '$lib/library/libraryState';
	import MyLoansSection from '$lib/library/MyLoansSection.svelte';
	import BulkCheckoutPanel from '$lib/library/BulkCheckoutPanel.svelte';
	import InlineCreateForm from '$lib/library/InlineCreateForm.svelte';
	import WorkRow from '$lib/library/WorkRow.svelte';
	import { withItem } from '$lib/collections/immutable';

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
	const refreshPresence = createPresenceRefresh('library', (ids) => (lib.heldFileIds = ids));

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

	const tree = createLibraryTreeLoads({
		selected: () => selected,
		lib,
		setStatus: (s) => {
			status = s;
		},
		markEditionsPartial: (workId, truncated) => {
			editionsPartialWorkIds = withItem(editionsPartialWorkIds, workId, truncated);
		},
		markCopiesPartial: (editionId, truncated) => {
			copiesPartialEditionIds = withItem(copiesPartialEditionIds, editionId, truncated);
		}
	});

	const writes = createLibraryWrites({
		selected: () => selected,
		isOffline: () => isOffline,
		lib,
		workForm: () => workForm,
		editionDrafts: () => editionDrafts,
		bulk: () => bulk,
		fileUploads,
		routeLoad,
		setLendingsPartial: (partial) => {
			lendingsPartial = partial;
		},
		setReturnError: (message) => {
			returnError = message;
		}
	});

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
		void loadForSelected();
	});

	const librarian = createLibrarianLoad(lib);
	$effect(() => {
		librarian.select(selected);
		return () => librarian.destroy();
	});

	function retryLibrarianLoad(): void {
		librarian.retryLibrarianLoad(selected);
	}

	const treeActions: TreeActions = {
		toggleWork: tree.toggleWork,
		loadEditions: tree.loadEditionsFor,
		toggleEdition: tree.toggleEdition,
		loadCopies: tree.loadCopiesFor,
		setCopySortKey: (key) => {
			lib.copySortKey = key;
		},
		checkout: writes.handleInlineCheckout,
		returnLending: writes.handleReturn,
		attachFiles: writes.handleAttachFiles,
		openFile: handleOpenEditionFile,
		submitEdition: writes.submitCreateEdition,
		fileSize: (bytes) => formatFileSize(bytes)
	};
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.library_title()}</h1>

		<!-- #321 — a truncated list is a standing fact: visible, never sr-only, and gone
		     once every read is complete. -->
		{#if libraryPartial}
			<PartialNotice
				testid="library-partial-notice"
				text={m.library_partial_notice()}
				class="text-sm"
			/>
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
					submit={writes.handleBulkCheckout}
				/>

				<InlineCreateForm
					kind="work"
					view={workFormView(workForm)}
					{isOffline}
					submit={writes.submitCreateWork}
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
			<FormError data-testid="return-error">{returnError}</FormError>
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
