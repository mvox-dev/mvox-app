<script lang="ts">
	// #361 GREEN — PersonName: the ONE way a bare member name renders. Built
	// on #388's RedactedText so every member name on a surface that CAN hold
	// a marker is blanked in a capture, and a new usage inherits the marker
	// by using this component instead of a bare {name}.
	import RedactedText from '$lib/components/RedactedText.svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	let { name, ...rest }: { name: string } & HTMLAttributes<HTMLSpanElement> = $props();
</script>

<RedactedText {...rest}>{name}</RedactedText>

<!-- (*MVOX:Josquin* — #361 GREEN: PersonName, the one way a member name renders) -->
