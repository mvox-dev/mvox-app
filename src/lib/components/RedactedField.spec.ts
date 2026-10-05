// @vitest-environment happy-dom
// RedactedField is the one way admin-editable PII fields render: the capture-redaction
// marker sits on a wrapper the component owns, so no call site can forget it.

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
		// The wrapper is the component's own element, inside the render container.
		expect(container.contains(wrapper)).toBe(true);
		// And it is not the <input> itself — ::after cannot render there.
		expect(wrapper!.tagName).not.toBe('INPUT');
	});
});

// happy-dom caches a selector result per element; each test reads each selector once,
// in one toggle state, on a fresh render.
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
