// Which of a person's files are on this device; the last query issued wins.
import type { CollectiveIdentity } from '$lib/collectives/store';
import { getAppByteStore } from '$lib/files/appByteStore';
import { reportProblem } from '$lib/problems/reportProblem';

export type PresenceRefresh = (identity: CollectiveIdentity, isCurrent: () => boolean) => void;

export function createPresenceRefresh(area: string, onIds: (ids: Set<string>) => void): PresenceRefresh {
	let seq = 0;
	return (identity, isCurrent) => {
		const mine = ++seq;
		const live = () => mine === seq && isCurrent();
		const failed = (error: unknown) => {
			if (live()) reportProblem({ area, action: 'reading which files are on this device', error });
		};
		try {
			getAppByteStore()
				.heldFileIds(identity)
				.then((ids) => {
					if (live()) onIds(new Set(ids));
				})
				.catch(failed);
		} catch (e) {
			failed(e);
		}
	};
}

// (*MVOX:Josquin*)
