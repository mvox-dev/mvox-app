import { reportProblem } from '$lib/problems/reportProblem';

export type Membership = 'loading' | 'member' | 'non-member';

export function loadMembership(
	lookup: Promise<string | null>,
	isCurrent: () => boolean,
	state: { memberId: string | null; membership: Membership },
	onresolved?: (memberId: string | null) => void
): void {
	lookup
		.then((id) => {
			if (!isCurrent()) return;
			state.memberId = id;
			state.membership = id ? 'member' : 'non-member';
			onresolved?.(id);
		})
		.catch((e) => {
			if (!isCurrent()) return;
			reportProblem({ area: 'rsvp', action: 'finding your member record', error: e });
			state.memberId = null;
			state.membership = 'loading';
		});
}
