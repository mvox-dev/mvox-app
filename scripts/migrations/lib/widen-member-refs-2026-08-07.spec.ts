import { describe, expect, it, vi } from 'vitest';
import { type EntuCfg } from '$lib/seasons/entuSeasons';
import {
	MEMBER_TYPE_ID,
	PERSON_PROPDEF_ID,
	SECTION_PROPDEF_ID,
	EXPECTED_DOMAIN_MEMBER_COUNT,
	BASELINE_DOMAIN_MEMBER_IDS,
	verifyMemberTypeSharing,
	verifyMemberNamePropDefAbsent,
	verifyPropDefsAbsent,
	widenPropDefs,
	enumerateDomainMembers,
	touchSaveCanary,
	touchSaveDomainMembers,
	renderPlan,
	WidenLedger,
	type MemberTarget,
	type EnumerationResult
} from './widen-member-refs-2026-08-07';

// ════════════════════════════════════════════════════════════════════════════
// #20 follow-up — proves the built script against an in-memory Entu mock. No
// agent runs this against live polyphony; this file only proves the engine
// before the real dry-run/live invocation. Bentham note D (pre-execution
// review, non-blocking): a small spec matching the sibling migration libs'
// precedent (t3-1-singer-provision.spec.ts, t4-10-plan.spec.ts) — covers
// partial-A⇒no-B (by construction, exercised at the entrypoint not here),
// count-drift⇒HALT, and same-id-response⇒failed. Extended after Gama's #20
// 18:11 comment: observed-value ledger recording, baseline-set drift-check
// (not just count), and the orphan/new-since-baseline classification.
// ════════════════════════════════════════════════════════════════════════════

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ── verifyMemberTypeSharing ──────────────────────────────────────────────────

describe('verifyMemberTypeSharing', () => {
	function mockTypeEntity(sharing: string | undefined, name = 'member') {
		return vi.fn().mockImplementation((url: string) => {
			expect(url).toContain(`entity/${MEMBER_TYPE_ID}`);
			return Promise.resolve(
				json({ entity: { name: [{ string: name }], ...(sharing != null ? { _sharing: [{ string: sharing }] } : {}) } })
			);
		});
	}

	it('resolves with the OBSERVED value when the type is domain — not just a boolean', async () => {
		await expect(verifyMemberTypeSharing(cfg, mockTypeEntity('domain'))).resolves.toBe('domain');
	});

	it('resolves with the OBSERVED value when the type is public', async () => {
		await expect(verifyMemberTypeSharing(cfg, mockTypeEntity('public'))).resolves.toBe('public');
	});

	it('HALTs when the type _sharing is absent — the apparent-success trap Bentham flagged', async () => {
		await expect(verifyMemberTypeSharing(cfg, mockTypeEntity(undefined))).rejects.toThrow(/nukes domain-bucket exposure/);
	});

	it('HALTs when the type _sharing is private', async () => {
		await expect(verifyMemberTypeSharing(cfg, mockTypeEntity('private'))).rejects.toThrow(/expected 'domain' or 'public'/);
	});

	it('HALTs on a name mismatch (wrong entity id)', async () => {
		await expect(verifyMemberTypeSharing(cfg, mockTypeEntity('domain', 'organization'))).rejects.toThrow(/wrong entity id/);
	});
});

// ── verifyMemberNamePropDefAbsent ────────────────────────────────────────────

describe('verifyMemberNamePropDefAbsent', () => {
	it('passes when no member.name prop-def is found', async () => {
		const mock = vi.fn().mockResolvedValue(json({ entities: [] }));
		await expect(verifyMemberNamePropDefAbsent(cfg, mock)).resolves.toBeUndefined();
	});

	it('HALTs if a member.name prop-def is unexpectedly found — the orphan-name scope claim would no longer hold', async () => {
		const mock = vi.fn().mockResolvedValue(json({ entities: [{ _id: 'propdef-name-revived' }] }));
		await expect(verifyMemberNamePropDefAbsent(cfg, mock)).rejects.toThrow(/UNEXPECTEDLY FOUND/);
	});
});

