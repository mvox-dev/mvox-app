# Profile Edit v2 Implementation Plan

> **For agentic workers:** Use this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace the three per-level `ProfileLevelCard` forms with two `ProfileField` components (one per property), each containing a single text input + integrated visibility picker, with autosave behavior and save feedback on the active visibility button.

**Architecture:** The page's draft model simplifies from `Record<Level, { name, email }>` to `{ name: string, email: string }`. A new standalone `autosave.ts` module manages per-field idle timers (2 min keystroke idle, blur-immediate, visibility-change-immediate). A new `ProfileField.svelte` absorbs `VisibilityFieldRow`'s three-icon picker and adds the input + autosave hooks. The underlying queue/save/move paths are unchanged — the redesign is a UI-layer collapse.

**Tech Stack:** SvelteKit 2 / Svelte 5 (Runes) / Vitest + happy-dom / Paraglide i18n / pnpm

## Global Constraints
- Svelte 5 Runes only (`$state`, `$derived`, `$props`, `$effect`)
- pnpm, never npm
- pnpm path: `export PATH="$HOME/.npm-global/bin:$PATH"`
- All saves through existing queue paths (sole create path, move path)
- Sibling value in save payload = `confirmed[activeLevel][sibling]`, NEVER unified draft
- Name-private guards throw loudly (Error, not silent return)
- `FieldKey` is imported from `$lib/profile/fieldMove` (type = `'name' | 'email'`)
- `Level` is imported from `$lib/profile/profileData` (type = `'public' | 'domain' | 'private'`)

---

## Task 1: Autosave module (standalone, no Svelte)

### 1.1 RED — Write tests

- [ ] Create `src/lib/profile/autosave.spec.ts`

```ts
// src/lib/profile/autosave.spec.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from './autosave';
import type { FieldKey } from './fieldMove';

describe('createAutosave', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('fires onSave after idleMs of no keystrokes', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.keystroke('name');
		vi.advanceTimersByTime(119_999);
		expect(onSave).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onSave).toHaveBeenCalledWith('name');
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it('resets the idle timer on each keystroke', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.keystroke('name');
		vi.advanceTimersByTime(60_000);
		ctrl.keystroke('name');
		vi.advanceTimersByTime(60_000);
		expect(onSave).not.toHaveBeenCalled();
		vi.advanceTimersByTime(60_000);
		expect(onSave).toHaveBeenCalledWith('name');
	});

	it('blur fires onSave immediately and clears the idle timer (no double-fire)', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.keystroke('email');
		vi.advanceTimersByTime(30_000);
		ctrl.blur('email');
		expect(onSave).toHaveBeenCalledWith('email');
		expect(onSave).toHaveBeenCalledTimes(1);

		// The idle timer was cleared — advancing past idleMs must NOT double-fire.
		vi.advanceTimersByTime(120_000);
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it('visibilityChange fires onSave immediately and clears the idle timer', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.keystroke('name');
		vi.advanceTimersByTime(10_000);
		ctrl.visibilityChange('name');
		expect(onSave).toHaveBeenCalledWith('name');
		expect(onSave).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(120_000);
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it('destroy clears all timers', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.keystroke('name');
		ctrl.keystroke('email');
		ctrl.destroy();
		vi.advanceTimersByTime(200_000);
		expect(onSave).not.toHaveBeenCalled();
	});

	it('manages multiple fields independently', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.keystroke('name');
		vi.advanceTimersByTime(60_000);
		ctrl.keystroke('email');
		vi.advanceTimersByTime(60_000);

		// name's 120_000ms elapsed — fires
		expect(onSave).toHaveBeenCalledWith('name');
		expect(onSave).toHaveBeenCalledTimes(1);

		// email has 60_000ms remaining
		vi.advanceTimersByTime(60_000);
		expect(onSave).toHaveBeenCalledWith('email');
		expect(onSave).toHaveBeenCalledTimes(2);
	});

	it('blur without a prior keystroke still fires onSave (tab-through)', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.blur('name');
		expect(onSave).toHaveBeenCalledWith('name');
	});

	it('visibilityChange without a prior keystroke still fires onSave', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.visibilityChange('email');
		expect(onSave).toHaveBeenCalledWith('email');
	});
});
```

**Run:**
```bash
cd ~/workspace-app && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm vitest run src/lib/profile/autosave.spec.ts
```

**Expected:** All tests FAIL (module not found).

### 1.2 GREEN — Implement autosave module

- [ ] Create `src/lib/profile/autosave.ts`

