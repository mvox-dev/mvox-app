// The season-create write: create the season under the shared shell, then announce and refresh.
import { m } from '$lib/paraglide/messages.js';
import type { Collective } from '$lib/collectives/types';
import type { createSeason } from '$lib/entity/entityCreate';
import { runCreateSubmitShell } from '$lib/agenda/createSubmitShell';

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
	await runCreateSubmitShell({
		action: 'season create',
		failed: m.season_create_failed,
		selected: run.selected,
		setError: run.setError,
		logArgs: [form.name],
		create: (cfg, dbEntityId) =>
			run.seams.createSeason(cfg, {
				name: form.name,
				dbEntityId,
				startDate: form.startDate,
				endDate: form.endDate,
				conductorRefs: form.conductorIds
			}),
		onCreated: () => {
			run.setStatus(m.season_created({ name: form.name }));
			run.onclose();
			run.loadForSelected();
		}
	});
}
