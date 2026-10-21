<!-- The season attendance card at the top of /profile (#920), for members of the collective. -->
<script lang="ts">
	import { reportProblem } from '$lib/problems/reportProblem';
	import SeasonSummary from '$lib/components/attendance/SeasonSummary.svelte';
	import { completionGateStore } from '$lib/profile/completionGate';
	import type { MemberAttendanceRate } from '$lib/attendance/attendanceSummary';
	import {
		loadSeasonAttendance,
		loadSeasonMemberRates,
		type SeasonAttendance
	} from '$lib/profile/seasonAttendance';
	import type { EntuCfg } from '$lib/entu/cfg';

	let { generation }: { generation: () => number } = $props();

	let card = $state<SeasonAttendance | null>(null);
	let cfg: EntuCfg | null = null;
	let expanded = $state(false);
	let rates = $state<MemberAttendanceRate[]>([]);
	let ratesLoaded = false;
	let ratesLoading = $state(false);
	let ratesError = $state(false);
	let ratesPartial = $state(false);

	export function reset(): void {
		card = null;
		cfg = null;
		expanded = false;
		rates = [];
		ratesLoaded = false;
		ratesLoading = false;
		ratesError = false;
		ratesPartial = false;
	}

	export async function load(
		c: EntuCfg,
		personId: string,
		g: number,
		dbEntityId: Promise<string | null>
	): Promise<void> {
		try {
			const read = await loadSeasonAttendance(c, personId, dbEntityId);
			if (g !== generation()) return;
			cfg = c;
			card = read;
		} catch (e) {
			if (g !== generation()) return;
			reportProblem({ area: 'profile', action: 'loading the season attendance', error: e });
		}
	}

	function onexpand(): void {
		expanded = !expanded;
		if (!expanded || ratesLoaded || !cfg || !card) return;
		const g = generation();
		ratesLoading = true;
		ratesError = false;
		loadSeasonMemberRates(cfg, card.events)
			.then((read) => {
				if (g !== generation()) return;
				rates = read.rates;
				ratesPartial = read.partial;
				ratesLoaded = true;
				ratesLoading = false;
			})
			.catch((e) => {
				if (g !== generation()) return;
				reportProblem({ area: 'profile', action: 'loading the season attendance rates', error: e });
				rates = [];
				ratesPartial = false;
				ratesLoading = false;
				ratesError = true;
			});
	}
</script>

<!-- As on the agenda: a member sees it once the profile-completion check passes. -->
{#if card && $completionGateStore === 'complete'}
	<SeasonSummary
		myRate={card.myRate}
		canExpand={card.canExpand}
		{expanded}
		memberRates={rates}
		membersPartial={ratesPartial}
		loading={ratesLoading}
		error={ratesError}
		{onexpand}
	/>
{/if}

<!-- (*MVOX:Josquin*) -->
