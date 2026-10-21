// #17: give each synthetic singer a domain profile, then move her member to the domain tier.

// Bundle 2 runs only after Bundle 1 fully succeeds: a domain member without a verified
// profile shows as an unnamed member, worse than leaving her private.

import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/entu/cfg';
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

/** Read-only enumeration. HALTs on count drift, truncation, a member that is not exactly one
 * private entity, or any existing profile (never blind-create over one). */
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

/** Bundle 1: create an admin-owned profile shell, set `name`, read it back to prove it.
 * Per-record failures go to the ledger; never throws. */
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

/** Bundle 2: one POST carrying the old `_sharing` value id replaces it atomically, then
 * reads back. `_sharing` does not cascade via _inheritrights, so the change stays local. */
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