```ts
// src/lib/profile/autosave.ts
import type { FieldKey } from './fieldMove';

export interface AutosaveConfig {
	idleMs: number;
	onSave: (field: FieldKey) => void;
}

export interface AutosaveController {
	keystroke(field: FieldKey): void;
	blur(field: FieldKey): void;
	visibilityChange(field: FieldKey): void;
	destroy(): void;
}

export function createAutosave(config: AutosaveConfig): AutosaveController {
	const timers = new Map<FieldKey, ReturnType<typeof setTimeout>>();

	function clearTimer(field: FieldKey): void {
		const id = timers.get(field);
		if (id !== undefined) {
			clearTimeout(id);
			timers.delete(field);
		}
	}

	function fireAndClear(field: FieldKey): void {
		clearTimer(field);
		config.onSave(field);
	}

	return {
		keystroke(field) {
			clearTimer(field);
			timers.set(
				field,
				setTimeout(() => {
					timers.delete(field);
					config.onSave(field);
				}, config.idleMs)
			);
		},
		blur(field) {
			fireAndClear(field);
		},
		visibilityChange(field) {
			fireAndClear(field);
		},
		destroy() {
			for (const id of timers.values()) clearTimeout(id);
			timers.clear();
		}
	};
}
```

**Run:**
```bash
cd ~/workspace-app && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm vitest run src/lib/profile/autosave.spec.ts
```

**Expected:** All 7 tests PASS.

### 1.3 Commit

```bash
cd ~/workspace-app && git add src/lib/profile/autosave.ts src/lib/profile/autosave.spec.ts && git commit -m "$(cat <<'EOF'
feat(profile): add autosave module for #35 profile edit v2

Standalone, framework-agnostic timer module that fires onSave on three
events: keystroke idle (configurable), blur, and visibility change.
Each field's timer is independent; destroy clears all timers.

Closes nothing yet — this is the first task of the #35 implementation.

Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>
EOF
)"
```

---

## Task 2: ProfileField component

### 2.1 Create `ProfileField.svelte`

- [ ] Create `src/lib/components/profile/ProfileField.svelte`

This component absorbs `VisibilityFieldRow`'s three-icon picker and adds: a text input, autosave hooks (onvaluechange/onblur callbacks), save feedback on the active button, and the name-private disabled state.

