<script lang="ts">
	// T6.3/#54 — the library browse page: works -> editions -> copies, availability
	// derived from lending. Read-only throughout. Same state-machine shape as
	// roster/+page.svelte (loading/no-collective/load-error/ready + generation guard).
	// T6.4/#73 — my-loans section + librarian checkout/return UI.
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import { rovingNextIndex } from '$lib/a11y/roving';
	import {
		listWorks,
		listEditions,
		listCopies,
		listAllEditions,
		listAllCopies,
		listLendings,
		resolveBorrowerNames,
		resolveCopyNames,
		resolveCopyChains,
		formatLoanChainLabel,
		deriveCopyAvailability,
		deriveEditionAvailability,
		deriveWorkAvailability,
		activeLendingForMemberInEdition,
		type Work,
		type Edition,
		type Copy,
		type Lending,
		type LoanChain
	} from '$lib/library/libraryData';
	import { librarianStore, libraryEntityIdStore, resetLibrarian, resolveLibrarian } from '$lib/library/librarianStore';
	import { listActiveMembers, type ActiveMember } from '$lib/roster/rosterData';
	import { findMyMemberId } from '$lib/rsvp/rsvpData';
	import { createLending, returnLending, bulkCheckout } from '$lib/library/lendingActions';
	import { createWork } from '$lib/entity/entityCreate';
	import { getLocale } from '$lib/paraglide/runtime';
	// #92 TR.4 — repertoire status badges on the browse tree. Season resolution
	// reuses the agenda's pure currentSeason picker (never re-derived); the
	// repertoire read reuses TR.2's listRepertoireItems as-is (no new query).
	import { listSeasons } from '$lib/seasons/entuSeasons';
	import { currentSeason } from '$lib/attendance/conductorLogic';
	import { listRepertoireItems, type RepertoireItem } from '$lib/repertoire/repertoireData';
	import { isAuthExpiredError } from '$lib/entu/request';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';

	const selected = $derived($selectedCollectiveStore);

	// #76 correction 9 — localize lending dates. Entu delivers full ISO
	// timestamps (e.g. "2026-07-01T00:00:00.000Z"); render them for humans via
	// Intl.DateTimeFormat rather than leaking the raw ISO string into the UI.
	// Uses the active Paraglide locale (not browser default) and forces UTC
	// timezone so date-only values never shift to the previous day in negative
	// offsets. Formatter is cached per locale to avoid re-creating it on every
	// call inside render loops.
	let _dateFmtLocale: string | undefined;
	let _dateFmt: Intl.DateTimeFormat | undefined;
	function formatDate(isoDate: string): string {
		if (!isoDate) return '';
		const locale = getLocale();
		if (!_dateFmt || locale !== _dateFmtLocale) {
			_dateFmtLocale = locale;
			_dateFmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
		}
		return _dateFmt.format(new Date(isoDate));
	}

	type Status = 'loading' | 'no-collective' | 'load-error' | 'session-expired' | 'ready';
	type NodeStatus = 'idle' | 'loading' | 'error';

	let generation = 0;
	let status = $state<Status>('loading');
	let works = $state<Work[]>([]);
	let lendings = $state<Lending[]>([]);
	let borrowerNames = $state<Map<string, string>>(new Map());

	let expandedWorks = $state<Set<string>>(new Set());
	let expandedEditions = $state<Set<string>>(new Set());
	let editionsByWork = $state<Map<string, Edition[]>>(new Map());
	let copiesByEdition = $state<Map<string, Copy[]>>(new Map());
	let editionNodeStatus = $state<Map<string, NodeStatus>>(new Map());
	let copyNodeStatus = $state<Map<string, NodeStatus>>(new Map());

	// #112/#88 — copy-list sort key, ONE control shared across every unfolded
	// edition (a view concern, not per-edition state — re-sorting never
	// refetches). Default 'nr' ascending.
	type CopySortKey = 'nr' | 'member' | 'since';
	let copySortKey = $state<CopySortKey>('nr');

	// #156 — copy-sort chip roving tabindex. Radiogroup semantics, same as the
	// roster view-mode chips: `copySortKey` already models single selection
	// (shared across every open edition), so arrow-select needs no separate
	// $state — the pressed chip IS the tab stop. The delegated keydown handler
	// scopes its walk to `e.currentTarget` (one `copy-sort-{edition.id}` group
	// per edition), so arrowing inside one edition's chips never touches
	// another edition's — no per-edition keying needed beyond that scoping.
	function handleCopySortKeydown(e: KeyboardEvent): void {
		const group = e.currentTarget as HTMLElement;
		const chips = Array.from(group.querySelectorAll<HTMLButtonElement>('button'));
		const idx = chips.indexOf(e.target as HTMLButtonElement);
		if (idx < 0) return;
		const next = rovingNextIndex(e.key, idx, chips.length);
		if (next < 0) return;
		e.preventDefault();
		const key = chips[next].dataset.sortKey as CopySortKey | undefined;
		if (!key) return;
		copySortKey = key;
		chips[next].focus();
	}

	/**
	 * Sort value for a single copy under the given key, or null when the copy
	 * has nothing to sort on there. Null ALWAYS sorts last, regardless of key:
	 *   - 'nr': the copy's number (a falsy/zero copyNumber counts as "no nr",
	 *     matching the same falsy check the row's own label already uses).
	 *   - 'member' / 'since': drawn from the copy's ACTIVE lending, if any —
	 *     an available (unassigned) copy has no lending, so both keys fall
	 *     back to null together.
	 */
	function copySortValue(copy: Copy, key: CopySortKey): string | number | null {
		if (key === 'nr') return copy.copyNumber ? copy.copyNumber : null;
		const lending = activeLendingForCopy(copy.id);
		if (!lending) return null;
		if (key === 'member') return borrowerNames.get(lending.memberId) || null;
		return lending.assignedAt || null;
	}

	/** Stable comparator for a single key: nulls last, numbers compare
	 *  numerically, everything else (names, ISO date strings) compares
	 *  lexically — ISO dates sort correctly as strings. */
	function compareByKey(a: Copy, b: Copy, key: CopySortKey): number {
		const av = copySortValue(a, key);
		const bv = copySortValue(b, key);
		if (av === null && bv === null) return 0;
		if (av === null) return 1;
		if (bv === null) return -1;
		if (typeof av === 'number' && typeof bv === 'number') return av - bv;
		return String(av).localeCompare(String(bv));
	}

	/** Partition-then-sort: lent-out copies first (sorted by the active key),
	 *  available copies below, always sorted by nr regardless of the active
	 *  key. #114 F6 — the two groups never intermix. */
	function sortCopies(copies: Copy[], key: CopySortKey): Copy[] {
		const lent = copies.filter((c) => activeLendingForCopy(c.id));
		const available = copies.filter((c) => !activeLendingForCopy(c.id));
		lent.sort((a, b) => compareByKey(a, b, key));
		available.sort((a, b) => compareByKey(a, b, 'nr'));
		return [...lent, ...available];
	}

	// #92 TR.4 — current season's active/learning repertoire, keyed by work id.
	// Retired/dropped items never enter this map — filtered at resolution time
	// (AC-8: members never see those statuses, same discipline as TR.2/TR.3).
	let repertoireByWorkId = $state<Map<string, RepertoireItem>>(new Map());
	const REPERTOIRE_BADGE_DOT_CLASS: Record<string, string> = {
		active: 'bg-green',
		learning: 'bg-amber'
	};
	const REPERTOIRE_BADGE_LABEL: Record<string, () => string> = {
		active: m.repertoire_status_active,
		learning: m.repertoire_status_learning
	};

	// #73 — my loans state
	let myMemberId = $state<string | null>(null);
	let myLoansExpanded = $state(false);
	let myCopyNames = $state<Map<string, string>>(new Map());
	let myCopyChains = $state<Map<string, LoanChain>>(new Map());

	// Derived: active loans for the current member
	let myActiveLoans = $derived(
		myMemberId ? lendings.filter((l) => l.memberId === myMemberId && l.returnedAt === '') : []
	);

	// #76 — inline checkout state (per-copy error on the browse-tree row; the
	// standalone checkout-copy/checkout-member/checkout-due-date/checkout-error
	// state is gone — selecting a member in the inline picker checks out
	// immediately, no separate form/submit step)
	let inlineCheckoutErrors = $state<Map<string, string>>(new Map());
	let returnError = $state('');

	// #74 — bulk checkout state (edition-first flow)
	let bulkCheckoutWorkId = $state('');
	let bulkCheckoutEditionId = $state('');
	let bulkCheckoutCheckedMembers = $state<Set<string>>(new Set());
	let bulkCheckoutDueDate = $state('');
	let bulkCheckoutError = $state('');

	// #73/#74 — checkout form data (loaded when librarian confirmed)
	let allEditions = $state<Edition[]>([]);
	let allCopies = $state<Copy[]>([]);
	let allMembers = $state<ActiveMember[]>([]);
	let memberNames = $state<Map<string, string>>(new Map());

	// #198 — librarian-only inline "create work" affordance. Same
	// open/close/local-insert shape as roster's page-level section create
	// (pageCreateOpen/submitPageCreate): closed by default, no form in the DOM
	// until opened, and a successful create is inserted LOCALLY into `works`
	// (no listWorks refetch) — the parent is the LIBRARY entity id from
	// `libraryEntityIdStore` (resolveLibrarian), never the database entity.
	let createWorkOpen = $state(false);
	let createWorkName = $state('');
	let createWorkComposer = $state('');
	let createWorkError = $state<(() => string) | null>(null);
	let createWorkStatus = $state('');
	let createWorkNameInput = $state<HTMLInputElement | null>(null);
	// #198 review — in-flight latch. Without it a double-click (or Enter pressed
	// twice, which routes to the same submitCreateWork) issues two POSTs and
	// leaves two duplicate `work` entities in Entu, which has no bulk delete.
	let createWorkPending = $state(false);

	function openCreateWorkForm(): void {
		createWorkName = '';
		createWorkComposer = '';
		createWorkError = null;
		// A new attempt owns the live region too — the previous "X created."
		// announcement must not sit there while a fresh form is open.
		createWorkStatus = '';
		createWorkOpen = true;
	}

	function closeCreateWorkForm(): void {
		createWorkOpen = false;
		createWorkName = '';
		createWorkComposer = '';
		createWorkError = null;
	}

	// Escape closes from ANY control in the form, not just the inputs — it is
	// wired to the two buttons as well, so Escape still works with focus on
	// Submit/Cancel. (Wiring it once on the wrapper <div> would be an a11y
	// violation: a non-interactive element carrying keyboard listeners.)
	function onCreateWorkEscapeKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		closeCreateWorkForm();
	}

	function onCreateWorkNameKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			onCreateWorkEscapeKeydown(event);
			return;
		}
		if (event.key !== 'Enter') return;
		event.preventDefault();
		void submitCreateWork();
	}

	async function submitCreateWork(): Promise<void> {
		if (createWorkPending) return;
		createWorkError = null;
		createWorkStatus = '';
		const current = selected;
		const token = getToken();
		const libraryId = $libraryEntityIdStore;
		// Fail LOUDLY (house rule) — a librarian whose JWT expired while the
		// librarian tools are still on screen must see why the write did not
		// happen, not get a silent no-op. Same shape as roster's submitPageCreate.
		if (!current || !token || !libraryId) {
			console.error('library: create work with no cfg/library', {
				hasCollective: !!current,
				hasToken: !!token,
				libraryId
			});
			createWorkError = m.library_create_work_error;
			return;
		}
		const name = createWorkName.trim();
		// Field-level validation BEFORE the write seam — the data layer's
		// requireText would throw and land in the transport catch below, telling
		// the librarian "could not create" for what is a missing required field.
		// Same shape as roster's submitPageCreate.
		if (!name) {
			createWorkError = m.library_create_work_name_required;
			return;
		}
		const composer = createWorkComposer.trim();
		const cfg = { db: current.db, token };

		let newId: string;
		createWorkPending = true;
		try {
			newId = await createWork(cfg, { name, composer, libraryEntityId: libraryId });
		} catch (e) {
			console.error('library: create work failed', name, e);
			createWorkError = m.library_create_work_error;
			return;
		} finally {
			createWorkPending = false;
		}

		// LOCAL insertion — same "never refetch" contract as roster's
		// page-level section create.
		works = [...works, { id: newId, name, composer }];
		createWorkStatus = m.library_create_work_created({ name });
		closeCreateWorkForm();
	}

	// Auto-focus the name input the instant the inline form appears, same
	// contract as roster's page-level create form.
	$effect(() => {
		if (createWorkOpen && createWorkNameInput) createWorkNameInput.focus();
	});

	async function loadForSelected(): Promise<void> {
		const current = selected;
		const g = ++generation;
		if (!current) {
			status = 'no-collective';
			works = [];
			return;
		}
		const token = getToken();
		if (!token) {
			console.error('library: no auth token in storage on a protected route');
			status = 'load-error';
			return;
		}
		status = 'loading';
		expandedWorks = new Set();
		expandedEditions = new Set();
		editionsByWork = new Map();
		copiesByEdition = new Map();
		repertoireByWorkId = new Map();
		try {
			const cfg = { db: current.db, token };
			const [workList, lendingList] = await Promise.all([listWorks(cfg), listLendings(cfg)]);
			if (g !== generation) return;
			const activeMemberIds = lendingList.filter((l) => l.returnedAt === '').map((l) => l.memberId);
			const names = await resolveBorrowerNames(cfg, activeMemberIds);
			if (g !== generation) return;
			works = workList;
			lendings = lendingList;
			borrowerNames = names;
			status = 'ready';

			// #73 — resolve current member for my-loans
			findMyMemberId(cfg, current.personId).then((id) => {
				if (g === generation) myMemberId = id;
			});

			// #92 TR.4 — season-scoped repertoire read, once: resolve the CURRENT
			// season (same pure picker the agenda uses) then TR.2's
			// listRepertoireItems. No current season -> no badges, no second fetch.
			listSeasons(cfg)
				.then((seasons) => {
					if (g !== generation) return;
					const season = currentSeason(seasons, new Date());
					if (!season) return;
					return listRepertoireItems(cfg, season.id).then((items) => {
						if (g !== generation) return;
						const byWorkId = new Map<string, RepertoireItem>();
						for (const item of items) {
							if (item.status === 'active' || item.status === 'learning') {
								byWorkId.set(item.workId, item);
							}
						}
						repertoireByWorkId = byWorkId;
					});
				})
				.catch((e) => {
					// Badges are supplementary — a failed repertoire read must not take
					// down the (already-successful) library browse tree with it.
					console.error('library: repertoire badge load failed', e);
				});
		} catch (e) {
			if (g !== generation) return;
			// #107 — a session-expired rejection is a DIFFERENT failure class than
			// a generic load error: the entuFetch layer already cleared the stale
			// session and fired the sign-in redirect, so this just says why.
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				return;
			}
			console.error('library: load failed', e);
			status = 'load-error';
		}
	}

	// Fetch-only (does not touch expandedWorks) — called both when a work is first
	// expanded (not yet cached) and from the error state's retry button (the node
	// stays expanded across a retry; only toggleWork collapses it).
	async function loadEditionsFor(workId: string): Promise<void> {
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		editionNodeStatus = new Map(editionNodeStatus).set(workId, 'loading');
		try {
			const editions = await listEditions({ db: current.db, token }, workId);
			editionsByWork = new Map(editionsByWork).set(workId, editions);
			editionNodeStatus = new Map(editionNodeStatus).set(workId, 'idle');
		} catch (e) {
			// #107 (review R2/F3) — a node expand is a READ, so it gets the same
			// treatment as the page-level load above: collapse to the shared
			// session-expired notice instead of leaving a dead "couldn't load" badge
			// inside a tree that is about to unmount behind the sign-in redirect.
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				return;
			}
			console.error('library: editions load failed', workId, e);
			editionNodeStatus = new Map(editionNodeStatus).set(workId, 'error');
		}
	}

	function toggleWork(workId: string): void {
		const next = new Set(expandedWorks);
		if (next.has(workId)) {
			next.delete(workId);
			expandedWorks = next;
			return;
		}
		next.add(workId);
		expandedWorks = next;
		if (editionsByWork.has(workId)) return; // cached
		void loadEditionsFor(workId);
	}

	// Same fetch-only / toggle split as editions, one level down.
	async function loadCopiesFor(editionId: string): Promise<void> {
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		copyNodeStatus = new Map(copyNodeStatus).set(editionId, 'loading');
		try {
			const copies = await listCopies({ db: current.db, token }, editionId);
			copiesByEdition = new Map(copiesByEdition).set(editionId, copies);
			copyNodeStatus = new Map(copyNodeStatus).set(editionId, 'idle');
		} catch (e) {
			// #107 (review R2/F3) — same READ-path rule as loadEditionsFor.
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				return;
			}
			console.error('library: copies load failed', editionId, e);
			copyNodeStatus = new Map(copyNodeStatus).set(editionId, 'error');
		}
	}

	function toggleEdition(editionId: string): void {
		const next = new Set(expandedEditions);
		if (next.has(editionId)) {
			next.delete(editionId);
			expandedEditions = next;
			return;
		}
		next.add(editionId);
		expandedEditions = next;
		if (copiesByEdition.has(editionId)) return; // cached
		void loadCopiesFor(editionId);
	}

	// #74 — auto-select work when there is exactly one
	$effect(() => {
		if (works.length === 1) {
			bulkCheckoutWorkId = works[0].id;
		}
	});

	// #74 — reset edition when work selection changes
	$effect(() => {
		void bulkCheckoutWorkId;
		bulkCheckoutEditionId = '';
	});

	// #74 — reset checked state when edition selection changes
	$effect(() => {
		void bulkCheckoutEditionId;
		bulkCheckoutCheckedMembers = new Set();
	});

	// #74 — derive editions filtered by selected work
	let filteredBulkCheckoutEditions = $derived(
		bulkCheckoutWorkId
			? allEditions.filter((e) => e.workId === bulkCheckoutWorkId)
			: []
	);

	// #74 — derive copy IDs belonging to the selected checkout edition
	let bulkCheckoutEditionCopyIds = $derived(
		bulkCheckoutEditionId
			? new Set(allCopies.filter((c) => c.editionId === bulkCheckoutEditionId).map((c) => c.id))
			: new Set<string>()
	);

	// #74 — derive availability counter for selected checkout edition
	let bulkCheckoutEditionAvailability = $derived(
		bulkCheckoutEditionId
			? deriveEditionAvailability(bulkCheckoutEditionId, allCopies, lendings)
			: { available: 0, total: 0 }
	);

	// #76-fix — resolve copy names for my-loans (avoids rendering raw entity IDs)
	let copyNameGen = 0;
	$effect(() => {
		const loans = myActiveLoans;
		const g = ++copyNameGen;
		if (loans.length === 0) {
			myCopyNames = new Map();
			return;
		}
		const current = selected;
		if (!current) { myCopyNames = new Map(); return; }
		const token = getToken();
		if (!token) return;
		const copyIds = loans.map(l => l.copyId);
		// Librarian path: allCopies already has name + copyNumber — resolve
		// locally without a network round-trip per copy.
		const localNames = new Map<string, string>();
		const unresolved: string[] = [];
		for (const id of copyIds) {
			const cached = allCopies.find(c => c.id === id);
			if (cached) {
				const label = cached.name || (cached.copyNumber ? `#${cached.copyNumber}` : '');
				localNames.set(id, label);
			} else {
				unresolved.push(id);
			}
		}
		if (unresolved.length === 0) {
			if (g !== copyNameGen) return;
			myCopyNames = localNames;
			return;
		}
		const cfg = { db: current.db, token };
		resolveCopyNames(cfg, unresolved).then(names => {
			if (g !== copyNameGen) return;
			// Merge locally-resolved names with network-fetched ones
			for (const [id, name] of localNames) names.set(id, name);
			myCopyNames = names;
		}).catch(e => {
			console.error('library: copy name resolution failed', e);
		});
	});

	// #129 — resolve copy → edition → work chain for my-loans labels
	let chainGen = 0;
	$effect(() => {
		const loans = myActiveLoans;
		const g = ++chainGen;
		if (loans.length === 0) {
			myCopyChains = new Map();
			return;
		}
		const current = selected;
		if (!current) { myCopyChains = new Map(); return; }
		const token = getToken();
		if (!token) return;
		const copyIds = loans.map(l => l.copyId);
		// Librarian path: resolve locally from allCopies → allEditions → works
		const localChains = new Map<string, LoanChain>();
		const unresolved: string[] = [];
		for (const id of copyIds) {
			const cached = allCopies.find(c => c.id === id);
			if (cached) {
				const edition = allEditions.find(e => e.id === cached.editionId);
				const work = edition ? works.find(w => w.id === edition.workId) : undefined;
				localChains.set(id, {
					copyNumber: cached.copyNumber,
					workName: work?.name ?? '',
					editionName: edition?.name ?? ''
				});
			} else {
				unresolved.push(id);
			}
		}
		if (unresolved.length === 0) {
			if (g !== chainGen) return;
			myCopyChains = localChains;
			return;
		}
		const cfg = { db: current.db, token };
		resolveCopyChains(cfg, unresolved, works).then(chains => {
			if (g !== chainGen) return;
			for (const [id, chain] of localChains) chains.set(id, chain);
			myCopyChains = chains;
		}).catch(e => {
			console.error('library: copy chain resolution failed', e);
		});
	});

	$effect(() => {
		void selected;
		loadForSelected().catch((e) => {
			console.error('library: load failed', e);
			status = 'load-error';
		});
	});

	// TL.1/#72 — librarian-only tools composition (placeholder; TL.2/TL.3 fill in
	// real content). Same generation-guard discipline as +layout.svelte's
	// adminStore wiring: keyed on `selected`, resetLibrarian() to 'loading' on
	// every (re)selection so a stale collective's late resolve can't clobber a
	// newer one. Hidden-if-undeterminable: 'loading' renders nothing.
	let librarianGen = 0;
	$effect(() => {
		const current = selected;
		const g = ++librarianGen;
		if (!current) {
			resetLibrarian();
			return;
		}
		resetLibrarian();
		const token = getToken();
		const cfg = { db: current.db, token: token ?? '' };
		resolveLibrarian(cfg, current.personId).then(async (result) => {
			if (g !== librarianGen) return;
			libraryEntityIdStore.set(result.libraryId);
			// Load checkout form data BEFORE revealing librarian tools so the
			// bulk-checkout/return edition pickers are populated on first render.
			if (result.state === 'librarian') {
				try {
					const [editions, copies, members] = await Promise.all([
						listAllEditions(cfg),
						listAllCopies(cfg),
						listActiveMembers(cfg)
					]);
					if (g !== librarianGen) return;
					allEditions = editions;
					allCopies = copies;
					allMembers = members;
					const memberIdList = members.map((mbr) => mbr.memberId);
					resolveBorrowerNames(cfg, memberIdList).then((names) => {
						if (g === librarianGen) memberNames = names;
					}).catch((e) => console.error('library: member name resolution failed', e));
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
	});

	// #76 — inline checkout: selecting a member on an available copy row checks
	// it out immediately (no separate submit step). Server-confirmed — lendings
	// are re-fetched after createLending resolves, so the row's availability
	// reflects the refreshed list, not an optimistic local flip.
	async function handleInlineCheckout(copyId: string, memberId: string): Promise<void> {
		const nextErrors = new Map(inlineCheckoutErrors);
		nextErrors.delete(copyId);
		inlineCheckoutErrors = nextErrors;
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		const libraryId = $libraryEntityIdStore;
		if (!libraryId) return;
		const cfg = { db: current.db, token };
		try {
			await createLending(cfg, libraryId, {
				copyId,
				memberId,
				assignedAt: new Date().toISOString().slice(0, 10)
			});
			// Refresh lending data after successful checkout
			const lendingList = await listLendings(cfg);
			const activeMemberIds = lendingList.filter((l) => l.returnedAt === '').map((l) => l.memberId);
			const names = await resolveBorrowerNames(cfg, activeMemberIds);
			lendings = lendingList;
			borrowerNames = names;
		} catch (e) {
			console.error('library: inline checkout failed', copyId, e);
			const errNext = new Map(inlineCheckoutErrors);
			errNext.set(copyId, e instanceof Error ? e.message : m.library_inline_checkout_error());
			inlineCheckoutErrors = errNext;
		}
	}

	// #76 — copy IDs belonging to an edition, for the inline picker's
	// double-lending guard. Same logic as the bulk-checkout edition scoping
	// (bulkCheckoutEditionCopyIds), derived from allCopies (librarian-only data).
	function editionCopyIdsFor(editionId: string): Set<string> {
		return new Set(allCopies.filter((c) => c.editionId === editionId).map((c) => c.id));
	}

	// #73 — return a lending
	async function handleReturn(lendingId: string): Promise<void> {
		returnError = '';
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		const cfg = { db: current.db, token };
		try {
			await returnLending(cfg, lendingId);
			// Refresh lending data after successful return
			const lendingList = await listLendings(cfg);
			const activeMemberIds = lendingList.filter((l) => l.returnedAt === '').map((l) => l.memberId);
			const names = await resolveBorrowerNames(cfg, activeMemberIds);
			lendings = lendingList;
			borrowerNames = names;
		} catch (e) {
			console.error('library: return failed', e);
			returnError = e instanceof Error ? e.message : 'Return failed';
		}
	}

	function isOverdue(assignedUntil: string): boolean {
		if (!assignedUntil) return false;
		const today = new Date().toISOString().slice(0, 10);
		return assignedUntil < today;
	}

	// Find the active lending for a given copy (for return button)
	function activeLendingForCopy(copyId: string): Lending | undefined {
		return lendings.find((l) => l.copyId === copyId && l.returnedAt === '');
	}

	// #76 — work availability for browse tree counter (librarian only)
	// Delegates to the pure, unit-tested deriveWorkAvailability in libraryData.ts.
	function workAvailability(workId: string): { available: number; total: number } {
		return deriveWorkAvailability(workId, allEditions, allCopies, lendings);
	}

	// #74 — bulk checkout handler
	async function handleBulkCheckout(): Promise<void> {
		bulkCheckoutError = '';
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		const libraryId = $libraryEntityIdStore;
		if (!libraryId) return;
		if (!bulkCheckoutEditionId || bulkCheckoutCheckedMembers.size === 0) return;
		const cfg = { db: current.db, token };
		const activeLendings = lendings.filter((l) => l.returnedAt === '');
		try {
			const result = await bulkCheckout(cfg, libraryId, {
				editionId: bulkCheckoutEditionId,
				memberIds: [...bulkCheckoutCheckedMembers],
				assignedAt: new Date().toISOString().slice(0, 10),
				...(bulkCheckoutDueDate ? { assignedUntil: bulkCheckoutDueDate } : {})
			}, activeLendings);
			if (result.failed.length > 0) {
				bulkCheckoutError = `${result.failed.length} checkout(s) failed`;
			}
			// Refresh lending data
			const lendingList = await listLendings(cfg);
			const activeMemberIds = lendingList.filter((l) => l.returnedAt === '').map((l) => l.memberId);
			const names = await resolveBorrowerNames(cfg, activeMemberIds);
			lendings = lendingList;
			borrowerNames = names;
			bulkCheckoutCheckedMembers = new Set();
			bulkCheckoutDueDate = '';
		} catch (e) {
			console.error('library: bulk checkout failed', e);
			bulkCheckoutError = e instanceof Error ? e.message : 'Bulk checkout failed';
		}
	}
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.library_title()}</h1>

		{#if $librarianStore === 'librarian'}
			<section data-testid="librarian-tools" class="rounded-md border border-dashed border-ink-5 px-4 py-3 text-sm">
				{m.library_librarian_tools()}

				<!-- #74 — bulk checkout section (work→edition two-level picker) -->
				<div data-testid="bulk-checkout" class="mt-3">
					<!-- #151 — section-heading role: `font-display text-lg`, as every other
					     section heading in the app. h2 rather than h3: the page's only
					     other heading is the h1 above, so h3 skipped a level. -->
					<h2 class="font-display text-lg">{m.library_bulk_checkout_title()}</h2>
					<select data-testid="bulk-checkout-work-select" aria-label={m.library_bulk_checkout_work_placeholder()} value={bulkCheckoutWorkId} onchange={(e) => (bulkCheckoutWorkId = e.currentTarget.value)} class="mt-1 w-full rounded border border-ink-5 px-2 py-1">
						<option value="">{m.library_bulk_checkout_work_placeholder()}</option>
						{#each works as work (work.id)}
							<option value={work.id}>{work.name}</option>
						{/each}
					</select>
					{#if bulkCheckoutWorkId}
						<select data-testid="bulk-checkout-edition-select" aria-label={m.library_bulk_checkout_edition_placeholder()} value={bulkCheckoutEditionId} onchange={(e) => (bulkCheckoutEditionId = e.currentTarget.value)} class="mt-1 w-full rounded border border-ink-5 px-2 py-1">
							<option value="">{m.library_bulk_checkout_edition_placeholder()}</option>
							{#each filteredBulkCheckoutEditions as edition (edition.id)}
								<option value={edition.id}>{edition.name}</option>
							{/each}
						</select>
					{/if}
					{#if bulkCheckoutEditionId}
						<p data-testid="bulk-checkout-availability" class="mt-1 text-xs" aria-live="polite">
							{m.library_bulk_checkout_availability({ available: bulkCheckoutEditionAvailability.available, total: bulkCheckoutEditionAvailability.total })}
						</p>
						<div data-testid="bulk-checkout-member-list" class="mt-2 flex flex-col gap-1">
							{#each allMembers as member (member.memberId)}
								{@const existingLending = activeLendingForMemberInEdition(member.memberId, bulkCheckoutEditionCopyIds, lendings)}
								{#if existingLending}
									<div class="flex items-center gap-1 text-xs">
										<span>{memberNames.get(member.memberId) || m.library_borrower_unknown()}</span>
										<span data-testid="bulk-checkout-already-lent-{member.memberId}">{m.library_bulk_checkout_already_lent({ date: formatDate(existingLending.assignedAt) })}</span>
									</div>
								{:else}
									<label class="flex items-center gap-1 text-xs">
										<input type="checkbox"
											checked={bulkCheckoutCheckedMembers.has(member.memberId)}
											onchange={() => {
												const next = new Set(bulkCheckoutCheckedMembers);
												if (next.has(member.memberId)) next.delete(member.memberId);
												else next.add(member.memberId);
												bulkCheckoutCheckedMembers = next;
											}}
										/>
										<span>{memberNames.get(member.memberId) || m.library_borrower_unknown()}</span>
									</label>
								{/if}
							{/each}
						</div>
						<input data-testid="bulk-checkout-due-date" type="date" bind:value={bulkCheckoutDueDate} class="mt-1 w-full rounded border border-ink-5 px-2 py-1" />
						{#if bulkCheckoutCheckedMembers.size > bulkCheckoutEditionAvailability.available}
							<p data-testid="bulk-checkout-too-many" class="mt-1 text-xs text-red-700" role="alert">{m.library_bulk_checkout_too_many()}</p>
						{/if}
						<button type="button" data-testid="bulk-checkout-submit" class="mt-1 self-start rounded-md border border-ink px-3 py-1 text-xs hover:bg-ink hover:text-paper" disabled={bulkCheckoutCheckedMembers.size === 0 || bulkCheckoutCheckedMembers.size > bulkCheckoutEditionAvailability.available} onclick={handleBulkCheckout}>
							{m.library_checkout_submit()}
						</button>
						{#if bulkCheckoutError}
							<p data-testid="bulk-checkout-error" class="text-xs text-red-700" role="alert">{bulkCheckoutError}</p>
						{/if}
					{/if}
				</div>

				<!-- #198 — librarian-only inline "create work" affordance, same
				     open/close/local-insert shape as roster's page-level section
				     create. -->
				<div class="mt-3 flex flex-col gap-1.5 border-t border-dashed border-ink-5 pt-3">
					{#if !createWorkOpen}
						<button
							type="button"
							data-testid="create-work-button"
							class="flex min-h-11 items-center self-start rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper"
							onclick={openCreateWorkForm}
						>
							{m.library_create_work_button()}
						</button>
					{:else}
						<!-- `role="group"`, NOT `role="dialog"` — this is a non-modal
						     inline form: no focus trap, no focus return, no backdrop. A
						     dialog role would announce a boundary the form does not
						     honour. The group keeps the accessible name. (Roster's
						     page-level create form still carries the stale
						     `role="dialog"` — same fix wanted there, separate commit.) -->
						<div
							data-testid="create-work-form"
							role="group"
							aria-label={m.library_create_work_button()}
							class="flex flex-col gap-1.5"
						>
							<input
								type="text"
								data-testid="create-work-name"
								bind:this={createWorkNameInput}
								aria-label={m.library_create_work_name_label()}
								placeholder={m.library_create_work_name_label()}
								aria-invalid={createWorkError ? true : undefined}
								aria-describedby={createWorkError ? 'create-work-error' : undefined}
								value={createWorkName}
								oninput={(e) => (createWorkName = (e.currentTarget as HTMLInputElement).value)}
								onkeydown={onCreateWorkNameKeydown}
								class="min-h-11 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
							/>
							<input
								type="text"
								data-testid="create-work-composer"
								aria-label={m.library_create_work_composer_label()}
								placeholder={m.library_create_work_composer_label()}
								value={createWorkComposer}
								oninput={(e) => (createWorkComposer = (e.currentTarget as HTMLInputElement).value)}
								onkeydown={onCreateWorkNameKeydown}
								class="min-h-11 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
							/>
							{#if createWorkError}
								<p
									id="create-work-error"
									role="alert"
									data-testid="create-work-error"
									class="text-xs text-red-700"
								>
									{createWorkError()}
								</p>
							{/if}
							<div class="flex gap-2">
								<button
									type="button"
									data-testid="create-work-submit"
									class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
									disabled={createWorkPending}
									onclick={() => void submitCreateWork()}
									onkeydown={onCreateWorkEscapeKeydown}
								>
									{m.library_create_work_submit()}
								</button>
								<button
									type="button"
									data-testid="create-work-cancel"
									class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink"
									onclick={closeCreateWorkForm}
									onkeydown={onCreateWorkEscapeKeydown}
								>
									{m.library_create_work_cancel()}
								</button>
							</div>
						</div>
					{/if}
					<div
						data-testid="create-work-status"
						role="status"
						aria-live="polite"
						class="sr-only"
					>
						{createWorkStatus}
					</div>
				</div>
			</section>
		{:else if $librarianStore === 'error'}
			<div data-testid="librarian-load-error" class="flex items-center gap-2" role="alert">
				<p class="text-xs text-red-700">{m.library_librarian_load_error()}</p>
				<button
					type="button"
					data-testid="librarian-retry-load"
					class="text-xs underline"
					onclick={() => {
						if (!selected) return;
						const token = getToken();
						const cfg = { db: selected.db, token: token ?? '' };
						resolveLibrarian(cfg, selected.personId).then(async (result) => {
							libraryEntityIdStore.set(result.libraryId);
							if (result.state === 'librarian') {
								try {
									const [editions, copies, members] = await Promise.all([
										listAllEditions(cfg),
										listAllCopies(cfg),
										listActiveMembers(cfg)
									]);
									allEditions = editions;
									allCopies = copies;
									allMembers = members;
									const memberIdList = members.map((mbr) => mbr.memberId);
									resolveBorrowerNames(cfg, memberIdList).then((names) => {
										memberNames = names;
									}).catch((e) => console.error('library: member name resolution failed', e));
								} catch (e) {
									console.error('library: checkout data load failed', e);
									librarianStore.set('error');
									return;
								}
							}
							librarianStore.set(result.state);
						});
					}}
				>
					{m.library_librarian_retry()}
				</button>
			</div>
		{/if}

		{#if returnError}
			<p data-testid="return-error" class="text-xs text-red-700" role="alert">{returnError}</p>
		{/if}

		<!-- #73 — my loans section -->
		{#if myActiveLoans.length > 0}
			<section data-testid="my-loans" class="rounded-md border border-ink-5 px-4 py-3">
				<button
					type="button"
					data-testid="my-loans-toggle"
					class="flex w-full items-center justify-between text-left text-sm font-medium"
					aria-expanded={myLoansExpanded}
					aria-controls={myLoansExpanded ? 'my-loans-list' : undefined}
					onclick={() => { myLoansExpanded = !myLoansExpanded; }}
				>
					<span>{m.library_my_loans_title({ count: myActiveLoans.length })}</span>
					<span aria-hidden="true">{myLoansExpanded ? '▾' : '▸'}</span>
				</button>
				{#if myLoansExpanded}
					<ul id="my-loans-list" class="mt-2 flex flex-col gap-1">
						{#each myActiveLoans as loan (loan.id)}
							<li data-testid="my-loans-item-{loan.id}" class="flex items-center justify-between text-xs">
								<span>{m.library_my_loans_copy_label({ copyName: myCopyChains.has(loan.copyId) ? formatLoanChainLabel(myCopyChains.get(loan.copyId)!) : myCopyNames.get(loan.copyId) || m.library_copy_name_unknown() })}</span>
								<span class="text-ink-2">
									{formatDate(loan.assignedAt)}{#if loan.assignedUntil} – {formatDate(loan.assignedUntil)}{/if}
								</span>
								{#if isOverdue(loan.assignedUntil)}
									<span data-testid="my-loans-overdue-{loan.id}" class="text-red-700">{m.library_my_loans_overdue()}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
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
		{:else if works.length === 0}
			<div data-testid="library-empty" class="flex min-h-[30vh] items-center justify-center">
				<p class="font-display text-xl text-ink-2">{m.library_empty()}</p>
			</div>
		{:else}
			<ul data-testid="library-work-list" class="flex flex-col gap-1">
				{#each works as work (work.id)}
					{@const isOpen = expandedWorks.has(work.id)}
					<li data-testid="library-work-{work.id}" class="flex flex-col border-b border-dashed border-ink-5 py-2 last:border-b-0">
						<button
							type="button"
							data-testid="library-work-toggle-{work.id}"
							class="flex items-center justify-between text-left"
							aria-expanded={isOpen}
							aria-controls={isOpen ? `library-editions-${work.id}` : undefined}
							onclick={() => toggleWork(work.id)}
						>
							<span class="flex flex-col">
								<span class="text-sm text-ink">{work.name}{#if $librarianStore === 'librarian'}{@const avail = workAvailability(work.id)}{#if avail.total > 0} ({m.library_work_availability(avail)}){/if}{/if}</span>
								<span class="text-xs text-ink-2">{work.composer || m.library_work_composer_unknown()}</span>
							</span>
							<span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
						</button>

						<!-- #92 TR.4 — repertoire status badge. Only works whose id resolved
						     into repertoireByWorkId (active/learning in the CURRENT season)
						     carry one; retired/dropped and non-repertoire works render none —
						     same pattern as AgendaList's attendance badge. -->
						{#if repertoireByWorkId.has(work.id)}
							{@const repStatus = repertoireByWorkId.get(work.id)!.status}
							<span
								data-testid="repertoire-badge-{work.id}"
								data-status={repStatus}
								role="img"
								aria-label={m.repertoire_badge_aria_label({
									status: REPERTOIRE_BADGE_LABEL[repStatus]?.() ?? repStatus
								})}
								class="mt-1 inline-flex w-fit items-center gap-1 font-mono text-[9px] tracking-wide text-ink-2"
							>
								<span
									class="h-1.5 w-1.5 rounded-full {REPERTOIRE_BADGE_DOT_CLASS[repStatus] ?? 'bg-ink-4'}"
									aria-hidden="true"
								></span>
								{REPERTOIRE_BADGE_LABEL[repStatus]?.() ?? repStatus}
							</span>
						{/if}

						{#if isOpen}
							<div id="library-editions-{work.id}" class="ml-4 mt-2 flex flex-col gap-1">
								{#if editionNodeStatus.get(work.id) === 'loading'}
									<div class="h-2.5 w-1/3 animate-pulse rounded bg-ink-5"></div>
								{:else if editionNodeStatus.get(work.id) === 'error'}
									<div class="flex items-center gap-2" role="alert">
										<p class="text-xs text-red-700">{m.library_node_load_error()}</p>
										<button
											type="button"
											class="text-xs underline"
											onclick={() => loadEditionsFor(work.id)}
										>
											{m.library_node_retry()}
										</button>
									</div>
								{:else if (editionsByWork.get(work.id) ?? []).length === 0}
									<p class="text-xs text-ink-2">{m.library_editions_empty()}</p>
								{:else}
									{#each editionsByWork.get(work.id) ?? [] as edition (edition.id)}
										{@const editionOpen = expandedEditions.has(edition.id)}
										<div data-testid="library-edition-{edition.id}" class="flex flex-col border-b border-dashed border-ink-5 py-1.5 last:border-b-0">
											<button
												type="button"
												data-testid="library-edition-toggle-{edition.id}"
												class="flex items-center justify-between text-left"
												aria-expanded={editionOpen}
												aria-controls={editionOpen ? `library-copies-${edition.id}` : undefined}
												onclick={() => toggleEdition(edition.id)}
											>
												<span class="flex flex-col">
													<span class="text-sm text-ink">{edition.name}</span>
													<span class="text-xs text-ink-2">{edition.publisher || m.library_edition_publisher_unknown()}</span>
												</span>
												<span aria-hidden="true">{editionOpen ? '▾' : '▸'}</span>
											</button>

											{#if editionOpen}
												<div id="library-copies-{edition.id}" class="ml-4 mt-1.5 flex flex-col gap-1">
													{#if copyNodeStatus.get(edition.id) === 'loading'}
														<div class="h-2.5 w-1/3 animate-pulse rounded bg-ink-5"></div>
													{:else if copyNodeStatus.get(edition.id) === 'error'}
														<div class="flex items-center gap-2" role="alert">
															<p class="text-xs text-red-700">{m.library_node_load_error()}</p>
															<button type="button" class="text-xs underline" onclick={() => loadCopiesFor(edition.id)}>
																{m.library_node_retry()}
															</button>
														</div>
													{:else if (copiesByEdition.get(edition.id) ?? []).length === 0}
														<p class="text-xs text-ink-2">{m.library_copies_empty()}</p>
													{:else}
														<!-- #112/#88 — compact sort control group: nr / member / since.
														     #156 — the group now says what it is: `role="radiogroup"` +
														     `role="radio"` + `aria-checked` (which REPLACES the old
														     `aria-pressed` — pressed-state on `role="radio"` is an invalid
														     ARIA mix, the same trap page.sections-a11y.spec.ts caught on
														     `role="option"`). The role is load-bearing: arrows here both
														     MOVE and SELECT (`handleCopySortKeydown`), unlike the app's
														     `role="toolbar"` groups where arrows only move. -->
														<div
															data-testid="copy-sort-{edition.id}"
															role="radiogroup"
															tabindex="-1"
															aria-label={m.library_copy_sort_label()}
															class="mb-1 flex items-center gap-1"
															onkeydown={handleCopySortKeydown}
														>
															<button
																type="button"
																data-testid="copy-sort-nr-{edition.id}"
																data-sort-key="nr"
																role="radio"
																aria-checked={copySortKey === 'nr' ? 'true' : 'false'}
																tabindex={copySortKey === 'nr' ? 0 : -1}
																class="rounded border px-1.5 py-0.5 text-[10px] {copySortKey === 'nr'
																	? 'border-ink bg-ink text-paper'
																	: 'border-ink-5 text-ink-2'}"
																onclick={() => (copySortKey = 'nr')}
															>
																{m.library_copy_sort_nr()}
															</button>
															<button
																type="button"
																data-testid="copy-sort-member-{edition.id}"
																data-sort-key="member"
																role="radio"
																aria-checked={copySortKey === 'member' ? 'true' : 'false'}
																tabindex={copySortKey === 'member' ? 0 : -1}
																class="rounded border px-1.5 py-0.5 text-[10px] {copySortKey === 'member'
																	? 'border-ink bg-ink text-paper'
																	: 'border-ink-5 text-ink-2'}"
																onclick={() => (copySortKey = 'member')}
															>
																{m.library_copy_sort_member()}
															</button>
															<button
																type="button"
																data-testid="copy-sort-since-{edition.id}"
																data-sort-key="since"
																role="radio"
																aria-checked={copySortKey === 'since' ? 'true' : 'false'}
																tabindex={copySortKey === 'since' ? 0 : -1}
																class="rounded border px-1.5 py-0.5 text-[10px] {copySortKey === 'since'
																	? 'border-ink bg-ink text-paper'
																	: 'border-ink-5 text-ink-2'}"
																onclick={() => (copySortKey = 'since')}
															>
																{m.library_copy_sort_since()}
															</button>
														</div>
														{#each sortCopies(copiesByEdition.get(edition.id) ?? [], copySortKey) as copy (copy.id)}
															{@const availability = deriveCopyAvailability(copy.id, lendings)}
															{@const activeLending = activeLendingForCopy(copy.id)}
															{#if $librarianStore === 'librarian' || activeLending}
															<div data-testid="library-copy-{copy.id}" class="flex items-center justify-between text-xs">
																<span class="text-ink">{copy.name || (copy.copyNumber ? `#${copy.copyNumber}` : m.library_copy_name_unknown())}</span>
																<span class="flex items-center gap-1">
																	{#if availability.status === 'available'}
																	{#if $librarianStore === 'librarian'}
																		{@const editionCopyIds = editionCopyIdsFor(edition.id)}
																		<span class="flex flex-col items-end gap-0.5">
																			<select
																				data-testid="inline-checkout-{copy.id}"
																				aria-label={m.library_inline_checkout_placeholder()}
																				value=""
																				onchange={(e) => {
																					const memberId = e.currentTarget.value;
																					if (memberId) void handleInlineCheckout(copy.id, memberId);
																				}}
																				class="rounded border border-ink-5 px-2 py-0.5"
																			>
																				<option value="" disabled>{m.library_inline_checkout_placeholder()}</option>
																				{#each allMembers as member (member.memberId)}
																					{@const existingLending = activeLendingForMemberInEdition(member.memberId, editionCopyIds, lendings)}
																					{#if existingLending}
																						<option value={member.memberId} disabled>
																							{memberNames.get(member.memberId) || m.library_borrower_unknown()} — {m.library_inline_checkout_already_lent({ date: formatDate(existingLending.assignedAt) })}
																						</option>
																					{:else}
																						<option value={member.memberId}>{memberNames.get(member.memberId) || m.library_borrower_unknown()}</option>
																					{/if}
																				{/each}
																			</select>
																			{#if inlineCheckoutErrors.get(copy.id)}
																				<span data-testid="inline-checkout-error-{copy.id}" class="text-xs text-red-700" role="alert">{inlineCheckoutErrors.get(copy.id)}</span>
																			{/if}
																		</span>
																	{:else}
																		<span class="rounded-full bg-ink-5 px-2 py-0.5 text-ink-2">{m.library_copy_available()}</span>
																	{/if}
																	{:else}
																		<span class="rounded-full bg-ink-5 px-2 py-0.5 text-ink-2">
																			{m.library_copy_lent_to({
																				name: borrowerNames.get(availability.memberId) || m.library_borrower_unknown()
																			})}
																			{#if availability.assignedAt}
																				· {m.library_lent_since({ date: formatDate(availability.assignedAt) })}
																			{/if}
																		</span>
																		{#if $librarianStore === 'librarian' && activeLending}
																			<button
																				type="button"
																				data-testid="library-return-{copy.id}"
																				class="rounded-md border border-ink px-2 py-0.5 text-xs hover:bg-ink hover:text-paper"
																				onclick={() => handleReturn(activeLending.id)}
																			>
																				{m.library_return()}
																			</button>
																		{/if}
																	{/if}
																</span>
															</div>
																{/if}
														{/each}
															{#if $librarianStore !== 'librarian'}
																{@const availableCount = (copiesByEdition.get(edition.id) ?? []).filter(
																	(c) => !activeLendingForCopy(c.id)
																).length}
																{#if availableCount > 0}
																	<div
																		data-testid="library-available-summary-{edition.id}"
																		class="text-xs text-ink-2"
																	>
																		{m.library_available_summary({ count: availableCount })}
																	</div>
																{/if}
															{/if}
													{/if}
												</div>
											{/if}
										</div>
									{/each}
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
