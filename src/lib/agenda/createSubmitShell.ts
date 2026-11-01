// The shared create-submit shell: guards the write against a collective switch, then hands over.
import type { Collective } from '$lib/collectives/types';
import { cfgFor } from '$lib/entu/cfg';
import { resolveDbEntityOrLog } from '$lib/collective/resolveDbEntityOrLog';
import { reportProblem } from '$lib/problems/reportProblem';
import { writeOwner } from '$lib/problems/writeOwner';

export type Cfg = ReturnType<typeof cfgFor>;

export interface CreateSubmitShell<T> {
	action: string;
	failed: () => string;
	selected: () => Collective | null;
	setError: (msg: () => string) => void;
	create: (cfg: Cfg, dbEntityId: string) => Promise<T>;
	onCreated: (created: T, cfg: Cfg) => void;
}

export async function runCreateSubmitShell<T>(shell: CreateSubmitShell<T>): Promise<void> {
	const current = shell.selected();
	if (!current) {
		reportProblem({ area: 'agenda', action: shell.action, reason: 'submitted with no selected collective' });
		shell.setError(shell.failed);
		return;
	}
	const cfg = cfgFor(current.db);
	const dbChanged = (): boolean => shell.selected()?.db !== cfg.db;
	const owner = writeOwner(cfg);

	const dbEntityId = await resolveDbEntityOrLog(cfg, { area: 'agenda', action: shell.action });
	if (dbChanged()) return;
	if (!dbEntityId) {
		shell.setError(shell.failed);
		return;
	}

	let created: T;
	try {
		created = await shell.create(cfg, dbEntityId);
	} catch (e) {
		reportProblem({ area: 'agenda', action: shell.action, error: e, owner });
		if (!dbChanged()) shell.setError(shell.failed);
		return;
	}
	if (dbChanged()) return;

	shell.onCreated(created, cfg);
}