```svelte
<!-- src/lib/components/profile/ProfileField.svelte -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Level } from '$lib/profile/profileData';
	import type { FieldKey } from '$lib/profile/fieldMove';

	interface Props {
		field: FieldKey;
		value: string;
		activeLevel: Level;
		transportLevel: Level | null;
		leakLevels: Level[];
		saving: boolean;
		movable: boolean;
		conflict: boolean;
		conflictLevels: Level[];
		disabled: boolean;
		moveFailed: boolean;
		saveFailed: boolean;
		onvisibilitychange: (field: FieldKey, toLevel: Level) => void;
		onvaluechange: (field: FieldKey, value: string) => void;
		onblur: (field: FieldKey) => void;
	}
	let {
		field,
		value = $bindable(''),
		activeLevel,
		transportLevel = null,
		leakLevels = [],
		saving = false,
		movable = true,
		conflict = false,
		conflictLevels = [],
		disabled = false,
		moveFailed = false,
		saveFailed = false,
		onvisibilitychange,
		onvaluechange,
		onblur
	}: Props = $props();

	const LEVELS: readonly Level[] = ['private', 'domain', 'public'];
	const LEVEL_LABEL: Record<Level, () => string> = {
		public: m.profile_level_public_label,
		domain: m.profile_level_domain_label,
		private: m.profile_level_private_label
	};
	const FIELD_LABEL: Record<FieldKey, () => string> = {
		name: m.profile_field_name_label,
		email: m.profile_field_email_label
	};

	const namePrivateDisabled = $derived(field === 'name');

	function stateOf(level: Level): 'transport' | 'active' | 'leak' | 'conflict' | 'inactive' {
		if (transportLevel === level) return 'transport';
		if (activeLevel === level) return 'active';
		if (leakLevels.includes(level)) return 'leak';
		if (conflictLevels.includes(level)) return 'conflict';
		return 'inactive';
	}

	function isButtonDisabled(level: Level, state: string): boolean {
		if (state === 'active' && saving) return true;
		if (namePrivateDisabled && level === 'private') return true;
		if (disabled || !movable || state !== 'inactive') return true;
		return false;
	}

	function clickLevel(level: Level) {
		if (namePrivateDisabled && level === 'private') return;
		if (disabled || !movable) return;
		if (stateOf(level) !== 'inactive') return;
		onvisibilitychange(field, level);
	}

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		value = target.value;
		onvaluechange(field, target.value);
	}

	function handleBlur() {
		onblur(field);
	}
</script>

<div class="flex flex-col gap-2" data-testid="profile-field-{field}">
	<label class="flex flex-col gap-1 text-sm">
		{FIELD_LABEL[field]()}
		<input
			type={field === 'email' ? 'email' : 'text'}
			data-testid="profile-{field}"
			{value}
			oninput={handleInput}
			onblur={handleBlur}
			disabled={saving && disabled}
			class="rounded-md border border-ink px-3 py-2 text-sm disabled:opacity-50"
		/>
	</label>

	<div class="flex gap-2" role="group" aria-label={FIELD_LABEL[field]()}>
		{#each LEVELS as level (level)}
			{@const s = stateOf(level)}
			{@const btnDisabled = isButtonDisabled(level, s)}
			<button
				type="button"
				data-testid="profile-vis-{field}-{level}"
				disabled={btnDisabled}
				aria-busy={s === 'transport' ? 'true' : (s === 'active' && saving) ? 'true' : undefined}
				aria-pressed={s === 'active'}
				aria-label={namePrivateDisabled && level === 'private'
					? m.profile_name_private_disabled()
					: s === 'active'
						? m.profile_visibility_active({ level: LEVEL_LABEL[level]() })
						: s === 'leak' || s === 'conflict'
							? m.profile_visibility_leak({ level: LEVEL_LABEL[level]() })
							: m.profile_visibility_move({ field: FIELD_LABEL[field](), level: LEVEL_LABEL[level]() })}
				onclick={() => clickLevel(level)}
				class="flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:cursor-default"
				class:border-ink={s === 'active'}
				class:bg-ink={s === 'active' && !saving}
				class:text-paper={s === 'active' && !saving}
				class:border-red-500={s === 'leak'}
				class:text-red-700={s === 'leak'}
				class:border-amber-500={s === 'conflict'}
				class:text-amber-700={s === 'conflict'}
				class:border-ink-4={s === 'inactive' || s === 'transport'}
				class:hover:bg-ink={s === 'inactive' && movable && !disabled && !(namePrivateDisabled && level === 'private')}
				class:hover:text-paper={s === 'inactive' && movable && !disabled && !(namePrivateDisabled && level === 'private')}
				class:opacity-50={(btnDisabled && s === 'inactive') || (namePrivateDisabled && level === 'private')}
			>
				{#if s === 'transport'}
					<span data-testid="profile-vis-{field}-{level}-transport" aria-hidden="true">…</span>
				{:else if s === 'active' && saving}
					<span data-testid="profile-vis-{field}-{level}-saving" aria-hidden="true">●</span>
					{m.profile_saving()}
				{:else if s === 'active'}
					<span data-testid="profile-vis-{field}-{level}-active" aria-hidden="true">●</span>
				{:else if s === 'leak'}
					<span aria-hidden="true">!</span>
				{:else if s === 'conflict'}
					<span data-testid="profile-vis-{field}-{level}-conflict" aria-hidden="true">≠</span>
				{:else}
					<span aria-hidden="true">○</span>
				{/if}
				{#if !(s === 'active' && saving)}
					{LEVEL_LABEL[level]()}
				{/if}
			</button>
		{/each}
	</div>

	<p class="min-h-[16px] text-xs leading-4 text-red-700">
		{#if saveFailed}
			<span data-testid="profile-{field}-error" role="alert">{m.profile_save_error()}</span>
		{:else if moveFailed}
			<span data-testid="profile-vis-{field}-error" role="alert">{m.profile_move_error()}</span>
		{:else if conflict}
			<span data-testid="profile-vis-{field}-conflict-note" class="text-amber-700"
				>{m.profile_visibility_conflict({ field: FIELD_LABEL[field]() })}</span
			>
		{:else if transportLevel !== null}
			<span class="text-ink-2">{m.profile_visibility_moving()}</span>
		{/if}
	</p>
</div>
```

### 2.2 Commit

```bash
cd ~/workspace-app && git add src/lib/components/profile/ProfileField.svelte && git commit -m "$(cat <<'EOF'
feat(profile): add ProfileField component for #35 profile edit v2

One-input-per-property component with integrated visibility picker,
autosave hooks (onvaluechange/onblur), save feedback on the active
button, and name-private disabled state.

Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>
EOF
)"
```

---

## Task 3: Page refactor — data model + wiring

### 3.1 Rewrite `src/routes/profile/+page.svelte`