// ── verifyPropDefsAbsent ─────────────────────────────────────────────────────

describe('verifyPropDefsAbsent', () => {
	function mockPropDefs(opts: { personSharing?: string; sectionSharing?: string }) {
		return vi.fn().mockImplementation((url: string) => {
			if (url.includes(PERSON_PROPDEF_ID)) {
				return Promise.resolve(
					json({ entity: { name: [{ string: 'person' }], ...(opts.personSharing ? { _sharing: [{ string: opts.personSharing }] } : {}) } })
				);
			}
			if (url.includes(SECTION_PROPDEF_ID)) {
				return Promise.resolve(
					json({ entity: { name: [{ string: 'section' }], ...(opts.sectionSharing ? { _sharing: [{ string: opts.sectionSharing }] } : {}) } })
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});
	}

	it('passes when both prop-defs are absent', async () => {
		await expect(verifyPropDefsAbsent(cfg, mockPropDefs({}))).resolves.toBeUndefined();
	});

	it('HALTs if person already has a _sharing value — live state moved since the probe', async () => {
		await expect(verifyPropDefsAbsent(cfg, mockPropDefs({ personSharing: 'domain' }))).rejects.toThrow(/live state has moved/);
	});

	it('HALTs if section already has a _sharing value', async () => {
		await expect(verifyPropDefsAbsent(cfg, mockPropDefs({ sectionSharing: 'domain' }))).rejects.toThrow(/live state has moved/);
	});
});

// ── enumerateDomainMembers ───────────────────────────────────────────────────

describe('enumerateDomainMembers', () => {
	function baselineMember(id: string, opts: { hasPerson?: boolean } = {}) {
		return {
			_id: id,
			_sharing: [{ _id: `sharing-${id}`, string: 'domain' }],
			...(opts.hasPerson === false ? {} : { person: [{ reference: `person-for-${id}` }] })
		};
	}

	it('HALTs when the live domain-tier count is below the baseline (shrunk)', async () => {
		const members = BASELINE_DOMAIN_MEMBER_IDS.slice(0, 3).map((id) => baselineMember(id));
		const mock = vi.fn().mockResolvedValue(json({ count: members.length, entities: members }));
		await expect(enumerateDomainMembers(cfg, mock)).rejects.toThrow(/count DRIFT \(shrunk\)/);
	});

	it('HALTs on a truncated page (server count mismatch)', async () => {
		const members = BASELINE_DOMAIN_MEMBER_IDS.map((id) => baselineMember(id));
		const mock = vi.fn().mockResolvedValue(json({ count: members.length + 1, entities: members }));
		await expect(enumerateDomainMembers(cfg, mock)).rejects.toThrow(/truncated/);
	});

	it('HALTs, naming them individually, if any baseline member is no longer domain-tier live', async () => {
		const members = BASELINE_DOMAIN_MEMBER_IDS.slice(1).map((id) => baselineMember(id)); // drop the first baseline id
		// pad back up to count so the "shrunk" guard doesn't fire first — simulate a
		// REPLACEMENT (same count, different composition), the exact case a bare
		// count check would miss.
		members.push(baselineMember('member-not-in-baseline'));
		const mock = vi.fn().mockResolvedValue(json({ count: members.length, entities: members }));
		await expect(enumerateDomainMembers(cfg, mock)).rejects.toThrow(new RegExp(BASELINE_DOMAIN_MEMBER_IDS[0]));
	});

	it('reports EXACTLY the baseline, unchanged, when live matches the baseline set 1:1 — excludes private members', async () => {
		const domainMembers = BASELINE_DOMAIN_MEMBER_IDS.map((id) => baselineMember(id));
		const privateMember = { _id: 'member-private', _sharing: [{ _id: 'sharing-private', string: 'private' }] };
		const all = [...domainMembers, privateMember];
		const mock = vi.fn().mockResolvedValue(json({ count: all.length, entities: all }));
		const result = await enumerateDomainMembers(cfg, mock);
		expect(result.targets).toHaveLength(EXPECTED_DOMAIN_MEMBER_COUNT);
		expect(result.targets.every((t) => t.memberId !== 'member-private')).toBe(true);
		expect(result.unchangedFromBaselineCount).toBe(EXPECTED_DOMAIN_MEMBER_COUNT);
		expect(result.newSinceBaselineIds).toEqual([]);
		expect(result.orphanMemberIds).toEqual([]);
	});

	it('surfaces a member created since the probe as an individually-named delta, not silently folded into the count', async () => {
		const domainMembers = BASELINE_DOMAIN_MEMBER_IDS.map((id) => baselineMember(id));
		const newMember = baselineMember('member-brand-new-since-probe');
		const all = [...domainMembers, newMember];
		const mock = vi.fn().mockResolvedValue(json({ count: all.length, entities: all }));
		const result = await enumerateDomainMembers(cfg, mock);
		expect(result.targets).toHaveLength(EXPECTED_DOMAIN_MEMBER_COUNT + 1);
		expect(result.newSinceBaselineIds).toEqual(['member-brand-new-since-probe']);
	});

	it('classifies members with no `person` ref as orphans', async () => {
		const domainMembers = BASELINE_DOMAIN_MEMBER_IDS.map((id, i) => baselineMember(id, { hasPerson: i >= 2 }));
		const mock = vi.fn().mockResolvedValue(json({ count: domainMembers.length, entities: domainMembers }));
		const result = await enumerateDomainMembers(cfg, mock);
		expect(result.orphanMemberIds).toEqual(BASELINE_DOMAIN_MEMBER_IDS.slice(0, 2));
	});
});

// ── widenPropDefs ─────────────────────────────────────────────────────────────

describe('widenPropDefs', () => {
	it('sets both prop-defs and read-back-confirms domain', async () => {
		const mock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			if (init?.method === 'POST') return Promise.resolve(json({ _id: url }));
			return Promise.resolve(json({ entity: { _sharing: [{ string: 'domain' }] } }));
		});
		const entries = await widenPropDefs(cfg, mock);
		expect(entries).toEqual([
			{ propDefId: PERSON_PROPDEF_ID, name: 'person', status: 'set' },
			{ propDefId: SECTION_PROPDEF_ID, name: 'section', status: 'set' }
		]);
	});

	it('records a per-record failure on read-back mismatch, does not throw', async () => {
		const mock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			if (init?.method === 'POST') return Promise.resolve(json({ _id: url }));
			return Promise.resolve(json({ entity: { _sharing: [{ string: 'private' }] } }));
		});
		const entries = await widenPropDefs(cfg, mock);
		expect(entries.every((e) => e.status === 'failed')).toBe(true);
	});
});

