// @vitest-environment happy-dom
//
// #207 RED — TimeSelect: the app's ONE time-entry composite (PO standing
// rule 5 + the 5-minute addendum). Native controls only (rules 1/2): two
// native <select>s — hour and minute — plus, in AM/PM mode, a third native
// <select> for AM/PM. There is NO step= attribute anywhere because there is
// no input: 5-minute resolution holds BY CONSTRUCTION of the minute options.
//
// CONTRACT (GREEN must implement — src/lib/components/TimeSelect.svelte,
// Svelte 5 runes):
//
//   PROPS
//     value     '' | 'HH:MM' — the canonical 24h string the surfaces already
//               store/submit. Accepted AND emitted in exactly this shape; the
//               component NEVER changes the stored/submitted string format.
//     prefix    testid prefix — renders <prefix>-hour, <prefix>-minute and
//               (AM/PM mode only) <prefix>-ampm
//     onchange  (value: string) => void — called once per COMPLETED user
//               change with the full 'HH:MM'. Never called at mount, and
//               never with a partial pick (hour without minute etc.).
//     disabled  optional — disables every rendered select
//
//   MODE — read REACTIVELY from $lib/preferences/timeFormat's timeFormatStore:
//     '24h' (default): hour options exactly '00'..'23'; minute options exactly
//       '00','05',…,'55'.
//     'ampm': hour options exactly '1'..'12' + an AM/PM select (option values
//       'AM','PM'); the pick is converted to 24h BEFORE emitting ('12:30'+PM
//       → '12:30', '12:30'+AM → '00:30', '7:05'+PM → '19:05'; incoming '00'
//       renders as 12 AM, '12' as 12 PM). Switching mode re-renders the SAME
//       underlying value — it is a display change, never a value change.
//
//   EMPTY / PARTIAL — value '' renders every select with an empty placeholder
//     option (value '') SELECTED, like the series day select; nothing is
//     emitted until the pick is complete.
//
//   LEGACY-MINUTE RULE — an incoming minute that is not a multiple of 5
//     (e.g. '19:03' from older data) gets its exact minute inserted as an
//     extra option and SELECTED, so rendering never silently snaps the value.
//     Changing the hour alone keeps that legacy minute ('20:03').
//
//   A11Y — every select carries a non-empty accessible name (aria-label from
//     the Paraglide keys time_select_hour_label / time_select_minute_label /
//     time_select_ampm_label).
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Does not exist yet — this whole file is RED with "Failed to resolve import"
// until GREEN creates the component (and the preference store it reads).
import TimeSelect from './TimeSelect.svelte';
import { timeFormatStore } from '$lib/preferences/timeFormat';
import { HOURS_24, MINUTES_5, optionValues } from '$lib/testing/timeControls';

const HOURS_12 = Array.from({ length: 12 }, (_, i) => String(i + 1));

const sel = (c: HTMLElement, id: string) =>
	c.querySelector(`[data-testid="${id}"]`) as HTMLSelectElement | null;

function renderTime(props: Record<string, unknown> = {}) {
	const onchange = vi.fn();
	const { container } = render(TimeSelect, {
		props: { prefix: 'tsel', value: '', onchange, ...props }
	});
	return { container, onchange };
}

async function pick(c: HTMLElement, id: string, value: string) {
	await fireEvent.change(sel(c, id)!, { target: { value } });
}

beforeEach(() => {
	localStorage.clear();
	timeFormatStore.set('24h');
});

afterEach(() => {
	cleanup();
	localStorage.clear();
	timeFormatStore.set('24h');
});