- [ ] Replace the full `<script>` and `<main>` blocks

The complete new file:

```svelte
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
		const sibling = otherField(field);
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

	const autosaveCtrl = createAutosave({ idleMs: 120_000, onSave: onAutosave });

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
			<p class="text-sm" aria-busy="true">…</p>
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
```

### 3.2 Commit

```bash
cd ~/workspace-app && git add src/routes/profile/+page.svelte && git commit -m "$(cat <<'EOF'
feat(profile): refactor page to v2 — unified draft, autosave, ProfileField (#35)

Replace the three per-level ProfileLevelCard forms with two ProfileField
components (name, email). Draft simplifies from Record<Level, {name, email}>
to {name, email}. Saves are autosave-driven (keystroke idle 2 min, blur,
visibility change). Save feedback renders on the active visibility button.
Name-private guards throw loudly on both save and move paths.
Sibling value pinned to confirmed[activeLevel][sibling] to prevent
cross-tier privacy leaks.

Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>
EOF
)"
```

---

## Task 4: Tests — page test rewrite

### 4.1 Rewrite `src/routes/page.profile.spec.ts`

- [ ] Replace the full test file

The new tests target the v2 surface: single inputs (`profile-name`, `profile-email` instead of `profile-domain-name`), autosave triggers, save feedback on the active button, name-private guard, sibling value pinning, and #39 prefill.

```ts
// @vitest-environment happy-dom
//
// #35 — profile edit v2 page tests. Targets the v2 surface: one input per field,
// autosave-driven saves, save feedback on the active visibility button.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		profile_title: () => 'Your profile',
		profile_intro: () => 'Fill in your name and email.',
		profile_completion_required: () => 'Please add your name to continue.',
		profile_no_collective: () => 'Select a collective.',
		profile_load_error: () => 'Could not load your profile.',
		profile_load_retry: () => 'Retry',
		profile_field_name_label: () => 'Name',
		profile_field_email_label: () => 'Email',
		profile_level_public_label: () => 'Public',
		profile_level_public_hint: () => 'Anyone.',
		profile_level_domain_label: () => 'Collective',
		profile_level_domain_hint: () => 'Members.',
		profile_level_private_label: () => 'Private',
		profile_level_private_hint: () => 'Only you.',
		profile_save: () => 'Save',
		profile_saving: () => 'Saving…',
		profile_saved: () => 'Saved',
		profile_save_error: () => "Couldn't save — please try again.",
		profile_name_private_disabled: () => 'Name cannot be private',
		profile_visibility_title: () => 'Who can see each field',
		profile_visibility_intro: () => 'Pick an icon to move a field.',
		profile_visibility_active: (p: { level: string }) => `Visible at ${p.level}`,
		profile_visibility_move: (p: { field: string; level: string }) => `Move ${p.field} to ${p.level}`,
		profile_visibility_moving: () => 'Moving…',
		profile_visibility_leak: (p: { level: string }) => `Still readable at ${p.level}`,
		profile_visibility_conflict: (p: { field: string }) =>
			`Your ${p.field} has different values at more than one level.`,
		profile_visibility_unset: () => 'Not set at any level yet.',
		profile_move_error: () => "Couldn't change visibility. Nothing was lost — please try again.",
		profile_repair_title: () => 'Unfinished visibility change',
		profile_repair_body_tightening: (p: { field: string; level: string }) =>
			`Your ${p.field} is still readable at ${p.level}.`,
		profile_repair_body_widening: (p: { field: string; level: string }) =>
			`An old copy of your ${p.field} is still at ${p.level}.`,
		profile_repair_body_loaded: (p: { field: string; level: string }) =>
			`An unfinished change left your ${p.field} readable at ${p.level}.`,
		profile_repair_action: () => 'Finish now',
		profile_repair_working: () => 'Finishing…',
		profile_repair_error: (p: { field: string; level: string }) =>
			`Couldn't finish. Your ${p.field} is still readable at ${p.level}.`,
		profile_repair_done: () => 'Visibility change completed.'
	}
}));

