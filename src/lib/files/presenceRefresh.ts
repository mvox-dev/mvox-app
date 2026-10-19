// Which of a person's files are on this device; the last query issued wins.
import type { CollectiveIdentity } from '$lib/collectives/store';
import { getAppByteStore } from '$lib/files/appByteStore';
import { createLatest } from '$lib/async/latest';
import { reportProblem } from '$lib/problems/reportProblem';

export type PresenceRefresh = (identity: CollectiveIdentity, isCurrent: () => boolean) => void;

export function createPresenceRefresh(area: string, onIds: (ids: Set<string>) => void): PresenceRefresh {
	const latest = createLatest();
	return (identity, isCurrent) => {
		const isLatest = latest.next();
		const live = () => isLatest() && isCurrent();
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
