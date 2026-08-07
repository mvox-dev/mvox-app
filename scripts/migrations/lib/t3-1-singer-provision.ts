// T3.1 (#17) — provision the 128 synthetic singers: domain `profile` entities
// (Bundle 1) + `member` tier conversion private→domain (Bundle 2). Authorized on
// #17 (§8.6 chain recorded there); Owner: Pérotin (build + execute — no separate
// build/review handoff for this task, per the issue's ownership line).
//
// Design mirrors t4-10-plan.ts's proven shape: read-only enumeration with
// fail-loud drift guards, pure plan builders, per-record engines that NEVER throw
// (captured in a ledger), a dry-run renderer as the operator's verify surface.
//
// Bundle separation is real, not cosmetic: `provisionDomainProfiles` (Bundle 1)
// and `convertMemberTiers` (Bundle 2) are independent engines. The entrypoint
// gates Bundle 2 on Bundle 1's full success — converting a member's tier to
// domain without a populated, verified domain profile would surface her as an
// incomplete/unnamed member (worse than leaving her private), so a partial
// Bundle 1 must never let Bundle 2 run.

import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/seasons/entuSeasons';
import { createProfile, saveProfileFields, listMyProfiles } from '$lib/profile/profileData';

/** Frozen drift tripwire — the live public-tier person count, as of the #17 probe
 * (2026-08-07). NOT the authoritative source; `enumerateSingerTargets` HALTs
 * loudly if the live count differs (a synthetic added/removed since the probe). */
export const EXPECTED_PUBLIC_PERSON_COUNT = 128;