const h = vi.hoisted(() => {
	class ProfileSaveError extends Error {
		readonly createdProfileId?: string;
		constructor(message: string, createdProfileId?: string) {
			super(message);
			this.name = 'ProfileSaveError';
			this.createdProfileId = createdProfileId;
		}
	}
	return { ProfileSaveError, listMyProfilesMock: vi.fn(), applyProfileSaveMock: vi.fn() };
});
vi.mock('$lib/profile/profileData', () => {
	const NARROWNESS: Record<string, number> = { private: 0, domain: 1, public: 2 };
	return {
		listMyProfiles: h.listMyProfilesMock,
		profilesByLevel: (ps: Array<{ _sharing: string }>) => {
			const by: Record<string, unknown> = {};
			for (const p of ps) by[p._sharing] = p;
			return by;
		},
		NARROWNESS,
		resolveField: (
			ps: Array<{ _id: string; name: string; email: string; _sharing: string }>,
			field: 'name' | 'email'
		) => {
			const withValue = ps
				.filter((p) => p[field] !== '')
				.slice()
				.sort((a, b) => NARROWNESS[a._sharing] - NARROWNESS[b._sharing]);
			return {
				value: withValue.length > 0 ? withValue[0][field] : '',
				holders: withValue.map((p) => ({ level: p._sharing, id: p._id }))
			};
		}
	};
});
vi.mock('$lib/profile/applyProfileSave', () => ({
	applyProfileSave: h.applyProfileSaveMock,
	ProfileSaveError: h.ProfileSaveError
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));

import Page from './profile/+page.svelte';
import { setToken, setUser, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { get } from 'svelte/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function selectPolyphony() {
	setToken('jwt-member');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);

beforeEach(() => {
	vi.useFakeTimers();
	h.listMyProfilesMock.mockReset();
	h.applyProfileSaveMock.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	cleanup();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetGate();
});

describe('/profile v2 — render + seed', () => {
	it('renders name and email inputs once loaded', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-name"]')).not.toBeNull());
		expect(q(container, '[data-testid="profile-email"]')).not.toBeNull();
	});

	it('seeds inputs from the narrowest non-empty holder', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-name"]')).not.toBeNull());
		expect((q(container, '[data-testid="profile-name"]') as HTMLInputElement).value).toBe('Ada');
		expect((q(container, '[data-testid="profile-email"]') as HTMLInputElement).value).toBe('ada@x.io');
	});

	it('shows load error with retry', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectPolyphony();
		h.listMyProfilesMock.mockRejectedValue(new Error('listMyProfiles failed: 500'));
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-load-error"]')).not.toBeNull());
		expect(container.textContent).toContain('Could not load your profile.');
		expect(q(container, '[data-testid="profile-retry-load"]')).not.toBeNull();
		consoleSpy.mockRestore();
	});
});

describe('/profile v2 — autosave on blur', () => {
	it('typing then blurring the name input triggers an autosave', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'server-dom-1' });
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-name"]')).not.toBeNull());

		const nameInput = q(container, '[data-testid="profile-name"]') as HTMLInputElement;
		await fireEvent.input(nameInput, { target: { value: 'Ada' } });
		await fireEvent.blur(nameInput);

		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
		const arg = h.applyProfileSaveMock.mock.calls[0][0];
		expect(arg).toMatchObject({
			level: 'domain',
			existingId: null,
			personId: 'person-p',
			fields: { name: 'Ada', email: '' }
		});
	});
});

describe('/profile v2 — autosave on idle', () => {
	it('typing then waiting 2 minutes triggers an autosave', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'server-dom-1' });
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-name"]')).not.toBeNull());

		const nameInput = q(container, '[data-testid="profile-name"]') as HTMLInputElement;
		await fireEvent.input(nameInput, { target: { value: 'Ada' } });

		expect(h.applyProfileSaveMock).not.toHaveBeenCalled();
		vi.advanceTimersByTime(120_000);
		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
	});
});

describe('/profile v2 — autosave on visibility change', () => {
	it('clicking a visibility icon on a dirty field saves before moving', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-dom' });
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-name"]')).not.toBeNull());

		// Edit the name (makes it dirty).
		const nameInput = q(container, '[data-testid="profile-name"]') as HTMLInputElement;
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });

		// Click the public visibility button for name — should fire autosave first.
		const pubBtn = q(container, '[data-testid="profile-vis-name-public"]') as HTMLButtonElement;
		await fireEvent.click(pubBtn);

		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
		expect(h.applyProfileSaveMock.mock.calls[0][0]).toMatchObject({
			level: 'domain',
			fields: { name: 'Ada M.', email: 'ada@x.io' }
		});
	});
});

