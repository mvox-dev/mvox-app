// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rovingKeydown, type RovingOptions } from './roving';

function group(html: string): HTMLElement {
	const el = document.createElement('div');
	el.innerHTML = html;
	document.body.append(el);
	return el;
}

function press(el: HTMLElement, target: Element, key: string, opts?: RovingOptions): KeyboardEvent {
	const e = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
	el.addEventListener('keydown', (ev) => rovingKeydown(ev as KeyboardEvent, opts), { once: true });
	target.dispatchEvent(e);
	return e;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('rovingKeydown', () => {
	it('moves focus to the next button and prevents the default', () => {
		const el = group('<button id="a">a</button><button id="b">b</button>');
		const a = el.querySelector<HTMLElement>('#a')!;
		a.focus();
		const e = press(el, a, 'ArrowRight');
		expect(document.activeElement?.id).toBe('b');
		expect(e.defaultPrevented).toBe(true);
	});

	it('wraps from the last member to the first', () => {
		const el = group('<button id="a">a</button><button id="b">b</button>');
		const b = el.querySelector<HTMLElement>('#b')!;
		b.focus();
		press(el, b, 'ArrowDown');
		expect(document.activeElement?.id).toBe('a');
	});

	it('ignores keys it does not handle, without preventing the default', () => {
		const el = group('<button id="a">a</button><button id="b">b</button>');
		const a = el.querySelector<HTMLElement>('#a')!;
		a.focus();
		const e = press(el, a, 'Enter');
		expect(document.activeElement?.id).toBe('a');
		expect(e.defaultPrevented).toBe(false);
	});

	it('ignores a target that is not a member', () => {
		const el = group('<button id="a">a</button><span id="s">s</span>');
		const e = press(el, el.querySelector('#s')!, 'ArrowRight');
		expect(e.defaultPrevented).toBe(false);
	});

	it('uses the selector to pick members', () => {
		const el = group(
			'<button id="a">a</button><button id="x" disabled>x</button><button id="b">b</button>'
		);
		const a = el.querySelector<HTMLElement>('#a')!;
		a.focus();
		press(el, a, 'ArrowRight', { selector: 'button:not([disabled])' });
		expect(document.activeElement?.id).toBe('b');
	});

	it('calls beforeFocus with the next member, then focuses it', () => {
		const el = group('<button id="a">a</button><button id="b" data-k="two">b</button>');
		const a = el.querySelector<HTMLElement>('#a')!;
		a.focus();
		const beforeFocus = vi.fn((member: HTMLElement) => {
			expect(document.activeElement?.id).toBe('a');
			return member.dataset.k === 'two';
		});
		press(el, a, 'End', { beforeFocus });
		expect(beforeFocus).toHaveBeenCalledOnce();
		expect(beforeFocus.mock.calls[0][0].id).toBe('b');
		expect(document.activeElement?.id).toBe('b');
	});

	it('keeps focus when beforeFocus returns false, after preventing the default', () => {
		const el = group('<button id="a">a</button><button id="b">b</button>');
		const a = el.querySelector<HTMLElement>('#a')!;
		a.focus();
		const e = press(el, a, 'ArrowRight', { beforeFocus: () => false });
		expect(document.activeElement?.id).toBe('a');
		expect(e.defaultPrevented).toBe(true);
	});
});