describe('TimeSelect — 24h mode (#207 rule 5)', () => {
	it("renders hour options EXACTLY '00'..'23' and minute options EXACTLY the twelve 5-minute steps", () => {
		const { container } = renderTime({ value: '07:45' });
		const hour = sel(container, 'tsel-hour');
		const minute = sel(container, 'tsel-minute');
		expect(hour?.tagName).toBe('SELECT');
		expect(minute?.tagName).toBe('SELECT');
		expect(optionValues(hour)).toEqual(HOURS_24);
		expect(optionValues(minute)).toEqual(MINUTES_5);
		expect(hour!.value).toBe('07');
		expect(minute!.value).toBe('45');
		// 24h mode has NO third select.
		expect(sel(container, 'tsel-ampm')).toBeNull();
	});

	it('value "" renders empty placeholders selected and emits NOTHING at mount', () => {
		const { container, onchange } = renderTime({ value: '' });
		expect(sel(container, 'tsel-hour')!.value).toBe('');
		expect(sel(container, 'tsel-minute')!.value).toBe('');
		// The full pick lists are still there behind the placeholder.
		expect(optionValues(sel(container, 'tsel-hour')).filter((v) => v !== '')).toEqual(HOURS_24);
		expect(optionValues(sel(container, 'tsel-minute')).filter((v) => v !== '')).toEqual(MINUTES_5);
		expect(onchange).not.toHaveBeenCalled();
	});

	it('a partial pick emits nothing; completing it emits ONCE with the full HH:MM', async () => {
		const { container, onchange } = renderTime({ value: '' });
		await pick(container, 'tsel-hour', '07');
		expect(onchange, 'hour alone is not a time').not.toHaveBeenCalled();
		await pick(container, 'tsel-minute', '45');
		expect(onchange).toHaveBeenCalledTimes(1);
		expect(onchange).toHaveBeenCalledWith('07:45');
	});

	it("LEGACY-MINUTE RULE: value '19:03' renders '03' as a selected EXTRA option — never silently snapped", () => {
		const { container, onchange } = renderTime({ value: '19:03' });
		const minute = sel(container, 'tsel-minute')!;
		expect(optionValues(minute)).toContain('03');
		expect(minute.value).toBe('03');
		expect(sel(container, 'tsel-hour')!.value).toBe('19');
		// Display-only: no spontaneous emission may rewrite the stored value.
		expect(onchange).not.toHaveBeenCalled();
	});

	it("changing only the HOUR of '19:03' keeps the legacy minute: emits '20:03'", async () => {
		const { container, onchange } = renderTime({ value: '19:03' });
		await pick(container, 'tsel-hour', '20');
		expect(onchange).toHaveBeenCalledTimes(1);
		expect(onchange).toHaveBeenCalledWith('20:03');
	});

	it('disabled disables every select', () => {
		const { container } = renderTime({ value: '07:45', disabled: true });
		expect(sel(container, 'tsel-hour')!.disabled).toBe(true);
		expect(sel(container, 'tsel-minute')!.disabled).toBe(true);
	});
});

