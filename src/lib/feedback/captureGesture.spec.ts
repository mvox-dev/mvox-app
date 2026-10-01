// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenForDoubleTap } from './captureGesture';

function tap(target: Element, x = 10, y = 10): void {
	const init = { bubbles: true, isPrimary: true, button: 0, clientX: x, clientY: y };
	target.dispatchEvent(new PointerEvent('pointerdown', init));
	target.dispatchEvent(new PointerEvent('pointerup', init));
}

let stop: (() => void) | undefined;
afterEach(() => {
	stop?.();
	document.body.innerHTML = '';
});

function setup(html: string, now?: () => number) {
	document.body.innerHTML = html;
	const onDoubleTap = vi.fn();
	stop = listenForDoubleTap(document, onDoubleTap, now);
	return onDoubleTap;
}

describe('listenForDoubleTap', () => {
	it('fires once on two quick taps on plain text', () => {
		const onDoubleTap = setup('<p id="t">Some plain text</p>');
		const p = document.getElementById('t')!;
		tap(p);
		expect(onDoubleTap).not.toHaveBeenCalled();
		tap(p);
		expect(onDoubleTap).toHaveBeenCalledTimes(1);
		tap(p);
		expect(onDoubleTap).toHaveBeenCalledTimes(1);
	});

	it('clears the word selection the double click made', () => {
		const onDoubleTap = setup('<p id="t">Some plain text</p>');
		const p = document.getElementById('t')!;
		const range = document.createRange();
		range.selectNodeContents(p);
		window.getSelection()!.addRange(range);
		tap(p);
		tap(p);
		expect(onDoubleTap).toHaveBeenCalledTimes(1);
		expect(window.getSelection()!.rangeCount).toBe(0);
	});

	it.each([
		['an input', '<input id="t" />'],
		['a textarea', '<textarea id="t"></textarea>'],
		['a select', '<select id="t"><option>a</option></select>'],
		['editable text', '<div contenteditable="true"><b id="t">x</b></div>'],
		['a button', '<button><span id="t">ok</span></button>'],
		['a link', '<a href="/x"><span id="t">x</span></a>'],
		['the part viewer', '<div data-testid="part-viewer-root"><canvas id="t"></canvas></div>'],
		['the drawing surface', '<svg data-testid="stroke-surface"><path id="t" /></svg>']
	])('does not fire on %s', (_name, html) => {
		const onDoubleTap = setup(html);
		const target = document.getElementById('t')!;
		tap(target);
		tap(target);
		expect(onDoubleTap).not.toHaveBeenCalled();
	});

	it('does not fire on taps too far apart in time or space', () => {
		let t = 0;
		const onDoubleTap = setup('<p id="t">text</p>', () => t);
		const p = document.getElementById('t')!;
		tap(p);
		t = 1000;
		tap(p);
		tap(p, 200, 200);
		expect(onDoubleTap).not.toHaveBeenCalled();
	});

	it('stops listening once stopped', () => {
		const onDoubleTap = setup('<p id="t">text</p>');
		stop!();
		const p = document.getElementById('t')!;
		tap(p);
		tap(p);
		expect(onDoubleTap).not.toHaveBeenCalled();
	});
});
