// #360 — the done-when sweep AS A TEST: "A search of the tree finds no
// remaining render of a composed invite URL." This spec walks every non-spec
// source file under src/, classifies every site where invite-link material
// appears (buildInviteUrl / buildInviteProviderHref / `/invite/${…}`
// interpolation, or an identifier assigned from one of those), and:
//
//   1. proves the INSTRUMENT on inline fixtures first (negative-from-the-
//      instrument law: a clean negative is a claim about the instrument until
//      the instrument is shown to catch the leak it exists for);
//   2. asserts the FORBIDDEN kinds (markup-value, markup-text) are EMPTY —
//      the #360 ruling: the invite URL/token never renders, in any state;
//   3. asserts the full enumeration of remaining (allowed) sites equals a
//      maintained allowlist of the copy-only / navigation-only sites — so a
//      FUTURE file that starts composing or navigating invite URLs fails the
//      suite and forces a conscious allowlist decision.
//
// REDEEM-PATH BOUNDARY (Gama, #360, verbatim): "'not shown on screen' governs
// admin surfaces where someone else's bearer secret sits before a third
// party; on the redeem path the token is in its owner's hands and carrying it
// is what an invite link is." — which is why the invite/[token] landing's
// href={…} sites and the auth callback's redirect composition are ALLOWED
// entries below, not violations.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
	FORBIDDEN_KINDS,
	findCarriers,
	scanInviteUrlSites,
	type InviteSite
} from '$lib/testing/inviteRenderSweep';

// ── 1. the instrument, proven on inline fixtures ─────────────────────────────

describe('#360 sweep instrument — the classifier catches the leak it exists for', () => {
	const SCRIPT = [
		'<script lang="ts">',
		"\timport { buildInviteUrl } from '$lib/invite/invite-links';",
		"\tlet inviteLink = '';",
		"\tinviteLink = buildInviteUrl(window.location.origin, 'tok');",
		'</script>'
	].join('\n');

	it('finds the carrier assigned from buildInviteUrl (direct and object-literal update)', () => {
		expect(findCarriers("inviteLink = buildInviteUrl(origin, token)")).toContain('inviteLink');
		expect(
			findCarriers(
				'inviteLinkByMemberId = { ...inviteLinkByMemberId, [row.memberId]: buildInviteUrl(o, t) }'
			)
		).toContain('inviteLinkByMemberId');
		expect(findCarriers('const retryHref = $derived(`/invite/${encodeURIComponent(token)}`)')).toContain(
			'retryHref'
		);
	});

	it('a readonly input VALUE-binding the link is classified markup-value — forbidden', () => {
		const sites = scanInviteUrlSites(
			'fixture.svelte',
			`${SCRIPT}\n<input readonly value={inviteLink} />`
		);
		expect(sites.map((s) => s.kind)).toContain('markup-value');
	});

	it('a text interpolation of the link is classified markup-text — forbidden', () => {
		const sites = scanInviteUrlSites('fixture.svelte', `${SCRIPT}\n<p>{inviteLink}</p>`);
		expect(sites.map((s) => s.kind)).toContain('markup-text');
	});

	it('a bare buildInviteUrl call rendered in markup is forbidden too — no carrier needed', () => {
		const sites = scanInviteUrlSites(
			'fixture.svelte',
			`${SCRIPT}\n<p>{buildInviteUrl(origin, token)}</p>`
		);
		expect(sites.map((s) => s.kind)).toContain('markup-text');
	});

	it('an {#if} guard on the carrier is markup-guard — allowed (renders nothing)', () => {
		const sites = scanInviteUrlSites(
			'fixture.svelte',
			`${SCRIPT}\n{#if inviteLink}\n<button type="button">copy</button>\n{/if}`
		);
		const markup = sites.filter((s) => s.kind !== 'script-compose');
		expect(markup.map((s) => s.kind)).toEqual(['markup-guard']);
	});

	it('href={…} carrying the token is markup-href — the redeem path’s navigation-only shape', () => {
		const sites = scanInviteUrlSites(
			'fixture.svelte',
			`${SCRIPT}\n<a href={buildInviteProviderHref(provider.id, token)}>continue</a>`
		);
		expect(sites.map((s) => s.kind)).toContain('markup-href');
	});

	it('a copy-only surface (button + handler, no rendered link) yields NO forbidden site', () => {
		const sites = scanInviteUrlSites(
			'fixture.svelte',
			`${SCRIPT}\n<button type="button" onclick={() => copyLink()}>copy</button>`
		);
		expect(sites.filter((s) => FORBIDDEN_KINDS.has(s.kind))).toEqual([]);
	});

	it('.ts sources report script-compose sites (enumerable, never renderable)', () => {
		const sites = scanInviteUrlSites(
			'fixture.ts',
			'const landing = `/invite/${encodeURIComponent(invite.token)}`;'
		);
		expect(sites.map((s) => s.kind)).toEqual(['script-compose']);
	});
});

