// mvox-app#282 — read-only probe, no mutation. id_code does not exist yet
// on either db (that's what the seed-282 dry-run confirms), so a dry-run
// against it structurally cannot produce a real read-back line — there is
// nothing to read back until either a live create or a later idempotent
// run finds it. Team-lead asked to SEE the read-back-survives-redaction
// property demonstrated before authorizing the live run. This probe
// answers that directly: it runs `assertPropDefSharing` (the exact
// primitive seed-282 will call) against an EXISTING sibling prop-def on
// the SAME type — `admin_member_record.phone`, already live and
// `private` since #265 — through the SAME writeLedger path, and the
// resulting ledger is inspected for whether propDefId/sharing/ordinal
// survive or get swallowed by DEFAULT_REDACT_FIELDS.
//
// Zero mutation: `assertPropDefSharing` is a GET + assert, never a write.
// Nothing about phone's own value is touched or read — only its prop-def
// metadata (_sharing tier).

import { resolveMetaTypeIds, resolveTypeIdByName, assertPropDefSharing, type LedgerStep } from '../lib/ensure-schema-type';
import { admin_member_record } from '../lib/mvox-schema-extensions';
import { loadCredeCfg } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';
import { entuFetch } from '$lib/entu/request';

async function main(): Promise<void> {
	const cfg = await loadCredeCfg();
	console.log(`db=${cfg.db} — probing read-back mechanism against an EXISTING prop-def (phone), read-only\n`);

	const ledger: LedgerStep[] = [];

	const { entityMetaTypeId, propertyMetaTypeId } = await resolveMetaTypeIds(cfg);
	const typeId = await resolveTypeIdByName(cfg, entityMetaTypeId, admin_member_record.name);
	console.log(`admin_member_record type-def: ${typeId}`);

	// Resolve phone's existing prop-def id the same way ensurePropDef's
	// existence check does — by _parent + name.string lookup.
	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${propertyMetaTypeId}&_parent.reference=${typeId}&name.string=phone&props=_id&limit=1`,
		cfg.token
	);
	const body = (await res.json()) as { entities?: Array<{ _id: string }> };
	const phonePropDefId = body.entities?.[0]?._id;
	if (!phonePropDefId) throw new Error('phone prop-def not found — cannot probe read-back against it');

	await assertPropDefSharing(cfg, phonePropDefId, `${admin_member_record.name}.phone`, 'private', ledger);
	console.log(`read-back-asserted: propDefId=${phonePropDefId} sharing=private ✓ (this is EXACTLY the line seed-282 will produce for id_code once it exists)`);

	const artifactPath = writeLedger({
		scriptName: 'probe-282-readback-redaction-survival',
		dryRun: true,
		db: cfg.db,
		sensitive: false,
		acknowledgedNonSensitive: true,
		payload: {
			purpose: 'demonstrate that assertPropDefSharing read-back lines (target/id/after.sharing) survive DEFAULT_REDACT_FIELDS redaction — no mutation, phone prop-def only, read-only GET',
			probedField: 'admin_member_record.phone (existing sibling, not id_code — id_code does not exist yet)',
			entityMetaTypeId,
			propertyMetaTypeId,
			adminMemberRecordTypeId: typeId,
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
	console.log('Inspect the ledger JSON directly — target/id/after.sharing should read in the clear, not [REDACTED].');
}

main().catch((err) => {
	console.error('probe-282-readback-redaction-survival ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
