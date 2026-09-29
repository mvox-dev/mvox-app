<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { m } from '$lib/paraglide/messages.js';
	import { rovingNextIndex } from '$lib/a11y/roving';
	import { getToken } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import { loadRoster, type RosterRow } from '$lib/roster/rosterData';
	import type { ListRead } from '$lib/entu/listRead';
	// Write producers: mintSelfLinkInvite (kutsu/saada uuesti) and withdrawInvite
	// (tühista kutse) — never createInvite, which mints a second person+member.
	// listJoinStateDetails is the one read; JoinState never triggers a second call.
	import {
		listJoinStateDetails,
		type JoinState,
		type JoinStateDetail
	} from '$lib/profile/linkedIdentities';
	import { mintSelfLinkInvite, withdrawInvite, INVITE_LIFETIME_MS } from '$lib/invite/inviteData';
	import { isoDateFormatter } from '$lib/preferences/timeFormat';
	// The invite token is a bearer secret: the row hands out a full URL, never
	// a bare JWT (pasted into a browser it becomes a leaking search query). The
	// URL composer and the copy-click both share their code with InviteSurface.
	import { buildInviteUrl } from '$lib/invite/invite-links';
	import { createInviteLinkCopier, type InviteLinkCopier } from '$lib/invite/copy-invite-link';
	import { resolveOwnerTier, type OwnerTier } from '$lib/nav/adminStore';
	import {
		deactivateMember,
		reinstateMember,
		loadActiveAndArchivedRosters,
		listDeactivateBlockers,
		type DeactivateBlocker
	} from '$lib/roster/memberLifecycle';
	import {
		loadMemberRecord,
		createMemberRecord,
		updateMemberRecord,
		MemberRecordPartialSaveError,
		type MemberRecordLookup,
		type MemberRecord
	} from '$lib/roster/memberRecord';
	import { isValidIdCode } from '$lib/roster/idCode';
	import { resolveMyLibraryId } from '$lib/library/librarianStore';
	import { listSections, groupBySection, type SectionNode, type SectionGroup } from '$lib/sections/sectionData';
	import {
		assignMemberSection,
		unassignMemberSection,
		createSection,
		reorderSections,
		deleteSection,
		reparentSection,
		renameSection
	} from '$lib/sections/sectionActions';
	import {
		isSectionMembershipMissing,
		isSectionNotEmpty,
		isSectionParentDamaged
	} from '$lib/sections/sectionErrors';
	import SectionPicker from '$lib/sections/SectionPicker.svelte';
	import { adminStore } from '$lib/nav/adminStore';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';
	import { isAuthExpiredError } from '$lib/entu/request';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';
	import RedactedField from '$lib/components/RedactedField.svelte';
	import RedactedText from '$lib/components/RedactedText.svelte';
	import EntuRef from '$lib/components/EntuRef.svelte';
	import { createRouteLoadMachine, type RouteLoadStatus } from '$lib/loading/routeLoad';
	// The write gate: every write here (member lifecycle, record, invites,
	// section tree) disables together while there is no usable online signal —
	// one sentence saying why, and nothing queued for later.
	import { writesAvailable } from '$lib/net/online';

	const selected = $derived($selectedCollectiveStore);
	const admin = $derived($adminStore);
	const isOffline = $derived(!$writesAvailable);

	let status = $state<RouteLoadStatus>('loading');
	let rows = $state<RosterRow[]>([]);

	// Two independent truncation causes share one notice: membersPartial (the
	// active list or its real-names overlay) and inactivePartial (the archived
	// half) — a silently-reverted row looks identical to "no record" on screen.
	let membersPartial = $state(false);
	let inactivePartial = $state(false);
	const rosterPartial = $derived(membersPartial || inactivePartial);

	let joinStates = $state<Record<string, JoinState>>({});
	let joinStateDetails = $state<Record<string, JoinStateDetail>>({});
	let ownerTier = $state<OwnerTier | 'loading'>('loading');
	let inviteLinkByMemberId = $state<Record<string, string>>({});
	let inviteErrorByMemberId = $state<Record<string, boolean>>({});
	let withdrawErrorByMemberId = $state<Record<string, boolean>>({});
	let inviteCopierByMemberId = $state<Record<string, InviteLinkCopier>>({});
	let copiedByMemberId = $state<Record<string, boolean>>({});
	let copyFailedByMemberId = $state<Record<string, boolean>>({});
	let inviteActionPending = $state(false);
	let sections = $state<SectionNode[]>([]);
	let sectionsError = $state(false);

	let sectionWriteError = $state<{ memberId: string } | null>(null);

	let sectionBusyIds = new SvelteSet<string>();

	let view = $state<'grouped' | 'flat'>('grouped');

	let currentCfg: EntuCfg | null = null;

	const routeLoad = createRouteLoadMachine({
		name: 'roster',
		selected: () => selected,
		setStatus: (s) => {
			status = s;
		},
		reset: ({ isSwitch }) => {
			reorderError = false;
			reorderStatus = '';
			reorderPending = false;
			removeError = null;
			pendingRemoveId = null;
			sectionWriteError = null;
			pageCreateError = null;
			sectionBusyIds.clear();
			removePending = false;
			untrack(() => {
				void submitRename({ refocus: false, generation: routeLoad.generation - 1 });
			});
			renamingSectionId = null;
			renameValue = '';
			renamePending = false;
			renameError = null;
			pendingDeactivateId = null;
			deactivateRefusal = null;
			deactivateActionError = null;
			deactivatePending = false;
			reinstatePending = null;
			inviteActionPending = false;
			recordEditorMemberId = null;
			recordEditorLookup = null;
			recordSaveError = null;
			recordStatus = '';
			removeStatus = '';
			renameStatus = '';
			pageCreateStatus = '';
			membersPartial = false;
			if (isSwitch) {
				showInactive = false;
				inactiveRows = [];
				inactiveLoadError = false;
				inactivePartial = false;
				inviteLinkByMemberId = {};
				inviteErrorByMemberId = {};
				withdrawErrorByMemberId = {};
				inviteCopierByMemberId = {};
				copiedByMemberId = {};
				copyFailedByMemberId = {};
				pageCreateOpen = false;
				pageCreateName = '';
				pageCreateParentId = '';
			}
		},
		onNoCollective: () => {
			rows = [];
			sections = [];
			membersPartial = false;
			inactivePartial = false;
			expandedIds = new Set();
			sectionsError = false;
			currentCfg = null;
			joinStates = {};
			joinStateDetails = {};
			ownerTier = 'loading';
			inviteLinkByMemberId = {};
			inviteErrorByMemberId = {};
			withdrawErrorByMemberId = {};
			inviteCopierByMemberId = {};
			copiedByMemberId = {};
			copyFailedByMemberId = {};
		},
		onNoToken: () => {
			currentCfg = null;
		},
		async load({ cfg, selected, isCurrent }) {
			currentCfg = cfg;
			const [rowResult, sectionResult, ownerTierResult] = await Promise.allSettled([
				readRosterHalves(cfg),
				listSections(cfg),
				resolveOwnerTier(cfg, selected.personId)
			]);
			if (!isCurrent()) return;

			if (rowResult.status === 'rejected') {
				if (isAuthExpiredError(rowResult.reason)) {
					status = 'session-expired';
					return;
				}
				console.error('roster: load failed', rowResult.reason);
				status = 'load-error';
				return;
			}
			applyRosterHalves(rowResult.value);

			ownerTier = ownerTierResult.status === 'fulfilled' ? ownerTierResult.value : 'error';

			try {
				const details = await listJoinStateDetails(cfg, rows.map((r) => r.personId));
				if (!isCurrent()) return;
				joinStateDetails = details;
				joinStates = bareJoinStates(details);
			} catch (e) {
				if (!isCurrent()) return;
				console.error('roster: join-state load failed, showing no join-state badges', e);
				joinStateDetails = {};
				joinStates = {};
			}

			if (sectionResult.status === 'rejected') {
				if (isAuthExpiredError(sectionResult.reason)) {
					status = 'session-expired';
					return;
				}
				console.error('roster: section tree load failed', sectionResult.reason);
				sections = [];
				expandedIds = new Set();
				sectionsError = true;
				view = 'flat';
			} else {
				sections = sectionResult.value;
				expandedIds = new Set();
				sectionsError = false;
			}
			status = 'ready';
		}
	});

	function loadForSelected(): Promise<void> {
		return routeLoad.loadForSelected();
	}

	type RosterHalves = {
		active: ListRead<RosterRow>;
		inactive: ListRead<RosterRow> | null;
		archivedFailed: boolean;
	};

	async function readRosterHalves(cfg: EntuCfg): Promise<RosterHalves> {
		const wantArchived = untrack(() => showInactive);
		if (!wantArchived) {
			return { active: await loadRoster(cfg), inactive: null, archivedFailed: false };
		}
		try {
			const both = await loadActiveAndArchivedRosters(cfg);
			return { active: both.active, inactive: both.inactive, archivedFailed: false };
		} catch (e) {
			console.error('roster: archived half failed, loading the active list alone', e);
			return { active: await loadRoster(cfg), inactive: null, archivedFailed: true };
		}
	}

	function applyRosterHalves(read: RosterHalves): void {
		rows = read.active.items;
		membersPartial = read.active.truncated;
		if (read.inactive) {
			inactiveRows = read.inactive.items;
			inactivePartial = read.inactive.truncated;
			inactiveLoadError = false;
		} else if (read.archivedFailed) {
			inactiveRows = [];
			inactivePartial = false;
			inactiveLoadError = true;
		}
	}

	$effect(() => {
		void selected;
		loadForSelected().catch((e) => {
			console.error('roster: load failed', e);
			status = 'load-error';
		});
	});

	const currentDbEntityId = $derived(
		rows.find((r) => r.personId === selected?.personId)?.dbEntityId ??
			rows.find((r) => r.dbEntityId)?.dbEntityId ??
			null
	);

	const visibleSections = $derived(
		currentDbEntityId === null
			? sections
			: sections.filter(
					(n) => n.parentDamaged === true || (n.dbEntityId ?? null) === currentDbEntityId
				)
	);

	const groups = $derived(groupBySection(rows, visibleSections));
	const groupById = $derived.by(() => {
		const map = new Map<string, SectionGroup>();
		for (const g of groups) if (g.sectionId !== null) map.set(g.sectionId, g);
		return map;
	});
	const unassignedGroup = $derived(groups.find((g) => g.sectionId === null) ?? null);

	const sectionNameById = $derived.by(() => {
		const map = new Map<string, string>();
		function walk(nodes: SectionNode[]): void {
			for (const n of nodes) {
				map.set(n.id, n.name);
				walk(n.children);
			}
		}
		walk(sections);
		return map;
	});

	const flatRows = $derived([...rows].sort((a, b) => a.name.localeCompare(b.name)));

	const rootDbEntityBySectionId = $derived.by(() => {
		const map = new Map<string, string | null>();
		function walk(nodes: SectionNode[], rootOrg: string | null): void {
			for (const n of nodes) {
				const org = n.parentId === null ? (n.dbEntityId ?? null) : rootOrg;
				map.set(n.id, org);
				walk(n.children, org);
			}
		}
		walk(sections, null);
		return map;
	});

	function isOwnDbEntitySection(id: string): boolean {
		const org = rootDbEntityBySectionId.get(id) ?? null;
		if (org === null || currentDbEntityId === null) return true;
		return org === currentDbEntityId;
	}

	let expandedIds = $state<Set<string>>(new Set());
	function toggleSection(id: string): void {
		const next = new Set(expandedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expandedIds = next;
	}

	const allSectionIdsList = $derived.by(() => {
		const ids: string[] = [];
		function walk(nodes: SectionNode[]): void {
			for (const n of nodes) {
				ids.push(n.id);
				walk(n.children);
			}
		}
		walk(visibleSections);
		if (unassignedGroup) ids.push('unassigned');
		return ids;
	});

	let viewMode = $state<'collapsed' | 'expanded' | 'arrange'>('collapsed');

	function setViewMode(mode: 'collapsed' | 'expanded' | 'arrange'): void {
		viewMode = mode;
		if (mode === 'collapsed') expandedIds = new Set();
		else if (mode === 'expanded') expandedIds = new Set(allSectionIdsList);
	}

	function handleViewModeKeydown(e: KeyboardEvent): void {
		const group = e.currentTarget as HTMLElement;
		const chips = Array.from(group.querySelectorAll<HTMLButtonElement>('button'));
		const idx = chips.indexOf(e.target as HTMLButtonElement);
		if (idx < 0) return;
		const next = rovingNextIndex(e.key, idx, chips.length);
		if (next < 0) return;
		e.preventDefault();
		const mode = chips[next].dataset.viewMode as 'collapsed' | 'expanded' | 'arrange' | undefined;
		if (!mode) return;
		setViewMode(mode);
		chips[next].focus();
	}

	type ArrangeRow = { id: string; name: string; depth: number; memberCount: number };
	const arrangeRows = $derived.by(() => {
		const list: ArrangeRow[] = [];
		function walk(nodes: SectionNode[]): void {
			for (const n of nodes) {
				list.push({ id: n.id, name: n.name, depth: n.depth, memberCount: groupById.get(n.id)?.memberCount ?? 0 });
				walk(n.children);
			}
		}
		walk(visibleSections);
		return list;
	});

	const ARRANGE_INDENT_CLASSES = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16'] as const;
	function arrangeIndentClass(depth: number): string {
		return ARRANGE_INDENT_CLASSES[Math.min(depth, ARRANGE_INDENT_CLASSES.length - 1)];
	}

	function currentSectionIds(memberId: string): string[] {
		return rows.find((r) => r.memberId === memberId)?.sectionIds ?? [];
	}

	function patchMemberSectionIds(memberId: string, sectionIds: string[]): void {
		const distinct = [...new Set(sectionIds)];
		rows = rows.map((r) => (r.memberId === memberId ? { ...r, sectionIds: distinct } : r));
	}

	function dropBack(memberId: string, sectionId: string): void {
		patchMemberSectionIds(
			memberId,
			currentSectionIds(memberId).filter((id) => id !== sectionId)
		);
	}


	async function handleAssign(memberId: string, sectionId: string): Promise<void> {
		if (isOffline) return;
		sectionWriteError = null;
		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: section assign with no cfg', memberId, sectionId);
			sectionWriteError = { memberId };
			return;
		}
		const g = routeLoad.generation;
		sectionBusyIds.add(memberId);
		patchMemberSectionIds(memberId, [...currentSectionIds(memberId), sectionId]);
		try {
			await assignMemberSection(cfg, memberId, sectionId);
		} catch (e) {
			console.error('roster: section assign failed', memberId, sectionId, e);
			if (g !== routeLoad.generation) return;
			dropBack(memberId, sectionId);
			sectionWriteError = { memberId };
		} finally {
			sectionBusyIds.delete(memberId);
		}
	}

	async function handleUnassign(memberId: string, sectionId: string): Promise<void> {
		if (isOffline) return;
		sectionWriteError = null;
		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: section unassign with no cfg', memberId, sectionId);
			sectionWriteError = { memberId };
			return;
		}
		const g = routeLoad.generation;
		sectionBusyIds.add(memberId);
		try {
			await unassignMemberSection(cfg, memberId, sectionId);
			if (g !== routeLoad.generation) return;
			dropBack(memberId, sectionId);
		} catch (e) {
			console.error('roster: section unassign failed', memberId, sectionId, e);
			if (g !== routeLoad.generation) return;
			if (isSectionMembershipMissing(e)) {
				dropBack(memberId, sectionId);
			} else {
				sectionWriteError = { memberId };
			}
		} finally {
			sectionBusyIds.delete(memberId);
		}
	}

	async function handleMove(memberId: string, fromId: string, toId: string): Promise<void> {
		if (isOffline) return;
		sectionWriteError = null;
		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: section move with no cfg', memberId, fromId, toId);
			sectionWriteError = { memberId };
			return;
		}
		const g = routeLoad.generation;
		sectionBusyIds.add(memberId);
		try {
			try {
				await assignMemberSection(cfg, memberId, toId);
			} catch (e) {
				console.error('roster: move — assigning the new section failed', memberId, fromId, toId, e);
				if (g !== routeLoad.generation) return;
				sectionWriteError = { memberId };
				return;
			}
			if (g !== routeLoad.generation) return;
			patchMemberSectionIds(memberId, [...currentSectionIds(memberId), toId]);
			try {
				await unassignMemberSection(cfg, memberId, fromId);
			} catch (e) {
				console.error(
					'roster: move — unassigning the old section failed',
					memberId,
					fromId,
					toId,
					e
				);
				if (g !== routeLoad.generation) return;
				if (isSectionMembershipMissing(e)) {
					dropBack(memberId, fromId);
					return;
				}
				sectionWriteError = { memberId };
				return;
			}
			if (g !== routeLoad.generation) return;
			dropBack(memberId, fromId);
		} finally {
			sectionBusyIds.delete(memberId);
		}
	}


	function findSectionNode(nodes: SectionNode[], id: string): SectionNode | null {
		for (const node of nodes) {
			if (node.id === id) return node;
			const found = findSectionNode(node.children, id);
			if (found) return found;
		}
		return null;
	}

	function insertSectionNode(
		nodes: SectionNode[],
		newNode: SectionNode,
		parentId: string | null
	): SectionNode[] {
		if (parentId === null) return [...nodes, newNode];
		return nodes.map((node) => {
			if (node.id === parentId) return { ...node, children: [...node.children, newNode] };
			if (node.children.length === 0) return node;
			return { ...node, children: insertSectionNode(node.children, newNode, parentId) };
		});
	}


	function removeSectionNode(nodes: SectionNode[], id: string): SectionNode[] {
		return nodes
			.filter((n) => n.id !== id)
			.map((n) => (n.children.length === 0 ? n : { ...n, children: removeSectionNode(n.children, id) }));
	}


	function renameSectionNode(nodes: SectionNode[], id: string, name: string): SectionNode[] {
		return nodes.map((n) => {
			if (n.id === id) return { ...n, name };
			if (n.children.length === 0) return n;
			return { ...n, children: renameSectionNode(n.children, id, name) };
		});
	}


	function withDepth(node: SectionNode, depth: number): SectionNode {
		return { ...node, depth, children: node.children.map((c) => withDepth(c, depth + 1)) };
	}

	function extractSectionNode(nodes: SectionNode[], id: string): [SectionNode[], SectionNode | null] {
		let removed: SectionNode | null = null;
		function walk(list: SectionNode[]): SectionNode[] {
			const kept: SectionNode[] = [];
			for (const n of list) {
				if (n.id === id) {
					removed = n;
					continue;
				}
				kept.push(n.children.length === 0 ? n : { ...n, children: walk(n.children) });
			}
			return kept;
		}
		const next = walk(nodes);
		return [next, removed];
	}

	function insertSectionNodeAt(
		nodes: SectionNode[],
		newNode: SectionNode,
		parentId: string | null,
		atIndex: number | undefined
	): SectionNode[] {
		if (parentId === null) {
			const idx = atIndex ?? nodes.length;
			return [...nodes.slice(0, idx), newNode, ...nodes.slice(idx)];
		}
		return nodes.map((node) => {
			if (node.id === parentId) {
				const idx = atIndex ?? node.children.length;
				return { ...node, children: [...node.children.slice(0, idx), newNode, ...node.children.slice(idx)] };
			}
			if (node.children.length === 0) return node;
			return { ...node, children: insertSectionNodeAt(node.children, newNode, parentId, atIndex) };
		});
	}

	type ReparentTarget = { kind: 'section'; sectionId: string } | { kind: 'org'; dbEntityId: string };

	function applyReparent(
		nodes: SectionNode[],
		id: string,
		target: ReparentTarget,
		insertAfterId: string | null
	): SectionNode[] {
		const [withoutNode, removed] = extractSectionNode(nodes, id);
		if (!removed) return nodes;

		const newDepth =
			target.kind === 'org' ? 0 : (findSectionNode(nodes, target.sectionId)?.depth ?? 0) + 1;
		const newParentId = target.kind === 'org' ? null : target.sectionId;
		const newDbEntityId = target.kind === 'org' ? target.dbEntityId : null;
		const movedNode: SectionNode = { ...withDepth(removed, newDepth), parentId: newParentId, dbEntityId: newDbEntityId };

		let atIndex: number | undefined;
		if (insertAfterId !== null) {
			const newSiblings =
				target.kind === 'org' ? withoutNode : (findSectionNode(withoutNode, target.sectionId)?.children ?? []);
			const idx = newSiblings.findIndex((n) => n.id === insertAfterId);
			atIndex = idx === -1 ? undefined : idx + 1;
		}
		return insertSectionNodeAt(withoutNode, movedNode, newParentId, atIndex);
	}

	let removeError = $state<{ name: string; kind: 'write' | 'not-empty' } | null>(null);

	let pendingRemoveId = $state<string | null>(null);

	let pendingDeactivateId = $state<string | null>(null);
	let deactivateRefusal = $state<{ memberId: string; blockers: DeactivateBlocker[] } | null>(null);
	let deactivatePending = $state(false);

	let deactivateActionError = $state<{ memberId: string; kind: 'deactivate' | 'reinstate' } | null>(
		null
	);

	async function armDeactivate(memberId: string): Promise<void> {
		if (deactivatePending) return;
		deactivateRefusal = null;
		deactivateActionError = null;
		pendingDeactivateId = memberId;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="member-deactivate-confirm-${memberId}"]`)?.focus();
	}

	async function disarmDeactivate(memberId: string): Promise<void> {
		pendingDeactivateId = null;
		deactivateRefusal = null;
		deactivateActionError = null;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="member-deactivate-${memberId}"]`)?.focus();
	}

	async function handleDeactivateConfirm(row: RosterRow): Promise<void> {
		if (isOffline) return;
		if (deactivatePending) return;
		const cfg = currentCfg;
		if (!cfg) return;
		const activeAtStart = document.activeElement;
		const ownsFocus =
			!activeAtStart ||
			activeAtStart === document.body ||
			activeAtStart ===
				document.querySelector(`[data-testid="member-deactivate-confirm-${row.memberId}"]`);
		const gEntry = routeLoad.generation;
		deactivatePending = true;
		deactivateRefusal = null;
		deactivateActionError = null;
		try {
			const dbEntityId = row.dbEntityId ?? currentDbEntityId;
			if (!dbEntityId) {
				throw new Error(`roster: cannot resolve the database entity id for member ${row.memberId}`);
			}
			const libraryId = await resolveMyLibraryId(cfg, undefined, dbEntityId);
			const blockers = await listDeactivateBlockers(cfg, row.personId, dbEntityId, libraryId);
			if (blockers.length > 0) {
				if (gEntry !== routeLoad.generation) return;
				deactivateRefusal = { memberId: row.memberId, blockers };
				return;
			}
			await deactivateMember(cfg, row.memberId);
			if (gEntry !== routeLoad.generation) return;
			pendingDeactivateId = null;
			await loadForSelected();
		} catch (e) {
			console.error('roster: deactivate failed', row.memberId, e);
			if (gEntry !== routeLoad.generation) return;
			deactivateActionError = { memberId: row.memberId, kind: 'deactivate' };
		} finally {
			if (gEntry === routeLoad.generation) deactivatePending = false;
			if (ownsFocus && pendingDeactivateId === row.memberId) {
				await tick();
				focusableByTestId(`member-deactivate-confirm-${row.memberId}`)?.focus();
			}
		}
	}

	let showInactive = $state(false);
	let inactiveRows = $state<RosterRow[]>([]);
	let inactiveLoadError = $state(false);

	async function toggleInactive(): Promise<void> {
		const opening = !showInactive;
		showInactive = opening;
		if (!opening) {
			inactivePartial = false;
			return;
		}
		const cfg = currentCfg;
		if (!cfg) return;
		const g = routeLoad.generation;
		try {
			inactiveLoadError = false;
			const read = await readRosterHalves(cfg);
			if (!routeLoad.isCurrent(g)) return;
			applyRosterHalves(read);
		} catch (e) {
			if (!routeLoad.isCurrent(g)) return;
			console.error('roster: inactive roster load failed', e);
			inactiveLoadError = true;
			inactiveRows = [];
			inactivePartial = false;
		}
	}

	let reinstatePending = $state<string | null>(null);

	async function handleReinstate(memberId: string): Promise<void> {
		if (isOffline) return;
		if (reinstatePending) return;
		const cfg = currentCfg;
		if (!cfg) return;
		const gEntry = routeLoad.generation;
		reinstatePending = memberId;
		deactivateActionError = null;
		try {
			await reinstateMember(cfg, memberId);
			await loadForSelected();
		} catch (e) {
			console.error('roster: reinstate failed', memberId, e);
			if (gEntry !== routeLoad.generation) return;
			deactivateActionError = { memberId, kind: 'reinstate' };
		} finally {
			if (gEntry === routeLoad.generation) reinstatePending = null;
		}
	}


	async function refreshJoinState(cfg: EntuCfg, personId: string, g: number): Promise<void> {
		const updated = await listJoinStateDetails(cfg, [personId]);
		if (!routeLoad.isCurrent(g)) return;
		joinStateDetails = { ...joinStateDetails, ...updated };
		joinStates = { ...joinStates, ...bareJoinStates(updated) };
	}

	async function handleMintInvite(row: RosterRow): Promise<void> {
		if (isOffline) return;
		if (inviteActionPending) return;
		const cfg = currentCfg;
		if (!cfg) return;
		inviteActionPending = true;
		const g = routeLoad.generation;
		try {
			const { inviteToken } = await mintSelfLinkInvite(cfg, row.personId);
			if (!routeLoad.isCurrent(g)) return;
			const { [row.memberId]: _dropped, ...restErrors } = inviteErrorByMemberId;
			inviteErrorByMemberId = restErrors;
			inviteLinkByMemberId = {
				...inviteLinkByMemberId,
				[row.memberId]: buildInviteUrl(window.location.origin, inviteToken)
			};
			copiedByMemberId = { ...copiedByMemberId, [row.memberId]: false };
			copyFailedByMemberId = { ...copyFailedByMemberId, [row.memberId]: false };
			await refreshJoinState(cfg, row.personId, g);
		} catch (e) {
			if (!routeLoad.isCurrent(g)) return;
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				return;
			}
			console.error('roster: invite mint failed', row.memberId, e);
			inviteErrorByMemberId = { ...inviteErrorByMemberId, [row.memberId]: true };
		} finally {
			if (routeLoad.isCurrent(g)) inviteActionPending = false;
		}
	}

	async function handleWithdrawInvite(row: RosterRow): Promise<void> {
		if (isOffline) return;
		if (inviteActionPending) return;
		const cfg = currentCfg;
		if (!cfg) return;
		inviteActionPending = true;
		const g = routeLoad.generation;
		try {
			await withdrawInvite(cfg, row.personId);
			if (!routeLoad.isCurrent(g)) return;
			const { [row.memberId]: _droppedW, ...restWithdrawErrors } = withdrawErrorByMemberId;
			withdrawErrorByMemberId = restWithdrawErrors;
			const { [row.memberId]: _droppedLink, ...restLinks } = inviteLinkByMemberId;
			inviteLinkByMemberId = restLinks;
			await refreshJoinState(cfg, row.personId, g);
		} catch (e) {
			if (!routeLoad.isCurrent(g)) return;
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				return;
			}
			console.error('roster: withdraw failed', row.memberId, e);
			withdrawErrorByMemberId = { ...withdrawErrorByMemberId, [row.memberId]: true };
		} finally {
			if (routeLoad.isCurrent(g)) inviteActionPending = false;
		}
	}

	async function copyInviteLink(memberId: string): Promise<void> {
		let copier = inviteCopierByMemberId[memberId];
		if (!copier) {
			copier = createInviteLinkCopier(() => inviteLinkByMemberId[memberId] ?? '');
			inviteCopierByMemberId = { ...inviteCopierByMemberId, [memberId]: copier };
		}
		const pending = copier.copy();
		copiedByMemberId = { ...copiedByMemberId, [memberId]: copier.copied };
		copyFailedByMemberId = { ...copyFailedByMemberId, [memberId]: copier.copyFailed };
		await pending;
		copiedByMemberId = { ...copiedByMemberId, [memberId]: copier.copied };
		copyFailedByMemberId = { ...copyFailedByMemberId, [memberId]: copier.copyFailed };
	}

	let recordEditorMemberId = $state<string | null>(null);
	let recordEditorLookup = $state<MemberRecordLookup | null>(null);
	let recordForm = $state<{
		name: string;
		phone: string;
		email: string;
		birthdate: string;
		id_code: string;
	}>({
		name: '',
		phone: '',
		email: '',
		birthdate: '',
		id_code: ''
	});
	let recordSavingMemberId = $state<string | null>(null);
	type RecordSaveError =
		| { memberId: string; kind: 'failed' }
		| { memberId: string; kind: 'partial'; savedFields: string[] }
		| { memberId: string; kind: 'name-required' }
		| { memberId: string; kind: 'phone-invalid' }
		| { memberId: string; kind: 'email-invalid' }
		| { memberId: string; kind: 'id-code-invalid' };
	let recordSaveError = $state<RecordSaveError | null>(null);
	let emailInputEl = $state<HTMLInputElement | null>(null);
	let recordStatus = $state('');
	let recordEditorOriginal: {
		name: string;
		phone: string;
		email: string;
		birthdate: string;
		id_code: string;
	} | null = null;

	const RECORD_FIELD_LABEL: Record<'name' | 'phone' | 'email' | 'birthdate' | 'id_code', () => string> = {
		name: m.roster_record_name_label,
		phone: m.roster_record_phone_label,
		email: m.roster_record_email_label,
		birthdate: m.roster_record_birthdate_label,
		id_code: m.roster_record_id_code_label
	};

	type JoinDisplayState = 'absent' | 'invited' | 'expired' | 'joined';

	const JOIN_STATE_LABEL: Record<JoinDisplayState, (params: { date: string }) => string> = {
		absent: m.roster_member_join_state_absent,
		invited: m.roster_member_join_state_invited,
		expired: m.roster_member_join_state_expired,
		joined: m.roster_member_join_state_joined
	};
	const JOIN_STATE_BADGE_CLASS: Record<JoinDisplayState, string> = {
		joined: 'border-emerald-700 text-emerald-700',
		invited: 'border-amber-700 text-amber-700',
		expired: 'border-red-700 text-red-700',
		absent: 'border-ink-4 text-ink-2'
	};
	const joinStateDateFmt = isoDateFormatter();

	function joinStateLine(row: RosterRow): { display: JoinDisplayState; at: string } | undefined {
		const detail = joinStateDetails[row.personId];
		if (detail === undefined) return undefined;
		const at = detail.state === 'absent' ? row.createdAt : detail.at;
		if (at === undefined || Number.isNaN(Date.parse(at))) return undefined;
		if (detail.state === 'absent') return { display: 'absent', at };
		if (detail.state === 'invited') {
			const expired = Date.parse(at) + INVITE_LIFETIME_MS < Date.now();
			return { display: expired ? 'expired' : 'invited', at };
		}
		return { display: 'joined', at };
	}

	function bareJoinStates(details: Record<string, JoinStateDetail>): Record<string, JoinState> {
		return Object.fromEntries(Object.entries(details).map(([id, d]) => [id, d.state]));
	}

	async function openRecordEditor(row: RosterRow): Promise<void> {
		const cfg = currentCfg;
		if (!cfg) return;
		const memberId = row.memberId;
		recordEditorMemberId = memberId;
		recordEditorLookup = null;
		recordSaveError = null;
		recordEditorOriginal = null;
		recordForm = { name: '', phone: '', email: '', birthdate: '', id_code: '' };
		const g = routeLoad.generation;
		try {
			const result = await loadMemberRecord(cfg, row.personId);
			if (!routeLoad.isCurrent(g) || recordEditorMemberId !== memberId) return;
			recordEditorLookup = result;
			if (result.state === 'none') {
				recordForm = {
					name: row.profileName ?? row.name,
					phone: '',
					email: row.email,
					birthdate: '',
					id_code: ''
				};
				recordEditorOriginal = { ...recordForm };
			} else if (result.state === 'one') {
				recordForm = {
					name: result.record.name,
					phone: result.record.phone,
					email: result.record.email,
					birthdate: result.record.birthdate,
					id_code: result.record.id_code ?? ''
				};
				recordEditorOriginal = { ...recordForm };
			}
		} catch (e) {
			if (!routeLoad.isCurrent(g) || recordEditorMemberId !== memberId) return;
			console.error('roster: member record load failed', memberId, e);
			recordEditorMemberId = null;
		}
	}

	function cancelRecordEditor(): void {
		recordEditorMemberId = null;
		recordEditorLookup = null;
		recordSaveError = null;
		recordEditorOriginal = null;
	}

	async function saveRecordEditor(row: RosterRow): Promise<void> {
		if (recordSavingMemberId !== null) return;
		if (isOffline) return;
		const cfg = currentCfg;
		if (!cfg) return;
		const lookup = recordEditorLookup;
		if (!lookup || lookup.state === 'damaged') return;
		const memberId = row.memberId;
		recordSaveError = null;
		recordStatus = '';
		if (recordForm.name.trim() === '') {
			recordSaveError = { memberId, kind: 'name-required' };
			return;
		}
		if (/\p{L}/u.test(recordForm.phone)) {
			recordSaveError = { memberId, kind: 'phone-invalid' };
			return;
		}
		if (emailInputEl && !emailInputEl.checkValidity()) {
			recordSaveError = { memberId, kind: 'email-invalid' };
			return;
		}
		if (!isValidIdCode(recordForm.id_code)) {
			recordSaveError = { memberId, kind: 'id-code-invalid' };
			return;
		}
		const g = routeLoad.generation;
		recordSavingMemberId = memberId;
		try {
			const fresh = await loadMemberRecord(cfg, row.personId);
			if (!routeLoad.isCurrent(g) || recordEditorMemberId !== memberId) return;
			if (fresh.state === 'damaged') {
				recordEditorLookup = fresh;
				return;
			}
			if (fresh.state === 'none') {
				const dbEntityId = row.dbEntityId ?? currentDbEntityId;
				if (!dbEntityId) {
					throw new Error(`roster: cannot resolve the database entity id for member ${memberId}`);
				}
				await createMemberRecord(cfg, {
					dbEntityId,
					personId: row.personId,
					name: recordForm.name,
					phone: recordForm.phone,
					email: recordForm.email,
					birthdate: recordForm.birthdate,
					id_code: recordForm.id_code
				});
			} else {
				const original = recordEditorOriginal ?? {
					name: '',
					phone: '',
					email: '',
					birthdate: '',
					id_code: ''
				};
				const changes: Partial<
					Pick<MemberRecord, 'name' | 'phone' | 'email' | 'birthdate' | 'id_code'>
				> = {};
				if (recordForm.name !== original.name) changes.name = recordForm.name;
				if (recordForm.phone !== original.phone) changes.phone = recordForm.phone;
				if (recordForm.email !== original.email) changes.email = recordForm.email;
				if (recordForm.birthdate !== original.birthdate) changes.birthdate = recordForm.birthdate;
				if (recordForm.id_code !== original.id_code) changes.id_code = recordForm.id_code;
				await updateMemberRecord(cfg, fresh.record._id, changes);
			}
			if (!routeLoad.isCurrent(g) || recordEditorMemberId !== memberId) return;
			recordEditorMemberId = null;
			recordEditorLookup = null;
			recordEditorOriginal = null;
			recordStatus = m.roster_record_saved();
		} catch (e) {
			if (!routeLoad.isCurrent(g) || recordEditorMemberId !== memberId) return;
			if (e instanceof MemberRecordPartialSaveError) {
				console.error('roster: member record save incomplete', memberId, e.failedField);
				recordSaveError =
					e.landedFields.length > 0
						? { memberId, kind: 'partial', savedFields: e.landedFields }
						: { memberId, kind: 'failed' };
			} else {
				console.error('roster: member record save failed', memberId, e);
				recordSaveError = { memberId, kind: 'failed' };
			}
		} finally {
			if (recordSavingMemberId === memberId) recordSavingMemberId = null;
		}
	}

	async function armRemove(id: string): Promise<void> {
		removeError = null;
		pendingRemoveId = id;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="section-remove-confirm-${id}"]`)?.focus();
	}

	function focusableByTestId(testid: string): HTMLElement | null {
		const el = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
		return el && !(el as HTMLButtonElement).disabled ? el : null;
	}

	async function disarmRemove(id: string): Promise<void> {
		pendingRemoveId = null;
		await tick();
		const target =
			focusableByTestId(`section-remove-${id}`) ??
			focusableByTestId(`section-toggle-${id}`) ??
			focusableByTestId(`arrange-row-${id}`);
		target?.focus();
		if (target === document.querySelector(`[data-testid="arrange-row-${id}"]`)) {
			rovingHandleId = id;
		}
	}


	function removeFocusFallbackId(id: string): string | null {
		const siblingNodes = siblingsOf(sections, id);
		if (!siblingNodes) return null;
		const idx = siblingNodes.findIndex((n) => n.id === id);
		if (idx > 0) return siblingNodes[idx - 1].id;
		return findSectionNode(sections, id)?.parentId ?? null;
	}

	async function placeFocusAfterRemove(targetId: string | null): Promise<void> {
		if (targetId && viewMode === 'arrange') {
			rovingHandleId = targetId;
		}
		await tick();
		const neighbour = targetId
			? (document.querySelector<HTMLElement>(`[data-testid="section-toggle-${targetId}"]`) ??
				document.querySelector<HTMLElement>(`[data-testid="arrange-row-${targetId}"]`))
			: null;
		(neighbour ?? document.querySelector<HTMLElement>('[data-testid="roster-view-chip-collapsed"]'))?.focus();
	}

	async function placeFocusAfterFailedRemove(id: string): Promise<void> {
		await tick();
		const target =
			focusableByTestId(`section-remove-confirm-${id}`) ?? focusableByTestId(`arrange-row-${id}`);
		if (!target) return;
		target.focus();
		if (target === document.querySelector(`[data-testid="arrange-row-${id}"]`)) {
			rovingHandleId = id;
		}
	}

	let removeStatus = $state('');

	let removePending = $state(false);

	async function handleRemoveSection(id: string): Promise<void> {
		if (structuralWritePending) return;
		if (isOffline) return;
		const fallbackId = removeFocusFallbackId(id);
		const active = document.activeElement;
		const ownsFocus =
			!active ||
			active === document.body ||
			active === document.querySelector(`[data-testid="section-remove-confirm-${id}"]`);
		removeError = null;
		removeStatus = '';
		const name = findSectionNode(sections, id)?.name ?? id;
		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: section remove with no cfg', id);
			removeError = { name, kind: 'write' };
			if (ownsFocus) await placeFocusAfterFailedRemove(id);
			return;
		}
		const g = routeLoad.generation;
		const before = sections;
		let failedRemoveId: string | null = null;
		removePending = true;
		try {
			await deleteSection(cfg, id);
			if (g !== routeLoad.generation) return;
			sections = removeSectionNode(sections, id);
			pendingRemoveId = null;
			if (expandedIds.has(id)) {
				const next = new Set(expandedIds);
				next.delete(id);
				expandedIds = next;
			}
			removeStatus = m.roster_section_removed({ name });
			if (ownsFocus) await placeFocusAfterRemove(fallbackId);
		} catch (e) {
			console.error('roster: section remove failed', id, e);
			try {
				const fresh = await listSections(cfg);
				if (g !== routeLoad.generation) return;
				sections = fresh;
			} catch (refetchError) {
				console.error('roster: section refetch after a failed remove failed', refetchError);
				if (g !== routeLoad.generation) return;
				sections = before;
			}
			if (g !== routeLoad.generation) return;
			removeError = { name, kind: isSectionNotEmpty(e) ? 'not-empty' : 'write' };
			failedRemoveId = id;
		} finally {
			if (g === routeLoad.generation) removePending = false;
			if (ownsFocus && failedRemoveId !== null) await placeFocusAfterFailedRemove(failedRemoveId);
		}
	}


	let pageCreateOpen = $state(false);
	let pageCreateName = $state('');
	let pageCreateParentId = $state('');
	let pageCreateError = $state<(() => string) | null>(null);
	let pageCreateNameInput = $state<HTMLInputElement | null>(null);

	let pageCreateStatus = $state('');

	function flattenSections(nodes: SectionNode[]): SectionNode[] {
		const out: SectionNode[] = [];
		for (const node of nodes) {
			out.push(node);
			out.push(...flattenSections(node.children));
		}
		return out;
	}
	const ownOrgFlatSections = $derived(flattenSections(visibleSections));

	function pageCreateParentLabel(node: SectionNode): string {
		return '  '.repeat(node.depth) + node.name;
	}

	function openPageCreateForm(): void {
		pageCreateName = '';
		pageCreateParentId = '';
		pageCreateError = null;
		pageCreateOpen = true;
	}

	function closePageCreateForm(): void {
		pageCreateOpen = false;
		pageCreateName = '';
		pageCreateParentId = '';
		pageCreateError = null;
	}

	function onPageCreateNameKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		void submitPageCreate();
	}

	async function submitPageCreate(): Promise<void> {
		if (isOffline) return;
		pageCreateError = null;
		pageCreateStatus = '';
		const name = pageCreateName.trim();
		if (!name) {
			pageCreateError = m.roster_section_name_required;
			return;
		}
		const parentId = pageCreateParentId === '' ? null : pageCreateParentId;
		const isDuplicate = ownOrgFlatSections.some(
			(node) => node.parentId === parentId && node.name.toLowerCase() === name.toLowerCase()
		);
		if (isDuplicate) {
			pageCreateError = m.roster_section_duplicate;
			return;
		}

		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: page-level section create with no cfg', name, parentId);
			pageCreateError = m.roster_section_create_failed;
			return;
		}
		const g = routeLoad.generation;

		let newId: string;
		try {
			newId = await createSection(cfg, { name, parentId, dbEntityId: currentDbEntityId });
		} catch (e) {
			console.error('roster: page-level section create failed', name, parentId, e);
			if (g !== routeLoad.generation) return;
			pageCreateError = m.roster_section_create_failed;
			return;
		}
		if (g !== routeLoad.generation) return;

		const depth = parentId ? (findSectionNode(sections, parentId)?.depth ?? 0) + 1 : 0;
		const newNode: SectionNode = {
			id: newId,
			name,
			displayOrder: Number.POSITIVE_INFINITY,
			parentId,
			dbEntityId: parentId ? null : (currentDbEntityId ?? null),
			depth,
			children: []
		};
		sections = insertSectionNode(sections, newNode, parentId);
		expandedIds = new Set(expandedIds).add(newId);
		pageCreateStatus = m.roster_section_created({ name });
		closePageCreateForm();
	}

	$effect(() => {
		if (pageCreateOpen && pageCreateNameInput) pageCreateNameInput.focus();
	});


	function siblingsOf(nodes: SectionNode[], id: string): SectionNode[] | null {
		if (nodes.some((n) => n.id === id)) return nodes;
		for (const n of nodes) {
			const found = siblingsOf(n.children, id);
			if (found) return found;
		}
		return null;
	}

	function visibleSiblingsOf(id: string): SectionNode[] | null {
		const siblings = siblingsOf(sections, id);
		if (siblings === null) return null;
		return siblings === sections ? visibleSections : siblings;
	}

	function applySiblingOrder(nodes: SectionNode[], orderedIds: string[]): SectionNode[] {
		const wanted = new Set(orderedIds);
		if (orderedIds.length > 0 && nodes.filter((n) => wanted.has(n.id)).length === orderedIds.length) {
			const byId = new Map(nodes.map((n) => [n.id, n]));
			let next = 0;
			return nodes.map((n) => (wanted.has(n.id) ? byId.get(orderedIds[next++])! : n));
		}
		return nodes.map((n) =>
			n.children.length === 0 ? n : { ...n, children: applySiblingOrder(n.children, orderedIds) }
		);
	}

	let reorderPending = $state(false);

	let reorderError = $state(false);

	let reparentPartial = $state(false);

	let reorderStatus = $state('');

	async function performReorder(
		beforeIds: string[],
		afterIds: string[],
		movedId: string
	): Promise<boolean> {
		if (structuralWritePending) return false;
		if (isOffline) return false;
		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: section reorder with no cfg', afterIds);
			reorderError = true;
			reparentPartial = false;
			return false;
		}
		const g = routeLoad.generation;
		reorderPending = true;
		reorderError = false;
		reparentPartial = false;
		reorderStatus = '';
		sections = applySiblingOrder(sections, afterIds);
		try {
			await reorderSections(cfg, afterIds);
			if (g !== routeLoad.generation) return false;
			reorderStatus = m.roster_section_moved({
				name: findSectionNode(sections, movedId)?.name ?? movedId,
				position: afterIds.indexOf(movedId) + 1,
				total: afterIds.length
			});
			return true;
		} catch (e) {
			console.error('roster: section reorder failed', e);
			if (g !== routeLoad.generation) return false;
			reorderError = true;
			try {
				const fresh = await listSections(cfg);
				if (g !== routeLoad.generation) return false;
				sections = fresh;
			} catch (refetchError) {
				console.error('roster: section refetch after a failed reorder failed', refetchError);
				if (g === routeLoad.generation) sections = applySiblingOrder(sections, beforeIds);
			}
		} finally {
			if (g === routeLoad.generation) reorderPending = false;
		}
		return false;
	}


	function prevSiblingId(id: string): string | null {
		const siblingIds = visibleSiblingsOf(id)?.map((n) => n.id) ?? [];
		const idx = siblingIds.indexOf(id);
		if (idx <= 0) return null;
		return siblingIds[idx - 1];
	}

	function canIndent(id: string): boolean {
		return prevSiblingId(id) !== null;
	}

	function canUnindent(id: string): boolean {
		return (findSectionNode(sections, id)?.parentId ?? null) !== null;
	}

	async function performReparent(
		node: SectionNode,
		target: ReparentTarget,
		insertAfterId: string | null,
		announce: () => string
	): Promise<boolean> {
		if (structuralWritePending) return false;
		if (isOffline) return false;
		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: section reparent with no cfg', node.id);
			reorderError = true;
			reparentPartial = false;
			return false;
		}
		const g = routeLoad.generation;
		reorderPending = true;
		reorderError = false;
		reparentPartial = false;
		reorderStatus = '';
		const before = sections;
		sections = applyReparent(sections, node.id, target, insertAfterId);
		const newParentId = target.kind === 'org' ? target.dbEntityId : target.sectionId;
		let moveLanded = false;
		try {
			await reparentSection(cfg, node.id, newParentId);
			moveLanded = true;
			if (g !== routeLoad.generation) return false;
			const destinationIds = visibleSiblingsOf(node.id)?.map((n) => n.id) ?? [];
			if (destinationIds.length > 0) await reorderSections(cfg, destinationIds);
			if (g !== routeLoad.generation) return false;
			reorderStatus = announce();
			return true;
		} catch (e) {
			console.error(
				isSectionParentDamaged(e)
					? 'roster: section reparent refused — parent data damaged, nothing written'
					: 'roster: section reparent failed',
				e
			);
			if (g !== routeLoad.generation) return false;
			reorderError = true;
			reparentPartial = moveLanded;
			try {
				const fresh = await listSections(cfg);
				if (g !== routeLoad.generation) return false;
				sections = fresh;
			} catch (refetchError) {
				console.error('roster: section refetch after a failed reparent failed', refetchError);
				if (g === routeLoad.generation) sections = before;
			}
		} finally {
			if (g === routeLoad.generation) reorderPending = false;
		}
		return false;
	}

	async function handleIndent(node: SectionNode): Promise<void> {
		const prevId = prevSiblingId(node.id);
		if (prevId === null) return;
		const parentName = findSectionNode(sections, prevId)?.name ?? '';
		await performReparent(node, { kind: 'section', sectionId: prevId }, null, () =>
			m.roster_section_indented({ name: node.name, parentName })
		);
	}

	async function handleUnindent(node: SectionNode): Promise<void> {
		if (node.parentId === null) return;
		const parent = findSectionNode(sections, node.parentId);
		if (!parent) return;
		if (parent.parentId === null) {
			const dbEntityId = parent.dbEntityId ?? currentDbEntityId;
			if (!dbEntityId) {
				console.error('roster: unindent to top level with no known collective (database entity) id', node.id);
				reorderError = true;
				reparentPartial = false;
				return;
			}
			await performReparent(node, { kind: 'org', dbEntityId }, parent.id, () =>
				m.roster_section_unindented_top({ name: node.name })
			);
			return;
		}
		const grandParentId = parent.parentId;
		const grandParentName = findSectionNode(sections, grandParentId)?.name ?? '';
		await performReparent(node, { kind: 'section', sectionId: grandParentId }, parent.id, () =>
			m.roster_section_unindented({ name: node.name, parentName: grandParentName })
		);
	}


	let renamingSectionId = $state<string | null>(null);
	let renameValue = $state('');
	let renamePending = $state(false);
	let renameError = $state<{ id: string; name: string } | null>(null);
	let renameInputEl = $state<HTMLInputElement | null>(null);
	let renameStatus = $state('');

	const structuralWritePending = $derived(reorderPending || renamePending || removePending);

	function startRename(node: SectionNode): void {
		if (isOffline) return;
		if (reorderPending || removePending) return;
		if (renamingSectionId !== null && renamingSectionId !== node.id) {
			void submitRename({ refocus: false });
			if (renamingSectionId !== null) return;
		}
		renameError = null;
		renameStatus = '';
		renamingSectionId = node.id;
		renameValue = node.name;
	}

	async function cancelRename(): Promise<void> {
		const id = renamingSectionId;
		renamingSectionId = null;
		renameValue = '';
		await tick();
		if (id) document.querySelector<HTMLElement>(`[data-testid="arrange-rename-${id}"]`)?.focus();
	}

	async function submitRename(opts?: {
		blurTrigger?: boolean;
		refocus?: boolean;
		generation?: number;
	}): Promise<void> {
		const blurTrigger = opts?.blurTrigger ?? false;
		const refocus = opts?.refocus ?? true;
		const id = renamingSectionId;
		if (id === null) return;
		const name = renameValue.trim();
		if (structuralWritePending || pendingRemoveId !== null || isOffline) return;
		if (blurTrigger) {
			const original = findSectionNode(sections, id)?.name ?? '';
			if (name === '' || name === original) {
				renamingSectionId = null;
				renameValue = '';
				renameError = null;
				return;
			}
		} else if (!name) {
			return;
		}
		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: section rename with no cfg', id);
			renameError = { id, name };
			return;
		}
		const g = opts?.generation ?? routeLoad.generation;
		const before = sections;
		renamePending = true;
		renamingSectionId = null;
		sections = renameSectionNode(sections, id, name);
		try {
			await renameSection(cfg, id, name);
			if (g !== routeLoad.generation) return;
			renameStatus = m.roster_section_renamed({ name });
		} catch (e) {
			console.error('roster: section rename failed', id, e);
			try {
				const fresh = await listSections(cfg);
				if (g !== routeLoad.generation) return;
				sections = fresh;
			} catch (refetchError) {
				console.error('roster: section refetch after a failed rename failed', refetchError);
				if (g !== routeLoad.generation) return;
				sections = before;
			}
			if (g !== routeLoad.generation) return;
			renameError = { id, name };
		} finally {
			if (g === routeLoad.generation) renamePending = false;
			if (refocus) {
				await tick();
				document.querySelector<HTMLElement>(`[data-testid="arrange-rename-${id}"]`)?.focus();
			}
		}
	}

	function onRenameKeydown(event: KeyboardEvent): void {
		event.stopPropagation();
		if (event.key === 'Enter') {
			event.preventDefault();
			void submitRename();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			void cancelRename();
		}
	}

	$effect(() => {
		if (renamingSectionId !== null && renameInputEl) {
			renameInputEl.focus();
			renameInputEl.select();
		}
	});

	let draggedSectionId = $state<string | null>(null);

	let dragOverId = $state<string | null>(null);

	function handleDragStart(id: string, event: DragEvent): void {
		draggedSectionId = id;
		dragOverId = null;
		if (event.dataTransfer) {
			event.dataTransfer.setData('text/plain', id);
			event.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleDragEnd(): void {
		draggedSectionId = null;
		dragOverId = null;
	}

	function handleDragOver(id: string, event: DragEvent): void {
		if (draggedSectionId === null) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dragOverId = id;
	}

	function handleDragLeave(id: string, event: DragEvent): void {
		if (dragOverId !== id) return;
		const row = event.currentTarget as HTMLElement | null;
		const to = event.relatedTarget as Node | null;
		if (row && to && row.contains(to)) return;
		dragOverId = null;
	}

	function dropOnto(fromId: string, targetId: string): void {
		if (!fromId || fromId === targetId) return;

		const siblingNodes = visibleSiblingsOf(fromId);
		if (!siblingNodes) return;
		const siblingIds = siblingNodes.map((n) => n.id);
		const targetIndex = siblingIds.indexOf(targetId);
		if (targetIndex === -1) return;

		const withoutFrom = siblingIds.filter((id) => id !== fromId);
		const insertAt = Math.min(targetIndex, withoutFrom.length);
		const afterIds = [...withoutFrom.slice(0, insertAt), fromId, ...withoutFrom.slice(insertAt)];
		void performReorder(siblingIds, afterIds, fromId);
	}

	function handleDrop(targetId: string, event: DragEvent): void {
		const fromId = draggedSectionId;
		draggedSectionId = null;
		dragOverId = null;
		if (!fromId) return;
		event.preventDefault();
		dropOnto(fromId, targetId);
	}

	const LONG_PRESS_MS = 400;
	const LONG_PRESS_SLOP_PX = 10;

	let touchDragId = $state<string | null>(null);
	let touchOverId = $state<string | null>(null);
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let pressOrigin: { x: number; y: number } | null = null;
	let pressHandle: HTMLElement | null = null;
	let pressPointerId: number | null = null;

	function endTouchDrag(): void {
		if (longPressTimer !== null) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
		if (pressHandle && pressPointerId !== null) {
			try {
				if (pressHandle.hasPointerCapture?.(pressPointerId)) {
					pressHandle.releasePointerCapture(pressPointerId);
				}
			} catch {
			}
		}
		pressOrigin = null;
		pressHandle = null;
		pressPointerId = null;
		touchDragId = null;
		touchOverId = null;
	}

	function sectionIdUnderPointer(x: number, y: number): string | null {
		const under = document.elementFromPoint?.(x, y);
		const match =
			under?.closest(
				'[data-testid^="section-group-"], [data-testid^="arrange-row-"], [data-drop-row]'
			) ?? null;
		const testid = match?.getAttribute('data-testid') ?? '';
		const id = testid.startsWith('arrange-row-')
			? testid.slice('arrange-row-'.length)
			: testid.startsWith('section-group-')
				? testid.slice('section-group-'.length)
				: (match?.getAttribute('data-drop-row') ?? '');
		return id && id !== 'unassigned' ? id : null;
	}

	function handlePointerDown(id: string, event: PointerEvent): void {
		if (event.pointerType === 'mouse') return;
		if (structuralWritePending) return;
		endTouchDrag();
		const handle = (event.target as HTMLElement | null)?.closest?.(
			'[data-testid^="section-drag-handle-"], [data-testid^="arrange-grip-"]'
		) as HTMLElement | null;
		if (!handle) return;
		pressHandle = handle;
		pressPointerId = event.pointerId;
		pressOrigin = { x: event.clientX, y: event.clientY };
		longPressTimer = setTimeout(() => {
			longPressTimer = null;
			touchDragId = id;
			touchOverId = id;
			try {
				handle.setPointerCapture(pressPointerId as number);
			} catch {
			}
		}, LONG_PRESS_MS);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (touchDragId === null) {
			if (longPressTimer === null || !pressOrigin) return;
			const dx = event.clientX - pressOrigin.x;
			const dy = event.clientY - pressOrigin.y;
			if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) endTouchDrag();
			return;
		}
		event.preventDefault();
		touchOverId = sectionIdUnderPointer(event.clientX, event.clientY);
	}

	function handlePointerUp(event: PointerEvent): void {
		const fromId = touchDragId;
		if (fromId === null) {
			endTouchDrag();
			return;
		}
		const targetId = sectionIdUnderPointer(event.clientX, event.clientY) ?? touchOverId;
		endTouchDrag();
		if (targetId) dropOnto(fromId, targetId);
	}


	let grabbedSectionId = $state<string | null>(null);
	let grabSiblingIds: string[] | null = null;
	let grabRefocusPending = false;

	const reorderableHandleIds = $derived.by(() => {
		if (admin !== 'admin') return [] as string[];
		const ids: string[] = [];
		function walk(nodes: SectionNode[]): void {
			for (const n of nodes) {
				if (expandedIds.has(n.id)) walk(n.children);
				else ids.push(n.id);
			}
		}
		walk(visibleSections);
		return ids;
	});
	let rovingHandleId = $state<string | null>(null);
	const activeHandleId = $derived(
		rovingHandleId !== null && reorderableHandleIds.includes(rovingHandleId)
			? rovingHandleId
			: (reorderableHandleIds[0] ?? null)
	);

	function handleElementFor(id: string): HTMLElement | null {
		return (
			document.querySelector<HTMLElement>(`[data-testid="section-drag-handle-${id}"]`) ??
			document.querySelector<HTMLElement>(`[data-testid="arrange-row-${id}"]`)
		);
	}

	function moveFocus(direction: 1 | -1): void {
		const ids = viewMode === 'arrange' ? arrangeReorderableIds : reorderableHandleIds;
		const currentId = viewMode === 'arrange' ? activeArrangeRowId : activeHandleId;
		if (currentId === null) return;
		const idx = ids.indexOf(currentId);
		const nextIdx = idx + direction;
		if (idx === -1 || nextIdx < 0 || nextIdx >= ids.length) return;
		const nextId = ids[nextIdx];
		rovingHandleId = nextId;
		tick().then(() => handleElementFor(nextId)?.focus());
	}

	async function toggleGrab(node: SectionNode): Promise<void> {
		if (grabbedSectionId !== null && grabbedSectionId !== node.id) return;

		if (grabbedSectionId === null) {
			if (structuralWritePending) return;
			grabbedSectionId = node.id;
			grabSiblingIds = visibleSiblingsOf(node.id)?.map((n) => n.id) ?? [node.id];
			rovingHandleId = node.id;
			reorderStatus = m.roster_section_grabbed({ name: node.name });
			return;
		}

		const before = grabSiblingIds ?? [];
		const after = visibleSiblingsOf(node.id)?.map((n) => n.id) ?? before;
		grabbedSectionId = null;
		grabSiblingIds = null;
		if (before.length === after.length && before.every((id, i) => id === after[i])) {
			reorderStatus = m.roster_section_dropped({
				name: node.name,
				position: after.indexOf(node.id) + 1,
				total: after.length
			});
			return;
		}
		const wrote = await performReorder(before, after, node.id);
		if (!wrote) return;
		const committed = visibleSiblingsOf(node.id)?.map((n) => n.id) ?? after;
		reorderStatus = m.roster_section_dropped({
			name: node.name,
			position: committed.indexOf(node.id) + 1,
			total: committed.length
		});
	}

	async function handleHandleKeydown(node: SectionNode, event: KeyboardEvent): Promise<void> {
		if (event.target !== event.currentTarget) return;

		const key = event.key;

		if (grabbedSectionId !== null && grabbedSectionId !== node.id) return;

		if (grabbedSectionId === null) {
			if (key === ' ' || key === 'Enter') {
				event.preventDefault();
				await toggleGrab(node);
				return;
			}
			if (key === 'ArrowDown') {
				event.preventDefault();
				moveFocus(1);
				return;
			}
			if (key === 'ArrowUp') {
				event.preventDefault();
				moveFocus(-1);
			}
			return;
		}

		if (key === 'ArrowUp' || key === 'ArrowDown') {
			event.preventDefault();
			const siblingIds = visibleSiblingsOf(node.id)?.map((n) => n.id) ?? [];
			const idx = siblingIds.indexOf(node.id);
			const nextIdx = idx + (key === 'ArrowUp' ? -1 : 1);
			if (idx === -1 || nextIdx < 0 || nextIdx >= siblingIds.length) return;
			const reordered = [...siblingIds];
			reordered.splice(idx, 1);
			reordered.splice(nextIdx, 0, node.id);
			grabRefocusPending = true;
			sections = applySiblingOrder(sections, reordered);
			reorderStatus = m.roster_section_moved({
				name: node.name,
				position: nextIdx + 1,
				total: reordered.length
			});
			try {
				await tick();
				handleElementFor(node.id)?.focus();
			} finally {
				grabRefocusPending = false;
			}
			return;
		}

		if (key === 'ArrowRight' || key === 'ArrowLeft') {
			if (findSectionNode(sections, node.id)?.parentDamaged === true) {
				event.preventDefault();
				return;
			}
		}

		if (key === 'ArrowRight') {
			event.preventDefault();
			if (prevSiblingId(node.id) === null) return;
			grabbedSectionId = null;
			grabSiblingIds = null;
			await handleIndent(node);
			return;
		}

		if (key === 'ArrowLeft') {
			event.preventDefault();
			if (node.parentId === null) return;
			grabbedSectionId = null;
			grabSiblingIds = null;
			await handleUnindent(node);
			return;
		}

		if (key === ' ' || key === 'Enter') {
			event.preventDefault();
			await toggleGrab(node);
			return;
		}

		if (key === 'Escape') {
			event.preventDefault();
			cancelGrab(node);
			await tick();
			handleElementFor(node.id)?.focus();
		}
	}

	function cancelGrab(node: SectionNode): void {
		const restore = grabSiblingIds;
		grabbedSectionId = null;
		grabSiblingIds = null;
		if (restore) sections = applySiblingOrder(sections, restore);
		reorderStatus = m.roster_section_move_cancelled({ name: node.name });
	}

	function handleHandleBlur(node: SectionNode): void {
		if (grabRefocusPending) return;
		if (grabbedSectionId !== node.id) return;
		cancelGrab(node);
	}


	const arrangeReorderableIds = $derived(
		arrangeRows.filter((r) => r.id !== renamingSectionId).map((r) => r.id)
	);

	const activeArrangeRowId = $derived(
		rovingHandleId !== null && arrangeReorderableIds.includes(rovingHandleId)
			? rovingHandleId
			: (arrangeReorderableIds[0] ?? null)
	);

	const heldSectionId = $derived(grabbedSectionId ?? draggedSectionId ?? touchDragId ?? null);

	const heldSubtreeIds = $derived.by(() => {
		const ids = new Set<string>();
		if (heldSectionId === null) return ids;
		const node = findSectionNode(sections, heldSectionId);
		if (!node) return ids;
		function walk(n: SectionNode): void {
			for (const child of n.children) {
				ids.add(child.id);
				walk(child);
			}
		}
		walk(node);
		return ids;
	});

	const ARRANGE_DROP_HINT_END = '__end__';

	const arrangeDropHintBeforeId = $derived.by((): string | null => {
		if (viewMode !== 'arrange') return null;
		const fromId = draggedSectionId ?? touchDragId;
		const overId = draggedSectionId !== null ? dragOverId : touchOverId;
		if (fromId === null || overId === null || overId === fromId) return null;
		const siblingIds = visibleSiblingsOf(overId)?.map((n) => n.id) ?? [];
		const fromIdx = siblingIds.indexOf(fromId);
		const toIdx = siblingIds.indexOf(overId);
		if (fromIdx < 0 || toIdx < 0) return null;
		if (fromIdx > toIdx) return overId;
		const targetIdx = arrangeRows.findIndex((r) => r.id === overId);
		if (targetIdx < 0) return null;
		const targetDepth = arrangeRows[targetIdx].depth;
		let i = targetIdx + 1;
		while (i < arrangeRows.length && arrangeRows[i].depth > targetDepth) i += 1;
		return arrangeRows[i]?.id ?? ARRANGE_DROP_HINT_END;
	});
</script>

{#snippet rowInfo(row: RosterRow, showSection: boolean, rowSectionNames: string[])}
	<span data-testid="roster-row-name" class="text-sm text-ink"><RedactedText>{row.name}</RedactedText></span>
	{#if row.email}
		<span data-testid="roster-row-email" class="text-xs text-ink-2"><RedactedText>{row.email}</RedactedText></span>
	{/if}
	{@const line = joinStateLine(row)}
	{#if line !== undefined}
		<span
			data-testid="roster-row-join-state-{row.memberId}"
			data-join-state={line.display}
			class="w-fit rounded-full border px-1.5 py-0.5 font-mono text-[9px] tracking-wide uppercase {JOIN_STATE_BADGE_CLASS[
				line.display
			]}"
		>
			{JOIN_STATE_LABEL[line.display]({ date: joinStateDateFmt.format(new Date(line.at)) })}
		</span>
	{/if}
	{#if showSection && rowSectionNames.length > 0}
		<span data-testid="roster-row-section" class="text-xs text-ink-2">{rowSectionNames.join(', ')}</span>
	{/if}
{/snippet}

{#snippet memberRow(row: RosterRow, showSection: boolean, groupSectionId: string | null)}
	{@const rowSectionNames = (row.sectionIds ?? [])
		.map((id) => sectionNameById.get(id))
		.filter((name): name is string => Boolean(name))}
	{@const memberSectionIds = row.sectionIds ?? []}
	{@const pickerRenderIds =
		groupSectionId === null
			? memberSectionIds
			: memberSectionIds.filter((id) => id === groupSectionId)}
	<li
		data-testid="roster-row-{row.memberId}"
		class="relative flex min-h-11 flex-col gap-0.5 border-b border-dashed border-ink-5 py-2 last:border-b-0"
	>
		{@render rowInfo(row, showSection, rowSectionNames)}
		{#if admin === 'admin' && recordEditorMemberId !== row.memberId}
			<button
				type="button"
				data-testid="roster-row-card-{row.memberId}"
				class="absolute inset-0 rounded-md border border-ink-5 text-left hover:border-ink-3 focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
				onclick={() => openRecordEditor(row)}
			>
				<span class="sr-only">{m.roster_record_edit_label()} <RedactedText>{row.profileName ?? row.name}</RedactedText></span>
			</button>
		{/if}
		{#if admin === 'admin' && recordEditorMemberId === row.memberId}
			<div class="mt-1 flex flex-col gap-2">
				{#if recordEditorLookup?.state === 'damaged'}
					<p
						data-testid="roster-record-damaged-{row.memberId}"
						role="alert"
						class="mt-1 text-xs text-red-700"
					>
						{m.roster_record_damaged()}
						<EntuRef id={row.personId} />
					</p>
				{:else if recordEditorLookup !== null}
					<div class="mt-1 flex flex-col gap-2 rounded-md border border-ink-5 p-2">
						<RedactedField
							label={m.roster_record_name_label()}
							type="text"
							testid="roster-record-name"
							required
							bind:value={recordForm.name}
							disabled={recordSavingMemberId !== null}
						/>
						<RedactedField
							label={m.roster_record_phone_label()}
							type="tel"
							testid="roster-record-phone"
							bind:value={recordForm.phone}
							disabled={recordSavingMemberId !== null}
						/>
						<RedactedField
							label={m.roster_record_email_label()}
							type="email"
							testid="roster-record-email"
							bind:el={emailInputEl}
							bind:value={recordForm.email}
							disabled={recordSavingMemberId !== null}
						/>
						<RedactedField
							label={m.roster_record_birthdate_label()}
							type="date"
							testid="roster-record-birthdate"
							bind:value={recordForm.birthdate}
							disabled={recordSavingMemberId !== null}
						/>
						<RedactedField
							label={m.roster_record_id_code_label()}
							type="text"
							testid="roster-record-id-code"
							bind:value={recordForm.id_code}
							disabled={recordSavingMemberId !== null}
						/>
						<div class="flex items-center gap-2">
							<button
								type="button"
								data-testid="roster-record-save"
								disabled={recordSavingMemberId !== null || isOffline}
								class="rounded-md border border-ink px-2 py-1 text-xs disabled:opacity-50"
								onclick={() => saveRecordEditor(row)}
							>
								{m.roster_record_save()}
							</button>
							<button
								type="button"
								data-testid="roster-record-cancel"
								disabled={recordSavingMemberId === row.memberId}
								class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
								onclick={cancelRecordEditor}
							>
								{m.roster_record_cancel()}
							</button>
						</div>
						{#if recordSaveError?.memberId === row.memberId}
							<p data-testid="roster-record-save-error" role="alert" class="text-xs text-red-700">
								{#if recordSaveError.kind === 'partial'}
									{m.roster_record_save_partial({
										saved: recordSaveError.savedFields
											.map((f) => RECORD_FIELD_LABEL[f as keyof typeof RECORD_FIELD_LABEL]())
											.join(', ')
									})}
								{:else if recordSaveError.kind === 'name-required'}
									{m.roster_record_name_required()}
								{:else if recordSaveError.kind === 'phone-invalid'}
									{m.roster_record_phone_invalid()}
								{:else if recordSaveError.kind === 'email-invalid'}
									{m.roster_record_email_invalid()}
								{:else if recordSaveError.kind === 'id-code-invalid'}
									{m.roster_record_id_code_invalid()}
								{:else}
									{m.roster_record_save_failed()}
								{/if}
							</p>
						{/if}
					</div>
				{/if}
				{#if joinStates[row.personId] !== undefined}
					{@const state = joinStates[row.personId]}
					{#if ownerTier === 'owner'}
						<div class="flex flex-wrap items-center gap-2">
							{#if state === 'absent'}
								<button
									type="button"
									data-testid="roster-member-invite-{row.memberId}"
									disabled={inviteActionPending || isOffline}
									class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
									onclick={() => handleMintInvite(row)}
								>
									{m.roster_member_invite()}
								</button>
							{:else if state === 'invited'}
								<button
									type="button"
									data-testid="roster-member-reinvite-{row.memberId}"
									disabled={inviteActionPending || isOffline}
									class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
									onclick={() => handleMintInvite(row)}
								>
									{m.roster_member_reinvite()}
								</button>
								<button
									type="button"
									data-testid="roster-member-withdraw-{row.memberId}"
									disabled={inviteActionPending || isOffline}
									class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
									onclick={() => handleWithdrawInvite(row)}
								>
									{m.roster_member_withdraw()}
								</button>
							{/if}
						</div>
					{/if}
					{#if inviteLinkByMemberId[row.memberId]}
						<p class="text-xs">{m.admin_invite_link_label()}</p>
						<button
							type="button"
							data-testid="roster-invite-copy-{row.memberId}"
							class="self-start rounded-md border border-ink-5 px-3 py-1 text-xs text-ink-2 hover:text-ink"
							onclick={() => copyInviteLink(row.memberId)}
						>
							{m.admin_invite_copy()}
						</button>
						<p
							data-testid="roster-invite-copy-status-{row.memberId}"
							role="status"
							aria-live="polite"
							class="min-h-[16px] text-xs leading-[16px] text-ink-2"
						>
							{#if copiedByMemberId[row.memberId]}{m.admin_invite_copied()}{/if}
						</p>
						{#if copyFailedByMemberId[row.memberId]}
							<p
								data-testid="roster-invite-copy-error-{row.memberId}"
								role="alert"
								class="text-xs text-red-700"
							>
								{m.admin_invite_copy_error()}
							</p>
						{/if}
						<p class="text-xs text-ink-3">{m.admin_invite_bearer_warning()}</p>
					{/if}
					{#if inviteErrorByMemberId[row.memberId]}
						<p
							data-testid="roster-invite-error-{row.memberId}"
							role="alert"
							class="text-xs text-red-700"
						>
							{m.admin_invite_error()}
						</p>
					{/if}
					{#if withdrawErrorByMemberId[row.memberId]}
						<p
							data-testid="roster-withdraw-error-{row.memberId}"
							role="alert"
							class="text-xs text-red-700"
						>
							{m.roster_member_withdraw_failed()}
						</p>
					{/if}
				{/if}
			</div>
		{/if}
		{#if admin === 'admin' && row.personId !== selected?.personId && (recordEditorMemberId === row.memberId || pendingDeactivateId === row.memberId)}
			<div class="relative mt-1 flex flex-wrap items-center gap-2">
				{#if pendingDeactivateId === row.memberId}
					<span class="text-xs text-ink-2">{m.roster_member_deactivate_confirm_prompt()}</span>
					<button
						type="button"
						data-testid="member-deactivate-confirm-{row.memberId}"
						disabled={deactivatePending || isOffline}
						aria-busy={deactivatePending}
						class="rounded-md border border-red-700 px-2 py-1 text-xs text-red-700 hover:bg-red-700 hover:text-paper disabled:opacity-50"
						onclick={() => handleDeactivateConfirm(row)}
					>
						{m.roster_member_deactivate_confirm()}
					</button>
					<button
						type="button"
						data-testid="member-deactivate-cancel-{row.memberId}"
						disabled={deactivatePending}
						class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
						onclick={() => disarmDeactivate(row.memberId)}
					>
						{m.roster_member_deactivate_cancel()}
					</button>
				{:else}
					<button
						type="button"
						data-testid="member-deactivate-{row.memberId}"
						disabled={deactivatePending || isOffline}
						class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
						onclick={() => armDeactivate(row.memberId)}
					>
						{m.roster_member_deactivate()}
					</button>
				{/if}
			</div>
			{#if pendingDeactivateId === row.memberId && deactivateRefusal?.memberId === row.memberId}
				<p
					data-testid="member-deactivate-refused-{row.memberId}"
					role="alert"
					class="relative text-xs text-red-700"
				>
					{#each deactivateRefusal.blockers as blocker (blocker.role)}
						{blocker.role === 'admin'
							? m.roster_deactivate_refused_admin({ collective: selected?.name ?? '' })
							: m.roster_deactivate_refused_librarian({ collective: selected?.name ?? '' })}
					{/each}
				</p>
			{/if}
			{#if pendingDeactivateId === row.memberId && deactivateActionError?.memberId === row.memberId && deactivateActionError.kind === 'deactivate'}
				<p
					data-testid="member-deactivate-failed-{row.memberId}"
					role="alert"
					class="relative text-xs text-red-700"
				>
					{m.roster_member_deactivate_failed()}
					<EntuRef id={row.memberId} />
				</p>
			{/if}
		{/if}
		{#if row.ownerIds?.includes(selected?.personId ?? '') && !sectionsError}
			<div class="absolute top-1 right-1">
				<SectionPicker
					memberId={row.memberId}
					memberName={row.profileName ?? row.name}
					{sections}
					selectedIds={memberSectionIds}
					renderIds={pickerRenderIds}
					busy={sectionBusyIds.has(row.memberId) || isOffline}
					onassign={(sectionId) => handleAssign(row.memberId, sectionId)}
					onunassign={(sectionId) => handleUnassign(row.memberId, sectionId)}
					onmove={(fromId, toId) => handleMove(row.memberId, fromId, toId)}
				/>
			</div>
			{#if sectionWriteError?.memberId === row.memberId}
				<p
					data-testid="section-write-error-{row.memberId}"
					role="alert"
					class="relative text-xs text-red-700"
				>
					{m.roster_section_write_failed()}
				</p>
			{/if}
		{/if}
	</li>
{/snippet}

{#snippet dropIndicator()}
	<div
		data-testid="section-drop-indicator"
		aria-hidden="true"
		class="mx-2 h-0.5 border-t-2 border-dashed border-ink-3"
	></div>
{/snippet}

{#snippet sectionGroup(node: SectionNode)}
	{@const group = groupById.get(node.id)}
	{@const isExpanded = expandedIds.has(node.id)}
	<section
		data-testid="section-group-{node.id}"
		data-depth={node.depth}
		class="flex flex-col"
		style="margin-left: {node.depth === 0 ? 0 : 1}rem"
	>
		<div class="flex items-center gap-2 py-1.5">
			<button
				type="button"
				data-testid="section-toggle-{node.id}"
				aria-expanded={isExpanded}
				aria-controls={isExpanded ? `section-region-${node.id}` : undefined}
				class="flex items-center gap-2 text-left"
				onclick={() => toggleSection(node.id)}
			>
				<span aria-hidden="true" class="text-ink-2">{isExpanded ? '▾' : '▸'}</span>
				<span data-testid="section-header-{node.id}" class="text-sm font-medium text-ink">
					{node.name} ({group?.memberCount ?? 0})
				</span>
			</button>
		</div>
		{#if node.parentDamaged}
			<p data-testid="section-parent-damaged-{node.id}" role="alert" class="text-sm text-red-700">
				{m.roster_section_parent_damaged({ name: node.name })}
			</p>
		{/if}
		{#if isExpanded}
			<div id="section-region-{node.id}" class="contents">
				<ul class="flex flex-col pl-5">
					{#each group?.members ?? [] as row (row.memberId)}
						{@render memberRow(row, false, node.id)}
					{/each}
				</ul>
				{#each node.children as child (child.id)}
					{@render sectionGroup(child)}
				{/each}
			</div>
		{/if}
	</section>
{/snippet}

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.roster_title()}</h1>

		{#if admin === 'admin' && isOffline}
			<p data-testid="roster-write-unavailable" class="text-sm text-ink-2">
				{m.write_unavailable_no_signal()}
			</p>
		{/if}

		{#if rosterPartial}
			<p
				data-testid="roster-partial-notice"
				role="status"
				class="rounded-md border border-dashed border-ink-4 p-2 text-sm text-ink-2"
			>
				{m.roster_partial_notice()}
			</p>
		{/if}

		<div data-testid="roster-reorder-status" role="status" aria-live="polite" class="sr-only">
			{reorderStatus}
		</div>

		{#if admin === 'admin'}
			<span
				id="section-reorder-instructions"
				data-testid="roster-reorder-instructions"
				class="sr-only"
			>
				{m.roster_section_reorder_instructions()}
			</span>
		{/if}

		<div
			data-testid="roster-section-remove-status"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{removeStatus}
		</div>

		<div
			data-testid="roster-section-create-status"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{pageCreateStatus}
		</div>

		<div
			data-testid="roster-section-rename-status"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{renameStatus}
		</div>

		<div
			data-testid="roster-member-record-status"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{recordStatus}
		</div>

		{#if status === 'no-collective'}
			<p data-testid="roster-no-collective" class="text-sm">{m.roster_no_collective()}</p>
		{:else if status === 'loading'}
			<div
				data-testid="roster-skeleton"
				class="flex flex-col gap-3"
				aria-hidden="true"
				aria-busy="true"
			>
				{#each [0, 1, 2] as row (row)}
					<div data-testid="roster-skeleton-row" class="flex animate-pulse flex-col gap-1.5 py-2">
						<div class="h-3 w-1/2 rounded bg-ink-5"></div>
						<div class="h-2.5 w-1/3 rounded bg-ink-5"></div>
					</div>
				{/each}
			</div>
		{:else if status === 'session-expired'}
			<SessionExpiredNotice />
		{:else if status === 'load-error'}
			<div data-testid="roster-load-error" class="flex flex-col gap-2" role="alert">
				<p class="text-sm text-red-700">{m.roster_load_error()}</p>
				<button
					type="button"
					data-testid="roster-retry-load"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={() => loadForSelected()}
				>
					{m.roster_retry()}
				</button>
			</div>
		{:else if rows.length === 0 && sections.length === 0}
			<div data-testid="roster-empty" class="flex min-h-[30vh] items-center justify-center">
				<p class="font-display text-xl text-ink-2">{m.roster_empty()}</p>
			</div>
		{:else}
			{#if admin === 'admin' && ownerTier !== 'owner' && ownerTier !== 'loading'}
				<p data-testid="roster-invite-owner-note" class="text-xs text-ink-2">
					{m.roster_member_invite_owner_only()}
				</p>
			{/if}
			{#if sectionsError}
				<div data-testid="roster-sections-load-error" class="flex flex-col gap-1" role="alert">
					<p class="text-sm text-red-700">{m.roster_sections_load_error()}</p>
				</div>
			{/if}
			{#if reorderError}
				<p data-testid="section-reorder-error" role="alert" class="text-sm text-red-700">
					{reparentPartial ? m.roster_section_reparent_partial() : m.roster_section_reorder_failed()}
				</p>
			{/if}
			{#if removeError}
				<p data-testid="section-remove-error" role="alert" class="text-sm text-red-700">
					{removeError.kind === 'not-empty'
						? m.roster_section_remove_not_empty({ name: removeError.name })
						: m.roster_section_remove_failed({ name: removeError.name })}
				</p>
			{/if}
			{#if reorderPending}
				<div
					data-testid="section-reorder-pending"
					role="status"
					aria-busy="true"
					aria-live="polite"
					class="flex items-center gap-2 text-xs text-ink-2"
				>
					<span
						aria-hidden="true"
						class="h-3 w-3 animate-spin rounded-full border-2 border-ink-3 border-t-transparent"
					></span>
					{m.roster_section_reorder_pending()}
				</div>
			{/if}
			<div class="flex items-center justify-between border-b border-ink-5 pb-1.5">
				<span class="text-xs tracking-wide text-ink-2 uppercase">{m.roster_column_name()}</span>
				{#if !sectionsError}
					<button
						type="button"
						data-testid="roster-sort-toggle"
						aria-pressed={view === 'flat'}
						class="text-xs tracking-wide text-ink-2 uppercase underline hover:text-ink"
						onclick={() => (view = view === 'grouped' ? 'flat' : 'grouped')}
					>
						{view === 'grouped' ? m.roster_sort_alphabetical() : m.roster_sort_grouped()}
					</button>
				{/if}
			</div>

			{#if view === 'grouped' && !sectionsError}
				<div
					data-testid="roster-view-modes"
					role="radiogroup"
					tabindex="-1"
					aria-label={m.roster_view_modes_label()}
					class="inline-flex flex-wrap items-center gap-1.5 self-start"
					onkeydown={handleViewModeKeydown}
				>
					<button
						type="button"
						data-testid="roster-view-chip-collapsed"
						data-view-mode="collapsed"
						role="radio"
						aria-checked={viewMode === 'collapsed' ? 'true' : 'false'}
						tabindex={viewMode === 'collapsed' ? 0 : -1}
						class="rounded-full border px-2.5 py-1 text-xs tracking-wide uppercase {viewMode === 'collapsed'
							? 'border-ink bg-ink text-paper'
							: 'border-ink-4 text-ink-2 hover:text-ink'}"
						onclick={() => setViewMode('collapsed')}
					>
						{m.roster_view_collapsed()}
					</button>
					<button
						type="button"
						data-testid="roster-view-chip-expanded"
						data-view-mode="expanded"
						role="radio"
						aria-checked={viewMode === 'expanded' ? 'true' : 'false'}
						tabindex={viewMode === 'expanded' ? 0 : -1}
						class="rounded-full border px-2.5 py-1 text-xs tracking-wide uppercase {viewMode === 'expanded'
							? 'border-ink bg-ink text-paper'
							: 'border-ink-4 text-ink-2 hover:text-ink'}"
						onclick={() => setViewMode('expanded')}
					>
						{m.roster_view_expanded()}
					</button>
					{#if admin === 'admin'}
						<button
							type="button"
							data-testid="roster-view-chip-arrange"
							data-view-mode="arrange"
							role="radio"
							aria-checked={viewMode === 'arrange' ? 'true' : 'false'}
							tabindex={viewMode === 'arrange' ? 0 : -1}
							class="rounded-full border px-2.5 py-1 text-xs tracking-wide uppercase {viewMode === 'arrange'
								? 'border-ink bg-ink text-paper'
								: 'border-ink-4 text-ink-2 hover:text-ink'}"
							onclick={() => setViewMode('arrange')}
						>
							{m.roster_view_arrange()}
						</button>
					{/if}
				</div>
				{#if viewMode === 'arrange' && admin === 'admin'}
					<div data-testid="roster-arrange-list" class="flex flex-col">
						{#each arrangeRows as row (row.id)}
							{@const node = findSectionNode(sections, row.id)}
							{#if node}
								{@const siblingIds = visibleSiblingsOf(row.id)?.map((n) => n.id) ?? []}
								{@const acceptsDrop =
									draggedSectionId !== null &&
									draggedSectionId !== row.id &&
									siblingIds.includes(draggedSectionId)}
								{@const acceptsTouchDrop =
									touchDragId !== null &&
									touchOverId === row.id &&
									touchOverId !== touchDragId &&
									siblingIds.includes(touchDragId)}
								{@const canDelete =
									row.memberCount === 0 && node.children.length === 0 && isOwnDbEntitySection(row.id)}
								{@const indentApplicable = canIndent(row.id)}
								{@const unindentApplicable = canUnindent(row.id)}
								{@const damaged = node?.parentDamaged === true}
								{#if arrangeDropHintBeforeId === row.id}
									{@render dropIndicator()}
								{/if}
								{#if damaged}
									<p
										data-testid="section-parent-damaged-{row.id}"
										role="alert"
										class="text-sm text-red-700 {arrangeIndentClass(row.depth)}"
									>
										{m.roster_section_parent_damaged({ name: row.name })}
									</p>
								{/if}
								<div
									class="flex items-center focus-within:ring-2 focus-within:ring-indigo {(acceptsDrop &&
										dragOverId === row.id) ||
									acceptsTouchDrop
										? 'bg-ink-5'
										: ''} {touchDragId === row.id ? 'opacity-50' : ''} {heldSectionId === row.id
										? 'outline-2 outline-dashed outline-indigo'
										: ''} {heldSubtreeIds.has(row.id) ? 'bg-indigo-soft' : ''}"
									role="presentation"
									data-drop-row={row.id}
									ondragover={acceptsDrop ? (event: DragEvent) => handleDragOver(row.id, event) : undefined}
									ondragleave={acceptsDrop
										? (event: DragEvent) => handleDragLeave(row.id, event)
										: undefined}
									ondrop={acceptsDrop ? (event: DragEvent) => handleDrop(row.id, event) : undefined}
								>
									{#if renamingSectionId === row.id}
										<div class="flex grow items-center gap-2 py-1.5 {arrangeIndentClass(row.depth)}">
											<span aria-hidden="true" class="w-4 shrink-0"></span>
											<input
												type="text"
												data-testid="arrange-rename-input-{row.id}"
												bind:this={renameInputEl}
												aria-label={m.roster_section_name_label()}
												value={renameValue}
												oninput={(e) => (renameValue = (e.currentTarget as HTMLInputElement).value)}
												onkeydown={onRenameKeydown}
												onblur={() => void submitRename({ blurTrigger: true, refocus: false })}
												class="min-w-0 grow border border-ink-5 bg-paper px-1.5 py-0.5 text-ink"
											/>
										</div>
									{:else}
										<div
											data-testid="arrange-row-{row.id}"
											data-depth={row.depth}
											data-grabbed={heldSectionId === row.id ? 'true' : undefined}
											data-grabbed-subtree={heldSubtreeIds.has(row.id) ? 'true' : undefined}
											role="button"
											tabindex={activeArrangeRowId === row.id ? 0 : -1}
											aria-label={`${row.name} (${row.memberCount})`}
											aria-grabbed={draggedSectionId === row.id || grabbedSectionId === row.id
												? 'true'
												: 'false'}
											aria-dropeffect={acceptsDrop ? 'move' : undefined}
											aria-describedby="section-reorder-instructions"
											draggable={structuralWritePending || damaged ? 'false' : 'true'}
											style="touch-action: pan-y"
											class="flex shrink-0 items-center gap-2 py-1.5 pr-2 {arrangeIndentClass(
												row.depth
											)} focus:outline-none select-none {structuralWritePending || damaged
												? 'cursor-default'
												: 'cursor-grab'}"
											ondragstart={(event: DragEvent) => handleDragStart(row.id, event)}
											ondragend={handleDragEnd}
											onpointermove={handlePointerMove}
											onpointerup={handlePointerUp}
											onpointercancel={endTouchDrag}
											onlostpointercapture={endTouchDrag}
											onkeydown={(event: KeyboardEvent) => void handleHandleKeydown(node, event)}
											onclick={(event: MouseEvent) => {
												if (event.detail !== 0) return;
												handleElementFor(row.id)?.focus();
												void toggleGrab(node);
											}}
											onfocus={() => (rovingHandleId = row.id)}
											onblur={() => handleHandleBlur(node)}
										>
											<span
												data-testid="arrange-grip-{row.id}"
												aria-hidden="true"
												style="touch-action: none"
												class="flex min-h-11 w-4 shrink-0 flex-col justify-center gap-0.5 rounded-sm py-1 text-ink-2 {structuralWritePending
													? 'cursor-default'
													: 'cursor-grab hover:bg-ink-5 hover:text-ink active:bg-ink-5 active:text-ink'}"
												onpointerdown={(event: PointerEvent) => handlePointerDown(row.id, event)}
											>
												<span class="h-px w-full bg-current"></span>
												<span class="h-px w-full bg-current"></span>
												<span class="h-px w-full bg-current"></span>
											</span>
										</div>
									{/if}
									<button
										type="button"
										data-testid="arrange-rename-{row.id}"
										title={m.roster_section_rename({ name: row.name })}
										disabled={reorderPending || removePending || renamingSectionId === row.id || isOffline}
										class="group flex min-h-11 min-w-0 flex-1 appearance-none items-center gap-1.5 border-0 bg-transparent p-0 text-left text-ink-2 hover:text-ink disabled:cursor-default"
										onclick={() => startRename(node)}
									>
										<span class="sr-only">{m.roster_section_rename_action()}</span>
										<svg
											aria-hidden="true"
											viewBox="0 0 16 16"
											class="h-3 w-3 shrink-0 fill-current group-hover:text-ink group-disabled:opacity-30"
										>
											<path
												d="M11.3 1.3a1 1 0 0 1 1.4 0l2 2a1 1 0 0 1 0 1.4l-8 8-3.7 1 1-3.7 8-8z"
											/>
										</svg>
										{#if renamingSectionId !== row.id}
											<span class="truncate text-sm">{row.name}</span>
										{/if}
									</button>
									<span data-testid="arrange-count-{row.id}" class="shrink-0 pl-2 text-sm text-ink"
										>({row.memberCount})</span
									>
									<button
										type="button"
										data-testid="arrange-indent-{row.id}"
										aria-label={m.roster_section_indent({ name: row.name })}
										title={m.roster_section_indent({ name: row.name })}
										disabled={structuralWritePending ||
											renamingSectionId === row.id ||
											damaged ||
											!indentApplicable || isOffline}
										tabindex="-1"
										class="flex min-h-11 min-w-11 items-center justify-center rounded text-ink disabled:cursor-default disabled:opacity-60 {indentApplicable
											? ''
											: 'invisible'}"
										onclick={() => void handleIndent(node)}
									>
										<svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-current">
											<path d="M4 2 L12 8 L4 14 Z" />
										</svg>
									</button>
									<button
										type="button"
										data-testid="arrange-unindent-{row.id}"
										aria-label={m.roster_section_unindent({ name: row.name })}
										title={m.roster_section_unindent({ name: row.name })}
										disabled={structuralWritePending ||
											renamingSectionId === row.id ||
											damaged ||
											!unindentApplicable || isOffline}
										tabindex="-1"
										class="flex min-h-11 min-w-11 items-center justify-center rounded text-ink disabled:cursor-default disabled:opacity-60 {unindentApplicable
											? ''
											: 'invisible'}"
										onclick={() => void handleUnindent(node)}
									>
										<svg
											aria-hidden="true"
											viewBox="0 0 16 16"
											class="h-4 w-4 fill-none stroke-current"
											stroke-width="1.5"
											stroke-linejoin="round"
										>
											<path d="M12 2 L4 8 L12 14 Z" />
										</svg>
									</button>
									{#if pendingRemoveId === row.id}
										<button
											type="button"
											data-testid="section-remove-confirm-{row.id}"
											aria-label={m.roster_section_remove_confirm({ name: row.name })}
											disabled={structuralWritePending || isOffline}
											aria-busy={removePending}
											class="rounded px-1 text-xs text-red-700 underline disabled:opacity-50"
											onclick={() => void handleRemoveSection(row.id)}
										>
											{m.roster_section_remove_confirm_short()}
										</button>
										<button
											type="button"
											data-testid="section-remove-cancel-{row.id}"
											aria-label={m.roster_section_remove_cancel({ name: row.name })}
											disabled={structuralWritePending}
											class="rounded px-1 text-xs text-ink-2 underline hover:text-ink disabled:opacity-50"
											onclick={() => void disarmRemove(row.id)}
										>
											{m.roster_section_remove_cancel_short()}
										</button>
									{:else}
										<DeleteTrigger
											data-testid="section-remove-{row.id}"
											aria-label={m.roster_section_remove({ name: row.name })}
											title={m.roster_section_remove({ name: row.name })}
											disabled={structuralWritePending ||
												renamingSectionId === row.id ||
												!canDelete || isOffline}
											onclick={() => void armRemove(row.id)}
										/>
									{/if}
								</div>
								{#if renameError?.id === row.id}
									<p
										data-testid="arrange-rename-error-{row.id}"
										role="alert"
										class="text-xs text-red-700 {arrangeIndentClass(row.depth)}"
									>
										{m.roster_section_rename_failed({ name: renameError.name })}
									</p>
								{/if}
							{/if}
						{/each}
						{#if arrangeDropHintBeforeId === ARRANGE_DROP_HINT_END}
							{@render dropIndicator()}
						{/if}
					</div>
					{#if admin === 'admin'}
						<div class="flex flex-col gap-1.5 border-t border-dashed border-ink-5 pt-3">
							{#if !pageCreateOpen}
								<button
									type="button"
									data-testid="roster-new-section"
									class="self-start rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper disabled:opacity-50"
									disabled={isOffline}
									onclick={openPageCreateForm}
								>
									{m.roster_new_section()}
								</button>
							{:else}
								<div
									data-testid="roster-new-section-form"
									role="dialog"
									aria-label={m.roster_new_section_form_label()}
									class="flex flex-col gap-1.5"
								>
									<input
										type="text"
										data-testid="roster-new-section-name"
										bind:this={pageCreateNameInput}
										aria-label={m.roster_section_name_label()}
										placeholder={m.roster_section_name_label()}
										aria-invalid={pageCreateError ? true : undefined}
										aria-describedby={pageCreateError ? 'roster-new-section-error' : undefined}
										value={pageCreateName}
										oninput={(e) => (pageCreateName = (e.currentTarget as HTMLInputElement).value)}
										onkeydown={onPageCreateNameKeydown}
										class="border border-ink-5 bg-paper px-1.5 py-1 text-ink"
									/>
									<select
										data-testid="roster-new-section-parent"
										aria-label={m.roster_section_parent_label()}
										value={pageCreateParentId}
										onchange={(e) => (pageCreateParentId = (e.currentTarget as HTMLSelectElement).value)}
										class="border border-ink-5 bg-paper px-1.5 py-1 text-ink"
									>
										<option value="">{m.roster_new_section_top_level()}</option>
										{#each ownOrgFlatSections as node (node.id)}
											<option value={node.id}>{pageCreateParentLabel(node)}</option>
										{/each}
									</select>
									{#if pageCreateError}
										<p
											id="roster-new-section-error"
											role="alert"
											data-testid="roster-new-section-error"
											class="text-xs text-red-700"
										>
											{pageCreateError()}
										</p>
									{/if}
									<div class="flex gap-2">
										<button
											type="button"
											data-testid="roster-new-section-submit"
											class="border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
											disabled={isOffline}
											onclick={() => void submitPageCreate()}
										>
											{m.roster_create_assign()}
										</button>
										<button
											type="button"
											data-testid="roster-new-section-cancel"
											class="px-2 py-1 text-xs text-ink-2 hover:text-ink"
											onclick={closePageCreateForm}
										>
											{m.roster_cancel()}
										</button>
									</div>
								</div>
							{/if}
						</div>
					{/if}
				{:else}
					<div data-testid="roster-groups" class="flex flex-col">
						{#each visibleSections as node (node.id)}
							{@render sectionGroup(node)}
						{/each}
						{#if unassignedGroup}
							{@const isExpanded = expandedIds.has('unassigned')}
							<section data-testid="section-group-unassigned" data-depth="0" class="flex flex-col">
								<button
									type="button"
									data-testid="section-toggle-unassigned"
									aria-expanded={isExpanded}
									aria-controls={isExpanded ? 'section-region-unassigned' : undefined}
									class="flex items-center gap-2 py-1.5 text-left"
									onclick={() => toggleSection('unassigned')}
								>
									<span aria-hidden="true" class="text-ink-2">{isExpanded ? '▾' : '▸'}</span>
									<span data-testid="section-header-unassigned" class="text-sm font-medium text-ink">
										{m.roster_unassigned()} ({unassignedGroup.memberCount})
									</span>
								</button>
								{#if isExpanded}
									<ul id="section-region-unassigned" class="flex flex-col pl-5">
										{#each unassignedGroup.members as row (row.memberId)}
											{@render memberRow(row, false, null)}
										{/each}
									</ul>
								{/if}
							</section>
						{/if}
					</div>
				{/if}
			{:else}
				<ul data-testid="roster-flat-list" class="flex flex-col">
					{#each flatRows as row (row.memberId)}
						{@render memberRow(row, true, null)}
					{/each}
				</ul>
			{/if}
		{/if}

		{#if admin === 'admin' && status === 'ready'}
			<div class="flex flex-col gap-2 border-t border-dashed border-ink-5 pt-3">
				<button
					type="button"
					data-testid="roster-inactive-toggle"
					aria-expanded={showInactive}
					class="self-start text-xs tracking-wide text-ink-2 uppercase underline hover:text-ink"
					onclick={() => toggleInactive()}
				>
					{showInactive ? m.roster_inactive_hide() : m.roster_inactive_show()}
				</button>
				{#if showInactive}
					{#if inactiveLoadError}
						<p data-testid="roster-inactive-load-error" role="alert" class="text-sm text-red-700">
							{m.roster_inactive_load_error()}
						</p>
					{:else if inactiveRows.length === 0}
						<p data-testid="roster-inactive-empty" class="text-xs text-ink-2">{m.roster_inactive_empty()}</p>
					{:else}
						<ul data-testid="roster-inactive-list" class="flex flex-col">
							{#each inactiveRows as row (row.memberId)}
								{@const inactiveSectionNames = (row.sectionIds ?? [])
									.map((id) => sectionNameById.get(id))
									.filter((name): name is string => Boolean(name))}
								<li
									data-testid="inactive-member-row-{row.memberId}"
									class="flex flex-col gap-0.5 border-b border-dashed border-ink-5 py-2 last:border-b-0"
								>
									<span class="text-sm text-ink"><RedactedText>{row.name}</RedactedText></span>
									{#if inactiveSectionNames.length > 0}
										<span data-testid="inactive-member-section-{row.memberId}" class="text-xs text-ink-2">
											{inactiveSectionNames.join(', ')}
										</span>
									{/if}
									<button
										type="button"
										data-testid="member-reinstate-{row.memberId}"
										class="self-start rounded-md border border-ink px-3 py-1 text-xs hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50"
										disabled={reinstatePending !== null || isOffline}
										onclick={() => handleReinstate(row.memberId)}
									>
										{m.roster_member_reinstate()}
									</button>
									{#if deactivateActionError?.memberId === row.memberId && deactivateActionError.kind === 'reinstate'}
										<p
											data-testid="member-reinstate-failed-{row.memberId}"
											role="alert"
											class="text-xs text-red-700"
										>
											{m.roster_member_reinstate_failed()}
											<EntuRef id={row.memberId} />
										</p>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
</main>
