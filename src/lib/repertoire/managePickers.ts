// The one read behind the repertoire manage pickers (works, editions, season repertoire).
import { listAllEditions, listWorks, type Edition, type Work } from '$lib/library/libraryData';
import { listRepertoireItems, type RepertoireItem } from '$lib/repertoire/repertoireData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export interface ManagePickers {
	libraryWorks: Work[];
	libraryEditions: Edition[];
	libraryWorksPartial: boolean;
	libraryEditionsPartial: boolean;
	seasonRepertoire: RepertoireItem[];
}

export const NO_MANAGE_PICKERS: ManagePickers = {
	libraryWorks: [],
	libraryEditions: [],
	libraryWorksPartial: false,
	libraryEditionsPartial: false,
	seasonRepertoire: []
};

const READS = { listWorks, listAllEditions, listRepertoireItems };

export async function readManagePickers(
	cfg: EntuCfg,
	seasonId: string | null,
	reads: typeof READS = READS
): Promise<ManagePickers> {
	const [worksRead, editionsRead, repertoire] = await Promise.all([
		reads.listWorks(cfg),
		reads.listAllEditions(cfg),
		seasonId === null ? Promise.resolve<RepertoireItem[]>([]) : reads.listRepertoireItems(cfg, seasonId)
	]);
	return {
		libraryWorks: worksRead.items,
		libraryEditions: editionsRead.items,
		libraryWorksPartial: worksRead.truncated,
		libraryEditionsPartial: editionsRead.truncated,
		seasonRepertoire: repertoire
	};
}
