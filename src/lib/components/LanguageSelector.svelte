<!-- Language selector: one native button per locale, each named in its own language. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, locales, setLocale, type Locale } from '$lib/paraglide/runtime.js';
	import { rovingKeydown } from '$lib/a11y/roving';

	interface Props {
		setLocaleImpl?: (locale: Locale) => void;
	}
	const { setLocaleImpl = (locale: Locale) => setLocale(locale) }: Props = $props();

	const NATIVE_NAMES: Record<Locale, string> = {
		en: 'English',
		et: 'Eesti',
		lv: 'Latviešu',
		uk: 'Українська'
	};

	// Read once: choosing a locale reloads the document (Paraglide messages are not reactive).
	const current: Locale = getLocale();

	// Toolbar: arrows move focus only, never activate. `current` is not reactive, so a
	// local roving stop lets the tab stop travel before a locale is chosen.
	let rovingLocale = $state<Locale | null>(null);
	const activeLocale = $derived(rovingLocale ?? current);

	function handleKeydown(e: KeyboardEvent): void {
		rovingKeydown(e);
	}
</script>

<div
	data-testid="language-selector"
	role="toolbar"
	tabindex="-1"
	aria-label={m.profile_language_label()}
	class="inline-flex flex-wrap overflow-hidden rounded-md border border-ink-4"
	onkeydown={handleKeydown}
>
	{#each locales as locale (locale)}
		<button
			data-testid="language-option-{locale}"
			type="button"
			aria-pressed={locale === current ? 'true' : 'false'}
			tabindex={locale === activeLocale ? 0 : -1}
			onfocus={() => (rovingLocale = locale)}
			class="flex min-h-11 items-center justify-center border-r border-ink-4 px-2 py-1 text-sm last:border-r-0"
			class:bg-ink={locale === current}
			class:text-paper={locale === current}
			class:text-ink-2={locale !== current}
			onclick={() => setLocaleImpl(locale)}
		>
			{NATIVE_NAMES[locale]}
		</button>
	{/each}
</div>
