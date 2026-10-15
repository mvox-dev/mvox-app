// The event page's picker read behind a gate a spec can hold: the window a reload opens.
export const pickerGate = { armed: false, waiting: [] as Array<() => void> };

export async function managePickersGatedModule(importOriginal: () => Promise<unknown>) {
	const real = (await importOriginal()) as typeof import('$lib/repertoire/managePickers');
	return {
		...real,
		readManagePickers: async (...a: Parameters<typeof real.readManagePickers>) => {
			if (pickerGate.armed) await new Promise<void>((go) => pickerGate.waiting.push(go));
			return real.readManagePickers(...a);
		}
	};
}

// (*MVOX:Josquin*)
