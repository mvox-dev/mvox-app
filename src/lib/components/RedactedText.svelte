<script lang="ts">
	// #388 GREEN — the shared capture-redaction marker for PLAIN ELEMENT
	// CONTENT (a name, an email, any personal value rendered as text rather
	// than an <input>). RedactedField.svelte (#357) covers the admin
	// record-editor's inputs; /roster also bares personal values outside any
	// input (the collapsed row's name and email, the sr-only edit label's
	// name, the inactive-members row's name) — those need the same marker
	// with nothing to wrap an <input> around. #361 builds a name component on
	// top of this one next, so this stays GENERIC: nothing name-specific here.
	//
	// The marker sits on a wrapping <span>, never assumed onto the caller's
	// own element: the redaction mechanism is a CSS ::after overlay, and a
	// pseudo-element cannot render on a replaced element (see redact.ts).
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { REDACT_ATTR } from '$lib/redact/redact';

	let { children, ...rest }: { children: Snippet } & HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span {...{ [REDACT_ATTR]: '' }} {...rest}>{@render children()}</span>

<!-- (*MVOX:Josquin* — #388 GREEN: RedactedText, the shared display marker) -->
