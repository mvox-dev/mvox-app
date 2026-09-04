// src/lib/testing/timeControls.ts
//
// #207 — shared driver for the composite time controls (PO standing rule 5:
// 24h time entry via native <select>s, 5-minute resolution BY CONSTRUCTION).
//
// The three time-bearing surfaces stop being single native inputs and become
// composites under the SAME surface testid (now on a wrapper element):
//
//   <prefix>          the wrapper — keeps the surface's existing testid and,
//                     as a named role="group", the accessible name the old
//                     input's aria-label carried. The aria-invalid /
//                     aria-describedby wiring lives on the CONTROLS below, not
//                     here: aria-invalid is only honoured on form controls and
//                     aria-describedby is only announced on the focused
//                     element (#207 review F2).
//   <prefix>-date     native <input type="date"> (datetime surfaces only —
//                     native date pickers stay, Gama ruling 2026-09-02)
//   <prefix>-hour     native <select>, 24h mode options '00'..'23'
//   <prefix>-minute   native <select>, options '00','05',…,'55' (a legacy
//                     minute like '03' is inserted as an extra option so an
//                     existing value renders without silently snapping)
//   <prefix>-ampm     native <select> 'AM'/'PM' — AM/PM mode only
//
// Prefixes in use: series-create-time, event-create-datetime,
// event-edit-input-start_datetime, event-create-end (#243 — the create form's
// end pair), event-edit-input-duration_minutes (#243 — the detail page's end
// composite: the FIELD keeps its duration_minutes identity, only its editor
// became an end date+time).
//
// These helpers are the ONE migration seam for the ~45 old `fill()` /
// `beginEdit()` call sites — specs drive the composite through them instead of
// hand-editing each site (task pin). They assume 24h mode, the store default
// and the mode every migrated suite runs in.
import { fireEvent } from '@testing-library/svelte';

/** '00'..'23' — the exact hour option list rule 5 pins for 24h mode. */
export const HOURS_24: string[] = Array.from({ length: 24 }, (_, i) =>
	String(i).padStart(2, '0')
);

/** '00','05',…,'55' — 5-minute resolution by construction (the step=300 addendum). */
export const MINUTES_5: string[] = Array.from({ length: 12 }, (_, i) =>
	String(i * 5).padStart(2, '0')
);

/** All option values of a <select>, in DOM order. */
export function optionValues(select: Element | null): string[] {
	if (!select) return [];
	return [...select.querySelectorAll('option')].map((o) => (o as HTMLOptionElement).value);
}

function part(container: HTMLElement, testid: string): HTMLElement {
	const el = container.querySelector(`[data-testid="${testid}"]`);
	if (!el) throw new Error(`timeControls: [data-testid="${testid}"] not found`);
	return el as HTMLElement;
}

/** Set 'HH:MM' on a TimeSelect composite (24h mode). */
export async function fillTime(
	container: HTMLElement,
	prefix: string,
	value: string
): Promise<void> {
	const [hour, minute] = value.split(':');
	await fireEvent.change(part(container, `${prefix}-hour`), { target: { value: hour } });
	await fireEvent.change(part(container, `${prefix}-minute`), { target: { value: minute } });
}

/** Set date + time on a datetime composite (native date input + TimeSelect). */
export async function fillDateTime(
	container: HTMLElement,
	prefix: string,
	date: string,
	time: string
): Promise<void> {
	await fireEvent.input(part(container, `${prefix}-date`), { target: { value: date } });
	await fillTime(container, prefix, time);
}

/**
 * Read the composite back as the canonical 'YYYY-MM-DDTHH:MM' string — or ''
 * while ANY part is missing (the partial-state pin: a half-filled composite
 * must never surface a malformed datetime).
 */
export function readDateTime(container: HTMLElement, prefix: string): string {
	const date = (part(container, `${prefix}-date`) as HTMLInputElement).value;
	const hour = (part(container, `${prefix}-hour`) as HTMLSelectElement).value;
	const minute = (part(container, `${prefix}-minute`) as HTMLSelectElement).value;
	if (!date || !hour || !minute) return '';
	return `${date}T${hour}:${minute}`;
}

/**
 * Commit an in-situ composite edit: focus leaves the WHOLE group (focusout
 * with no relatedTarget). Replaces the old single-input `fireEvent.blur` —
 * blur moving BETWEEN the composite's own parts must NOT commit.
 */
export async function commitDateTime(container: HTMLElement, prefix: string): Promise<void> {
	await fireEvent.focusOut(part(container, prefix));
}