// ── 2 + 3. the tree ───────────────────────────────────────────────────────────

/** Non-spec source files under src/, skipping generated + test-infra dirs. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const rel = relative(process.cwd(), full).replaceAll('\\', '/');
		if (rel === 'src/lib/paraglide' || rel === 'src/lib/testing') continue; // generated / instrument
		if (statSync(full).isDirectory()) {
			sourceFiles(full, out);
			continue;
		}
		if (!/\.(ts|svelte)$/.test(name)) continue;
		if (/\.spec\./.test(name) || name.endsWith('.d.ts')) continue;
		out.push(rel);
	}
	return out;
}

function sweepTree(): InviteSite[] {
	const sites: InviteSite[] = [];
	for (const file of sourceFiles(join(process.cwd(), 'src'))) {
		sites.push(...scanInviteUrlSites(file, readFileSync(file, 'utf-8')));
	}
	return sites;
}

describe('#360 tree sweep — no composed invite URL reaches rendered text, ever', () => {
	it('FORBIDDEN sites (markup-value / markup-text) — none, in any non-spec source file', () => {
		const forbidden = sweepTree().filter((s) => FORBIDDEN_KINDS.has(s.kind));
		expect(
			forbidden.map((s) => `${s.file}:${s.line} [${s.kind}] ${s.excerpt}`),
			'#360: the invite URL/token must never render — copy-to-clipboard is the only egress'
		).toEqual([]);
	});

	it('full enumeration: every remaining site is a KNOWN copy-only or navigation-only site', () => {
		const found = [
			...new Set(
				sweepTree()
					.filter((s) => !FORBIDDEN_KINDS.has(s.kind))
					.map((s) => `${s.file} :: ${s.kind}`)
			)
		].sort();
		// The maintained allowlist. Adding an entry here is a CONSCIOUS decision
		// that a new site is copy-only or navigation-only — see the redeem-path
		// boundary comment at the top of this file for why invite/[token] and the
		// auth callback belong on it.
		expect(found).toEqual(
			[
				// the one composer module (script only, exports pure builders)
				'src/lib/invite/invite-links.ts :: script-compose',
				// admin surface — composes in script, egress is the clipboard only
				'src/lib/components/admin/InviteSurface.svelte :: script-compose',
				// roster rows — compose in script, {#if} guards gate the copy panel
				'src/routes/roster/+page.svelte :: script-compose',
				'src/routes/roster/+page.svelte :: markup-guard',
				// REDEEM PATH (owner's own hands — see boundary comment above):
				// the landing page navigates/hrefs the token, never shows it as text
				'src/routes/invite/[token]/+page.svelte :: script-compose',
				'src/routes/invite/[token]/+page.svelte :: markup-href',
				// auth callback — composes the redirect target for goto, script only
				'src/routes/auth/callback/run-invite-callback.ts :: script-compose'
			].sort()
		);
	});
});

// (*MVOX:Tallis* — #360 RED: the done-when sweep as a standing suite — fixture-
//  proven classifier, forbidden-kinds-empty, full enumeration over an allowlist)
