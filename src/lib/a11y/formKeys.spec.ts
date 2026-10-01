// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { formKeydown } from './formKeys';

function formWith(html: string) {
	const actions = { close: vi.fn(), submit: vi.fn() };
	const form = document.createElement('div');
	form.innerHTML = html;
	form.addEventListener('keydown', (event) => formKeydown(event, actions));
	document.body.append(form);
	return { form, actions };
}

function press(target: Element, key: string): KeyboardEvent {
	const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
	target.dispatchEvent(event);
	return event;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('formKeydown on the form wrapper', () => {
	it('Escape from any control closes and prevents the default', () => {
		const { form, actions } = formWith('<input type="text"><textarea></textarea><button>x</button>');
		for (const control of [...form.children, form]) {
			expect(press(control, 'Escape').defaultPrevented).toBe(true);
		}
		expect(actions.close).toHaveBeenCalledTimes(4);
		expect(actions.submit).not.toHaveBeenCalled();
	});

	it('Enter from a single-line input submits and prevents the default', () => {
		const { form, actions } = formWith(
			'<input type="text"><input type="date"><input type="number"><input>'
		);
		for (const input of form.children) {
			expect(press(input, 'Enter').defaultPrevented).toBe(true);
		}
		expect(actions.submit).toHaveBeenCalledTimes(4);
		expect(actions.close).not.toHaveBeenCalled();
	});

	it('Enter from a textarea, select, button or checkbox keeps its own behaviour', () => {
		const { form, actions } = formWith(
			'<textarea></textarea><select><option>a</option></select><button>x</button>' +
				'<input type="checkbox"><input type="button">'
		);
		for (const control of [...form.children, form]) {
			expect(press(control, 'Enter').defaultPrevented).toBe(false);
		}
		expect(actions.submit).not.toHaveBeenCalled();
		expect(actions.close).not.toHaveBeenCalled();
	});

	it('leaves other keys alone', () => {
		const { form, actions } = formWith('<input type="text">');
		for (const k of ['a', 'Tab', ' ']) {
			expect(press(form.children[0], k).defaultPrevented).toBe(false);
		}
		expect(actions.submit).not.toHaveBeenCalled();
		expect(actions.close).not.toHaveBeenCalled();
	});
});
