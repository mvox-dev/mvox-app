// The series-create submit: validate the form, create the series, then its events one by one.
import { m } from '$lib/paraglide/messages.js';
import type { Collective } from '$lib/collectives/types';
import { cfgFor } from '$lib/entu/cfg';
import type { CreateEventSeriesInput, createEvent, createEventSeries } from '$lib/entity/entityCreate';
import type { RepeatPattern } from '$lib/events/recurrence';
import { resolveDbEntityOrLog } from '$lib/collective/resolveDbEntityOrLog';
import { tallinnLocalToUtcIso } from '$lib/preferences/timeFormat';
import type {
	SeriesCreateErrorField,
	SeriesCreateFormSnapshot,
	SeriesResumeEntry
} from '$lib/agenda/seriesCreateResume';
import { seriesCreateIsoDay } from '$lib/agenda/seriesCreateDateGrid.svelte';

type Cfg = ReturnType<typeof cfgFor>;

export interface SeriesCreateRun {
	form: SeriesCreateFormSnapshot;
	dayApplies: boolean;
	resume: SeriesResumeEntry | null;
	datesFor: (skipDates: string[]) => string[];
	selected: () => Collective | null;
	manageableSeasonId: string | null;
	seams: { createEventSeries: typeof createEventSeries; createEvent: typeof createEvent };
	setError: (msg: () => string, field: SeriesCreateErrorField) => void;
	setProgress: (progress: { current: number; total: number } | null) => void;
	setRunning: (runDb: string | null) => void;
	recordResume: (db: string, entry: SeriesResumeEntry) => void;
	clearResume: (db: string) => void;
	onclose: () => void;
	loadForSelected: (opts?: { keepSeasonManage?: boolean }) => void;
	refreshSeasonManageLists: (cfg: Cfg, seasonId: string) => void;
	restoreFocus: () => void;
}

const INTERVAL_DAYS: Record<RepeatPattern, number> = { daily: 1, weekly: 7, biweekly: 14 };

function firstMissing(
	form: SeriesCreateFormSnapshot,
	dayApplies: boolean
): { msg: () => string; field: SeriesCreateErrorField } | null {
	if (!form.name.trim()) return { msg: m.series_create_name_required, field: 'name' };
	if (!form.type.trim()) return { msg: m.series_create_type_required, field: 'type' };
	if (!form.time) return { msg: m.series_create_time_required, field: 'time' };
	if (!form.duration.trim() || !Number.isFinite(Number(form.duration))) {
		return { msg: m.series_create_duration_required, field: 'duration' };
	}
	if (!form.from) return { msg: m.series_create_from_required, field: 'from' };
	if (!form.until) return { msg: m.series_create_until_required, field: 'until' };
	if (form.until < form.from) return { msg: m.series_create_until_before_from, field: 'until' };
	if (dayApplies && form.day === '') return { msg: m.series_create_day_required, field: 'day' };
	return null;
}

export async function runSeriesCreate(run: SeriesCreateRun): Promise<void> {
	const { form, resume, seams } = run;
	const missing = firstMissing(form, run.dayApplies);
	if (missing) {
		run.setError(missing.msg, missing.field);
		return;
	}
	const seasonId = form.seasonId;
	const name = form.name.trim();
	const typeValue = form.type.trim();
	const time = form.time;
	const durationValue = Number(form.duration);

	const dates: string[] = resume?.remaining ?? run.datesFor(form.skipDates);
	if (dates.length === 0) {
		run.setError(m.series_create_no_dates, null);
		return;
	}
	const total = resume?.total ?? dates.length;

	const current = run.selected();
	if (!current || !seasonId) {
		console.error('agenda: series create submitted with no selected collective/season');
		run.setError(m.series_create_failed, null);
		return;
	}
	const cfg = cfgFor(current.db);
	const panelSeasonId = run.manageableSeasonId;
	const runDb = cfg.db;
	const dbChanged = (): boolean => run.selected()?.db !== runDb;
	const runForm: SeriesCreateFormSnapshot = resume?.form ?? {
		...form,
		name,
		type: typeValue,
		skipDates: [...form.skipDates]
	};
	const recordStop = (seriesId: string, index: number): void => {
		run.recordResume(runDb, { seriesId, remaining: dates.slice(index), total, form: runForm });
	};

	run.setRunning(runDb);
	try {
		const dbEntityId = await resolveDbEntityOrLog(
			cfg,
			{ area: 'agenda', action: 'series create' },
			current.personId
		);
		if (!dbEntityId) {
			if (!dbChanged()) run.setError(m.series_create_failed, null);
			return;
		}
		if (dbChanged()) return;

		const trimmedLocation = form.location.trim();
		const trimmedDescription = form.description.trim();
		const seriesInput: CreateEventSeriesInput = {
			name,
			dbEntityId,
			extraParentIds: [seasonId],
			eventType: typeValue,
			intervalDays: INTERVAL_DAYS[form.repeat],
			startTime: time,
			durationMinutes: durationValue,
			startDate: seriesCreateIsoDay(dates[0]),
			endDate: seriesCreateIsoDay(dates[dates.length - 1]),
			...(trimmedLocation ? { defaultLocation: trimmedLocation } : {}),
			...(trimmedDescription ? { defaultDescription: trimmedDescription } : {})
		};

		let seriesId: string;
		if (resume) {
			seriesId = resume.seriesId;
		} else {
			try {
				seriesId = await seams.createEventSeries(cfg, seriesInput);
			} catch (e) {
				console.error('agenda: series create failed', e);
				if (!dbChanged()) run.setError(m.series_create_failed, null);
				return;
			}
		}
		if (dbChanged()) {
			recordStop(seriesId, 0);
			return;
		}

		let created = total - dates.length;
		for (let i = 0; i < dates.length; i += 1) {
			if (dbChanged()) {
				recordStop(seriesId, i);
				break;
			}
			run.setProgress({ current: created + 1, total });
			try {
				await seams.createEvent(cfg, {
					dbEntityId,
					seriesId,
					extraParentIds: [seasonId],
					eventType: typeValue,
					startDatetime: tallinnLocalToUtcIso(dates[i])
				});
				created += 1;
			} catch (e) {
				if (dbChanged()) {
					recordStop(seriesId, i);
					return;
				}
				console.error('agenda: bulk event create failed', e);
				run.setProgress(null);
				recordStop(seriesId, i);
				run.setError(() => m.series_create_bulk_failed({ created, total }), null);
				run.loadForSelected({ keepSeasonManage: true });
				if (panelSeasonId === seasonId) run.refreshSeasonManageLists(cfg, seasonId);
				return;
			}
		}
		if (dbChanged()) {
			if (created >= total) run.clearResume(runDb);
			return;
		}
		run.setProgress(null);
		run.clearResume(runDb);
		run.onclose();
		run.loadForSelected({ keepSeasonManage: true });
		if (panelSeasonId === seasonId) run.refreshSeasonManageLists(cfg, seasonId);
		run.restoreFocus();
	} finally {
		run.setRunning(null);
	}
}