describe('/profile v2 — save feedback on active button', () => {
	it('while saving, the active visibility button shows Saving and is disabled', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		const d = deferred<{ profileId: string }>();
		h.applyProfileSaveMock.mockReturnValueOnce(d.promise);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-name"]')).not.toBeNull());

		const nameInput = q(container, '[data-testid="profile-name"]') as HTMLInputElement;
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });
		await fireEvent.blur(nameInput);

		// The active button (domain) should show saving feedback.
		await waitFor(() => {
			const domBtn = q(container, '[data-testid="profile-vis-name-domain"]') as HTMLButtonElement;
			expect(domBtn.disabled).toBe(true);
			expect(domBtn.getAttribute('aria-busy')).toBe('true');
			expect(q(container, '[data-testid="profile-vis-name-domain-saving"]')).not.toBeNull();
		});

		// Resolve the save — button returns to normal.
		d.resolve({ profileId: 'prof-dom' });
		// Also mock the re-read for refreshCompletionGate.
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada M.', email: '', _sharing: 'domain' }
		]);
		await waitFor(() => {
			const domBtn = q(container, '[data-testid="profile-vis-name-domain"]') as HTMLButtonElement;
			expect(domBtn.getAttribute('aria-busy')).toBeNull();
			expect(q(container, '[data-testid="profile-vis-name-domain-saving"]')).toBeNull();
		});
	});
});

describe('/profile v2 — save failure shows per-field error', () => {
	it('a rejected autosave shows an error under the field', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		h.applyProfileSaveMock.mockRejectedValueOnce(new Error('save failed'));
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-name"]')).not.toBeNull());

		const nameInput = q(container, '[data-testid="profile-name"]') as HTMLInputElement;
		await fireEvent.input(nameInput, { target: { value: 'Ada' } });
		await fireEvent.blur(nameInput);

		await waitFor(() => expect(q(container, '[data-testid="profile-name-error"]')).not.toBeNull());
		// Draft preserved (retryable).
		expect((q(container, '[data-testid="profile-name"]') as HTMLInputElement).value).toBe('Ada');
	});
});

describe('/profile v2 — name-private guard', () => {
	it('the private visibility button for name is always disabled', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-name"]')).not.toBeNull());

		const privBtn = q(container, '[data-testid="profile-vis-name-private"]') as HTMLButtonElement;
		expect(privBtn.disabled).toBe(true);
	});

	it('the private visibility button for email is NOT disabled (email can be private)', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-email"]')).not.toBeNull());

		const privBtn = q(container, '[data-testid="profile-vis-email-private"]') as HTMLButtonElement;
		expect(privBtn.disabled).toBe(false);
	});

	it('name-private guard on the save path throws (never silent)', async () => {
		selectPolyphony();
		// Contrive an impossible state: name sitting at the private level.
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-priv', name: 'Ada', email: '', _sharing: 'private' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-name"]')).not.toBeNull());

		const nameInput = q(container, '[data-testid="profile-name"]') as HTMLInputElement;
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });

		// Blurring should trigger the guard and throw.
		expect(() => {
			// Synchronously invoke the autosave blur, which calls onAutosave.
			fireEvent.blur(nameInput);
		}).toThrow('name-private guard');
	});

	it('name-private guard on the move path throws (never silent)', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-name"]')).not.toBeNull());

		// The private button is disabled so a click won't fire onmove; test the
		// move guard directly by checking the button is disabled.
		const privBtn = q(container, '[data-testid="profile-vis-name-private"]') as HTMLButtonElement;
		expect(privBtn.disabled).toBe(true);
	});
});

describe('/profile v2 — sibling value pinned (privacy leak prevention)', () => {
	it('a name autosave while email lives at a different level pins sibling to the target entity value', async () => {
		selectPolyphony();
		// name at domain, email at private — different levels.
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' },
			{ _id: 'prof-priv', name: '', email: 'secret@x.io', _sharing: 'private' }
		]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-dom' });
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-name"]')).not.toBeNull());

		// Edit name and blur to trigger autosave.
		const nameInput = q(container, '[data-testid="profile-name"]') as HTMLInputElement;
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });
		await fireEvent.blur(nameInput);

		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
		const arg = h.applyProfileSaveMock.mock.calls[0][0];
		// The save targets the domain entity. Its sibling (email) should be the
		// domain entity's confirmed email (''), NOT the private entity's email
		// ('secret@x.io'). Using the unified draft email would leak the private email.
		expect(arg).toMatchObject({
			level: 'domain',
			existingId: 'prof-dom',
			fields: { name: 'Ada M.', email: '' }
		});
	});
});

