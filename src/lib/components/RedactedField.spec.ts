// @vitest-environment happy-dom
//
// #357 RED — RedactedField: the ONE component through which admin-editable
// PII fields render, carrying the capture-redaction marker BY CONSTRUCTION.
//
// WHY a component and not five attributes: #357's rule is "the marker goes
// on the component, not the call site" — per-call-site marking reproduces
// the seed-188 copy-template failure (three of eight hand-rolled migration
// scripts shipped with NO dry-run guard because each re-derived its own;
// centralizing made the guard mandatory by construction —
// scripts/migrations/lib/script-runner.ts:1-9). Today the roster record
// editor's five PII fields (real name, phone, email, birth date, id_code)
// are five hand-written inline <label>+<input> pairs in
// src/routes/roster/+page.svelte — a future sixth PII field would need a
// sixth hand-added marker. Extracted here, it inherits the marker for free.
//
// CONTRACT (GREEN must implement — src/lib/components/RedactedField.svelte,
// Svelte 5 runes):
//
//   RENDERS the roster record editor's exact field shape, so the five
//   existing call sites migrate with IDENTICAL testids, values, types and
//   classes (page.roster-record-editor.spec.ts and page.roster-real-names
//   .spec.ts stay green BYTE-UNMODIFIED):
//
//     <label class="flex flex-col gap-1 text-xs">
//       {label}
//       <span {REDACT_ATTR} class="relative flex flex-col">
//         <input {type} data-testid={testid} bind:value {disabled} {required}
//           class="rounded-md border border-ink px-2 py-1 text-base
//                  disabled:opacity-50" />
//       </span>
//     </label>
//
//   THE MARKER sits on a WRAPPING element around the input, by construction,
//   imported from $lib/redact/redact — never a hand-typed literal. It wraps
//   rather than marks the <input> itself because the redaction mechanism is
//   a CSS ::after overlay, and pseudo-elements cannot render on replaced
//   elements like <input>.
//
//   DEFAULT-INERT (the load-bearing constraint): without the
//   html[data-redacting] root toggle the marker changes NOTHING about how
//   the value renders. The toggle is set by a human in devtools before a
//   capture; jsdom can't screenshot, so the wiring pinned here is the
//   attribute/selector relationship — the PIXEL claim rides the manual
//   capture checklist in the landing comment.
//
//   PROPS
//     label     the visible field label (an ALREADY-RENDERED message string —
//               the call site passes m.roster_record_*_label(); this
//               component adds NO i18n surface of its own)
//     type      input type: text / tel / email / date
//     testid    landed verbatim as data-testid on the <input>
//     value     $bindable — the call sites bind recordForm fields
//     el        $bindable, optional — the underlying <input> element; the
//               roster email field binds it (emailInputEl) for its
//               checkValidity() gate before save
//     disabled  passthrough to the <input>
//     required  passthrough, default false (only the name field is required)
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import RedactedField from './RedactedField.svelte';
import { REDACT_ATTR, REDACT_TOGGLE_ATTR } from '$lib/redact/redact';

afterEach(() => {
	cleanup();
	document.documentElement.removeAttribute(REDACT_TOGGLE_ATTR);
});

const baseProps = {
	label: 'Phone',
	type: 'tel',
	testid: 'redacted-field-under-test',
	value: '+372 5550000',
	disabled: false
};

function input(container: HTMLElement): HTMLInputElement {
	const el = container.querySelector('[data-testid="redacted-field-under-test"]');
	expect(el, 'the input renders with the given testid, verbatim').not.toBeNull();
	expect(el!.tagName).toBe('INPUT');
	return el as HTMLInputElement;
}

describe('RedactedField — field shape identical to the inline markup it replaces', () => {
	it('renders exactly one <input> with the given testid, type and value', () => {
		const { container } = render(RedactedField, { props: baseProps });
		expect(container.querySelectorAll('input')).toHaveLength(1);
		const el = input(container);
		expect(el.type).toBe('tel');
		expect(el.value).toBe('+372 5550000');
	});

	it('the label text renders inside the <label> that contains the input — name-from-label, never aria-label (#262)', () => {
		const { container } = render(RedactedField, { props: baseProps });
		const el = input(container);
		expect(el.closest('label')!.textContent).toContain('Phone');
		expect(el.getAttribute('aria-label')).toBeNull();
	});

	it('carries the house field classes by construction (text-base: the #130 iOS zoom floor)', () => {
		const { container } = render(RedactedField, { props: baseProps });
		const cls = input(container).className;
		expect(cls).toContain('rounded-md');
		expect(cls).toContain('text-base');
		expect(cls).toContain('disabled:opacity-50');
	});

	it('disabled and required pass through; required defaults to false', () => {
		const { container } = render(RedactedField, {
			props: { ...baseProps, disabled: true, required: true }
		});
		const el = input(container);
		expect(el.disabled).toBe(true);
		expect(el.required).toBe(true);
		cleanup();
		const { container: c2 } = render(RedactedField, { props: baseProps });
		expect(input(c2).required).toBe(false);
	});
});

describe('the marker, by construction — a consumer CANNOT instantiate this field unmarked', () => {
	it(`the input sits inside a wrapping element carrying ${REDACT_ATTR} — on the wrapper, not the replaced <input>`, () => {
		const { container } = render(RedactedField, { props: baseProps });
		const el = input(container);
		const wrapper = el.closest(`[${REDACT_ATTR}]`);
		expect(wrapper, 'marker wrapper must exist around the input').not.toBeNull();
		// The wrapper is the COMPONENT'S OWN element, not something a call
		// site happened to provide: it lives inside the render container.
		expect(container.contains(wrapper)).toBe(true);
		// And it is not the <input> itself — ::after cannot render there.
		expect(wrapper!.tagName).not.toBe('INPUT');
	});
});

// INSTRUMENT NOTE (probed 2026-09-15): happy-dom caches selector evaluations
// per element+selector — a matches()/querySelector() result computed under
// one toggle state is returned STALE after the state flips. So every test
// below evaluates each selector against each element AT MOST ONCE, in a
// single toggle state, on a fresh render; the off-state and on-state are
// pinned in SEPARATE tests, never as a toggle round-trip on one element.
describe('DEFAULT-INERT + toggle wiring (#357: blanking happens only under the human-set root toggle)', () => {
	it('without the root toggle: value renders normally and NO element matches the redaction selector', () => {
		const { container } = render(RedactedField, { props: baseProps });
		expect(input(container).value).toBe('+372 5550000');
		expect(document.documentElement.hasAttribute(REDACT_TOGGLE_ATTR)).toBe(false);
		expect(
			input(container).closest(`[${REDACT_ATTR}]`)!.matches(
				`html[${REDACT_TOGGLE_ATTR}] [${REDACT_ATTR}]`
			)
		).toBe(false);
	});

	it('with data-redacting set on <html>: the wrapper matches the pinned CSS selector — and the DOM value is UNTOUCHED (the overlay is CSS, not a value mutation)', () => {
		document.documentElement.setAttribute(REDACT_TOGGLE_ATTR, '');
		const { container } = render(RedactedField, { props: baseProps });
		const wrapper = input(container).closest(`[${REDACT_ATTR}]`)!;
		expect(wrapper.matches(`html[${REDACT_TOGGLE_ATTR}] [${REDACT_ATTR}]`)).toBe(true);
		// Value mutation would break bind:value round-trips and every
		// existing value assertion; the mechanism is a visual cover only.
		expect(input(container).value).toBe('+372 5550000');
	});
});
