// The season-create write: resolve the collective, create the season, then announce and refresh.
import { m } from '$lib/paraglide/messages.js';
import type { Collective } from '$lib/collectives/types';
import { cfgFor } from '$lib/entu/cfg';
import type { createSeason } from '$lib/entity/entityCreate';
import { resolveDbEntityOrLog } from '$lib/collective/resolveDbEntityOrLog';

export interface SeasonCreateRun {
	form: { name: string; startDate: string; endDate: string; conductorIds: string[] };
	selected: () => Collective | null;
	seams: { createSeason: typeof createSeason };
	setError: (msg: () => string) => void;
	setStatus: (text: string) => void;
	onclose: () => void;
	loadForSelected: () => void;
}

export async function runSeasonCreate(run: SeasonCreateRun): Promise<void> {
	const { form } = run;
	const current = run.selected();
	if (!current) {
		console.error('agenda: season create submitted with no selected collective');
		run.setError(m.season_create_failed);
		return;
	}
	const cfg = cfgFor(current.db);
	const dbChanged = (): boolean => run.selected()?.db !== cfg.db;

	const dbEntityId = await resolveDbEntityOrLog(
		cfg,
		{ area: 'agenda', action: 'season create' },
		current.personId
	);
	if (dbChanged()) return;
	if (!dbEntityId) {
		run.setError(m.season_create_failed);
		return;
	}

	try {
		await run.seams.createSeason(cfg, {
			name: form.name,
			dbEntityId,
			startDate: form.startDate,
			endDate: form.endDate,
			conductorRefs: form.conductorIds
		});
	} catch (e) {
		console.error('agenda: season create failed', form.name, e);
		if (!dbChanged()) run.setError(m.season_create_failed);
		return;
	}
	if (dbChanged()) return;

	run.setStatus(m.season_created({ name: form.name }));
	run.onclose();
	run.loadForSelected();
}
