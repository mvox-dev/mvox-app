<!-- One-of-N choice as a segmented pill: a toolbar of toggle buttons, one pressed (#809). -->
<script lang="ts" module>
	export interface PillOption<T extends string> {
		value: T;
		label: string;
		testid: string;
		ariaLabel?: string;
		disabled?: boolean;
		busy?: boolean;
		class?: string;
		pressedClass?: string;
	}
</script>

<script lang="ts" generics="T extends string">
	import type { Snippet } from 'svelte';
	import { rovingKeydown } from '$lib/a11y/roving';
	import { writesAvailable } from '$lib/net/online';

	interface Props {
		testid: string;
		label: string;
		options: PillOption<T>[];
		selected: T | null;
		emptyAllowed: boolean;
		defaultValue?: T;
		kind: 'data' | 'ui';
		busy?: boolean;
		reachableWhenBlocked?: boolean;
		roving?: T | null;
		class?: string;
		buttonClass?: string;
		onselect: (value: T | null) => void;
		onkeydown?: (e: KeyboardEvent) => void;
		option?: Snippet<[PillOption<T>]>;
	}

	let {
		testid,
		label,
		options,
		selected,
		emptyAllowed,
		defaultValue,
		kind,
		busy = false,
		reachableWhenBlocked = false,
		roving = $bindable(),
		class: groupClass = '',
		buttonClass = 'px-2 py-1 font-mono text-[9px] tracking-wide',
		onselect,
		onkeydown,
		option: optionContent
	}: Props = $props();

	const pressedValue = $derived(selected ?? defaultValue ?? null);
	const blocked = $derived(busy || (kind === 'data' && !$writesAvailable));

	function isBlocked(o: PillOption<T>): boolean {
		return blocked || o.disabled === true;
	}

	// Blocked options under aria-disabled stay focusable, so they can hold the Tab stop.
	const tabStop = $derived.by(() => {
		const reachable = options.filter((o) => (reachableWhenBlocked && !o.disabled) || !isBlocked(o));
		for (const v of [roving ?? null, pressedValue]) {
			if (v !== null && reachable.some((o) => o.value === v)) return v;
		}
		return reachable[0]?.value ?? null;
	});

	function choose(o: PillOption<T>): void {
		if (isBlocked(o)) return;
		if (o.value !== pressedValue) onselect(o.value);
		else if (emptyAllowed && pressedValue !== (defaultValue ?? null)) onselect(defaultValue ?? null);
	}

	// Arrows only move focus: Space or Enter chooses, so moving never saves.
	function handleKeydown(e: KeyboardEvent): void {
		onkeydown?.(e);
		rovingKeydown(e, { selector: reachableWhenBlocked ? 'button' : 'button:not([disabled])' });
	}
</script>

<div
	data-testid={testid}
	role="toolbar"
	tabindex="-1"
	aria-label={label}
	aria-busy={busy ? 'true' : undefined}
	class="inline-flex flex-wrap overflow-hidden rounded-md border border-ink-4 {groupClass}"
	onkeydown={handleKeydown}
>
	{#each options as o (o.value)}
		{@const isPressed = o.value === pressedValue}
		<button
			type="button"
			data-testid={o.testid}
			disabled={reachableWhenBlocked ? o.disabled : isBlocked(o)}
			aria-disabled={reachableWhenBlocked && isBlocked(o) ? 'true' : undefined}
			aria-pressed={isPressed ? 'true' : 'false'}
			aria-label={o.ariaLabel}
			aria-busy={o.busy ? 'true' : undefined}
			tabindex={tabStop === o.value ? 0 : -1}
			onfocus={() => (roving = o.value)}
			onclick={() => choose(o)}
			class="border-r border-ink-4 last:border-r-0 {buttonClass} {isPressed
				? (o.pressedClass ?? 'bg-ink text-paper')
				: 'text-ink-2'} {blocked ? 'opacity-[0.45]' : ''} {isBlocked(o)
				? 'cursor-default'
				: ''} {o.class ?? ''}"
		>
			{#if optionContent}{@render optionContent(o)}{:else}{o.label}{/if}
		</button>
	{/each}
</div>
