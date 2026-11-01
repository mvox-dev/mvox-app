// The landing page's state: one load per selected collective, and the own-answer writes.
import { get } from 'svelte/store';
import { cfgFor } from '$lib/entu/cfg';
import { isAuthExpiredError } from '$lib/entu/auth-expired';
import { createLatest } from '$lib/async/latest';
import { reportProblem } from '$lib/problems/reportProblem';
import { resetServedFromCache } from '$lib/entu/readCache';
import { createWriteTokens } from '$lib/net/writeTokens';
import { writesAvailable } from '$lib/net/online';
import { withEntry, withItem } from '$lib/collections/immutable';
import { createRsvpChangeQueue } from '$lib/rsvp/rsvpChangeQueue';
import { createRsvpWriteStatus, existingRsvp } from '$lib/rsvp/rsvpWriteStatus';
import {
	rsvpsByEventId,
	type RsvpByEventId,
	type RsvpEntry,
	type RsvpStatus
} from '$lib/rsvp/rsvpData';
import {
	sameCollectiveIdentity,
	selectedCollectiveIdentityStore,
	type CollectiveIdentity
} from '$lib/collectives/store';
import type { AgendaItem } from '$lib/agenda/types';
import type { LinkRow } from '$lib/links/linkData';
import * as reads from './landingReads';
import type { EventTally, LearningWork } from './landingReads';

export const UNANSWERED_SHOWN = 5;

