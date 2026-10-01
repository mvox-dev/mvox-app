<!-- src/lib/components/nav/NavShell.svelte -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { NavEntry, NavContext } from '$lib/nav/entries';
	import { rovingKeydown } from '$lib/a11y/roving';
	import { m } from '$lib/paraglide/messages.js';

	let {
		entries,
		activeRoute,
		completionLocked = false,
		anonymous = false,
		isAdmin = false,
		// No NAV_ENTRIES entry reads this now; it stays as NavContext's second visibility
		// axis so a future entry can gate on it without re-threading the shell.
		hasMultipleCollectives = false,
		toolbar,
		toolbarLabel,
		overlay,
		children,
	}: {
		entries: NavEntry[];
		activeRoute: string;
		completionLocked?: boolean;
		anonymous?: boolean;
		isAdmin?: boolean;
		hasMultipleCollectives?: boolean;
		toolbar?: Snippet;
		toolbarLabel?: string;
		overlay?: Snippet;
		children: Snippet;
	} = $props();

	const ctx: NavContext = $derived({ isAdmin, hasMultipleCollectives });
	const visibleEntries = $derived(entries.filter((e) => e.visible(ctx)));

	// Completion-lock disables every entry but Profile. Out of the markup because the roving
	// tabindex below needs it too: a tab stop parked on a disabled link (tabindex="-1")
	// drops the whole nav out of the tab order.
	function isDisabled(entry: NavEntry): boolean {
		return completionLocked && entry.route !== '/profile';
	}
	const enabledEntries = $derived(visibleEntries.filter((e) => !isDisabled(e)));

	// Route matching is segment-aware and longest-wins: '/admin' and '/admin/invite' share a
	// prefix, so a per-entry `startsWith` would mark both current on /admin/invite.
	function matchesRoute(route: string): boolean {
		if (route === '/') return activeRoute === '/';
		return activeRoute === route || activeRoute.startsWith(route + '/');
	}

	const activeKey = $derived.by(() => {
		let best: NavEntry | null = null;
		for (const entry of visibleEntries) {
			if (!matchesRoute(entry.route)) continue;
			if (!best || entry.route.length > best.route.length) best = entry;
		}
		return best?.key ?? null;
	});

	// Roving tabindex: the last focused entry, else the current page's, else the first, so a
	// roving key that vanished with a context change still leaves one tab stop.

	// Every candidate must be ENABLED: a disabled tab stop leaves no tabindex="0" link and
	// strands the user away from Profile, the only link that clears the lock. Chrome focuses
	// a clicked greyed link, and the locked route's own entry renders before the redirect.
	let rovingKey = $state<string | null>(null);
	const activeNavKey = $derived.by(() => {
		if (rovingKey !== null && enabledEntries.some((e) => e.key === rovingKey)) return rovingKey;
		if (activeKey !== null && enabledEntries.some((e) => e.key === activeKey)) return activeKey;
		return enabledEntries[0]?.key ?? null;
	});

	let railSide = $state<'left' | 'right'>('left');

	$effect(() => {
		function update() {
			// -90 = CCW rotation (notch on left) → rail on right
			// 90 = CW rotation (notch on right) → rail on left
			// 0/180/undefined = portrait or desktop → left (default)
			railSide = window.orientation === 90 ? 'right' : 'left';
		}
		update();
		window.addEventListener('orientationchange', update);
		return () => window.removeEventListener('orientationchange', update);
	});

	function handleKeydown(e: KeyboardEvent): void {
		// Members are every enabled link, not the tab stop: with roving tabindex only one link
		// has tabindex="0", so filtering on it would leave arrow-nav a group of one.
		rovingKeydown(e, { selector: 'a:not([aria-disabled="true"])' });
	}
</script>

