// src/lib/profile/autosave.spec.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from './autosave';
import type { FieldKey } from './fieldMove';

describe('createAutosave', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('fires onSave after idleMs of no keystrokes', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.keystroke('name');
		vi.advanceTimersByTime(119_999);
		expect(onSave).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onSave).toHaveBeenCalledWith('name');
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it('resets the idle timer on each keystroke', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.keystroke('name');
		vi.advanceTimersByTime(60_000);
		ctrl.keystroke('name');
		vi.advanceTimersByTime(60_000);
		expect(onSave).not.toHaveBeenCalled();
		vi.advanceTimersByTime(60_000);
		expect(onSave).toHaveBeenCalledWith('name');
	});

	it('blur fires onSave immediately and clears the idle timer (no double-fire)', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.keystroke('email');
		vi.advanceTimersByTime(30_000);
		ctrl.blur('email');
		expect(onSave).toHaveBeenCalledWith('email');
		expect(onSave).toHaveBeenCalledTimes(1);

		// The idle timer was cleared — advancing past idleMs must NOT double-fire.
		vi.advanceTimersByTime(120_000);
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it('visibilityChange fires onSave immediately and clears the idle timer', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.keystroke('name');
		vi.advanceTimersByTime(10_000);
		ctrl.visibilityChange('name');
		expect(onSave).toHaveBeenCalledWith('name');
		expect(onSave).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(120_000);
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it('destroy clears all timers', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.keystroke('name');
		ctrl.keystroke('email');
		ctrl.destroy();
		vi.advanceTimersByTime(200_000);
		expect(onSave).not.toHaveBeenCalled();
	});

	it('manages multiple fields independently', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.keystroke('name');
		vi.advanceTimersByTime(60_000);
		ctrl.keystroke('email');
		vi.advanceTimersByTime(60_000);

		// name's 120_000ms elapsed — fires
		expect(onSave).toHaveBeenCalledWith('name');
		expect(onSave).toHaveBeenCalledTimes(1);

		// email has 60_000ms remaining
		vi.advanceTimersByTime(60_000);
		expect(onSave).toHaveBeenCalledWith('email');
		expect(onSave).toHaveBeenCalledTimes(2);
	});

	it('blur without a prior keystroke still fires onSave (tab-through)', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.blur('name');
		expect(onSave).toHaveBeenCalledWith('name');
	});

	it('visibilityChange without a prior keystroke still fires onSave', () => {
		const onSave = vi.fn();
		const ctrl = createAutosave({ idleMs: 120_000, onSave });

		ctrl.visibilityChange('email');
		expect(onSave).toHaveBeenCalledWith('email');
	});
});
