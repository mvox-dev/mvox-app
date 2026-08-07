import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import {
	enumerateSingerTargets,
	provisionDomainProfiles,
	convertMemberTiers,
	renderPlan,
	ProvisionLedger,
	EXPECTED_PUBLIC_PERSON_COUNT,
	type SingerTarget
} from './t3-1-singer-provision';

// ════════════════════════════════════════════════════════════════════════════
// T3.1 (#17) singer provisioning — proves the built script against an in-memory
// Entu mock. No agent runs this against live polyphony; this file only proves
// the engine before the real dry-run/live invocation.
// ════════════════════════════════════════════════════════════════════════════

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function makePerson(i: number, opts: { sharing?: string; noName?: boolean } = {}) {
	return {
		_id: `person-${i}`,
		_sharing: [{ string: opts.sharing ?? 'public' }],
		name: opts.noName ? undefined : [{ string: `Singer ${i}` }]
	};
}

beforeEach(() => {
	resetTypeIdCache();
});

// ── enumerateSingerTargets ───────────────────────────────────────────────────

describe('enumerateSingerTargets', () => {
	type MockOpts = {
		personCount: number;
		countMismatch?: boolean; // server `count` != entities.length
		memberCountForFirst?: number; // deviate from 1 for person-0
		memberSharingForFirst?: string; // deviate from 'private' for person-0
		existingProfileForFirst?: boolean;
		noNameForFirst?: boolean;
	};

	function makeMock(opts: MockOpts) {
		const persons = Array.from({ length: opts.personCount }, (_, i) =>
			makePerson(i, { noName: opts.noNameForFirst && i === 0 })
		);

		return vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=person')) {
				return Promise.resolve(
					json({ count: opts.countMismatch ? persons.length + 1 : persons.length, entities: persons })
				);
			}
			if (url.includes('_type.string=member')) {
				const personId = decodeURIComponent(url.match(/person\.reference=([^&]+)/)?.[1] ?? '');
				const isFirst = personId === 'person-0';
				const count = isFirst && opts.memberCountForFirst != null ? opts.memberCountForFirst : 1;
				const sharing = isFirst && opts.memberSharingForFirst != null ? opts.memberSharingForFirst : 'private';
				const entities = Array.from({ length: count }, (_, i) => ({
					_id: `member-${personId}-${i}`,
					_sharing: [{ _id: `sharing-prop-${personId}-${i}`, string: sharing }]
				}));
				return Promise.resolve(json({ entities }));
			}
			if (url.includes('_type.string=profile')) {
				const personId = decodeURIComponent(url.match(/_parent\.reference=([^&]+)/)?.[1] ?? '');
				const hasExisting = opts.existingProfileForFirst && personId === 'person-0';
				return Promise.resolve(json({ entities: hasExisting ? [{ _id: 'existing-profile-1' }] : [] }));
			}
			throw new Error(`unrouted mock request: ${url}`);
		});
	}

	it('returns one target per public-tier person, with member id/sharing-prop-id + name', async () => {
		const fetchImpl = makeMock({ personCount: EXPECTED_PUBLIC_PERSON_COUNT });
		const targets = await enumerateSingerTargets(cfg, fetchImpl as unknown as typeof fetch);
		expect(targets).toHaveLength(EXPECTED_PUBLIC_PERSON_COUNT);
		expect(targets[0]).toEqual({
			personId: 'person-0',
			name: 'Singer 0',
			memberId: 'member-person-0-0',
			memberSharingPropId: 'sharing-prop-person-0-0'
		});
	});

	it('HALTs on public-person-count drift from EXPECTED_PUBLIC_PERSON_COUNT', async () => {
		const fetchImpl = makeMock({ personCount: EXPECTED_PUBLIC_PERSON_COUNT - 1 });
		await expect(enumerateSingerTargets(cfg, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/DRIFT/);
	});

	it('HALTs on a truncated person-census page', async () => {
		const fetchImpl = makeMock({ personCount: EXPECTED_PUBLIC_PERSON_COUNT, countMismatch: true });
		await expect(enumerateSingerTargets(cfg, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/truncated/);
	});

	it('HALTs if a person has zero member entities', async () => {
		const fetchImpl = makeMock({ personCount: EXPECTED_PUBLIC_PERSON_COUNT, memberCountForFirst: 0 });
		await expect(enumerateSingerTargets(cfg, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/expected exactly 1/);
	});

	it('HALTs if a person has more than one member entity', async () => {
		const fetchImpl = makeMock({ personCount: EXPECTED_PUBLIC_PERSON_COUNT, memberCountForFirst: 2 });
		await expect(enumerateSingerTargets(cfg, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/expected exactly 1/);
	});

	it('HALTs if a member is not private-tier', async () => {
		const fetchImpl = makeMock({ personCount: EXPECTED_PUBLIC_PERSON_COUNT, memberSharingForFirst: 'domain' });
		await expect(enumerateSingerTargets(cfg, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/expected 'private'/);
	});

	it('HALTs if a profile already exists for a person (the #30 existing-profile lesson)', async () => {
		const fetchImpl = makeMock({ personCount: EXPECTED_PUBLIC_PERSON_COUNT, existingProfileForFirst: true });
		await expect(enumerateSingerTargets(cfg, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/already has/);
	});

	it('HALTs if a public person carries no name value', async () => {
		const fetchImpl = makeMock({ personCount: EXPECTED_PUBLIC_PERSON_COUNT, noNameForFirst: true });
		await expect(enumerateSingerTargets(cfg, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/no name value/);
	});
});

// ── provisionDomainProfiles (Bundle 1) ───────────────────────────────────────

describe('provisionDomainProfiles', () => {
	const target: SingerTarget = { personId: 'p1', name: 'Singer One', memberId: 'm1', memberSharingPropId: 'sp1' };

	function makeMock(opts: { failCreate?: boolean; failPopulate?: boolean; verifyMismatch?: boolean } = {}) {
		const profiles: Array<{ _id: string; _parent: string; name?: string }> = [];
		let seq = 0;
		return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const method = (init?.method ?? 'GET').toUpperCase();
			if (method === 'GET' && url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: 'profile-type-id' }] }));
			}
			if (method === 'POST' && /\/entity(\?|$)/.test(url)) {
				if (opts.failCreate) return Promise.resolve(json({}, 500));
				const id = `new-prof-${++seq}`;
				const body = JSON.parse(String(init!.body)) as Array<{ type: string; reference?: string }>;
				profiles.push({ _id: id, _parent: body.find((p) => p.type === '_parent')?.reference ?? '' });
				return Promise.resolve(json({ _id: id }));
			}
			const entMatch = url.match(/\/entity\/([^/?]+)/);
			if (method === 'POST' && entMatch) {
				if (opts.failPopulate) return Promise.resolve(json({}, 500));
				const prof = profiles.find((p) => p._id === entMatch[1]);
				const body = JSON.parse(String(init!.body)) as Array<{ type: string; string?: string }>;
				if (prof) {
					const nameProp = body.find((p) => p.type === 'name');
					if (nameProp) prof.name = nameProp.string;
				}
				return Promise.resolve(json({ _id: entMatch[1] }));
			}
			if (method === 'GET' && entMatch) {
				// saveProfileFields' lookup GET (name/email value-ids) — fresh shell, no values yet.
				return Promise.resolve(json({ entity: { _id: entMatch[1] } }));
			}
			if (method === 'GET' && url.includes('_type.string=profile')) {
				const parent = decodeURIComponent(url.match(/_parent\.reference=([^&]+)/)?.[1] ?? '');
				const ents = profiles
					.filter((p) => p._parent === parent)
					.map((p) => ({ _id: p._id, name: p.name != null && !opts.verifyMismatch ? [{ string: p.name }] : undefined, _sharing: [{ string: 'domain' }] }));
				return Promise.resolve(json({ entities: ents }));
			}
			throw new Error(`unrouted mock request: ${method} ${url}`);
		});
	}

	it('happy path: create → populate → verify → status "created"', async () => {
		const fetchImpl = makeMock();
		const entries = await provisionDomainProfiles(cfg, [target], fetchImpl as unknown as typeof fetch);
		expect(entries).toEqual([{ personId: 'p1', status: 'created', profileId: 'new-prof-1' }]);
	});

	it('create failure → status "failed", phase "create", no profileId', async () => {
		const fetchImpl = makeMock({ failCreate: true });
		const entries = await provisionDomainProfiles(cfg, [target], fetchImpl as unknown as typeof fetch);
		expect(entries).toEqual([expect.objectContaining({ personId: 'p1', status: 'failed', phase: 'create' })]);
		expect(entries[0].profileId).toBeUndefined();
	});

	it('populate failure → status "failed", phase "populate", names the orphan shell', async () => {
		const fetchImpl = makeMock({ failPopulate: true });
		const entries = await provisionDomainProfiles(cfg, [target], fetchImpl as unknown as typeof fetch);
		expect(entries[0]).toEqual(expect.objectContaining({ personId: 'p1', status: 'failed', phase: 'populate', profileId: 'new-prof-1' }));
		expect(entries[0].message).toMatch(/orphan empty shell/);
	});

	it('verify mismatch → status "failed", phase "verify"', async () => {
		const fetchImpl = makeMock({ verifyMismatch: true });
		const entries = await provisionDomainProfiles(cfg, [target], fetchImpl as unknown as typeof fetch);
		expect(entries[0]).toEqual(expect.objectContaining({ personId: 'p1', status: 'failed', phase: 'verify' }));
	});
});

