// The event-create write: resolve the collective, create the event, then announce and refresh.
import { m } from '$lib/paraglide/messages.js';
import type { Collective } from '$lib/collectives/types';
import { cfgFor } from '$lib/entu/cfg';
import type { createEvent, CreateEventInput } from '$lib/entity/entityCreate';
import { resolveDbEntityOrLog } from '$lib/collective/resolveDbEntityOrLog';

type Cfg = ReturnType<typeof cfgFor>;

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
	showableUnderFilter: boolean;
	when: string;
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
	const current = run.selected();
	if (!current) {
		console.error('agenda: event create submitted with no selected collective');
		run.setError(m.event_create_failed);
		return;
	}
	const cfg = cfgFor(current.db);
	const runDb = cfg.db;
	const dbChanged = (): boolean => run.selected()?.db !== runDb;

	const dbEntityId = await resolveDbEntityOrLog(
		cfg,
		{ area: 'agenda', action: 'event create' },
		current.personId
	);
	if (dbChanged()) return;
	if (!dbEntityId) {
		run.setError(m.event_create_failed);
		return;
	}

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

	let newEventId: string;
	try {
		newEventId = await seams.createEvent(cfg, input);
	} catch (e) {
		console.error('agenda: event create failed', e);
		if (!dbChanged()) run.setError(m.event_create_failed);
		return;
	}
	if (dbChanged()) return;

	const panel = run.isMounted();
	const createdName = form.name || form.seriesName() || form.type;
	run.setStatus(
		run.showableUnderFilter
			? m.event_created({ name: createdName, when: run.when })
			: m.event_created_hidden_by_filter({ name: createdName, when: run.when })
	);
	run.onclose();
	run.loadForSelected({ keepSeasonManage: panel });
	if (panel && run.panelSeasonId === form.seasonId) {
		run.refreshSeasonManageLists(cfg, run.panelSeasonId);
	}
	if (panel && run.showableUnderFilter) run.surfaceCreatedEvent(newEventId);
	if (panel) run.restoreFocus();
}
