// The one re-read of work rows and season repertoire after a repertoire write.
import { refreshEventPageWorkRows } from '$lib/events/eventPageData';
import type { RepertoireItem } from '$lib/repertoire/repertoireData';
import type { WorkRow } from '$lib/repertoire/types';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export interface RefetchWorkRowsOptions {
	includeInactive: boolean;
	/** The caller's stale guard: false once a newer load or context owns the screen. */
	isCurrent: () => boolean;
	onRows: (byEvent: Record<string, WorkRow[]>) => void;
	onFailure?: () => void;
}

export function refetchWorkRows(
	cfg: EntuCfg,
	eventIds: string[],
	seasonId: string | null,
	options: RefetchWorkRowsOptions
): void {
	refreshEventPageWorkRows(cfg, eventIds, seasonId, fetch, {
		includeInactive: options.includeInactive
	})
		.then((byEvent) => {
			if (options.isCurrent()) options.onRows(byEvent);
		})
		.catch(() => {
			if (options.isCurrent()) options.onFailure?.();
		});
}

export function refetchSeasonRepertoire(
	cfg: EntuCfg,
	seasonId: string,
	listRepertoireItems: (cfg: EntuCfg, seasonId: string) => Promise<RepertoireItem[]>,
	isCurrent: () => boolean,
	onItems: (items: RepertoireItem[]) => void
): void {
	listRepertoireItems(cfg, seasonId)
		.then((items) => {
			if (isCurrent()) onItems(items);
		})
		.catch(() => {
		});
}
