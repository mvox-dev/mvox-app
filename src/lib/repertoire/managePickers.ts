// The one read behind the repertoire manage pickers (works, editions, season repertoire).
import { listAllEditions, listWorks, type Edition, type Work } from '$lib/library/libraryData';
import { listRepertoireItems, type RepertoireItem } from '$lib/repertoire/repertoireData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { reportProblem } from '$lib/problems/reportProblem';

export interface ManagePickers {
	libraryWorks: Work[];
	libraryEditions: Edition[];
	libraryWorksPartial: boolean;
	libraryEditionsPartial: boolean;
	seasonRepertoire: RepertoireItem[];
}

export interface ManagePickersRead {
	pickers: ManagePickers;
	// False when any read failed: a list shown empty may then be a failure, not emptiness.
	complete: boolean;
}

const READS = { listWorks, listAllEditions, listRepertoireItems };

export async function readManagePickers(
	cfg: EntuCfg,
	seasonId: string | null,
	reads: typeof READS = READS
): Promise<ManagePickersRead> {
	const [works, editions, repertoire] = await Promise.allSettled([
		reads.listWorks(cfg),
		reads.listAllEditions(cfg),
		seasonId === null ? Promise.resolve<RepertoireItem[]>([]) : reads.listRepertoireItems(cfg, seasonId)
	]);
	let complete = true;
	function settled<T>(result: PromiseSettledResult<T>, action: string): T | null {
		if (result.status === 'fulfilled') return result.value;
		complete = false;
		reportProblem({ area: 'repertoire pickers', action, error: result.reason });
		return null;
	}
	const worksRead = settled(works, 'loading the library works');
	const editionsRead = settled(editions, 'loading the library editions');
	const repertoireItems = settled(repertoire, 'loading the season repertoire');
	return {
		pickers: {
			libraryWorks: worksRead?.items ?? [],
			libraryEditions: editionsRead?.items ?? [],
			libraryWorksPartial: worksRead?.truncated ?? false,
			libraryEditionsPartial: editionsRead?.truncated ?? false,
			seasonRepertoire: repertoireItems ?? []
		},
		complete
	};
}