// ── touchSaveDomainMembers / touchSaveCanary — same-id-response⇒failed ───────

describe('touchSaveDomainMembers', () => {
	const target: MemberTarget = { memberId: 'member-0', sharingPropId: 'sharing-0', sharingValue: 'domain' };

	it('touches cleanly when the response carries a NEW property id', async () => {
		const mock = vi.fn().mockResolvedValue(json({ properties: [{ _id: 'sharing-0-NEW', type: '_sharing' }] }));
		const entries = await touchSaveDomainMembers(cfg, [target], mock);
		expect(entries).toEqual([{ memberId: 'member-0', status: 'touched', newSharingPropId: 'sharing-0-NEW' }]);
	});

	it('fails when the response returns the SAME property id — no rotation, no fresh write', async () => {
		const mock = vi.fn().mockResolvedValue(json({ properties: [{ _id: 'sharing-0', type: '_sharing' }] }));
		const entries = await touchSaveDomainMembers(cfg, [target], mock);
		expect(entries[0].status).toBe('failed');
		expect(entries[0].message).toMatch(/SAME property _id/);
	});

	it('fails on a non-2xx POST, captured per-record, never throws', async () => {
		const mock = vi.fn().mockResolvedValue(json({}, 403));
		const entries = await touchSaveDomainMembers(cfg, [target], mock);
		expect(entries[0].status).toBe('failed');
	});
});

