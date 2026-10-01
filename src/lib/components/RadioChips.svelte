<script lang="ts" generics="T extends string">
	import { rovingKeydown } from '$lib/a11y/roving';

	interface Props {
		testid: string;
		label: string;
		class: string;
		options: { value: T; label: string; testid: string }[];
		selected: T;
		onselect: (value: T) => void;
		chipClass: string;
		onClass: string;
		offClass: string;
	}

	const {
		testid,
		label,
		class: groupClass,
		options,
		selected,
		onselect,
		chipClass,
		onClass,
		offClass
	}: Props = $props();

	// A radiogroup, not a toolbar: arrows move AND select, inside this group only.
	// aria-checked, never aria-pressed, which is invalid on role="radio".
	function handleKeydown(e: KeyboardEvent): void {
		const chips = Array.from((e.currentTarget as HTMLElement).querySelectorAll('button'));
		rovingKeydown(e, {
			beforeFocus: (member) => {
				const option = options[chips.indexOf(member as HTMLButtonElement)];
				if (!option) return false;
				onselect(option.value);
			}
		});
	}
</script>

<div
	data-testid={testid}
	role="radiogroup"
	tabindex="-1"
	aria-label={label}
	class={groupClass}
	onkeydown={handleKeydown}
>
	{#each options as option (option.value)}
		<button
			type="button"
			data-testid={option.testid}
			role="radio"
			aria-checked={selected === option.value ? 'true' : 'false'}
			tabindex={selected === option.value ? 0 : -1}
			class="{chipClass} {selected === option.value ? onClass : offClass}"
			onclick={() => onselect(option.value)}
		>
			{option.label}
		</button>
	{/each}
</div>
