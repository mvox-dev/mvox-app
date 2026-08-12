// #127 follow-up — Nest Baritone under Bass
//
// PO ruling changed (Mihkel, 2026-08-13, relayed by team-lead): Baritone no longer stays
// standalone. It becomes a sub-section of Bass — same additive pattern already used for
// Soprano I/II under Soprano etc. in section-cleanup-127-2026-08-13.ts (org-parent link
// stays, a new section-parent link is added).
//
// Scope: BOTH Baritone sections (RAM + TAM) — neither is merged into the other, neither
// absorbs the other's members. Each just gains a second _parent link pointing at EFK's
// Bass section. No member reassignment, no deletion — this is Step C hierarchy only.
//
//   RAM Baritone  69c7f8828489bfcb0e81b3ec  -> add parent Bass/EFK 69c7f8768489bfcb0e81b163
//   TAM Baritone  69c7f8898489bfcb0e81b580  -> add parent Bass/EFK 69c7f8768489bfcb0e81b163
//
// DRY_RUN=true by default. Set DRY_RUN=false ONLY after the dry-run ledger has been
// reviewed and team-lead has sent explicit "I authorize this run".
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/section-cleanup-127-baritone-nest-2026-08-13.ts                # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/section-cleanup-127-baritone-nest-2026-08-13.ts                # ONLY after authorization

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

interface SectionRef {
	id: string;
	name: string;
	org: string;
}

const BASS_EFK: SectionRef = { id: '69c7f8768489bfcb0e81b163', name: 'Bass', org: 'Eesti Filharmoonia Kammerkoor' };
const RAM_BARITONE: SectionRef = { id: '69c7f8828489bfcb0e81b3ec', name: 'Baritone', org: 'Eesti Rahvusmeeskoor' };
const TAM_BARITONE: SectionRef = { id: '69c7f8898489bfcb0e81b580', name: 'Baritone', org: 'Tartu Akadeemiline Meeskoor' };

const NEST_UNDER: Array<{ child: SectionRef; parent: SectionRef }> = [
	{ child: RAM_BARITONE, parent: BASS_EFK },
	{ child: TAM_BARITONE, parent: BASS_EFK }
];

interface ParentValue {
	_id: string;
	reference: string;
	entity_type?: string;
	string?: string;
}

interface LedgerEntry {
	phase: 'phase0-verify' | 'C-nest';
	action: string;
	targetId: string;
	targetLabel: string;
	status: 'ok' | 'skipped-already-done' | 'failed' | 'dry-run';
	detail?: string;
	error?: string;
}

const ledger: LedgerEntry[] = [];

function writeLedger(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'ledgers');
	const filename = `section-cleanup-127-baritone-nest-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function verifySection(cfg: EntuCfg, ref: SectionRef, label: string): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${ref.id}?props=name,_parent`, cfg.token);
	if (!res.ok) throw new Error(`Phase 0 verify ${label} (${ref.id}): GET failed ${res.status}`);
	const body = (await res.json()) as {
		entity: { name?: Array<{ string: string }>; _parent?: ParentValue[] };
	};
	const liveName = body.entity.name?.[0]?.string;
	const liveOrg = body.entity._parent?.find((p) => p.entity_type === 'organization')?.string;
	if (liveName !== ref.name || liveOrg !== ref.org) {
		throw new Error(
			`Phase 0 verify ${label} (${ref.id}): DRIFT — expected name=${JSON.stringify(ref.name)} org=${JSON.stringify(ref.org)}, ` +
				`found name=${JSON.stringify(liveName)} org=${JSON.stringify(liveOrg)}. Refusing to proceed.`
		);
	}
	ledger.push({
		phase: 'phase0-verify',
		action: 'verify-section',
		targetId: ref.id,
		targetLabel: label,
		status: 'ok',
		detail: `name=${liveName} org=${liveOrg}`
	});
}

async function nestSection(cfg: EntuCfg, child: SectionRef, parent: SectionRef): Promise<void> {
	const label = `${child.name}/${child.org} -> parent ${parent.name}/${parent.org}`;
	const res = await entuFetch(cfg.db, `entity/${child.id}?props=_parent`, cfg.token);
	if (!res.ok) throw new Error(`nestSection(${child.id}): GET failed ${res.status}`);
	const body = (await res.json()) as { entity: { _parent?: ParentValue[] } };
	const alreadyNested = (body.entity._parent ?? []).some((p) => p.reference === parent.id);

	if (alreadyNested) {
		ledger.push({ phase: 'C-nest', action: 'nest-section', targetId: child.id, targetLabel: label, status: 'skipped-already-done' });
		return;
	}

	if (DRY_RUN) {
		ledger.push({ phase: 'C-nest', action: 'nest-section', targetId: child.id, targetLabel: label, status: 'dry-run' });
		return;
	}

	try {
		const postRes = await entuFetch(cfg.db, `entity/${child.id}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: '_parent', reference: parent.id }])
		});
		if (!postRes.ok) {
			const text = await postRes.text().catch(() => '(no body)');
			throw new Error(`POST parent link failed: ${postRes.status} — ${text}`);
		}
		const verifyRes = await entuFetch(cfg.db, `entity/${child.id}?props=_parent`, cfg.token);
		if (!verifyRes.ok) throw new Error(`read-back verify GET failed: ${verifyRes.status}`);
		const verifyBody = (await verifyRes.json()) as { entity: { _parent?: ParentValue[] } };
		const nowNested = (verifyBody.entity._parent ?? []).some((p) => p.reference === parent.id);
		if (!nowNested) throw new Error('read-back verify FAILED: parent link not present after POST — apparent-success trap');
		ledger.push({ phase: 'C-nest', action: 'nest-section', targetId: child.id, targetLabel: label, status: 'ok' });
	} catch (err) {
		ledger.push({
			phase: 'C-nest',
			action: 'nest-section',
			targetId: child.id,
			targetLabel: label,
			status: 'failed',
			error: err instanceof Error ? err.message : String(err)
		});
	}
}

async function main(): Promise<void> {
	console.log(`#127 baritone-under-bass nest — DRY_RUN=${DRY_RUN}`);
	const cfg = await loadCfg();

	console.log('\n== Phase 0: verify frozen section IDs against live data ==');
	await verifySection(cfg, BASS_EFK, 'BASS_EFK (target parent)');
	await verifySection(cfg, RAM_BARITONE, 'RAM_BARITONE');
	await verifySection(cfg, TAM_BARITONE, 'TAM_BARITONE');

	console.log('\n== Step C: nest Baritone sections under Bass/EFK ==');
	for (const { child, parent } of NEST_UNDER) {
		console.log(`[C] nesting ${child.name}/${child.org} under ${parent.name}/${parent.org}`);
		await nestSection(cfg, child, parent);
	}

	const summary = {
		ok: ledger.filter((e) => e.status === 'ok').length,
		skipped: ledger.filter((e) => e.status === 'skipped-already-done').length,
		dryRun: ledger.filter((e) => e.status === 'dry-run').length,
		failed: ledger.filter((e) => e.status === 'failed').length
	};
	console.log('\n== Summary ==', summary);

	const path = writeLedger({ dryRun: DRY_RUN, generatedAt: new Date().toISOString(), summary, ledger });
	console.log(`Ledger written: ${path}`);

	if (summary.failed > 0) {
		console.error(`\n${summary.failed} failed — see ledger for detail.`);
		process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exitCode = 1;
});

// (*MVOX:Perotin*)