// ── convertMemberTiers (Bundle 2) ────────────────────────────────────────────

describe('convertMemberTiers', () => {
	const target: SingerTarget = { personId: 'p1', name: 'Singer One', memberId: 'm1', memberSharingPropId: 'sp1' };

	function makeMock(opts: { failPost?: boolean; readbackStale?: boolean } = {}) {
		let currentSharing = 'private';
		return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const method = (init?.method ?? 'GET').toUpperCase();
			if (method === 'POST' && url.includes('/entity/m1')) {
				if (opts.failPost) return Promise.resolve(json({}, 500));
				const body = JSON.parse(String(init!.body)) as Array<{ _id?: string; type: string; string?: string }>;
				const sharingProp = body.find((p) => p.type === '_sharing');
				expect(sharingProp?._id).toBe('sp1'); // atomic replace carries the OLD prop id
				if (!opts.readbackStale) currentSharing = sharingProp?.string ?? currentSharing;
				return Promise.resolve(json({ _id: 'm1' }));
			}
			if (method === 'GET' && url.includes('/entity/m1')) {
				return Promise.resolve(json({ entity: { _sharing: [{ string: currentSharing }] } }));
			}
			throw new Error(`unrouted mock request: ${method} ${url}`);
		});
	}

	it('happy path: atomic POST replace (carrying the old prop id) → read-back confirms domain → "converted"', async () => {
		const fetchImpl = makeMock();
		const entries = await convertMemberTiers(cfg, [target], fetchImpl as unknown as typeof fetch);
		expect(entries).toEqual([{ personId: 'p1', memberId: 'm1', status: 'converted' }]);
	});

	it('POST failure → status "failed"', async () => {
		const fetchImpl = makeMock({ failPost: true });
		const entries = await convertMemberTiers(cfg, [target], fetchImpl as unknown as typeof fetch);
		expect(entries[0]).toEqual(expect.objectContaining({ personId: 'p1', memberId: 'm1', status: 'failed' }));
	});

	it('read-back still shows the old tier → status "failed" (never trust the POST 200 alone)', async () => {
		const fetchImpl = makeMock({ readbackStale: true });
		const entries = await convertMemberTiers(cfg, [target], fetchImpl as unknown as typeof fetch);
		expect(entries[0]).toEqual(expect.objectContaining({ personId: 'p1', memberId: 'm1', status: 'failed' }));
		expect(entries[0].message).toMatch(/expected 'domain'/);
	});
});

// ── renderPlan (pure) ────────────────────────────────────────────────────────

describe('renderPlan', () => {
	it('mentions both bundles, every target, and zero writes issued', () => {
		const targets: SingerTarget[] = [{ personId: 'p1', name: 'Singer One', memberId: 'm1', memberSharingPropId: 'sp1' }];
		const out = renderPlan(targets);
		expect(out).toContain('Bundle 1');
		expect(out).toContain('Bundle 2');
		expect(out).toContain('p1');
		expect(out).toContain('m1');
		expect(out).toContain('Singer One');
		expect(out).toContain('Writes issued this run: 0');
	});
});

// ── ProvisionLedger ──────────────────────────────────────────────────────────

describe('ProvisionLedger', () => {
	it('hasFailures is true if ANY profile or tier entry is not the success status', () => {
		const ledger = new ProvisionLedger();
		ledger.recordProfile([{ personId: 'p1', status: 'created', profileId: 'x' }]);
		expect(ledger.hasFailures()).toBe(false);
		ledger.recordTier([{ personId: 'p1', memberId: 'm1', status: 'failed', message: 'boom' }]);
		expect(ledger.hasFailures()).toBe(true);
	});
});