describe('TimeSelect — AM/PM mode is an OPT-IN display, 24h stays the wire (#207 rule 5)', () => {
	beforeEach(() => {
		timeFormatStore.set('ampm');
	});

	it("renders hour options '1'..'12' plus an AM/PM select — minutes stay 5-minute", () => {
		const { container } = renderTime({ value: '12:30' });
		expect(optionValues(sel(container, 'tsel-hour'))).toEqual(HOURS_12);
		expect(optionValues(sel(container, 'tsel-minute'))).toEqual(MINUTES_5);
		const ampm = sel(container, 'tsel-ampm');
		expect(ampm?.tagName).toBe('SELECT');
		expect(optionValues(ampm).filter((v) => v !== '')).toEqual(['AM', 'PM']);
	});

	it("displays the 24h value in 12h terms: '12:30'→12:30 PM, '00:30'→12:30 AM, '19:05'→7:05 PM", () => {
		const noon = renderTime({ value: '12:30' });
		expect(sel(noon.container, 'tsel-hour')!.value).toBe('12');
		expect(sel(noon.container, 'tsel-ampm')!.value).toBe('PM');
		expect(sel(noon.container, 'tsel-minute')!.value).toBe('30');
		cleanup();

		const midnight = renderTime({ value: '00:30' });
		expect(sel(midnight.container, 'tsel-hour')!.value).toBe('12');
		expect(sel(midnight.container, 'tsel-ampm')!.value).toBe('AM');
		cleanup();

		const evening = renderTime({ value: '19:05' });
		expect(sel(evening.container, 'tsel-hour')!.value).toBe('7');
		expect(sel(evening.container, 'tsel-ampm')!.value).toBe('PM');
		expect(sel(evening.container, 'tsel-minute')!.value).toBe('05');
	});

	it("converts to 24h BEFORE emitting: 12:30 PM → '12:30', then AM → '00:30'", async () => {
		const { container, onchange } = renderTime({ value: '' });
		await pick(container, 'tsel-hour', '12');
		await pick(container, 'tsel-minute', '30');
		expect(onchange, 'no emission until AM/PM is picked too').not.toHaveBeenCalled();
		await pick(container, 'tsel-ampm', 'PM');
		expect(onchange).toHaveBeenLastCalledWith('12:30');
		await pick(container, 'tsel-ampm', 'AM');
		expect(onchange).toHaveBeenLastCalledWith('00:30');
	});

	it("7:05 PM → '19:05'", async () => {
		const { container, onchange } = renderTime({ value: '' });
		await pick(container, 'tsel-hour', '7');
		await pick(container, 'tsel-minute', '05');
		await pick(container, 'tsel-ampm', 'PM');
		expect(onchange).toHaveBeenLastCalledWith('19:05');
	});

	// Pick ORDER must not change the outcome. Regression: the meridiem used to
	// be re-derived from the hour, so an AM/PM pick made FIRST had nowhere to
	// live — the select flipped back to 'AM' on the next hour pick and the save
	// landed 12 hours off. (#207 review F1)
	it("AM/PM FIRST, then hour, then minute: PM → 7 → 05 emits '19:05'", async () => {
		const { container, onchange } = renderTime({ value: '' });
		await pick(container, 'tsel-ampm', 'PM');
		expect(sel(container, 'tsel-ampm')!.value, 'the PM pick must stick').toBe('PM');
		await pick(container, 'tsel-hour', '7');
		expect(sel(container, 'tsel-ampm')!.value, 'the hour pick must not reset PM').toBe('PM');
		expect(sel(container, 'tsel-hour')!.value).toBe('7');
		await pick(container, 'tsel-minute', '05');
		expect(onchange).toHaveBeenLastCalledWith('19:05');
	});

	it("the mirror: AM FIRST, then hour, then minute: AM → 7 → 05 emits '07:05'", async () => {
		const { container, onchange } = renderTime({ value: '' });
		await pick(container, 'tsel-ampm', 'AM');
		expect(sel(container, 'tsel-ampm')!.value).toBe('AM');
		await pick(container, 'tsel-hour', '7');
		expect(sel(container, 'tsel-ampm')!.value).toBe('AM');
		await pick(container, 'tsel-minute', '05');
		expect(onchange).toHaveBeenLastCalledWith('07:05');
	});

	it('switching mode PRESERVES the underlying value — display change, never a value change', async () => {
		timeFormatStore.set('24h');
		const { container, onchange } = renderTime({ value: '19:05' });
		expect(sel(container, 'tsel-hour')!.value).toBe('19');

		timeFormatStore.set('ampm');
		await waitFor(() => expect(sel(container, 'tsel-ampm')).not.toBeNull());
		expect(sel(container, 'tsel-hour')!.value).toBe('7');
		expect(sel(container, 'tsel-minute')!.value).toBe('05');
		expect(sel(container, 'tsel-ampm')!.value).toBe('PM');

		timeFormatStore.set('24h');
		await waitFor(() => expect(sel(container, 'tsel-ampm')).toBeNull());
		expect(sel(container, 'tsel-hour')!.value).toBe('19');
		expect(onchange, 'a mode switch must not rewrite the value').not.toHaveBeenCalled();
	});
});

describe('TimeSelect — accessible names (#207, rules 1/2 stay native AND labelled)', () => {
	it('24h mode: hour and minute selects each carry a non-empty accessible name', () => {
		const { container } = renderTime({ value: '07:45' });
		for (const id of ['tsel-hour', 'tsel-minute']) {
			const label = sel(container, id)!.getAttribute('aria-label');
			expect(label?.trim(), `${id} needs a non-empty aria-label`).toBeTruthy();
		}
	});

	it('AM/PM mode: the third select is labelled too', () => {
		timeFormatStore.set('ampm');
		const { container } = renderTime({ value: '19:05' });
		for (const id of ['tsel-hour', 'tsel-minute', 'tsel-ampm']) {
			const label = sel(container, id)!.getAttribute('aria-label');
			expect(label?.trim(), `${id} needs a non-empty aria-label`).toBeTruthy();
		}
	});
});
