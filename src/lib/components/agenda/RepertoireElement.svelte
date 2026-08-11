<!-- src/lib/components/agenda/RepertoireElement.svelte -->
<!--
	#90 TR.2 — the collapsed/expanded "Works" element on an agenda event row.
	Prop-driven and fetch-free (same unit-level seam as AgendaList/RsvpControl:
	the page resolves data via loadWorksByEventId, this component only renders
	the already-resolved view model).

	Collapsed: a single tappable line — ♫ + work names joined by ' · '. Absent
	entirely when `rows` is empty (never an empty "Works" placeholder). Only
	ACTIVE rows are named: a season editor reads the repertoire unfiltered
	(#91's `includeInactive`, so the status toggle is two-way), and a dropped
	work must not advertise itself on a rehearsal row as if it were live rep —
	it is counted instead ("+N inactive") and shown, de-emphasised, on expand.

	Expanded: one row per work — name + composer, status badge (translated via
	the same STATUS_OPTIONS lookup the management select uses), pinned edition (or a
	work-no-edition placeholder), program notes when present, and the functional
	links: PDF, Borrow (static /library link, present only when copies exist),
	and one link per external_link value (text = the link's domain; the producer
	buildWorkRows has already dropped any non-http(s) value, so these hrefs are
	safe to bind).

	The PDF link is a BUTTON, not an anchor with an href. Entu's signed S3
	download url lives 60 seconds (entu-www src/api/files/index.md), so it
	cannot be resolved at agenda load and parked in an href — it would be long
	dead by the time a member expands a row and taps. The row carries the file
	PROPERTY id instead, and `onpdfclick(fileId)` lets the page sign it at click
	time (repertoire/fileUrls.ts). Entu's `?download=true` shortcut is not an
	option either: entuFetch is browser-direct with a Bearer header, and a plain
	<a> navigation carries no Authorization header.

	Concert ordering: when every row carries an ordinal (a programmed concert),
	renders numbered (ol/li) in ordinal order. When ordinals are absent (the
	season-repertoire fallback, which carries no concert position), renders as
	an unnumbered list (ul/li) in the given row order — a repertoire is still a
	list of works, and a screen reader should get the "list, N items" count on
	both surfaces; only the 1./2./3. positions are concert-specific.

	Neither <li> may carry a display utility (`flex`, `grid`, `block`, …):
	`display: flex` replaces the UA's `display: list-item`, ::marker is only
	generated for list-item boxes, and the ol's numbering would disappear with
	no test noticing (a DOM-shape spec cannot see computed display). Row layout
	therefore lives on an inner <div>; a spec guard in
	page.repertoire-a11y.spec.ts asserts the <li> class list stays display-free.

	#91 TR.3 — management controls (rights-gated writes). Still prop-driven and
	fetch-free: the page resolves rights (repertoireActions.resolveManageRights),
	picker candidates, and per-key pending state, and owns the actual writes
	(repertoireActions functions, queued through createRepertoireWriteQueue) —
	this component only renders controls and forwards taps via callback props,
	same seam as RsvpControl/onrsvpchange. Controls render iff
	`manageRights === 'editor'`; any other value (including the default
	'not-editor') renders nothing extra — existing read-only callers are
	unaffected.

	`context` distinguishes the two management surfaces sharing this element:
	  - 'repertoire' — status cycle, pin edition, remove, "Add work" (from
	    `pickableWorksList`, TR.3's pickableWorks()).
	  - 'programme'  — move up/down (ordinal reorder), remove, "Add to
	    programme" (from `pickableEditions` — {id,label} pairs the caller
	    composes, e.g. "Work — Edition", so this component stays decoupled
	    from the Work/Edition shapes).
	Rows with no works AND editor rights still show the "Add" control (there is
	nothing to collapse, so it renders directly, no disclosure).

	The two surfaces are governed by DIFFERENT entities (`_editor` on the season
	vs on the event), so `seasonRights`/`eventRights` may be supplied
	independently; `manageRights` stays the single gate for whichever surface
	`context` names, and is what a caller holding only one set of rights passes.
	Two consequences worth stating:
	  - Row controls are gated on `row.kind`, NOT on `context` alone. An event
	    with no program_items renders the SEASON repertoire as fallback (TR.2's
	    hierarchy), so a programme surface can be showing repertoire_item ids —
	    forwarding one of those to a "remove from tonight" handler would delete
	    the whole collective's season-repertoire entry, not tonight's programme.
	  - "Add to programme" renders wherever `eventRights === 'editor'`, including
	    on a repertoire-context (fallback) row. That is the ONLY entry point for
	    creating the FIRST program_item on an event: until one exists the event
	    has no programme of its own to hang controls on.

	Pending state: `pendingKeys` is the caller's write-queue key set (per
	repertoire_item/program_item id for row actions; the sentinels
	`ADD_WORK_KEY`/`ADD_PROGRAMME_KEY` exported below for the two "Add"
	controls) — every management button disables while its key is pending, the
	same double-tap guard as attendance/rsvp.
