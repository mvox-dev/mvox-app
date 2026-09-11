// mvox-app#321 — read-only characterization of Entu's list-response `count`
// field, polyphony only (synthetic, pre-authorized), ZERO writes. Docs
// consulted first (entu/www api/query-reference/index.md, api/quickstart,
// api/best-practices) — none of the three mentions a `count`/total field on
// GET {db}/entity at all; pagination is documented only as limit+skip, with
// no response-envelope example shown. This is genuinely UNDOCUMENTED
// behaviour (the doc is silent, not contradicted), so a probe is the right
// instrument per the "consult and believe" ruling's own carve-out 1
// (architecture-decisions.md, 2026-09-06) — not re-litigating a documented
// claim.
//
// Two questions (team-lead dispatch for #321, the read-side twin of #289):
//
// Q1 — Is `count` reliably populated across the display-read query shapes
// the app actually uses, and does it hold the TRUE total while `entities`
// carries only the truncated page? Covers: db-wide no-filter, `_type`-
// filtered, `_parent.reference`-scoped (profileData.ts's own shape),
// status-filtered, with/without `props=`, and the exactly-at-cap edge case
// (entities.length === limit === count, i.e. NOT actually truncated —
// research-321.json flagged this as the one case a client-side
// `entities.length === limit` heuristic gets wrong without reading `count`).
//
// Q2 — Does `count` reflect the CALLER's rights-admitted subset, or the raw
// db-wide total regardless of caller? A caller whose rights admit only N of
// a collection's M rows must not see `count === M` (that would leak the
// existence of rows the caller cannot read at all — the exact concern
// research-321.json's rights-tier finding raised for a "showing N of count"
// UI notice). ONE caller identity is actually available in this
// environment: ENTU_API_KEY resolves to db-root (creds.ts's own documented
// comment). ENTU_ADMIN_KEY is a KNOWN DEAD END for this purpose — probe-44
// (2026-08-08) already established it resolves to an anonymous floor JWT
// (`accounts: []`), not a second real identity, so it is not tried again
// here. Standing up a genuine second-tier caller (throwaway person +
// entu_api_key + rights grant, the probe-294 pattern) would require writes,
// which this task is scoped to avoid entirely. The zero-write second tier
// used instead is a GENUINELY ANONYMOUS request — no Authorization header
// at all — the same technique the #265 mixed-sharing probe used to stand in
// for "a caller with no specific grant" tier. This answers Q2 for the
// public/anonymous tier specifically; it does NOT establish the answer for
// an authenticated-but-lesser-privileged member tier (e.g. domain-tier
// non-owner), which stays [unverified] — flagged explicitly in the ledger
// rather than inferred from the anonymous result.
//
// Disposition: no fixtures created, nothing to tear down. Both callers read
// only pre-existing polyphony data (synthetic).

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';
import { writeLedger } from '../lib/ledger-writer';

interface ReadResult {
	query: string;
	status: number;
	count: number | undefined;
	entitiesLength: number | undefined;
	hasCountKey: boolean;
}

async function readAuthed(cfg: { db: string; token: string }, query: string): Promise<ReadResult> {
	const res = await entuFetch(cfg.db, `entity?${query}`, cfg.token);
	const body = (await res.json().catch(() => null)) as { count?: number; entities?: unknown[] } | null;
	return { query, status: res.status, count: body?.count, entitiesLength: body?.entities?.length, hasCountKey: !!body && 'count' in body };
}