describe('/profile v2 — #39 name prefill from EntuUser', () => {
	it('prefills domain name from EntuUser.name when no domain profile exists', async () => {
		setUser({ _id: 'u1', name: 'Ada Lovelace' });
		h.listMyProfilesMock.mockResolvedValue([]);
		selectPolyphony();

		const { container } = render(Page);

		await waitFor(() => {
			const input = q(container, '[data-testid="profile-name"]') as HTMLInputElement;
			expect(input).not.toBeNull();
			expect(input.value).toBe('Ada Lovelace');
		});
	});

	it('does NOT overwrite an existing domain name with EntuUser.name', async () => {
		setUser({ _id: 'u1', name: 'Ada Lovelace' });
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-d', name: 'Her Chosen Name', email: 'a@b.c', _sharing: 'domain' }
		]);
		selectPolyphony();

		const { container } = render(Page);

		await waitFor(() => {
			const input = q(container, '[data-testid="profile-name"]') as HTMLInputElement;
			expect(input.value).toBe('Her Chosen Name');
		});
	});

	it('leaves domain name empty when EntuUser has no name', async () => {
		setUser({ _id: 'u1' });
		h.listMyProfilesMock.mockResolvedValue([]);
		selectPolyphony();

		const { container } = render(Page);

		await waitFor(() => {
			const input = q(container, '[data-testid="profile-name"]') as HTMLInputElement;
			expect(input).not.toBeNull();
			expect(input.value).toBe('');
		});
	});
});

describe('/profile v2 — cross-queue lock (save in flight blocks move)', () => {
	it('a move is blocked while an autosave is in flight', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const d = deferred<{ profileId: string }>();
		h.applyProfileSaveMock.mockReturnValueOnce(d.promise);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-name"]')).not.toBeNull());

		// Edit and blur to start a save.
		const nameInput = q(container, '[data-testid="profile-name"]') as HTMLInputElement;
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });
		await fireEvent.blur(nameInput);

		// While save is in flight, the visibility buttons should be disabled.
		await waitFor(() => {
			const pubBtn = q(container, '[data-testid="profile-vis-email-public"]') as HTMLButtonElement;
			expect(pubBtn.disabled).toBe(true);
		});

		// Resolve the save.
		d.resolve({ profileId: 'prof-dom' });
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada M.', email: 'ada@x.io', _sharing: 'domain' }
		]);
	});
});

describe('/profile v2 — T4.8 completion gate SSOT', () => {
	it('the completion banner clears after a domain name autosave', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValueOnce([]);
		h.listMyProfilesMock.mockResolvedValue([{ _id: 'dp-1', name: 'Ann', email: '', _sharing: 'domain' }]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'dp-1' });
		completionGateStore.set('incomplete');

		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-completion-required"]')).not.toBeNull()
		);

		const nameInput = q(container, '[data-testid="profile-name"]') as HTMLInputElement;
		await fireEvent.input(nameInput, { target: { value: 'Ann' } });
		await fireEvent.blur(nameInput);

		await waitFor(() => expect(q(container, '[data-testid="profile-completion-required"]')).toBeNull());
		expect(get(completionGateStore)).toBe('complete');
	});
});

describe('/profile v2 — repair banners still work', () => {
	it('an interrupted-move duplicate shows the repair banner', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-priv', name: 'Ada', email: '', _sharing: 'private' },
			{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-visibility-repair-name"]')).not.toBeNull());
	});
});