-->
<script module lang="ts">
	// Svelte 5: a plain `export` inside the instance script creates a component
	// PROP, not a static module export — these need `<script module>` so
	// `import RepertoireElement, { ADD_WORK_KEY } from './RepertoireElement.svelte'`
	// actually works for callers (and the spec).

	// The (id, label) picker pair lives in $lib/repertoire/types alongside the
	// row view model, so non-Svelte callers (the page's derived pickers, their
	// specs) can name it without importing a component. Re-exported here for
	// callers that already reach for it through the component.
	export type { PickerOption } from '$lib/repertoire/types';

	/** Fixed pending-key sentinels for the two "Add" controls (row actions use
	 *  their own item id as the key instead). */
	export const ADD_WORK_KEY = '__add_work__';
	export const ADD_PROGRAMME_KEY = '__add_programme__';
</script>

<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { PickerOption, RepertoireStatus, WorkRow } from '$lib/repertoire/types';
	import type { Work } from '$lib/library/libraryData';
	import type { ManageRightsState } from '$lib/repertoire/repertoireActions';

	const STATUS_OPTIONS: { value: RepertoireStatus; label: () => string }[] = [
		{ value: 'learning', label: m.repertoire_status_learning },
		{ value: 'active', label: m.repertoire_status_active },
		{ value: 'retired', label: m.repertoire_status_retired },
		{ value: 'dropped', label: m.repertoire_status_dropped }
	];

	/** The badge text. Routed through the SAME lookup the management select uses
	 *  (#91 review F6) — printing `row.status` verbatim leaked raw 'retired' /
	 *  'dropped' into all four locales, two snippets away from the translated
	 *  options. An unknown value would fall back to itself, but narrowStatus
	 *  (workRows.ts) already nulls those out before they reach a row. */
	function statusLabel(status: RepertoireStatus): string {
		return STATUS_OPTIONS.find((opt) => opt.value === status)?.label() ?? status;
	}

	/** Repertoire the collective is NOT singing. Only a season editor ever sees
	 *  these (`includeInactive`), and only so the status toggle is two-way. */
	const INACTIVE_STATUSES = new Set<RepertoireStatus>(['retired', 'dropped']);
	function isInactive(row: WorkRow): boolean {
		return row.status !== null && INACTIVE_STATUSES.has(row.status);
	}

	interface Props {
		rows: WorkRow[];
		/** Sign + open this edition file NOW (see the header note on the 60s url). */
		onpdfclick?: (fileId: string) => void;
		/** Rights for the surface `context` names. */
		manageRights?: ManageRightsState;
		/** `_editor` on the SEASON — governs repertoire_item writes. Defaults to
		 *  `manageRights` when `context === 'repertoire'`, so a single-surface
		 *  caller needs only `manageRights`. */
		seasonRights?: ManageRightsState;
		/** `_editor` on the EVENT — governs program_item writes. Defaults to
		 *  `manageRights` when `context === 'programme'`. */
		eventRights?: ManageRightsState;
		context?: 'repertoire' | 'programme';
		/** 'repertoire' context only — works not yet in the season's repertoire. */
		pickableWorksList?: Work[];
		/** 'programme' context only — editions not yet on tonight's programme. */
		pickableEditions?: PickerOption[];
		/** Per-row edition choices for "Pin edition" ('repertoire' context). A row
		 *  id absent (or mapped to []) hides that row's pin control — nothing to
		 *  pick from. */
		editionOptionsByRowId?: Record<string, PickerOption[]>;
		pendingKeys?: ReadonlySet<string>;
		/** #103 TE.3 — force the expanded region open with NO tap needed. The event
		 *  detail page IS the expanded view (a member never has to open her own
		 *  event's works), so it passes `true`; default `false` preserves the
		 *  agenda row's own collapsed-until-tapped behaviour verbatim. When true,
		 *  the collapsed `works-line` toggle does not render at all — there being
		 *  no "collapsed" state on this surface for it to reveal. */
		expanded?: boolean;
		onaddwork?: (workId: string) => void;
		onstatuschange?: (itemId: string, status: RepertoireStatus) => void;
		onpinedition?: (itemId: string, editionId: string) => void;
		onremoveitem?: (itemId: string) => void;
		onmoveitem?: (itemId: string, direction: 'up' | 'down') => void;
		/** ordinal is computed here (append-to-end; reorder afterwards via
		 *  onmoveitem) so the caller only needs to know the chosen edition. */
		onaddprogramitem?: (editionId: string, ordinal: number) => void;
	}
	const {
		rows,
		onpdfclick,
		manageRights = 'not-editor',
		seasonRights,
		eventRights,
		context = 'repertoire',
		pickableWorksList = [],
		pickableEditions = [],
		editionOptionsByRowId = {},
		pendingKeys = new Set<string>(),
		expanded: forceExpanded = false,
		onaddwork,
		onstatuschange,
		onpinedition,
		onremoveitem,
		onmoveitem,
		onaddprogramitem
	}: Props = $props();

	// Per-surface rights. A caller that supplies only `manageRights` gets exactly
	// the old behaviour: it governs `context`'s surface and the other stays shut.
	const canManageRepertoire = $derived(
		(seasonRights ?? (context === 'repertoire' ? manageRights : 'not-editor')) === 'editor'
	);
	const canManageProgramme = $derived(
		(eventRights ?? (context === 'programme' ? manageRights : 'not-editor')) === 'editor'
	);
	const canManage = $derived(canManageRepertoire || canManageProgramme);

	/** Repertoire ops (status / pin / remove) may touch this row: the surface is
	 *  the repertoire one AND the row is genuinely a repertoire_item. */
	function canEditRepertoireRow(row: WorkRow): boolean {
		return canManageRepertoire && context === 'repertoire' && row.kind === 'repertoire';
	}
	/** Programme ops (move / remove) may touch this row. Gated on `kind`, not on
	 *  `ordinal !== null`: a fallback row's id is a repertoire_item id, and a
	 *  program_item whose ordinal failed to read defaults to 0 (Entu's
	 *  `mandatory` is a soft hint), so ordinal is no proof of provenance. */
	function canEditProgrammeRow(row: WorkRow): boolean {
		return canManageProgramme && context === 'programme' && row.kind === 'program';
	}

	let expandedState = $state(false);
	/** #103 TE.3 — `forceExpanded` short-circuits the toggle entirely (see the
	 *  Props doc); otherwise this is exactly the old `expanded` local. */
	const isExpanded = $derived(forceExpanded || expandedState);

	let selectedWorkId = $state('');
	let selectedEditionForAdd = $state('');
	let selectedEditionByRow = $state<Record<string, string>>({});

	function handleAddWork() {
		if (!selectedWorkId || pendingKeys.has(ADD_WORK_KEY)) return;
		onaddwork?.(selectedWorkId);
		selectedWorkId = '';
	}

	function handleAddProgramItem() {
		if (!selectedEditionForAdd || pendingKeys.has(ADD_PROGRAMME_KEY)) return;
		const knownOrdinals = rows.flatMap((r) => (r.ordinal !== null ? [r.ordinal] : []));
		const nextOrdinal = knownOrdinals.length === 0 ? 0 : Math.max(...knownOrdinals) + 1;
		onaddprogramitem?.(selectedEditionForAdd, nextOrdinal);
		selectedEditionForAdd = '';
	}

	function handleStatusChange(rowId: string, value: string) {
		if (pendingKeys.has(rowId)) return;
		onstatuschange?.(rowId, value as RepertoireStatus);
	}

	function handlePinEdition(rowId: string) {
		const editionId = selectedEditionByRow[rowId];
		if (!editionId || pendingKeys.has(rowId)) return;
		onpinedition?.(rowId, editionId);
		selectedEditionByRow[rowId] = '';
	}

	function handleRemove(rowId: string) {
		if (pendingKeys.has(rowId)) return;
		onremoveitem?.(rowId);
	}

	function handleMove(rowId: string, direction: 'up' | 'down') {
		if (pendingKeys.has(rowId)) return;
		onmoveitem?.(rowId, direction);
	}

	// SSR/client-stable per-instance id, same pattern as SeasonSummary — the
	// collapsed toggle points aria-controls at the expanded region.
	const componentId = $props.id();
	const expandedRegionId = `works-expanded-${componentId}`;

	// #91 review F6 — the at-a-glance line names the music actually being sung.
	// A season editor reads the repertoire unfiltered so the status toggle stays
	// two-way, but that must not make a dropped work advertise itself on an
	// upcoming rehearsal row as if it were live rep; the count keeps it honest
	// without hiding that the rows are there to be expanded and managed.
	const activeRows = $derived(rows.filter((r) => !isInactive(r)));
	const inactiveCount = $derived(rows.length - activeRows.length);
	const collapsedLine = $derived(
		[
			activeRows.map((r) => r.workName).join(' · '),
			inactiveCount > 0 ? m.repertoire_inactive_count({ count: inactiveCount }) : ''
		]
			.filter((part) => part !== '')
			.join(' · ')
	);

	const hasOrdinals = $derived(rows.length > 0 && rows.every((r) => r.ordinal !== null));
	// Only meaningful (and only sorted) when hasOrdinals — the unordered branch
	// renders `rows` as given (season repertoire carries no concert position to
	// sort by). Ties keep source order (Array.prototype.sort is stable), so two
	// program_items that both defaulted to ordinal 0 still render in read order.
	const orderedRows = $derived(
		hasOrdinals ? [...rows].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)) : rows
	);

	function domainOf(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}
