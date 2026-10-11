// The shared create-submit shell: guards the write against a collective switch, then hands over.
import type { Collective } from '$lib/collectives/types';
import { cfgFor } from '$lib/entu/cfg';
import { resolveDbEntityOrLog } from '$lib/collective/resolveDbEntityOrLog';

export type Cfg = ReturnType<typeof cfgFor>;

export interface CreateSubmitShell<T> {
	action: string;
	failed: () => string;
	selected: () => Collective | null;
	setError: (msg: () => string) => void;
	logArgs?: unknown[];
	create: (cfg: Cfg, dbEntityId: string) => Promise<T>;
	onCreated: (created: T, cfg: Cfg) => void;
}

export async function runCreateSubmitShell<T>(shell: CreateSubmitShell<T>): Promise<void> {
	const current = shell.selected();
	if (!current) {
		console.error(`agenda: ${shell.action} submitted with no selected collective`);
		shell.setError(shell.failed);
		return;
	}
	const cfg = cfgFor(current.db);
	const dbChanged = (): boolean => shell.selected()?.db !== cfg.db;

	const dbEntityId = await resolveDbEntityOrLog(
		cfg,
		{ area: 'agenda', action: shell.action },
		current.personId
	);
	if (dbChanged()) return;
	if (!dbEntityId) {
		shell.setError(shell.failed);
		return;
	}

	let created: T;
	try {
		created = await shell.create(cfg, dbEntityId);
	} catch (e) {
		console.error(`agenda: ${shell.action} failed`, ...(shell.logArgs ?? []), e);
		if (!dbChanged()) shell.setError(shell.failed);
		return;
	}
	if (dbChanged()) return;

	shell.onCreated(created, cfg);
}
