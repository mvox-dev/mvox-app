<script lang="ts">
	// #207 rule 5 — the app's ONE time-entry composite. Native <select>s only
	// (rules 1/2): hour + minute, plus a third AM/PM select when the viewer's
	// $lib/preferences/timeFormat preference is 'ampm'. 5-minute resolution
	// holds BY CONSTRUCTION of the minute option list — there is no step=
	// attribute anywhere because there is no <input> at all.
	//
	// `hour24`/`minute` below are the ONE canonical store, always in 24h terms,
	// regardless of which mode is currently displayed — so a mode switch is a
	// pure re-render (no reseed, no emitted onchange) and AM/PM math never has
	// to guess which display produced the value it is holding.
	import { m } from '$lib/paraglide/messages.js';
	import { timeFormatStore } from '$lib/preferences/timeFormat';

	// `invalid` / `describedBy` / `onkeydown` are threaded down onto EVERY
	// <select> rather than left on the surrounding wrapper: `aria-invalid` is
	// only honoured on form controls, `aria-describedby` is announced only when
	// focus lands on the element carrying it, and a keydown listener belongs on
	// a real interactive control (a role="group" wrapper is non-interactive).
	// The wrapper's job is the accessible NAME of the group; the controls own
	// their own state and gestures. (#207 review F2/F3)
	let {
		value = '',
		prefix,
		onchange,
		disabled = false,
		invalid = undefined,
		describedBy = undefined,
		onkeydown = undefined
	}: {
		value?: string;
		prefix: string;
		onchange: (value: string) => void;
		disabled?: boolean;
		invalid?: true | undefined;
		describedBy?: string | undefined;
		onkeydown?: ((event: KeyboardEvent) => void) | undefined;
	} = $props();

	const mode = $derived($timeFormatStore);

	const HOURS_24: string[] = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
	const MINUTES_5: string[] = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
	const HOURS_12: string[] = Array.from({ length: 12 }, (_, i) => String(i + 1));

	function to12(h24: number): { hour12: string; ampm: 'AM' | 'PM' } {
		const ampmVal: 'AM' | 'PM' = h24 < 12 ? 'AM' : 'PM';
		let h12 = h24 % 12;
		if (h12 === 0) h12 = 12;
		return { hour12: String(h12), ampm: ampmVal };
	}

	function to24(h12: number, ampmVal: 'AM' | 'PM'): number {
		const base = h12 % 12;
		return ampmVal === 'PM' ? base + 12 : base;
	}

	let hour24 = $state('');
	let minute = $state('');
	// The meridiem is FIRST-CLASS state, not something re-derived from `hour24`.
	// Deriving it made the AM/PM select unable to remember a pick made BEFORE
	// the hour (with `hour24 === ''` there is nothing to derive from), so the
	// choice was dropped and the next hour pick silently fell back to AM — a
	// 12-hour-off save. Holding it here means either pick order works. It stays
	// '' until actually KNOWN — seeded from a concrete incoming value, or
	// explicitly picked in AM/PM mode. A viewer who has picked hour+minute but
	// not yet AM/PM must not emit: `hour24` already carries an assumed-AM
	// placeholder internally (see `handleHourChange`) so the hour select keeps
	// showing the pick, but emission stays gated on this until AM/PM is chosen.
	let ampmChoice = $state<'' | 'AM' | 'PM'>('');

	function seedFrom(v: string): void {
		if (!v) {
			hour24 = '';
			minute = '';
			ampmChoice = '';
			return;
		}
		const [h, mi] = v.split(':');
		hour24 = h ?? '';
		minute = mi ?? '';
		ampmChoice = hour24 === '' ? '' : to12(Number(hour24)).ampm;
	}

	// Re-seed on mount AND on every genuine EXTERNAL change of `value` (a form
	// reset, a fresh record loaded) — never merely because `mode` changed,
	// which must redisplay the SAME underlying value, not reinterpret it.
	// `$effect.pre` (not a plain top-level call) so `value` is read inside a
	// reactive closure and runs synchronously before the first paint — a bare
	// `seedFrom(value)` at script top level only captures the prop's initial
	// snapshot.
	let seeded = false;
	let lastSeededValue = '';
	$effect.pre(() => {
		const v = value;
		if (!seeded || v !== lastSeededValue) {
			seeded = true;
			lastSeededValue = v;
			seedFrom(v);
		}
	});

	const hourDisplay = $derived(
		mode === 'ampm' ? (hour24 === '' ? '' : to12(Number(hour24)).hour12) : hour24
	);
	const hourOptionsBase = $derived(mode === 'ampm' ? HOURS_12 : HOURS_24);
	const hourOptions = $derived(hourDisplay === '' ? ['', ...hourOptionsBase] : hourOptionsBase);

	// LEGACY-MINUTE RULE — an incoming minute off the 5-minute grid (older
	// data) is inserted as an extra option and selected, never silently
	// snapped.
	const minuteOptionsBase = $derived(
		minute !== '' && !MINUTES_5.includes(minute)
			? [...MINUTES_5, minute].sort((a, b) => Number(a) - Number(b))
			: MINUTES_5
	);
	const minuteOptions = $derived(minute === '' ? ['', ...minuteOptionsBase] : minuteOptionsBase);

	// Not gated on `hour24` — an AM/PM pick made before the hour must keep
	// showing what the viewer chose.
	const ampmDisplay = $derived(ampmChoice);
	const ampmOptions = $derived(ampmDisplay === '' ? ['', 'AM', 'PM'] : ['AM', 'PM']);

	function maybeEmit(): void {
		if (hour24 === '' || minute === '') return;
		if (mode === 'ampm' && ampmChoice === '') return;
		onchange(`${hour24}:${minute}`);
	}

	function handleHourChange(e: Event): void {
		const v = (e.currentTarget as HTMLSelectElement).value;
		if (mode === 'ampm') {
			const h12 = Number(v);
			// An unpicked meridiem holds `hour24` as an assumed-AM placeholder;
			// `ampmChoice` itself stays '' so emission remains gated.
			hour24 = String(to24(h12, ampmChoice || 'AM')).padStart(2, '0');
		} else {
			hour24 = v;
		}
		maybeEmit();
	}

	function handleMinuteChange(e: Event): void {
		minute = (e.currentTarget as HTMLSelectElement).value;
		maybeEmit();
	}

	function handleAmpmChange(e: Event): void {
		const v = (e.currentTarget as HTMLSelectElement).value as '' | 'AM' | 'PM';
		ampmChoice = v;
		// With no hour yet there is nothing to convert — the choice is simply
		// remembered, and the next hour pick reads it.
		if (v && hour24 !== '') {
			const h12 = Number(to12(Number(hour24)).hour12);
			hour24 = String(to24(h12, v)).padStart(2, '0');
		}
		maybeEmit();
	}
