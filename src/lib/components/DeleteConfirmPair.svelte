<!-- An armed delete's confirm and cancel buttons; each site keeps its arm state and testids. -->
<script lang="ts">
	import type { KeyboardEventHandler } from 'svelte/elements';

	let {
		confirmTestid,
		cancelTestid,
		confirmLabel,
		cancelLabel,
		confirmText,
		cancelText,
		pending,
		busy,
		isOffline,
		onconfirm,
		oncancel,
		onkeydown,
		class: className = '',
		confirmClass = ''
	}: {
		confirmTestid: string;
		cancelTestid: string;
		confirmLabel: string;
		cancelLabel: string;
		confirmText: string;
		cancelText: string;
		pending: boolean;
		busy: boolean;
		isOffline: boolean;
		onconfirm: () => void;
		oncancel: () => void;
		onkeydown?: KeyboardEventHandler<HTMLButtonElement>;
		class?: string;
		confirmClass?: string;
	} = $props();

	const join = (...parts: string[]): string => parts.filter(Boolean).join(' ');
</script>

<button
	type="button"
	data-testid={confirmTestid}
	aria-label={confirmLabel}
	disabled={pending || isOffline}
	aria-busy={busy}
	class={join(
		confirmClass,
		'flex min-h-11 items-center',
		className,
		'px-1 text-xs text-red-700 underline disabled:opacity-50'
	)}
	onclick={onconfirm}
	{onkeydown}
>
	{confirmText}
</button>
<button
	type="button"
	data-testid={cancelTestid}
	aria-label={cancelLabel}
	disabled={pending}
	class={join(
		'flex min-h-11 items-center',
		className,
		'px-1 text-xs text-ink-2 underline hover:text-ink disabled:opacity-50'
	)}
	onclick={oncancel}
	{onkeydown}
>
	{cancelText}
</button>