{#if !anonymous && visibleEntries.length > 0}
	<div class="nav-shell" class:rail-right={railSide === 'right'}>
		{#if toolbar}
			<div
				role="toolbar"
				aria-label={toolbarLabel}
				class="nav-bar"
				tabindex="-1"
				onkeydown={(e) => rovingKeydown(e, { selector: 'button:not(:disabled)' })}
			>
				{@render toolbar()}
			</div>
		{:else}
			<nav
				role="navigation"
				aria-label={m.nav_main_label()}
				class="nav-bar"
				onkeydown={handleKeydown}
			>
				{#each visibleEntries as entry (entry.key)}
					{@const active = entry.key === activeKey}
					{@const disabled = isDisabled(entry)}
					<a
						href={disabled ? '/profile' : entry.route}
						class="nav-entry"
						class:nav-entry--active={active}
						class:nav-entry--disabled={disabled}
						aria-current={active ? 'page' : undefined}
						aria-disabled={disabled ? 'true' : undefined}
						tabindex={disabled ? -1 : entry.key === activeNavKey ? 0 : -1}
						onfocus={() => {
							// Disabled links never claim the stop — see `activeNavKey`.
							if (!disabled) rovingKey = entry.key;
						}}
					>
						<span class="nav-icon" aria-hidden="true">{@html entry.icon}</span>
						<span class="nav-label">{entry.label()}</span>
					</a>
				{/each}
			</nav>
		{/if}
		<!-- The page stays mounted under the overlay, so closing it returns the page as it was. -->
		<div class="nav-stage">
			<main class="nav-content" tabindex="-1" inert={overlay !== undefined}>
				{@render children?.()}
			</main>
			{#if overlay}
				<div class="nav-overlay">{@render overlay()}</div>
			{/if}
		</div>
	</div>
{:else}
	{@render children?.()}
{/if}

<style>
	/* ── Base: State A — bottom tab bar (< 640px) ── */
	.nav-shell {
		display: flex;
		flex-direction: column;
		height: 100dvh;
	}

	.nav-bar {
		order: 1;
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-around;
		background: var(--color-paper-2);
		border-top: 1px solid var(--color-paper-3);
		padding: 0.25rem 0.5rem;
		flex-shrink: 0;
	}

	.nav-stage {
		order: 0;
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: grid;
		grid-template: minmax(0, 1fr) / minmax(0, 1fr);
	}

	.nav-content,
	.nav-overlay {
		grid-area: 1 / 1;
		overflow-y: auto;
	}

	.nav-overlay {
		z-index: 1;
		background: var(--color-paper);
	}

	.nav-entry {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 0.375rem 0.75rem;
		border-radius: 0.5rem;
		font-family: var(--font-sans);
		font-size: 0.625rem;
		line-height: 1.2;
		color: var(--color-ink-3);
		text-decoration: none;
		transition: color 0.15s, background-color 0.15s;
		gap: 0.125rem;
		cursor: pointer;
	}

	.nav-entry:hover:not(.nav-entry--disabled) {
		color: var(--color-ink);
		background: color-mix(in srgb, var(--color-paper) 50%, transparent);
	}

	.nav-entry--active {
		color: var(--color-ink);
		font-weight: 500;
		background: var(--color-paper);
	}

	.nav-entry--disabled {
		color: var(--color-ink-4);
		cursor: not-allowed;
	}

	.nav-entry--disabled:hover {
		color: var(--color-ink-4);
		background: transparent;
	}

	.nav-icon {
		display: flex;
		width: 1.25rem;
		height: 1.25rem;
	}

	.nav-icon :global(svg) {
		width: 100%;
		height: 100%;
	}

	.nav-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 5rem;
	}

	/* ── sm: State C — spine rail (640px–1023px) ── */
	@media (min-width: 640px) and (max-width: 1023.98px) {
		.nav-shell {
			flex-direction: row;
		}

		.nav-bar {
			order: 0;
			flex-direction: column;
			justify-content: flex-start;
			align-items: stretch;
			width: 4.5rem;
			padding: 0.75rem 0;
			padding-left: env(safe-area-inset-left, 0px);
			padding-right: env(safe-area-inset-right, 0px);
			border-top: none;
			border-right: 1px solid var(--color-paper-3);
			gap: 0.125rem;
		}

		.nav-stage {
			order: 1;
		}

		.nav-content,
		.nav-overlay {
			padding-left: env(safe-area-inset-left, 0px);
			padding-right: env(safe-area-inset-right, 0px);
		}

		.nav-entry {
			padding: 0.625rem 0.5rem;
			border-radius: 0.5rem 0 0 0.5rem;
			margin-left: 0.25rem;
			font-size: 0.5625rem;
			gap: 0.1875rem;
		}

		/* Folder-tab effect: active tab connects to content area */
		.nav-entry--active {
			background: var(--color-paper);
			margin-right: -1px;
			border-right: 1px solid var(--color-paper);
			position: relative;
			z-index: 1;
		}

		.nav-icon {
			width: 1.375rem;
			height: 1.375rem;
		}

		.nav-label {
			max-width: 3.5rem;
			font-size: 0.5rem;
		}
	}

	/* ── sm: Rail on RIGHT (CCW rotation, notch on left) ── */
	@media (min-width: 640px) and (max-width: 1023.98px) {
		.nav-shell.rail-right {
			flex-direction: row-reverse;
		}

		.nav-shell.rail-right :global(.nav-bar) {
			border-right: none;
			border-left: 1px solid var(--color-paper-3);
			padding-left: 0;
			padding-right: env(safe-area-inset-right, 0px);
		}

		.nav-shell.rail-right :global(.nav-content),
		.nav-shell.rail-right :global(.nav-overlay) {
			padding-left: env(safe-area-inset-left, 0px);
			padding-right: 0;
		}

		.nav-shell.rail-right :global(.nav-entry) {
			border-radius: 0 0.5rem 0.5rem 0;
			margin-left: 0;
			margin-right: 0.25rem;
		}

		.nav-shell.rail-right :global(.nav-entry--active) {
			margin-left: -1px;
			margin-right: 0.25rem;
			border-left: 1px solid var(--color-paper);
			border-right: none;
		}
	}

	/* ── lg: State B — top bar (>= 1024px) ── */
	@media (min-width: 1024px) {
		.nav-shell {
			flex-direction: column;
		}

		.nav-bar {
			order: 0;
			flex-direction: row;
			justify-content: flex-start;
			align-items: center;
			width: auto;
			height: 3rem;
			padding: 0 1.5rem;
			border-top: none;
			border-right: none;
			border-bottom: 1px solid var(--color-paper-3);
			gap: 0.25rem;
		}

		.nav-stage {
			order: 1;
		}

		.nav-entry {
			flex-direction: row;
			padding: 0.375rem 0.75rem;
			border-radius: 0.375rem;
			margin-left: 0;
			font-size: 0.8125rem;
			gap: 0.375rem;
		}

		.nav-entry--active {
			margin-right: 0;
			border-right: none;
			position: static;
		}

		.nav-icon {
			width: 1.125rem;
			height: 1.125rem;
		}

		.nav-label {
			max-width: none;
			font-size: 0.8125rem;
		}
	}
</style>
