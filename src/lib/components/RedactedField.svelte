<script lang="ts">
	// #357 GREEN — the ONE component through which admin-editable PII fields
	// render, carrying the capture-redaction marker BY CONSTRUCTION. See
	// RedactedField.spec.ts for the full contract and the seed-188
	// per-call-site anti-pattern this replaces.
	//
	// The marker sits on a WRAPPING <span> around the <input>, never on the
	// input itself: the redaction mechanism is a CSS ::after overlay, and
	// pseudo-elements cannot render on replaced elements like <input>.
	import { REDACT_ATTR } from '$lib/redact/redact';

	let {
		label,
		type,
		testid,
		value = $bindable(''),
		el = $bindable(null),
		disabled = false,
		required = false
	}: {
		label: string;
		// `string`, not a `'text' | 'tel' | 'email' | 'date'` union: the RED
		// spec's baseProps fixture assigns `type: 'tel'` on a plain (non-const)
		// object, which TS widens to `string` before it ever reaches a call
		// site — a literal-union prop here would reject that fixture. The five
		// real call sites in src/routes/roster/+page.svelte still only ever
		// pass one of the four HTML input types the contract names.
		type: string;
		testid: string;
		value?: string;
		el?: HTMLInputElement | null;
		disabled?: boolean;
		required?: boolean;
	} = $props();
</script>

<label class="flex flex-col gap-1 text-xs">
	{label}
	<span {...{ [REDACT_ATTR]: '' }} class="relative flex flex-col">
		<input
			{type}
			data-testid={testid}
			bind:this={el}
			bind:value
			{disabled}
			{required}
			class="rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50"
		/>
	</span>
</label>

<!-- (*MVOX:Byrd* — #357 GREEN: RedactedField, the capture-redaction marker on the component) -->