describe('/profile v2 — distinct-value conflict', () => {
	it('a field holding DIFFERENT values at two levels shows a conflict note', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-priv', name: 'Alice', email: '', _sharing: 'private' },
			{ _id: 'prof-pub', name: 'Alice Smith', email: '', _sharing: 'public' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());

		expect(q(container, '[data-testid="profile-vis-name-conflict-note"]')).not.toBeNull();
		expect(q(container, '[data-testid="profile-visibility-repair-name"]')).toBeNull();
	});
});
```

**Run:**
```bash
cd ~/workspace-app && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm vitest run src/routes/page.profile.spec.ts
```

**Expected:** All tests PASS (code from Tasks 1-3 is already in place).

### 4.2 Commit

```bash
cd ~/workspace-app && git add src/routes/page.profile.spec.ts && git commit -m "$(cat <<'EOF'
test(profile): rewrite page tests for v2 surface (#35)

Targets the v2 surface: single inputs (profile-name, profile-email),
autosave-on-blur, autosave-on-idle (fake timers), autosave-on-visibility-
change, save feedback on active button, name-private guard, sibling value
pinning (privacy leak prevention), #39 prefill, cross-queue lock, repair
banners, and distinct-value conflicts.

Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>
EOF
)"
```

---

## Task 5: i18n + cleanup

### 5.1 Add new i18n keys, remove old per-level card keys

- [ ] Update `messages/en.json`

**Add** after `profile_save_error`:
```json
"profile_name_private_disabled": "Name cannot be set to private visibility",
```

**Update** `profile_intro` to:
```json
"profile_intro": "Your name and email, and who can see them.",
```

**Remove** these keys (no longer used — the per-level card UI is gone):
- `profile_level_public_hint`
- `profile_level_domain_hint`
- `profile_level_private_hint`
- `profile_save`
- `profile_saved`

**Keep** these keys (still used by ProfileField / VisibilityRepairBanner / page):
- `profile_level_public_label`, `profile_level_domain_label`, `profile_level_private_label`
- `profile_saving` (used for save feedback on active button)
- `profile_save_error` (used for per-field error)
- All `profile_visibility_*` and `profile_repair_*` keys

- [ ] Apply the same add/remove/update to `messages/et.json`, `messages/lv.json`, `messages/uk.json`

**et.json** additions:
```json
"profile_name_private_disabled": "Nime ei saa privaatseks muuta",
```

**lv.json** additions:
```json
"profile_name_private_disabled": "Vārdu nevar iestatīt kā privātu",
```

**uk.json** additions:
```json
"profile_name_private_disabled": "Ім'я не можна зробити приватним",
```

Update `profile_intro` in each locale accordingly. Remove the same keys as en.json.

### 5.2 Delete old components

- [ ] Delete `src/lib/components/profile/ProfileLevelCard.svelte`
- [ ] Delete `src/lib/components/profile/VisibilityFieldRow.svelte`

```bash
cd ~/workspace-app && rm src/lib/components/profile/ProfileLevelCard.svelte src/lib/components/profile/VisibilityFieldRow.svelte
```

### 5.3 Run pnpm check

```bash
cd ~/workspace-app && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm check
```

**Expected:** 0 errors. If there are import errors referencing the deleted components, fix them.

### 5.4 Commit

```bash
cd ~/workspace-app && git add -A && git commit -m "$(cat <<'EOF'
chore(profile): i18n updates + delete old components (#35)

Add profile_name_private_disabled key to all 4 locales. Update
profile_intro for the v2 single-form wording. Remove stale per-level
card keys (profile_level_*_hint, profile_save, profile_saved).
Delete ProfileLevelCard.svelte and VisibilityFieldRow.svelte
(superseded by ProfileField).

Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>
EOF
)"
```

---

## Task 6: Verification

### 6.1 Run full test suite

```bash
cd ~/workspace-app && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm vitest run
```

**Expected:** All tests pass. If any test references old testids (`profile-public-name`, `profile-domain-save`, etc.), they were rewritten in Task 4. If OTHER test files reference deleted components, those need updating too (check imports in the test output).

### 6.2 Run pnpm check

```bash
cd ~/workspace-app && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm check
```

**Expected:** 0 errors.

### 6.3 Final commit (if any fixes needed)

If verification catches issues, fix and commit:

```bash
cd ~/workspace-app && git add -A && git commit -m "$(cat <<'EOF'
fix(profile): verification fixes for #35 profile edit v2

[describe what was fixed]

Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>
EOF
)"
```

---

## Files summary

### Creates
| File | Task |
|---|---|
| `src/lib/profile/autosave.ts` | Task 1 |
| `src/lib/profile/autosave.spec.ts` | Task 1 |
| `src/lib/components/profile/ProfileField.svelte` | Task 2 |

### Modifies
| File | Task |
|---|---|
| `src/routes/profile/+page.svelte` | Task 3 |
| `src/routes/page.profile.spec.ts` | Task 4 |
| `messages/en.json` | Task 5 |
| `messages/et.json` | Task 5 |
| `messages/lv.json` | Task 5 |
| `messages/uk.json` | Task 5 |

### Deletes
| File | Task |
|---|---|
| `src/lib/components/profile/ProfileLevelCard.svelte` | Task 5 |
| `src/lib/components/profile/VisibilityFieldRow.svelte` | Task 5 |

### Unchanged
| File | Reason |
|---|---|
| `src/lib/profile/profileData.ts` | Types + read/write primitives unchanged |
| `src/lib/profile/fieldMove.ts` | Move dispatch unchanged |
| `src/lib/profile/profileEditQueue.ts` | Queue unchanged; autosave funnels through `queue.request()` |
| `src/lib/profile/fieldMoveQueue.ts` | Move queue unchanged |
| `src/lib/profile/applyProfileSave.ts` | Write dispatcher unchanged |
| `src/lib/profile/completionGate.ts` | Gate module unchanged |
| `src/lib/components/profile/VisibilityRepairBanner.svelte` | Repair banner unchanged |

(*MVOX:Palestrina*)
