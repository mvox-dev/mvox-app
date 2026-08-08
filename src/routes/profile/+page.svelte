<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getToken, getUser } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import {
		listMyProfiles,
		profilesByLevel,
		resolveField,
		type Level,
		type MyProfile
	} from '$lib/profile/profileData';
	import { completionGateStore, resolveGate } from '$lib/profile/completionGate';
	import { planLoadedDuplicateRepairs, FieldMoveError, type FieldKey } from '$lib/profile/fieldMove';
	import { createFieldMoveQueue } from '$lib/profile/fieldMoveQueue';
	import { createProfileEditQueue } from '$lib/profile/profileEditQueue';
	import { createAutosave } from '$lib/profile/autosave';
	import ProfileField from '$lib/components/profile/ProfileField.svelte';
	import VisibilityRepairBanner from '$lib/components/profile/VisibilityRepairBanner.svelte';

	const FIELDS: readonly FieldKey[] = ['name', 'email'];
	const otherField = (f: FieldKey): FieldKey => (f === 'name' ? 'email' : 'name');

	const LEVELS: readonly Level[] = ['public', 'domain', 'private'];

	const selected = $derived($selectedCollectiveStore);

	type Status = 'loading' | 'no-collective' | 'load-error' | 'ready';

	let generation = 0;
	let status = $state<Status>('loading');

	// Unified draft: one value per field (not per level).
	let draft = $state<{ name: string; email: string }>({ name: '', email: '' });
	// Confirmed state stays per-entity (the backend model is per-entity).
	function emptyConfirmed(): Record<Level, { id: string | null; name: string; email: string }> {
		return {
			public: { id: null, name: '', email: '' },
			domain: { id: null, name: '', email: '' },
			private: { id: null, name: '', email: '' }
		};
	}
	let confirmed = $state(emptyConfirmed());

	// Per-field save-in-flight markers (replaces per-level pendingLevels for autosave feedback).
	let savingFields = $state(new Set<FieldKey>());
	let failedFields = $state(new Set<FieldKey>());

	// Per-level pending/failed still needed for the queue internals.
	let pendingLevels = $state(new Set<Level>());

	let loadedProfiles = $state<MyProfile[]>([]);
	let transport = $state<Record<FieldKey, Level | null>>({ name: null, email: null });
	let moveFailed = $state(new Set<FieldKey>());
	let repairWorking = $state(new Set<FieldKey>());
	let repairFailed = $state(new Set<FieldKey>());
	let busy = $state(false);
	let pendingMoveTo: Record<FieldKey, Level | null> = { name: null, email: null };

	const domainNameMissing = $derived($completionGateStore === 'incomplete');

	const nameRes = $derived(resolveField(loadedProfiles, 'name'));
	const emailRes = $derived(resolveField(loadedProfiles, 'email'));
	const resFor = (f: FieldKey) => (f === 'name' ? nameRes : emailRes);
	const repairPlans = $derived(planLoadedDuplicateRepairs(loadedProfiles));
	const planFor = (f: FieldKey) => repairPlans.find((p) => p.field === f);

	const movableFor = (f: FieldKey) => resFor(f).holders.length === 1;
	const isConflict = (f: FieldKey) => resFor(f).holders.length > 1 && planFor(f) === undefined;
	const conflictLevelsFor = (f: FieldKey): Level[] =>
		isConflict(f) ? resFor(f).holders.slice(1).map((h) => h.level) : [];

	/** The level currently holding this field (narrowest non-empty, or 'domain' default). */
	const activeLevelFor = (f: FieldKey): Level =>
		resFor(f).holders[0]?.level ?? 'domain';

	const writesInFlight = $derived(busy || pendingLevels.size > 0);

	function isDirty(field: FieldKey): boolean {
		const level = activeLevelFor(field);
		return draft[field] !== confirmed[level][field];
	}

	function withFieldSet(s: Set<FieldKey>, field: FieldKey, add: boolean): Set<FieldKey> {
		const next = new Set(s);
		if (add) next.add(field);
		else next.delete(field);
		return next;
	}

	function resetState() {
		draft = { name: '', email: '' };
		confirmed = emptyConfirmed();
		savingFields = new Set();
		failedFields = new Set();
		pendingLevels = new Set();
		loadedProfiles = [];
		transport = { name: null, email: null };
		moveFailed = new Set();
		repairWorking = new Set();
		repairFailed = new Set();
		busy = false;
		pendingMoveTo = { name: null, email: null };
		autosaveCtrl.destroy();
	}

	async function loadForSelected(): Promise<void> {
		const current = selected;
		const g = ++generation;
		resetState();
		queue.reset();
		moveQueue.reset();
		if (!current) {
			status = 'no-collective';
			return;
		}
		const token = getToken();
		if (!token) {
			console.error('profile: no auth token in storage on a protected route');
			status = 'load-error';
			return;
		}
		status = 'loading';
		const cfg = { db: current.db, token };
		const personId = current.personId;
		try {
			const profiles = await listMyProfiles(cfg, personId);
			if (g !== generation) return;
			loadedProfiles = profiles;
			const byLevel = profilesByLevel(profiles);
			const nextConfirmed = emptyConfirmed();
			for (const level of LEVELS) {
				const p = byLevel[level];
				if (p) {
					nextConfirmed[level] = { id: p._id, name: p.name, email: p.email };
				}
			}
			confirmed = nextConfirmed;

			// Populate unified draft from resolved field values.
			const nameResolved = resolveField(profiles, 'name');
			const emailResolved = resolveField(profiles, 'email');
			const nextDraft = {
				name: nameResolved.value,
				email: emailResolved.value
			};

			// #39 prefill: if no domain entity and name is empty, use provider name.
			if (nextDraft.name === '' && nextConfirmed.domain.id === null) {
				const providerName = getUser()?.name?.trim();
				if (providerName) {
					nextDraft.name = providerName;
				}
			}

			draft = nextDraft;
			status = 'ready';
		} catch (e) {
			if (g !== generation) return;
			console.error('profile: load failed', e);
			status = 'load-error';
		}
	}

	function refreshCompletionGate(): void {
		const current = selected;
		const token = getToken();
		if (current && token) {
			resolveGate({ db: current.db, token }, current.personId).then((state) =>
				completionGateStore.set(state)
			);
		}
	}

	const queue = createProfileEditQueue(
		{
			setPending(level, isPending) {
				const next = new Set(pendingLevels);
				if (isPending) next.add(level);
				else next.delete(level);
				pendingLevels = next;
			},
			reconcile(level, profileId, fields) {
				confirmed = { ...confirmed, [level]: { id: profileId, name: fields.name, email: fields.email } };
				// Clear per-field saving/failed on successful reconcile for any field
				// whose active level matches this level.
				for (const f of FIELDS) {
					if (activeLevelFor(f) === level) {
						savingFields = withFieldSet(savingFields, f, false);
						failedFields = withFieldSet(failedFields, f, false);
					}
				}
				if (level === 'domain') {
					refreshCompletionGate();
				}
			},
			recordCreatedId(level, profileId) {
				confirmed = { ...confirmed, [level]: { ...confirmed[level], id: profileId } };
			},
			markFailed(level) {
				for (const f of FIELDS) {
					if (activeLevelFor(f) === level) {
						savingFields = withFieldSet(savingFields, f, false);
						failedFields = withFieldSet(failedFields, f, true);
					}
				}
			}
		},
		() => generation
	);

	const moveQueue = createFieldMoveQueue(
		{
			setTransport(field, level, on) {
				transport = { ...transport, [field]: on ? level : null };
			},
			onCreateConfirmed() {},
			onMoveConfirmed(field) {
				busy = false;
				moveFailed = withFieldSet(moveFailed, field, false);
				void loadForSelected();
				if (field === 'name') refreshCompletionGate();
			},
			onMoveFailed(field, err) {
				busy = false;
				if (err instanceof FieldMoveError && err.phase === 'delete') {
					void loadForSelected();
				} else {
					if (err instanceof FieldMoveError && err.createdTargetId) {
						const id = err.createdTargetId;
						const toLevel = pendingMoveTo[field];
						if (toLevel && !loadedProfiles.some((p) => p._id === id)) {
							loadedProfiles = [...loadedProfiles, { _id: id, name: '', email: '', _sharing: toLevel }];
						}
					}
					moveFailed = withFieldSet(moveFailed, field, true);
				}
			},
			onRepairConfirmed(field) {
				busy = false;
				repairWorking = withFieldSet(repairWorking, field, false);
				repairFailed = withFieldSet(repairFailed, field, false);
				void loadForSelected();
			},
			onRepairFailed(field) {
				busy = false;
				repairWorking = withFieldSet(repairWorking, field, false);
				repairFailed = withFieldSet(repairFailed, field, true);
			}
		},
		() => generation
	);

	function activeContext(): { cfg: { db: string; token: string }; personId: string } | null {
		const current = selected;
		if (!current) {
			status = 'no-collective';
			return null;
		}
		const token = getToken();
		if (!token) {
			console.error('profile: no auth token in storage on a protected route');
			status = 'load-error';
			return null;
		}
		return { cfg: { db: current.db, token }, personId: current.personId };
	}

	// The autosave onSave callback — dispatches through the existing queue.
	function onAutosave(field: FieldKey): void {
		if (!isDirty(field)) return;
		const activeLevel = activeLevelFor(field);

		// Name-private guard (loud failure, never silent return).
		if (field === 'name' && activeLevel === 'private') {
			throw new Error('name-private guard: name cannot be saved at private level');
		}

		const ctx = activeContext();
		if (!ctx) return;
		// Pin sibling value to the target entity's confirmed value — NEVER the unified draft.
		const fields = {
			name: field === 'name' ? draft.name : confirmed[activeLevel].name,
			email: field === 'email' ? draft.email : confirmed[activeLevel].email
		};

		savingFields = withFieldSet(savingFields, field, true);
		failedFields = withFieldSet(failedFields, field, false);
		queue.request({
			cfg: ctx.cfg,
			personId: ctx.personId,
			level: activeLevel,
			existingId: confirmed[activeLevel].id,
			fields
		});
	}

	const autosaveCtrl = createAutosave({ idleMs: 2_000, onSave: onAutosave });

	function onmove(field: FieldKey, toLevel: Level) {
		if (writesInFlight) return;

		// Name-private guard (loud failure on the move path).
		if (field === 'name' && toLevel === 'private') {
			throw new Error('name-private guard: name cannot be moved to private level');
		}

		const res = resFor(field);
		if (res.holders.length !== 1) return;
		const from = res.holders[0];
		if (from.level === toLevel) return;
		const ctx = activeContext();
		if (!ctx) return;
		const src = loadedProfiles.find((p) => p._id === from.id);
		if (!src) return;
		const dst = loadedProfiles.find((p) => p._sharing === toLevel) ?? null;
		const other = otherField(field);
		pendingMoveTo = { ...pendingMoveTo, [field]: toLevel };
		moveFailed = withFieldSet(moveFailed, field, false);
		busy = true;
		moveQueue.move({
			cfg: ctx.cfg,
			personId: ctx.personId,
			field,
			fromLevel: from.level,
			toLevel,
			value: res.value,
			srcId: from.id,
			dstId: dst ? dst._id : null,
			srcSibling: src[other],
			dstSibling: dst ? dst[other] : ''
		});
	}

	function onrepair(field: FieldKey) {
		if (writesInFlight) return;
		const plan = planFor(field);
		if (!plan) return;
		const ctx = activeContext();
		if (!ctx) return;
		repairFailed = withFieldSet(repairFailed, field, false);
		repairWorking = withFieldSet(repairWorking, field, true);
		busy = true;
		moveQueue.repair({ cfg: ctx.cfg, field, clear: plan.clear });
	}

	function handleValueChange(field: FieldKey, value: string) {
		draft = { ...draft, [field]: value };
		autosaveCtrl.keystroke(field);
	}

	function handleBlur(field: FieldKey) {
		autosaveCtrl.blur(field);
	}

	function handleVisibilityChange(field: FieldKey, toLevel: Level) {
		// Fire autosave if dirty BEFORE the move (cross-queue lock will block the move
		// until the save settles).
		autosaveCtrl.visibilityChange(field);
		onmove(field, toLevel);
	}

	$effect(() => {
		void selected;
		loadForSelected().catch((e) => {
			console.error('profile: load failed', e);
			status = 'load-error';
		});
	});
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.profile_title()}</h1>

		{#if status === 'no-collective'}
			<p data-testid="profile-no-collective" class="text-sm">{m.profile_no_collective()}</p>
		{:else if status === 'loading'}
			<p class="text-sm" aria-busy="true">...</p>
		{:else if status === 'load-error'}
			<div data-testid="profile-load-error" class="flex flex-col gap-2" role="alert">
				<p class="text-sm text-red-700">{m.profile_load_error()}</p>
				<button
					type="button"
					data-testid="profile-retry-load"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={() => loadForSelected()}
				>
					{m.profile_load_retry()}
				</button>
			</div>
		{:else}
			<p class="text-sm text-ink-2">{m.profile_intro()}</p>
			{#if domainNameMissing}
				<p
					data-testid="profile-completion-required"
					class="rounded-md bg-amber-100 px-4 py-3 text-sm text-amber-900"
					role="status"
				>
					{m.profile_completion_required()}
				</p>
			{/if}

			{#each repairPlans as plan (plan.field)}
				<VisibilityRepairBanner
					field={plan.field}
					widerLevels={plan.widerLevels}
					severity="loaded"
					working={repairWorking.has(plan.field)}
					failed={repairFailed.has(plan.field)}
					{onrepair}
				/>
			{/each}

			<div class="flex flex-col gap-6">
				{#each FIELDS as field (field)}
					<ProfileField
						{field}
						bind:value={draft[field]}
						activeLevel={activeLevelFor(field)}
						transportLevel={transport[field]}
						leakLevels={planFor(field)?.widerLevels ?? []}
						saving={savingFields.has(field)}
						movable={movableFor(field)}
						conflict={isConflict(field)}
						conflictLevels={conflictLevelsFor(field)}
						disabled={writesInFlight}
						moveFailed={moveFailed.has(field)}
						saveFailed={failedFields.has(field)}
						onvisibilitychange={handleVisibilityChange}
						onvaluechange={handleValueChange}
						onblur={handleBlur}
					/>
				{/each}
			</div>
		{/if}
	</div>
</main>