</script>

<select
	data-testid={`${prefix}-hour`}
	aria-label={m.time_select_hour_label()}
	aria-invalid={invalid}
	aria-describedby={describedBy}
	{onkeydown}
	{disabled}
	value={hourDisplay}
	onchange={handleHourChange}
	class="min-w-0 border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
>
	{#each hourOptions as opt (opt)}
		<option value={opt}>{opt}</option>
	{/each}
</select>
<select
	data-testid={`${prefix}-minute`}
	aria-label={m.time_select_minute_label()}
	aria-invalid={invalid}
	aria-describedby={describedBy}
	{onkeydown}
	{disabled}
	value={minute}
	onchange={handleMinuteChange}
	class="min-w-0 border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
>
	{#each minuteOptions as opt (opt)}
		<option value={opt}>{opt}</option>
	{/each}
</select>
{#if mode === 'ampm'}
	<select
		data-testid={`${prefix}-ampm`}
		aria-label={m.time_select_ampm_label()}
		aria-invalid={invalid}
		aria-describedby={describedBy}
		{onkeydown}
		{disabled}
		value={ampmDisplay}
		onchange={handleAmpmChange}
		class="min-w-0 border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
	>
		{#each ampmOptions as opt (opt)}
			<option value={opt}>{opt}</option>
		{/each}
	</select>
{/if}

<!-- (*MVOX:Palestrina* — #207 GREEN part 1: TimeSelect composite) -->