export function createLanding() {
	const s = $state({
		agendaLoading: true,
		agendaError: false,
		sessionExpired: false,
		upcoming: [] as AgendaItem[],
		answers: null as RsvpByEventId | null,
		answersError: false,
		answersPartial: false,
		membership: 'loading' as 'loading' | 'member' | 'non-member',
		memberId: null as string | null,
		canAnswer: null as boolean | null,
		tally: null as EventTally | null,
		tallyError: false,
		learning: [] as LearningWork[],
		learningError: false,
		links: [] as LinkRow[],
		linksError: false,
		initials: '',
		pending: new Set<string>(),
		failed: new Set<string>()
	});

	const latest = createLatest();
	let identity: CollectiveIdentity | null = null;
	const current = () => sameCollectiveIdentity(get(selectedCollectiveIdentityStore), identity);

	const nextEvent = $derived(s.upcoming[0] ?? null);
	const unanswered = $derived(
		s.answers === null ? [] : s.upcoming.slice(1).filter((e) => !s.answers![e.id])
	);

	function failed(action: string, error: unknown, isCurrent: () => boolean, mark: () => void) {
		if (!isCurrent()) return;
		reportProblem({ area: 'landing', action, error });
		mark();
	}

	function loadTally(eventId: string, isCurrent: () => boolean): void {
		if (!identity) return;
		reads
			.readEventTally(cfgFor(identity.db), eventId)
			.then((t) => {
				if (!isCurrent()) return;
				s.tally = t;
				s.tallyError = false;
			})
			.catch((e) => failed('loading the answer tally', e, isCurrent, () => (s.tallyError = true)));
	}

	function load(selected: CollectiveIdentity | null): void {
		const isCurrent = latest.next();
		identity = selected ? { db: selected.db, personId: selected.personId } : null;
		Object.assign(s, {
			agendaLoading: selected !== null,
			agendaError: false,
			sessionExpired: false,
			upcoming: [],
			answers: null,
			answersError: false,
			answersPartial: false,
			membership: 'loading',
			memberId: null,
			canAnswer: null,
			tally: null,
			tallyError: false,
			learning: [],
			learningError: false,
			links: [],
			linksError: false,
			initials: '',
			pending: new Set<string>(),
			failed: new Set<string>()
		});
		queue = createQueue(isCurrent);
		if (!selected) return;
		resetServedFromCache();
		const cfg = cfgFor(selected.db);
		const personId = selected.personId;

		reads
			.loadFullAgenda()
			.then((agenda) => {
				if (!isCurrent()) return;
				s.upcoming = agenda.upcoming;
				s.agendaLoading = false;
				if (agenda.upcoming[0]) loadTally(agenda.upcoming[0].id, isCurrent);
				if (agenda.seasonId === null) return;
				reads
					.readLearningWorks(cfg, agenda.seasonId)
					.then((rows) => {
						if (isCurrent()) s.learning = rows;
					})
					.catch((e) => failed('loading the works', e, isCurrent, () => (s.learningError = true)));
			})
			.catch((e) => {
				if (!isCurrent()) return;
				s.agendaLoading = false;
				if (isAuthExpiredError(e)) s.sessionExpired = true;
				else failed('loading the agenda', e, isCurrent, () => (s.agendaError = true));
			});

		reads
			.listMyRsvps(cfg, personId)
			.then((r) => {
				if (!isCurrent()) return;
				s.answers = rsvpsByEventId(r.items);
				s.answersPartial = r.truncated;
			})
			.catch((e) => failed('loading your answers', e, isCurrent, () => (s.answersError = true)));

		reads
			.findMyMemberId(cfg, personId)
			.then((id) => {
				if (!isCurrent()) return;
				s.memberId = id;
				s.membership = id ? 'member' : 'non-member';
			})
			.catch((e) => failed('finding your member record', e, isCurrent, () => {}));

		reads.readRsvpRights(cfg, personId).then((ok) => {
			if (isCurrent()) s.canAnswer = ok;
		});

		reads
			.listLinks(cfg)
			.then((rows) => {
				if (isCurrent()) s.links = rows;
			})
			.catch((e) => failed('loading the links', e, isCurrent, () => (s.linksError = true)));

		reads
			.readInitials(cfg, personId)
			.then((initials) => {
				if (isCurrent()) s.initials = initials;
			})
			.catch((e) => failed('reading your name', e, isCurrent, () => {}));
	}

	// One queue per load: a write still in flight from the last collective touches nothing here.
	function createQueue(isCurrent: () => boolean) {
		const live =
			<A extends unknown[]>(f: (...args: A) => void) =>
			(...args: A) => {
				if (isCurrent()) f(...args);
			};
		return createRsvpChangeQueue(
			createRsvpWriteStatus({
				area: 'landing',
				tokens: createWriteTokens(() => get(selectedCollectiveIdentityStore), sameCollectiveIdentity),
				accessors: {
					setEntry: live((id: string, entry: RsvpEntry | null) => {
						if (s.answers) s.answers = withEntry(s.answers, id, entry);
					}),
					setPending: live((id: string, on: boolean) => (s.pending = withItem(s.pending, id, on))),
					setFailed: live((id: string, on: boolean) => (s.failed = withItem(s.failed, id, on))),
					setSaved: () => {}
				},
				onReconcile: (id) => {
					if (isCurrent() && id === nextEvent?.id) loadTally(id, isCurrent);
				}
			})
		);
	}
	let queue = createQueue(latest.whileCurrent());

	function answer(eventId: string, status: RsvpStatus | null): void {
		if (!identity || !current() || s.answers === null || !get(writesAvailable)) return;
		const cfg = cfgFor(identity.db);
		const { personId } = identity;
		const isCurrent = latest.whileCurrent();
		queue.request({
			cfg,
			personId,
			memberId: s.memberId,
			resolveMemberId: async () => {
				const id = await reads.findMyMemberId(cfg, personId);
				if (isCurrent()) s.memberId = id;
				return id;
			},
			eventId,
			existing: existingRsvp(s.answers[eventId], eventId),
			newStatus: status
		});
	}

	return {
		state: s,
		get nextEvent() {
			return nextEvent;
		},
		get unanswered() {
			return unanswered;
		},
		load,
		answer
	};
}

export type Landing = ReturnType<typeof createLanding>;

// (*MVOX:Josquin*)