/** One synthetic singer selected for provisioning, with everything both engines need. */
export type SingerTarget = {
	personId: string;
	name: string;
	memberId: string;
	/** The member's CURRENT `_sharing` property value-id — needed for the Bundle 2
	 * atomic replace (`POST entity/{id}` with this `_id` + the new string, which
	 * soft-deletes the old value and inserts the new one in one call). */
	memberSharingPropId: string;
};

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Step-0 enumeration (READ-ONLY). One-page GET of every person; keep only
 * `_sharing==='public'`; HALT if the count differs from `EXPECTED_PUBLIC_PERSON_COUNT`
 * (drift tripwire) or the page was truncated (`count !== entities.length`). For each
 * public person: HALT if she does not have EXACTLY ONE `member` entity at
 * `_sharing==='private'` (anything else means the #17 probe's picture has changed
 * underneath this run); HALT if a `profile` entity already exists for her at ANY
 * tier (the #30 existing-profile lesson — never blind-create over one that exists).
 */
export async function enumerateSingerTargets(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<SingerTarget[]> {
	const personRes = await entuFetch(
		cfg.db,
		'entity?_type.string=person&props=_id,_sharing,name&limit=1000',
		cfg.token,
		{},
		fetchImpl
	);
	if (!personRes.ok) throw new Error(`enumerateSingerTargets: person census GET failed: ${personRes.status}`);
	const personBody = (await personRes.json()) as {
		count?: number;
		entities?: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			_sharing?: Array<{ string: string }>;
		}>;
	};
	const personEntities = personBody.entities ?? [];
	if (typeof personBody.count === 'number' && personBody.count !== personEntities.length) {
		throw new Error(
			`enumerateSingerTargets: person census page truncated — server count=${personBody.count} but entities.length=${personEntities.length}; refuse to provision a partial page`
		);
	}

	const publicPersons = personEntities.filter((e) => e._sharing?.[0]?.string === 'public');
	if (publicPersons.length !== EXPECTED_PUBLIC_PERSON_COUNT) {
		throw new Error(
			`enumerateSingerTargets: public-tier person count DRIFT — expected ${EXPECTED_PUBLIC_PERSON_COUNT}, got ${publicPersons.length}; refuse to provision. The #17 probe's picture no longer matches live data — re-verify before proceeding.`
		);
	}

	const targets: SingerTarget[] = [];
	for (const p of publicPersons) {
		const name = p.name?.[0]?.string;
		if (name == null || name === '') {
			throw new Error(`enumerateSingerTargets: public person ${p._id} has no name value — cannot provision an unnamed profile`);
		}

		// Member precheck: exactly one, private.
		const memberRes = await entuFetch(
			cfg.db,
			`entity?_type.string=member&person.reference=${encodeURIComponent(p._id)}&props=_id,_sharing&limit=10`,
			cfg.token,
			{},
			fetchImpl
		);
		if (!memberRes.ok) throw new Error(`enumerateSingerTargets: member GET for person ${p._id} failed: ${memberRes.status}`);
		const memberBody = (await memberRes.json()) as {
			entities?: Array<{ _id: string; _sharing?: Array<{ _id: string; string: string }> }>;
		};
		const members = memberBody.entities ?? [];
		if (members.length !== 1) {
			throw new Error(
				`enumerateSingerTargets: person ${p._id} has ${members.length} member entities (expected exactly 1) — refuse to provision, re-verify manually`
			);
		}
		const member = members[0];
		const sharing = member._sharing?.[0];
		if (!sharing || sharing.string !== 'private') {
			throw new Error(
				`enumerateSingerTargets: person ${p._id}'s member ${member._id} has _sharing=${JSON.stringify(sharing?.string)} (expected 'private') — refuse to provision, live state has moved since the #17 probe`
			);
		}

		// Existing-profile precheck (the #30 lesson): HALT if ANY profile already
		// exists for this person, at any tier.
		const profileRes = await entuFetch(
			cfg.db,
			`entity?_type.string=profile&_parent.reference=${encodeURIComponent(p._id)}&props=_id,_sharing&limit=10`,
			cfg.token,
			{},
			fetchImpl
		);
		if (!profileRes.ok) throw new Error(`enumerateSingerTargets: profile GET for person ${p._id} failed: ${profileRes.status}`);
		const profileBody = (await profileRes.json()) as { entities?: Array<{ _id: string }> };
		const existingProfiles = profileBody.entities ?? [];
		if (existingProfiles.length > 0) {
			throw new Error(
				`enumerateSingerTargets: person ${p._id} already has ${existingProfiles.length} profile entity(ies) ` +
					`(${existingProfiles.map((e) => e._id).join(', ')}) — refuse to blind-create over an existing profile (the #30 lesson)`
			);
		}

		targets.push({ personId: p._id, name, memberId: member._id, memberSharingPropId: sharing._id });
	}

	return targets;
}

export type ProfileLedgerEntry = {
	personId: string;
	status: 'created' | 'failed';
	phase?: 'create' | 'populate' | 'verify';
	profileId?: string;
	message?: string;
};

/**
 * Bundle 1 engine. Per person: create a bare `profile` shell (admin-created,
 * admin-owned — NO `ownerIds`, so Entu adds the creating db-root identity as
 * `_owner` itself, per `createProfile`'s documented default), populate `name`,
 * then read-back-PROVE the profile holds it. NEVER throws for a per-record
 * failure — captured in the ledger, per-record, never aggregated.
 */
export async function provisionDomainProfiles(
	cfg: EntuCfg,
	targets: SingerTarget[],
	fetchImpl: typeof fetch = fetch
): Promise<ProfileLedgerEntry[]> {
	const entries: ProfileLedgerEntry[] = [];
	for (const t of targets) {
		let profileId: string;
		try {
			profileId = await createProfile(cfg, { personId: t.personId, _inheritrights: false, _sharing: 'domain' }, fetchImpl);
		} catch (err) {
			entries.push({ personId: t.personId, status: 'failed', phase: 'create', message: errMsg(err) });
			continue;
		}

		try {
			await saveProfileFields(cfg, profileId, { name: t.name, email: '' }, fetchImpl);
		} catch (err) {
			entries.push({
				personId: t.personId,
				status: 'failed',
				phase: 'populate',
				profileId,
				message: `${errMsg(err)} — orphan empty shell ${profileId} created, needs operator cleanup or a retry-populate`
			});
			continue;
		}

		try {
			const profiles = await listMyProfiles(cfg, t.personId, fetchImpl);
			const created = profiles.find((p) => p._id === profileId);
			if (!created || created.name !== t.name) {
				entries.push({
					personId: t.personId,
					status: 'failed',
					phase: 'verify',
					profileId,
					message: `profile ${profileId} does not read back with name=${JSON.stringify(t.name)}`
				});
				continue;
			}
		} catch (err) {
			entries.push({ personId: t.personId, status: 'failed', phase: 'verify', profileId, message: errMsg(err) });
			continue;
		}

		entries.push({ personId: t.personId, status: 'created', profileId });
	}
	return entries;
}

export type TierLedgerEntry = {
	personId: string;
	memberId: string;
	status: 'converted' | 'failed';
	message?: string;
};

/**
 * Bundle 2 engine. Per member: atomic `_sharing` replace — a single
 * `POST entity/{memberId}` carrying the OLD `_sharing` property's `_id` plus the
 * new string (`type:'_sharing', string:'domain'`). entu-api's `insertProperties`
 * soft-deletes the property named by an included `_id` and inserts the new value
 * in the same call (`entity.js:440-444`) — atomic, avoids the two-request race a
 * separate DELETE-then-POST would have. `_sharing` has no `_inheritrights`
 * cascade (confirmed against source: excluded from `aggregate.js`'s
 * `rightProperties` re-aggregation list), so this is a flat, local change. Then
 * read-back-PROVE the member now reads `_sharing==='domain'`.
 */
export async function convertMemberTiers(
	cfg: EntuCfg,
	targets: SingerTarget[],
	fetchImpl: typeof fetch = fetch
): Promise<TierLedgerEntry[]> {
	const entries: TierLedgerEntry[] = [];
	for (const t of targets) {
		try {
			const res = await entuFetch(
				cfg.db,
				`entity/${t.memberId}`,
				cfg.token,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify([{ _id: t.memberSharingPropId, type: '_sharing', string: 'domain' }])
				},
				fetchImpl
			);
			if (!res.ok) {
				entries.push({ personId: t.personId, memberId: t.memberId, status: 'failed', message: `tier-convert POST failed: ${res.status}` });
				continue;
			}
		} catch (err) {
			entries.push({ personId: t.personId, memberId: t.memberId, status: 'failed', message: errMsg(err) });
			continue;
		}

		try {
			const getRes = await entuFetch(cfg.db, `entity/${t.memberId}?props=_sharing`, cfg.token, {}, fetchImpl);
			if (!getRes.ok) {
				entries.push({
					personId: t.personId,
					memberId: t.memberId,
					status: 'failed',
					message: `read-back GET failed: ${getRes.status} — POST may have succeeded, verify by API`
				});
				continue;
			}
			const body = (await getRes.json()) as { entity?: { _sharing?: Array<{ string: string }> } };
			const nowSharing = body.entity?._sharing?.[0]?.string;
			if (nowSharing !== 'domain') {
				entries.push({
					personId: t.personId,
					memberId: t.memberId,
					status: 'failed',
					message: `read-back shows _sharing=${JSON.stringify(nowSharing)}, expected 'domain'`
				});
				continue;
			}
		} catch (err) {
			entries.push({ personId: t.personId, memberId: t.memberId, status: 'failed', message: errMsg(err) });
			continue;
		}

		entries.push({ personId: t.personId, memberId: t.memberId, status: 'converted' });
	}
	return entries;
}

