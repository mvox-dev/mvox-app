<!-- src/lib/components/nav/NavShell.svelte -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { NavEntry, NavContext } from '$lib/nav/entries';

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

	function isActive(route: string): boolean {
		if (route === '/') return activeRoute === '/';
		return activeRoute.startsWith(route);
	}

	let railSide = $state<'left' | 'right'>('left');

	$effect(() => {
		function update() {
			if (!screen.orientation) { railSide = 'left'; return; }
			railSide = screen.orientation.type === 'landscape-secondary' ? 'right' : 'left';
		}
		update();
		screen.orientation?.addEventListener('change', update);
		return () => screen.orientation?.removeEventListener('change', update);
	});

	function handleKeydown(e: KeyboardEvent): void {
		const nav = (e.currentTarget as HTMLElement);
		const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a:not([tabindex="-1"])'));
		const idx = links.indexOf(e.target as HTMLAnchorElement);
		if (idx < 0) return;

		let next = -1;
		if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
			next = (idx + 1) % links.length;
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
			next = (idx - 1 + links.length) % links.length;
		}
		if (next >= 0) {
			e.preventDefault();
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
				{@const active = isActive(entry.route)}
				{@const disabled = completionLocked && entry.route !== '/profile'}
				<a
					href={disabled ? '/profile' : entry.route}
					class="nav-entry"
					class:nav-entry--active={active}
					class:nav-entry--disabled={disabled}
					aria-current={active ? 'page' : undefined}
					aria-disabled={disabled ? 'true' : undefined}
					tabindex={disabled ? -1 : 0}
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

		.nav-shell.rail-right .nav-bar {
			border-right: none;
			border-left: 1px solid var(--color-paper-3);
			padding-left: 0;
			padding-right: env(safe-area-inset-right, 0px);
		}

		.nav-shell.rail-right .nav-content {
			padding-left: env(safe-area-inset-left, 0px);
			padding-right: 0;
		}

		.nav-shell.rail-right .nav-entry {
			border-radius: 0 0.5rem 0.5rem 0;
			margin-left: 0;
			margin-right: 0.25rem;
		}

		.nav-shell.rail-right .nav-entry--active {
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