</script>

{#snippet workRowContent(row: WorkRow)}
	<span data-testid="work-name" class="text-sm text-ink">{row.workName}</span>
	<span data-testid="work-composer" class="text-xs text-ink-2">{row.composer}</span>
	{#if row.status !== null}
		<span
			data-testid="work-status-badge"
			class="w-fit rounded-full border border-ink-4 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-ink-2 uppercase"
		>
			{statusLabel(row.status)}
		</span>
	{/if}
	{#if row.editionName !== ''}
		<span data-testid="work-edition" class="text-xs text-ink-2">{row.editionName}</span>
	{:else}
		<span data-testid="work-no-edition" class="text-xs text-ink-3 italic">{m.repertoire_no_edition()}</span>
	{/if}
	{#if row.notes !== ''}
		<span data-testid="work-notes" class="text-xs text-ink-2 italic">{row.notes}</span>
	{/if}
	<span class="flex flex-wrap gap-2">
		{#if row.fileId !== ''}
			<button
				type="button"
				data-testid="work-link-pdf"
				class="text-xs text-ink underline"
				aria-label={m.repertoire_pdf_link_aria_label({ work: row.workName })}
				onclick={() => onpdfclick?.(row.fileId)}
			>
				{m.repertoire_pdf_link()}
			</button>
		{/if}
		{#if row.canBorrow}
			<a
				data-testid="work-link-borrow"
				href="/library"
				class="text-xs text-ink underline"
				aria-label={m.repertoire_borrow_link_aria_label({ work: row.workName })}
			>
				{m.repertoire_borrow_link()}
			</a>
		{/if}
		<!-- Deliberately UNKEYED: `external_link` is an implicitly multi-valued
		     Entu string prop (POST appends), so an edition can legitimately hold
		     the same url twice. Keying on the url would throw each_key_duplicate
		     and take down the page — same failure mode the ordinal note below
		     guards against. These anchors carry no per-item state, so a key buys
		     nothing here. Hrefs are pre-filtered to http(s) by buildWorkRows. -->
		{#each row.externalLinks as link}
			<a
				data-testid="work-link-external"
				href={link}
				target="_blank"
				rel="noopener noreferrer"
				class="text-xs text-ink underline"
				aria-label={m.repertoire_external_link_aria_label({
					domain: domainOf(link),
					work: row.workName
				})}
			>
				{domainOf(link)}
			</a>
		{/each}
	</span>
{/snippet}

{#snippet removeButton(row: WorkRow)}
	<button
		type="button"
		data-testid="work-manage-remove"
		class="text-xs text-red underline disabled:cursor-default disabled:opacity-[0.45]"
		disabled={pendingKeys.has(row.id)}
		aria-label={m.repertoire_remove_aria_label({ work: row.workName })}
		onclick={() => handleRemove(row.id)}
	>
		{m.repertoire_remove()}
	</button>
{/snippet}

{#snippet manageRowControls(row: WorkRow, index: number)}
	{#if canEditRepertoireRow(row) || canEditProgrammeRow(row)}
		<div data-testid="work-manage-row" class="flex flex-wrap items-center gap-2 pt-1">
			{#if canEditRepertoireRow(row)}
				<select
					data-testid="work-manage-status-select"
					class="text-xs"
					value={row.status ?? 'active'}
					disabled={pendingKeys.has(row.id)}
					aria-label={m.repertoire_status_select_aria_label({ work: row.workName })}
					onchange={(e) => handleStatusChange(row.id, (e.currentTarget as HTMLSelectElement).value)}
				>
					{#each STATUS_OPTIONS as opt (opt.value)}
						<option value={opt.value}>{opt.label()}</option>
					{/each}
				</select>
				{#if (editionOptionsByRowId[row.id] ?? []).length > 0}
					<select
						data-testid="work-manage-pin-edition-select"
						class="text-xs"
						value={selectedEditionByRow[row.id] ?? ''}
						disabled={pendingKeys.has(row.id)}
						aria-label={m.repertoire_pin_edition_select_aria_label({ work: row.workName })}
						onchange={(e) => {
							selectedEditionByRow[row.id] = (e.currentTarget as HTMLSelectElement).value;
						}}
					>
						<option value="">{m.repertoire_pin_edition_label()}</option>
						{#each editionOptionsByRowId[row.id] ?? [] as opt (opt.id)}
							<option value={opt.id}>{opt.label}</option>
						{/each}
					</select>
					<button
						type="button"
						data-testid="work-manage-pin-edition-button"
						class="text-xs text-ink underline disabled:cursor-default disabled:opacity-[0.45]"
						disabled={pendingKeys.has(row.id) || !selectedEditionByRow[row.id]}
						aria-label={m.repertoire_pin_edition_button_aria_label({ work: row.workName })}
						onclick={() => handlePinEdition(row.id)}
					>
						{m.repertoire_pin_edition_button()}
					</button>
				{/if}
				<!-- Remove lives INSIDE each branch, never alongside them: the id it
				     forwards is a repertoire_item id here and a program_item id below,
				     and the two go to different DELETE handlers. A single shared button
				     outside the branches rendered on season-fallback rows in programme
				     context and handed a repertoire_item id to "remove from tonight". -->
				{@render removeButton(row)}
			{:else if canEditProgrammeRow(row)}
				<button
					type="button"
					data-testid="work-manage-move-up"
					class="text-xs text-ink underline disabled:cursor-default disabled:opacity-[0.45]"
					disabled={pendingKeys.has(row.id) || index === 0}
					aria-label={m.repertoire_move_up_aria_label({ work: row.workName })}
					onclick={() => handleMove(row.id, 'up')}
				>
					{m.repertoire_move_up()}
				</button>
				<button
					type="button"
					data-testid="work-manage-move-down"
					class="text-xs text-ink underline disabled:cursor-default disabled:opacity-[0.45]"
					disabled={pendingKeys.has(row.id) || index === orderedRows.length - 1}
					aria-label={m.repertoire_move_down_aria_label({ work: row.workName })}
					onclick={() => handleMove(row.id, 'down')}
				>
					{m.repertoire_move_down()}
				</button>
				{@render removeButton(row)}
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet manageAddControls()}
	{#if canManageRepertoire && context === 'repertoire'}
		<div data-testid="work-manage-add-work" class="flex flex-wrap items-center gap-2 pt-1">
			<select
				data-testid="work-manage-add-work-select"
				class="text-xs"
				value={selectedWorkId}
				disabled={pendingKeys.has(ADD_WORK_KEY)}
				aria-label={m.repertoire_add_work_select_aria_label()}
				onchange={(e) => (selectedWorkId = (e.currentTarget as HTMLSelectElement).value)}
			>
				<option value="">{m.repertoire_add_work_label()}</option>
				{#each pickableWorksList as w (w.id)}
					<option value={w.id}>{w.name}</option>
				{/each}
			</select>
			<button
				type="button"
				data-testid="work-manage-add-work-button"
				class="text-xs text-ink underline disabled:cursor-default disabled:opacity-[0.45]"
				disabled={pendingKeys.has(ADD_WORK_KEY) || !selectedWorkId}
				aria-label={m.repertoire_add_work_aria_label()}
				onclick={handleAddWork}
			>
				{m.repertoire_add_work_button()}
			</button>
		</div>
	{/if}
	<!-- Deliberately NOT the `{:else}` of the branch above: "Add to programme" is
	     the ONLY way to create an event's FIRST program_item, and until one
	     exists the event renders the season repertoire (repertoire context) — so
	     gating this on `context === 'programme'` made a new programme
	     uncreatable. Rights still gate it: an EVENT editor sees it, a
	     season-only editor does not. -->
	{#if canManageProgramme}
		<div data-testid="work-manage-add-programme" class="flex flex-wrap items-center gap-2 pt-1">
			<select
				data-testid="work-manage-add-programme-select"
				class="text-xs"
				value={selectedEditionForAdd}
				disabled={pendingKeys.has(ADD_PROGRAMME_KEY)}
				aria-label={m.repertoire_add_programme_select_aria_label()}
				onchange={(e) => (selectedEditionForAdd = (e.currentTarget as HTMLSelectElement).value)}
			>
				<option value="">{m.repertoire_add_programme_label()}</option>
				{#each pickableEditions as opt (opt.id)}
					<option value={opt.id}>{opt.label}</option>
				{/each}
			</select>
			<button
				type="button"
				data-testid="work-manage-add-programme-button"
				class="text-xs text-ink underline disabled:cursor-default disabled:opacity-[0.45]"
				disabled={pendingKeys.has(ADD_PROGRAMME_KEY) || !selectedEditionForAdd}
				aria-label={m.repertoire_add_programme_aria_label()}
				onclick={handleAddProgramItem}
			>
				{m.repertoire_add_programme_button()}
			</button>
		</div>
	{/if}
{/snippet}

{#if rows.length > 0}
	{#if !forceExpanded}
		<button
			type="button"
			data-testid="works-line"
			class="flex items-baseline gap-1.5 truncate text-left text-xs text-ink-2"
			aria-expanded={isExpanded}
			aria-controls={isExpanded ? expandedRegionId : undefined}
			onclick={() => (expandedState = !expandedState)}
		>
			<span aria-hidden="true">♫</span>
			<span class="truncate">{collapsedLine}</span>
		</button>
	{/if}
	{#if isExpanded}
		<div id={expandedRegionId} data-testid="works-expanded" class="flex flex-col gap-2 pt-1 pl-4">
			{#if hasOrdinals}
				<ol class="list-decimal space-y-2 pl-4">
					<!-- Keyed on the entity id, NEVER on ordinal: `mandatory: true` is a
					     soft UI hint in Entu, so two program_items can both carry the
					     default 0 — a duplicate key throws each_key_duplicate and takes
					     down the whole agenda page, not just this element. -->
					{#each orderedRows as row, index (row.id)}
						<!-- No `flex` (or any display utility) on the <li>: `display: flex`
						     replaces the UA's `display: list-item`, and ::marker is only
						     generated for list-item boxes — the list-decimal numbering
						     would silently vanish. Column layout lives on an inner div. -->
						<li
							data-testid="work-row"
							data-inactive={isInactive(row) ? 'true' : undefined}
							class:opacity-60={isInactive(row)}
						>
							<div class="flex flex-col gap-0.5">
								{@render workRowContent(row)}
								{@render manageRowControls(row, index)}
							</div>
						</li>
					{/each}
				</ol>
			{:else}
				<!-- Season repertoire is still a list of works — it just has no concert
				     position, so <ul> (no marker, no numbering) rather than <ol>. -->
				<ul class="space-y-2">
					{#each orderedRows as row, index (row.id)}
						<li
							data-testid="work-row"
							data-inactive={isInactive(row) ? 'true' : undefined}
							class:opacity-60={isInactive(row)}
						>
							<div class="flex flex-col gap-0.5">
								{@render workRowContent(row)}
								{@render manageRowControls(row, index)}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			{@render manageAddControls()}
		</div>
	{/if}
{:else if canManage}
	<div data-testid="works-manage-empty" class="flex flex-col gap-2 pt-1">
		{@render manageAddControls()}
	</div>
{/if}
