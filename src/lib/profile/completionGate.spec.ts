import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { MyProfile } from './profileData';

// T4.8/#28 RED — the completion-gate DECISION logic, tested as extracted pure/async
// utilities (the load-bearing gate-completeness + two-case separation), not brittle
// DOM. RED: hasDomainName / resolveGate / assertDomainNamePersisted are stubs that
// throw 'not implemented', so every assertion below FAILS until GREEN fills them.
//
// `hasDomainName` is pure — driven with MyProfile[] literals, no mock. `resolveGate`
// and `assertDomainNamePersisted` re-read via listMyProfiles, so it is mocked at the
// module boundary (real profilesByLevel kept via importActual, so GREEN exercises the
// real by-level indexer).

const { listMyProfilesMock } = vi.hoisted(() => ({ listMyProfilesMock: vi.fn() }));
vi.mock('./profileData', async (importActual) => {
	const actual = await importActual<typeof import('./profileData')>();
	return { ...actual, listMyProfiles: listMyProfilesMock };
});

import {
	hasDomainName,
	hasVisibleName,
	resolveGate,
	assertDomainNamePersisted,
	DomainNameInconsistencyError
} from './completionGate';

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt-abc' };

function profile(sharing: MyProfile['_sharing'], name: string, email = ''): MyProfile {
	return { _id: `p-${sharing}`, name, email, _sharing: sharing };
}

beforeEach(() => {
	listMyProfilesMock.mockReset();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('hasDomainName — the SSOT predicate (name on the domain-visibility entity)', () => {
	it('no domain entity at all → incomplete (Case 1: genuinely no name)', () => {
		expect(hasDomainName([])).toBe('incomplete');
	});

	it('domain entity with an EMPTY name → incomplete (Case 1: transition-window nameless)', () => {
		expect(hasDomainName([profile('domain', '')])).toBe('incomplete');
	});

	it('domain entity with a non-empty name → complete', () => {
		expect(hasDomainName([profile('domain', 'Ann')])).toBe('complete');
	});

	it('a PUBLIC-only name does NOT satisfy the gate — must read the domain entity, never resolveField', () => {
		// A public-tier name is domain-READABLE (written to both buckets), so a
		// resolveField-based gate would wrongly PASS this. The gate must check the
		// entity whose OWN _sharing === 'domain', which is absent here.
		expect(hasDomainName([profile('public', 'Ann')])).toBe('incomplete');
	});

	it('a PRIVATE-only name does NOT satisfy the gate (under-shares — invisible to fellow members)', () => {
		expect(hasDomainName([profile('private', 'Ann')])).toBe('incomplete');
	});

	it('public name present BUT domain name empty → incomplete (the domain entity governs, not the widest holder)', () => {
		expect(hasDomainName([profile('public', 'Ann'), profile('domain', '')])).toBe('incomplete');
	});

	it('NO email substitution — a domain entity with an email but no name is still incomplete', () => {
		expect(hasDomainName([profile('domain', '', 'ann@example.com')])).toBe('incomplete');
	});

	it('a WHITESPACE-ONLY domain name does NOT satisfy the gate (trimmed to empty — matches canSave)', () => {
		expect(hasDomainName([profile('domain', '   ')])).toBe('incomplete');
		expect(hasDomainName([profile('domain', '\t\n ')])).toBe('incomplete');
	});
});

describe('hasVisibleName — #58 Mihkel ruling: domain OR public tier satisfies', () => {
	it('a domain name satisfies the gate', () => {
		expect(hasVisibleName([profile('domain', 'Ann')])).toBe('complete');
	});

	it('a public name satisfies the gate (a public name is readable by fellow members too)', () => {
		expect(hasVisibleName([profile('public', 'Ann')])).toBe('complete');
	});

	it('a PRIVATE-only name does NOT satisfy the gate (under-shares — invisible to fellow members)', () => {
		expect(hasVisibleName([profile('private', 'Ann')])).toBe('incomplete');
	});

	it('no profiles at all → incomplete', () => {
		expect(hasVisibleName([])).toBe('incomplete');
	});

	it('domain name empty, public name empty → incomplete', () => {
		expect(hasVisibleName([profile('domain', ''), profile('public', '')])).toBe('incomplete');
	});

	it('domain name empty but public name present → complete (the widened case #58 fixes)', () => {
		expect(hasVisibleName([profile('domain', ''), profile('public', 'Ann')])).toBe('complete');
	});

	it('domain name present, public entity absent → complete', () => {
		expect(hasVisibleName([profile('domain', 'Ann')])).toBe('complete');
	});

	it('a WHITESPACE-ONLY public name does NOT satisfy the gate (trimmed to empty — matches hasDomainName)', () => {
		expect(hasVisibleName([profile('public', '   ')])).toBe('incomplete');
	});

	it('a private name alongside an empty domain/public does NOT satisfy the gate', () => {
		expect(
			hasVisibleName([profile('private', 'Ann'), profile('domain', ''), profile('public', '')])
		).toBe('incomplete');
	});
});

describe('resolveGate — async read + classify, fail-safe', () => {
	it('domain name present → complete', async () => {
		listMyProfilesMock.mockResolvedValue([profile('domain', 'Ann')]);
		expect(await resolveGate(cfg, 'person-p')).toBe('complete');
	});

	it('domain name absent → incomplete', async () => {
		listMyProfilesMock.mockResolvedValue([profile('domain', '')]);
		expect(await resolveGate(cfg, 'person-p')).toBe('incomplete');
	});

	it('#58: domain name absent but PUBLIC name present → complete (widened Case-1 gate)', async () => {
		listMyProfilesMock.mockResolvedValue([profile('domain', ''), profile('public', 'Ann')]);
		expect(await resolveGate(cfg, 'person-p')).toBe('complete');
	});

	it('private-only name does NOT satisfy resolveGate', async () => {
		listMyProfilesMock.mockResolvedValue([profile('private', 'Ann')]);
		expect(await resolveGate(cfg, 'person-p')).toBe('incomplete');
	});

	it('FAIL-SAFE: a listMyProfiles rejection resolves to loading, NEVER a false incomplete (no transient redirect)', async () => {
		listMyProfilesMock.mockRejectedValue(new Error('listMyProfiles failed: 503'));
		expect(await resolveGate(cfg, 'person-p')).toBe('loading');
	});
});

describe('assertDomainNamePersisted — Case 2 write-path post-condition (fail loud)', () => {
	it('read-back shows the domain name persisted → resolves (honest round trip released)', async () => {
		listMyProfilesMock.mockResolvedValue([profile('domain', 'Ann')]);
		await expect(assertDomainNamePersisted(cfg, 'person-p')).resolves.toBeUndefined();
	});

	it('a save reported success yet read-back shows NO domain name → throws DomainNameInconsistencyError naming the person (NOT a silent empty row)', async () => {
		listMyProfilesMock.mockResolvedValue([profile('domain', '')]);
		const err = await assertDomainNamePersisted(cfg, 'person-p').catch((e) => e);
		expect(err).toBeInstanceOf(DomainNameInconsistencyError);
		expect((err as Error).message).toContain('person-p');
	});
});

// (*MVOX:Tallis*)
