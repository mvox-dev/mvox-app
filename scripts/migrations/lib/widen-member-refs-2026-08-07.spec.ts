import { describe, expect, it, vi } from 'vitest';
import { type EntuCfg } from '$lib/seasons/entuSeasons';
import {
	MEMBER_TYPE_ID,
	PERSON_PROPDEF_ID,
	SECTION_PROPDEF_ID,
	EXPECTED_DOMAIN_MEMBER_COUNT,
	verifyMemberTypeSharing,
	verifyPropDefsAbsent,
	widenPropDefs,
	enumerateDomainMembers,
	touchSaveCanary,
	touchSaveDomainMembers,
	renderPlan,
	WidenLedger,
	type MemberTarget
} from './widen-member-refs-2026-08-07';

// ════════════════════════════════════════════════════════════════════════════
// #20 follow-up — proves the built script against an in-memory Entu mock. No
// agent runs this against live polyphony; this file only proves the engine
// before the real dry-run/live invocation. Bentham note D (pre-execution
// review, non-blocking): a small spec matching the sibling migration libs'
// precedent (t3-1-singer-provision.spec.ts, t4-10-plan.spec.ts) — covers
// partial-A⇒no-B (by construction, exercised at the entrypoint not here),
// count-drift⇒HALT, and same-id-response⇒failed.
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

	it('passes when the type is domain', async () => {
		await expect(verifyMemberTypeSharing(cfg, mockTypeEntity('domain'))).resolves.toBeUndefined();
	});

	it('passes when the type is public', async () => {
		await expect(verifyMemberTypeSharing(cfg, mockTypeEntity('public'))).resolves.toBeUndefined();
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
	function makeMember(i: number, sharing: string) {
		return { _id: `member-${i}`, _sharing: [{ _id: `sharing-${i}`, string: sharing }] };
	}

	it('HALTs on count drift', async () => {
		const members = Array.from({ length: 3 }, (_, i) => makeMember(i, 'domain'));
		const mock = vi.fn().mockResolvedValue(json({ count: members.length, entities: members }));
		await expect(enumerateDomainMembers(cfg, mock)).rejects.toThrow(/count DRIFT/);
	});

	it('HALTs on a truncated page (server count mismatch)', async () => {
		const members = Array.from({ length: EXPECTED_DOMAIN_MEMBER_COUNT }, (_, i) => makeMember(i, 'domain'));
		const mock = vi.fn().mockResolvedValue(json({ count: members.length + 1, entities: members }));
		await expect(enumerateDomainMembers(cfg, mock)).rejects.toThrow(/truncated/);
	});

	it('returns exactly the domain-tier members, excluding private ones, when the count matches', async () => {
		const domainMembers = Array.from({ length: EXPECTED_DOMAIN_MEMBER_COUNT }, (_, i) => makeMember(i, 'domain'));
		const privateMember = { _id: 'member-private', _sharing: [{ _id: 'sharing-private', string: 'private' }] };
		const all = [...domainMembers, privateMember];
		const mock = vi.fn().mockResolvedValue(json({ count: all.length, entities: all }));
		const targets = await enumerateDomainMembers(cfg, mock);
		expect(targets).toHaveLength(EXPECTED_DOMAIN_MEMBER_COUNT);
		expect(targets.every((t) => t.memberId !== 'member-private')).toBe(true);
		expect(targets[0]).toEqual({ memberId: 'member-0', sharingPropId: 'sharing-0', sharingValue: 'domain' });
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
	it('carries the explicit prop-def ids and the exact member count, not just a generic description', () => {
		const targets: MemberTarget[] = [{ memberId: 'm1', sharingPropId: 's1', sharingValue: 'domain' }];
		const plan = renderPlan(targets);
		expect(plan).toContain(PERSON_PROPDEF_ID);
		expect(plan).toContain(SECTION_PROPDEF_ID);
		expect(plan).toContain('1 domain-tier members in scope');
		expect(plan).toContain('Writes issued this run: 0');
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
