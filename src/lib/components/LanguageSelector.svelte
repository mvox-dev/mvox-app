<!-- Language selector: one native button per locale, each named in its own language. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, locales, setLocale, type Locale } from '$lib/paraglide/runtime.js';
	import SegmentedPill from '$lib/components/SegmentedPill.svelte';

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
</script>

<SegmentedPill
	testid="language-selector"
	label={m.profile_language_label()}
	options={locales.map((locale) => ({
		value: locale,
		label: NATIVE_NAMES[locale],
		testid: `language-option-${locale}`
	}))}
	selected={current}
	emptyAllowed={false}
	kind="ui"
	buttonClass="flex min-h-11 items-center justify-center px-2 py-1 text-sm"
	onselect={(locale) => locale && setLocaleImpl(locale)}
/>