describe('touchSaveCanary', () => {
	const target: MemberTarget = { memberId: 'member-0', sharingPropId: 'sharing-0', sharingValue: 'domain' };

	it('resolves when the touch succeeds AND exactly one _sharing value survives', async () => {
		const mock = vi
			.fn()
			.mockImplementationOnce(() => Promise.resolve(json({ properties: [{ _id: 'sharing-0-NEW', type: '_sharing' }] })))
			.mockImplementationOnce(() => Promise.resolve(json({ entity: { _sharing: [{ _id: 'sharing-0-NEW', string: 'domain' }] } })));
		await expect(touchSaveCanary(cfg, target, mock)).resolves.toEqual({ memberId: 'member-0', status: 'touched', newSharingPropId: 'sharing-0-NEW' });
	});

	it('throws (hard gate, not a ledger entry) if the touch itself fails', async () => {
		const mock = vi.fn().mockResolvedValue(json({}, 403));
		await expect(touchSaveCanary(cfg, target, mock)).rejects.toThrow(/canary member member-0 FAILED/);
	});

	it('throws if two _sharing values survive — the multi-value-append trap fired despite the atomic replace', async () => {
		const mock = vi
			.fn()
			.mockImplementationOnce(() => Promise.resolve(json({ properties: [{ _id: 'sharing-0-NEW', type: '_sharing' }] })))
			.mockImplementationOnce(() =>
				Promise.resolve(
					json({
						entity: {
							_sharing: [
								{ _id: 'sharing-0', string: 'domain' },
								{ _id: 'sharing-0-NEW', string: 'domain' }
							]
						}
					})
				)
			);
		await expect(touchSaveCanary(cfg, target, mock)).rejects.toThrow(/carries 2 _sharing values/);
	});
});

// ── renderPlan / WidenLedger ──────────────────────────────────────────────────

describe('renderPlan', () => {
	it('carries the explicit prop-def ids, the disambiguated population breakdown, and the observed type-sharing value', () => {
		const enumeration: EnumerationResult = {
			targets: [{ memberId: 'm1', sharingPropId: 's1', sharingValue: 'domain' }],
			unchangedFromBaselineCount: 245,
			newSinceBaselineIds: ['m1-new'],
			orphanMemberIds: ['m1-orphan']
		};
		const plan = renderPlan(enumeration, 'domain');
		expect(plan).toContain(PERSON_PROPDEF_ID);
		expect(plan).toContain(SECTION_PROPDEF_ID);
		expect(plan).toContain("observed live = 'domain'");
		expect(plan).toContain('Touch-save population: 1 domain-tier members total');
		expect(plan).toContain('245 unchanged from the 2026-08-07 probe baseline');
		expect(plan).toContain('m1-new: STILL NEEDS touching');
		expect(plan).toContain('1 of these are legacy orphan members');
		expect(plan).toContain('Writes issued this run: 0');
	});

	it('states plainly when the population is EXACTLY the unchanged baseline (no deltas)', () => {
		const enumeration: EnumerationResult = {
			targets: BASELINE_DOMAIN_MEMBER_IDS.map((id) => ({ memberId: id, sharingPropId: `s-${id}`, sharingValue: 'domain' })),
			unchangedFromBaselineCount: EXPECTED_DOMAIN_MEMBER_COUNT,
			newSinceBaselineIds: [],
			orphanMemberIds: []
		};
		const plan = renderPlan(enumeration, 'domain');
		expect(plan).toContain('0 new since the probe — population is EXACTLY the probe baseline, unchanged');
	});
});

describe('WidenLedger', () => {
	it('hasFailures is false when everything succeeds', () => {
		const ledger = new WidenLedger();
		ledger.recordPropDef([{ propDefId: PERSON_PROPDEF_ID, name: 'person', status: 'set' }]);
		ledger.recordTouch([{ memberId: 'm1', status: 'touched', newSharingPropId: 'x' }]);
		expect(ledger.hasFailures()).toBe(false);
	});

	it('hasFailures is true if any prop-def or touch-save failed', () => {
		const ledger = new WidenLedger();
		ledger.recordPropDef([{ propDefId: PERSON_PROPDEF_ID, name: 'person', status: 'failed', message: 'boom' }]);
		expect(ledger.hasFailures()).toBe(true);
	});
});
