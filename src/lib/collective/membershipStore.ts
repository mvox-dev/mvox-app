// Active member, archived, or none (#255)? A failed read is 'loading', never a claim.
import { writable, type Writable } from 'svelte/store';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { isTruncated } from '$lib/entu/listRead';
import { reportProblem } from '$lib/problems/reportProblem';

export type MembershipState = 'loading' | 'active' | 'inactive' | 'non-member';

export const membershipStore: Writable<MembershipState> = writable('loading');

export function resetMembership(): void {
	membershipStore.set('loading');
}

// Unscoped by status, unlike findMyMemberId, so archived and never-a-member differ.
export async function resolveMembership(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<MembershipState> {
	try {
		const res = await entuFetch(
			cfg.db,
			`entity?_type.string=member&person.reference=${encodeURIComponent(personId)}&props=status&limit=50`,
			cfg.token,
			{},
			fetchImpl
		);
		if (!res.ok) {
			reportProblem({ area: 'membership', action: 'reading your membership', error: new Error(`HTTP ${res.status}`) });
			return 'loading';
		}
		const body = (await res.json()) as {
			count?: number;
			entities?: Array<{ status?: Array<{ string?: string }> }>;
		};
		const entities = body.entities ?? [];
		const statuses = entities.map((e) => e.status?.[0]?.string);
		if (statuses.some((s) => s === 'active')) return 'active';
		// A partial page or an unreadable status proves nothing about the rest (#321).
		if (isTruncated(entities.length, body.count)) return 'loading';
		if (entities.length === 0) return 'non-member';
		if (statuses.some((s) => s === undefined)) return 'loading';
		return 'inactive';
	} catch (e) {
		reportProblem({ area: 'membership', action: 'reading your membership', error: e });
		return 'loading';
	}
}

// (*MVOX:Josquin*)