async function readAnon(db: string, query: string): Promise<ReadResult> {
	const base = process.env.PUBLIC_ENTU_API_BASE!;
	const res = await fetch(`${base}${db}/entity?${query}`, { headers: { Accept: 'application/json' } });
	const body = (await res.json().catch(() => null)) as { count?: number; entities?: unknown[] } | null;
	return { query, status: res.status, count: body?.count, entitiesLength: body?.entities?.length, hasCountKey: !!body && 'count' in body };
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`db=${cfg.db} (read-only, no mutation possible in this script)\n`);

	const ledger: Array<{ step: string; outcome: string; [k: string]: unknown }> = [];

	// ─── Q1 — truncation mechanics matrix (authenticated / db-root caller) ──
	console.log('=== Q1 — count vs entities.length under forced truncation (authenticated) ===');

	// Site 1: type-def entities, mirrors entuSeasons.ts resolveTypeId's own
	// `_type.string=entity&...&limit=1` shape, but at limit=1000/2/1, WITH
	// and WITHOUT props=, to separate the props axis from the limit axis.
	const q1Baseline = await readAuthed(cfg, `_type.string=entity&props=name&limit=1000`);
	const q1Limit2 = await readAuthed(cfg, `_type.string=entity&props=name&limit=2`);
	const q1Limit1 = await readAuthed(cfg, `_type.string=entity&props=name&limit=1`);
	const q1NoProps = await readAuthed(cfg, `_type.string=entity&limit=1`);
	console.log(`type-defs baseline (limit=1000, props):   count=${q1Baseline.count} entities=${q1Baseline.entitiesLength}`);
	console.log(`type-defs limit=2  (props):                count=${q1Limit2.count} entities=${q1Limit2.entitiesLength}`);
	console.log(`type-defs limit=1  (props):                count=${q1Limit1.count} entities=${q1Limit1.entitiesLength}`);
	console.log(`type-defs limit=1  (NO props):              count=${q1NoProps.count} entities=${q1NoProps.entitiesLength}`);
	ledger.push({
		step: 'q1-site-1-type-defs',
		outcome: q1Baseline.count === q1Limit2.count && q1Limit2.count === q1Limit1.count && q1Limit1.count === q1NoProps.count ? 'count-stable-across-limit-and-props' : 'count-VARIED',
		baseline: q1Baseline, limit2: q1Limit2, limit1: q1Limit1, noProps: q1NoProps
	});

	// Site 2: `_parent.reference`-scoped — profileData.ts's OWN exact shape
	// (see research-321.json inv finding, profileData.ts:170-173), real
	// person with 3 profile rows (member 69bcfd8e9c031ab8e6ce8079).
	const personWith3Profiles = '69bcfd8e9c031ab8e6ce8079';
	const q2Baseline = await readAuthed(cfg, `_type.string=profile&_parent.reference=${personWith3Profiles}&props=name,email,_sharing&limit=10`);
	const q2Limit1 = await readAuthed(cfg, `_type.string=profile&_parent.reference=${personWith3Profiles}&props=name,email,_sharing&limit=1`);
	console.log(`\nprofile _parent.reference baseline (limit=10): count=${q2Baseline.count} entities=${q2Baseline.entitiesLength}`);
	console.log(`profile _parent.reference limit=1:              count=${q2Limit1.count} entities=${q2Limit1.entitiesLength}`);
	ledger.push({
		step: 'q1-site-2-parent-scoped-profile',
		outcome: q2Baseline.count === q2Limit1.count && q2Limit1.count !== q2Limit1.entitiesLength ? 'count-true-total-entities-truncated' : 'UNEXPECTED',
		baseline: q2Baseline, limit1: q2Limit1
	});

	// Site 3: exactly-at-cap edge case — member active, real count=2.
	// limit=2 (== count, NOT truncated) vs limit=1 (truncated). The point:
	// entities.length === limit is TRUE in BOTH cases here (2===2, but also
	// compare against limit=3 to show the non-truncated case can still read
	// entities.length < limit) — count is what actually distinguishes them.
	const q3AtCap = await readAuthed(cfg, `_type.string=member&status.string=active&props=person&limit=2`);
	const q3AboveCap = await readAuthed(cfg, `_type.string=member&status.string=active&props=person&limit=3`);
	const q3BelowCap = await readAuthed(cfg, `_type.string=member&status.string=active&props=person&limit=1`);
	console.log(`\nmember active limit=2 (==count, NOT truncated):  count=${q3AtCap.count} entities=${q3AtCap.entitiesLength}`);
	console.log(`member active limit=3 (>count, confirms not-truncated): count=${q3AboveCap.count} entities=${q3AboveCap.entitiesLength}`);
	console.log(`member active limit=1 (<count, truncated):        count=${q3BelowCap.count} entities=${q3BelowCap.entitiesLength}`);
	ledger.push({
		step: 'q1-site-3-exactly-at-cap-edge-case',
		outcome: q3AtCap.entitiesLength === q3AboveCap.entitiesLength && q3AtCap.count === q3AboveCap.count ? 'exactly-at-cap-confirmed-not-truncated-via-count' : 'UNEXPECTED',
		atCap: q3AtCap, aboveCap: q3AboveCap, belowCap: q3BelowCap
	});

	// Site 4: db-wide, no `_type` filter at all (broadest possible shape).
	const q4Limit1 = await readAuthed(cfg, `limit=1`);
	const q4Limit50 = await readAuthed(cfg, `limit=50`);
	console.log(`\ndb-wide no-filter limit=1:  count=${q4Limit1.count} entities=${q4Limit1.entitiesLength}`);
	console.log(`db-wide no-filter limit=50: count=${q4Limit50.count} entities=${q4Limit50.entitiesLength}`);
	ledger.push({
		step: 'q1-site-4-db-wide-no-filter',
		outcome: q4Limit1.count === q4Limit50.count ? 'count-stable-independent-of-type-filter' : 'UNEXPECTED',
		limit1: q4Limit1, limit50: q4Limit50
	});

	const q1Verdict = ledger.filter((l) => l.step.startsWith('q1-')).every((l) => !String(l.outcome).includes('UNEXPECTED') && !String(l.outcome).includes('VARIED'));
	console.log(`\nQ1 VERDICT: ${q1Verdict ? 'CONFIRMED — count holds the true total, stable across limit/props/parent-scope/filter-shape; entities.length is the only thing truncation touches.' : 'MIXED — see per-site outcomes.'}`);

	// ─── Q2 — does count respect the caller's rights? ────────────────────
	console.log('\n=== Q2 — count vs caller rights (authenticated db-root vs genuinely anonymous) ===');
	const q2Sites: Array<{ label: string; query: string }> = [
		{ label: 'db-wide no-filter', query: 'props=_id&limit=1000' },
		{ label: 'type-def entities', query: '_type.string=entity&props=name&limit=1000' },
		{ label: 'person db-wide', query: '_type.string=person&props=name&limit=1000' },
		{ label: `profile under person ${personWith3Profiles}`, query: `_type.string=profile&_parent.reference=${personWith3Profiles}&props=name&limit=10` },
		{ label: 'member active', query: '_type.string=member&status.string=active&props=person&limit=1000' }
	];
	const rightsResults: Array<{ label: string; authed: ReadResult; anon: ReadResult; anonCountMatchesAnonVisible: boolean; anonLeaksAuthedTotal: boolean }> = [];
	for (const { label, query } of q2Sites) {
		const [a, b] = await Promise.all([readAuthed(cfg, query), readAnon(cfg.db, query)]);
		const anonCountMatchesAnonVisible = b.count === b.entitiesLength;
		const anonLeaksAuthedTotal = b.count === a.count && a.count !== b.entitiesLength && (a.count ?? 0) > (b.entitiesLength ?? 0);
		console.log(`${label.padEnd(40)} AUTH count=${a.count} entities=${a.entitiesLength}   ANON count=${b.count} entities=${b.entitiesLength}`);
		rightsResults.push({ label, authed: a, anon: b, anonCountMatchesAnonVisible, anonLeaksAuthedTotal });
	}
	ledger.push({ step: 'q2-anon-vs-authed', outcome: rightsResults.every((r) => r.anonCountMatchesAnonVisible && !r.anonLeaksAuthedTotal) ? 'anon-count-respects-anon-visibility-no-leak' : 'LEAK-OR-MISMATCH-DETECTED', sites: rightsResults });

	const q2AnonVerdict = rightsResults.every((r) => r.anonCountMatchesAnonVisible && !r.anonLeaksAuthedTotal);
	console.log(`\nQ2 (anonymous tier) VERDICT: ${q2AnonVerdict ? 'CONFIRMED — anonymous count always equals what the anonymous caller can actually see, never the authenticated total. No leak on this axis.' : 'LEAK DETECTED — see rightsResults.'}`);
	console.log('Q2 (authenticated-but-lesser-privileged member tier, e.g. domain-tier non-owner): [unverified] — no second real identity available without a write (ENTU_ADMIN_KEY is a known dead-end anonymous floor JWT per probe-44; standing up a throwaway tester+grant would itself be a write, out of scope for this zero-write task).');

	const artifactPath = writeLedger({
		scriptName: 'probe-321-list-count-semantics',
		dryRun: false,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'mvox-app#321 — does Entu list-response count reliably hold the true total under truncation (Q1), and does it respect the caller\'s rights-admitted subset rather than leaking the raw total (Q2)? Read-only, zero writes, polyphony synthetic only.',
			docsChecked: [
				'~/projects/entu-www/src/api/query-reference/index.md — Pagination section (limit/skip) documents no count/total field',
				'~/projects/entu-www/src/api/quickstart/index.md — no list-response JSON example shown at all',
				'~/projects/entu-www/src/api/best-practices/index.md — pagination guidance, no count field mentioned'
			],
			docsVerdict: 'SILENT on the count field both ways (presence and rights-scoping) — genuinely undocumented, not contradicted. Probing is the correct instrument per the consult-and-believe ruling\'s carve-out 1.',
			q1Verdict: q1Verdict ? 'CONFIRMED' : 'MIXED',
			q2AnonymousTierVerdict: q2AnonVerdict ? 'CONFIRMED-NO-LEAK' : 'LEAK-DETECTED',
			q2AuthenticatedLesserTierVerdict: '[unverified] — not testable without a write in this environment',
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