/** PURE dry-run render — the operator's per-run verify surface for both bundles. */
export function renderPlan(targets: SingerTarget[]): string {
	const lines: string[] = [];
	lines.push('T3.1 (#17) singer provisioning DRY-RUN plan (NO writes issued)');
	lines.push(`${targets.length} synthetic singers in scope (expected ${EXPECTED_PUBLIC_PERSON_COUNT}).`);
	lines.push('');
	lines.push('── Bundle 1: WOULD CREATE domain profile per person (admin-owned, _inheritrights:false)');
	for (const t of targets) {
		lines.push(`   person ${t.personId}: WOULD CREATE profile _sharing=domain _parent=${t.personId}, WOULD POPULATE name="${t.name}"`);
	}
	lines.push('');
	lines.push('── Bundle 2: WOULD CONVERT member _sharing private→domain (gated on Bundle 1 succeeding for ALL targets)');
	for (const t of targets) {
		lines.push(`   member ${t.memberId} (person ${t.personId}): WOULD CONVERT _sharing private → domain`);
	}
	lines.push('');
	lines.push(`Totals: ${targets.length} profile creates planned, ${targets.length} tier conversions planned. Writes issued this run: 0.`);
	return lines.join('\n');
}

/** Collects + reports per-record outcomes loudly — no aggregate "done" substitutes. */
export class ProvisionLedger {
	private profileEntries: ProfileLedgerEntry[] = [];
	private tierEntries: TierLedgerEntry[] = [];

	recordProfile(entries: ProfileLedgerEntry[]): void {
		this.profileEntries.push(...entries);
	}
	recordTier(entries: TierLedgerEntry[]): void {
		this.tierEntries.push(...entries);
	}

	profileFailures(): ProfileLedgerEntry[] {
		return this.profileEntries.filter((e) => e.status !== 'created');
	}
	tierFailures(): TierLedgerEntry[] {
		return this.tierEntries.filter((e) => e.status !== 'converted');
	}
	hasFailures(): boolean {
		return this.profileFailures().length > 0 || this.tierFailures().length > 0;
	}

	printReport(): void {
		console.log(`\n── Bundle 1 (profiles): ${this.profileEntries.length} attempted`);
		for (const e of this.profileEntries) {
			const line = `${e.status.toUpperCase()} person=${e.personId}${e.phase ? ` [${e.phase}]` : ''}${e.profileId ? ` profile=${e.profileId}` : ''}${e.message ? ` — ${e.message}` : ''}`;
			if (e.status === 'created') console.log(line);
			else console.error(line);
		}
		if (this.tierEntries.length > 0) {
			console.log(`\n── Bundle 2 (tier conversion): ${this.tierEntries.length} attempted`);
			for (const e of this.tierEntries) {
				const line = `${e.status.toUpperCase()} member=${e.memberId} person=${e.personId}${e.message ? ` — ${e.message}` : ''}`;
				if (e.status === 'converted') console.log(line);
				else console.error(line);
			}
		}

		const pFail = this.profileFailures();
		const tFail = this.tierFailures();
		if (pFail.length > 0 || tFail.length > 0) {
			console.error('');
			console.error(`PROVISIONING INCOMPLETE — ${pFail.length} profile failure(s), ${tFail.length} tier-conversion failure(s) need operator repair.`);
			console.error('Non-zero exit: this run did NOT complete. Do not claim success.');
		}
	}
}
