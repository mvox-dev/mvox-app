<!-- src/lib/components/nav/NavShell.svelte -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { NavEntry, NavContext } from '$lib/nav/entries';
	import { rovingNextIndex } from '$lib/a11y/roving';

	let {
		entries,
		activeRoute,
		completionLocked = false,
		anonymous = false,
		isAdmin = false,
		hasMultipleCollectives = false,
		children,
	}: {
		entries: NavEntry[];
		activeRoute: string;
		completionLocked?: boolean;
		anonymous?: boolean;
		isAdmin?: boolean;
		hasMultipleCollectives?: boolean;
		children: Snippet;
	} = $props();

	const ctx: NavContext = $derived({ isAdmin, hasMultipleCollectives });
	const visibleEntries = $derived(entries.filter((e) => e.visible(ctx)));

	// Completion-lock disables every entry but Profile. Hoisted OUT of the
	// markup (#156 review F2) because the roving-tabindex resolution below has
	// to consult it too — a tab stop parked on a disabled link is a tab stop
	// the keyboard can never reach, and since the disabled links carry
	// tabindex="-1" unconditionally, that silently drops the WHOLE nav out of
	// the tab order.
	function isDisabled(entry: NavEntry): boolean {
		return completionLocked && entry.route !== '/profile';
	}
	const enabledEntries = $derived(visibleEntries.filter((e) => !isDisabled(e)));

	// Route matching is SEGMENT-aware and LONGEST-WINS. Two entries can share a
	// prefix ('/admin' and '/admin/invite'); a per-entry `startsWith` test would
	// mark BOTH current on /admin/invite (two aria-current="page", two active
	// tabs). Resolve the single winning entry once, over the visible set.
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

	// #156 — roving tabindex. `rovingKey` is the last entry focus landed on;
	// `activeNavKey` falls back to the current page's entry (so Tab lands on
	// where you are), then to the first entry, covering first render AND a
	// roving key that vanished from under it (entries can change with
	// `isAdmin`/`hasMultipleCollectives`/completion-lock).
	//
	// EVERY candidate is checked against `enabledEntries`, not `visibleEntries`
	// (#156 review F2). A disabled entry is visible-but-unfocusable, so naming
	// one the tab stop leaves zero links with tabindex="0" and strands the
	// user — including out of reach of Profile, the only link that clears the
	// lock. Both routes into that state are real: clicking a greyed link
	// focuses it in Chrome (writing `rovingKey`), and the current route's own
	// entry is disabled on any locked non-/profile render, since the layout's
	// redirect is an $effect that runs after the first paint.
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
		const nav = (e.currentTarget as HTMLElement);
		// Members are every ENABLED link, not just the current tab stop — with
		// roving tabindex only one link carries tabindex="0" at a time, so
		// filtering on tabindex here (the old selector) would leave arrow-nav
		// with a group of one. `aria-disabled` is the real enabled/disabled
		// signal now.
		const links = Array.from(
			nav.querySelectorAll<HTMLAnchorElement>('a:not([aria-disabled="true"])')
		);
		const idx = links.indexOf(e.target as HTMLAnchorElement);
		if (idx < 0) return;

		const next = rovingNextIndex(e.key, idx, links.length);
		if (next >= 0) {
			e.preventDefault();
			// `onfocus` on the target link below writes `rovingKey` back, so the
			// tab stop travels with focus — no separate bookkeeping needed here.
			links[next].focus();
		}
	}
</script>

{#if !anonymous && visibleEntries.length > 0}
	<div class="nav-shell" class:rail-right={railSide === 'right'}>
		<nav
			role="navigation"
			aria-label="Main navigation"
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
		<main class="nav-content">
			{@render children?.()}
		</main>
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

	.nav-content {
		order: 0;
		flex: 1;
		overflow-y: auto;
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

		.nav-content {
			order: 1;
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

		.nav-shell.rail-right :global(.nav-content) {
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

		.nav-content {
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
