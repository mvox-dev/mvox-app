// src/lib/profile/autosave.ts
import type { FieldKey } from './fieldMove';

interface AutosaveConfig {
	idleMs: number;
	onSave: (field: FieldKey) => void;
}

interface AutosaveController {
	keystroke(field: FieldKey): void;
	blur(field: FieldKey): void;
	visibilityChange(field: FieldKey): void;
	/** #205 — Escape-cancels-edit: drop a field's pending idle timer WITHOUT firing onSave. */
	cancel(field: FieldKey): void;
	destroy(): void;
}

export function createAutosave(config: AutosaveConfig): AutosaveController {
	const timers = new Map<FieldKey, ReturnType<typeof setTimeout>>();

	function clearTimer(field: FieldKey): void {
		const id = timers.get(field);
		if (id !== undefined) {
			clearTimeout(id);
			timers.delete(field);
		}
	}

	function fireAndClear(field: FieldKey): void {
		clearTimer(field);
		config.onSave(field);
	}

	return {
		keystroke(field) {
			clearTimer(field);
			timers.set(
				field,
				setTimeout(() => {
					timers.delete(field);
					config.onSave(field);
				}, config.idleMs)
			);
		},
		blur(field) {
			fireAndClear(field);
		},
		visibilityChange(field) {
			fireAndClear(field);
		},
		cancel(field) {
			clearTimer(field);
		},
		destroy() {
			for (const id of timers.values()) clearTimeout(id);
			timers.clear();
		}
	};
}
