<!-- src/lib/components/LanguageSelector.svelte -->
<!--
	#123 — Language selector, app chrome (like the profile page's sign-out
	link): a segmented group of four native <button>s, one per shipped locale,
	labelled with the locale's OWN native name (never translated — "English"
	stays "English" in every locale).

	`setLocaleImpl` is the house-style trailing injectable seam (see
	src/lib/entu/request.ts `fetchImpl` convention): defaults to the real
	Paraglide `setLocale`, overridable in tests.

	It calls `setLocale(locale)` with Paraglide's DEFAULT `reload: true`.
	Paraglide messages are plain functions reading non-reactive module state
	(`_locale` in runtime.js), so `{m.foo()}` has no reactive dependency and
	never re-evaluates — with `reload: false` the locale would change while the
	screen stayed in the old language. runtime.js says as much: `reload: false`
	"does not re-render the UI [...] Do not use it for normal locale pickers."
	So the click reloads the document, and on reload the localStorage/cookie
	strategy resolves the new locale and the whole page renders translated.
	Reload is safe here: the token and the selected collective live in
	localStorage, and profile edits autosave on blur.

	Persistence is NOT this component's job: `setLocale` itself writes the
	PARAGLIDE_LOCALE cookie once 'cookie' is part of the paraglideVitePlugin
	strategy (vite.config.ts) — see runtime.js's generated `setLocale`.

	Review F3 (#123/S4), accepted as-is: that generated cookie carries only
	`path=/; max-age=…` — no SameSite/Secure. Browsers default an
	attribute-less cookie to SameSite=Lax, and the value is a non-sensitive UI
	preference validated against the 4-locale allowlist before use. The string
	is emitted by the gitignored Paraglide runtime, so pinning the attributes
	would mean replacing the built-in cookie strategy with a custom-cookie
	handler (`defineCustomClientStrategy`) — a separate issue, not a change
	this component can make.

	The document's `<html lang>` is synced to the resolved locale in
	src/routes/+layout.svelte (review F1) — app.html hardcodes `lang="en"`.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, locales, setLocale, type Locale } from '$lib/paraglide/runtime.js';
	import { rovingNextIndex } from '$lib/a11y/roving';

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

	// Read once at render: selecting a locale reloads the document (see above),
	// so the pressed option is re-derived from getLocale() on the way back in.
	// No local $state mirror — it would only ever be written on a click that is
	// simultaneously tearing this document down.
	const current: Locale = getLocale();

	// #156 — roving tabindex, TOOLBAR semantics: arrows move focus only, they
	// must NEVER activate. `current` is deliberately non-reactive (see block
	// comment — clicking reloads the document), so it can't drive the roving
	// stop by itself; a small session-local `rovingLocale` + onfocus
	// write-back lets the tab stop travel while the picker is open, without
	// making the picker impossible to traverse before a locale is committed.
	let rovingLocale = $state<Locale | null>(null);
	const activeLocale = $derived(rovingLocale ?? current);

	function handleKeydown(e: KeyboardEvent): void {
		const group = e.currentTarget as HTMLElement;
		const options = Array.from(group.querySelectorAll<HTMLButtonElement>('button'));
		const idx = options.indexOf(e.target as HTMLButtonElement);
		if (idx < 0) return;
		const next = rovingNextIndex(e.key, idx, options.length);
		if (next < 0) return;
		e.preventDefault();
		options[next].focus();
	}
</script>

<!-- #156 — WAI-APG TOOLBAR, not a radiogroup: arrows MOVE focus only, they
     never activate (activation reloads the document — see the block comment
     above). `role="toolbar"` states that in the markup; under the old bare
     `role="group"` nothing distinguished this from the app's arrow-SELECTS
     radiogroups (roster view chips, library copy-sort), and svelte-check
     flagged the keydown handler on a non-interactive role. `aria-pressed`
     toggle buttons inside a toolbar are the APG pattern — state pin
     unchanged. -->
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
