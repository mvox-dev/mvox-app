// The event-create write: create the event under the shared shell, then announce and refresh.
import { m } from '$lib/paraglide/messages.js';
import type { Collective } from '$lib/collectives/types';
import type { createEvent, CreateEventInput } from '$lib/entity/entityCreate';
import { runCreateSubmitShell, type Cfg } from '$lib/agenda/createSubmitShell';

export interface EventCreateRun {
	form: {
		seasonId: string;
		type: string;
		startDatetime: string;
		durationMinutes: number | undefined;
		name: string;
		seriesId: string;
		seriesName: () => string | undefined;
		location: string;
		description: string;
		capacity: number | undefined;
		conductorIds: string[];
	};
	panelSeasonId: string | null;
	selected: () => Collective | null;
	isMounted: () => boolean;
	showableUnderFilter: () => boolean;
	when: () => string;
	seams: { createEvent: typeof createEvent };
	setError: (msg: () => string) => void;
	setStatus: (text: string) => void;
	onclose: () => void;
	loadForSelected: (opts?: { keepSeasonManage?: boolean }) => void;
	refreshSeasonManageLists: (cfg: Cfg, seasonId: string) => void;
	surfaceCreatedEvent: (eventId: string) => void;
	restoreFocus: () => void;
}

export async function runEventCreate(run: EventCreateRun): Promise<void> {
	const { form, seams } = run;
	await runCreateSubmitShell({
		action: 'event create',
		failed: m.event_create_failed,
		selected: run.selected,
		setError: run.setError,
		create: (cfg, dbEntityId) => {
			const input: CreateEventInput = {
				dbEntityId,
				extraParentIds: [form.seasonId],
				eventType: form.type,
				startDatetime: form.startDatetime,
				...(form.name ? { name: form.name } : {}),
				...(form.seriesId ? { seriesId: form.seriesId } : {}),
				...(form.durationMinutes !== undefined ? { durationMinutes: form.durationMinutes } : {}),
				...(form.location ? { location: form.location } : {}),
				...(form.description ? { description: form.description } : {}),
				...(form.conductorIds.length > 0 ? { conductorRefs: form.conductorIds } : {}),
				...(form.capacity !== undefined ? { capacity: form.capacity } : {})
			};
			return seams.createEvent(cfg, input);
		},
		onCreated: (newEventId, cfg) => {
			const panel = run.isMounted();
			const when = run.when();
			const showable = run.showableUnderFilter();
			const createdName = form.name || form.seriesName() || form.type;
			run.setStatus(
				showable
					? m.event_created({ name: createdName, when })
					: m.event_created_hidden_by_filter({ name: createdName, when })
			);
			run.onclose();
			run.loadForSelected({ keepSeasonManage: panel });
			if (panel && run.panelSeasonId === form.seasonId) {
				run.refreshSeasonManageLists(cfg, run.panelSeasonId);
			}
			if (panel && showable) run.surfaceCreatedEvent(newEventId);
			if (panel) run.restoreFocus();
		}
	});
}
