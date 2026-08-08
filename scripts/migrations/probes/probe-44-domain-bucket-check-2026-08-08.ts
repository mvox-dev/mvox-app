// Read-only pre-execution gate (#44 / epic #37 D3). Is the `entu_api_key` value on
// person 69bcfd8e9c031ab8e6ce8079 (db-root/PO, the #43 hit) exposed at the DOMAIN
// tier? A db-root read alone can't answer this — db-root always sees the private
// bucket regardless of tier (per architecture-decisions.md "3-gate-AND" mechanics).
//
// Two approaches attempted:
// 1. Genuine non-db-root seat read via the locally-stored ENTU_ADMIN_KEY — this
//    FAILED as a discriminator: the key exchanges to an ANONYMOUS FLOOR JWT
//    (`accounts:[]`, no OAuth-linked identity — confirmed live, matches the known
//    "api-key on a person with no OAuth account" mechanic). Recorded as a finding
//    so a future run doesn't re-assume ENTU_ADMIN_KEY is a real second member seat.
// 2. Bucket-level structural check (the approach that actually answers the
//    question): the 3-gate-AND requires the INSTANCE's own `_sharing` to be
//    domain/public for ANY of its properties to reach the domain bucket, regardless
//    of the prop-def's own tier. Reading db-root's OWN person entity's `_sharing`
//    (a value db-root can always see about itself, no ambiguity) settles gate 3
//    directly.
//
// Never logs the `.string` value of entu_api_key/entu_passkey. No writes.
import { entuFetch } from '$lib/entu/request';
import { exchangeApiKeyForJwt, normalizeBase, loadCfg } from '../lib/creds';

const TARGET_PERSON_ID = '69bcfd8e9c031ab8e6ce8079'; // db-root/PO — the #43 hit
const PERSON_TYPE_OWN_SHARING_FROM_41 = 'domain'; // gate 2, from #41's probe-epic37-phase1-inventory
const ENTU_API_KEY_PROPDEF_SHARING_FROM_41 = 'domain'; // gate 1, from #41's personDeferredDomainPropDefs

async function attemptAdminSeatRead() {
	const rawBase = process.env.ENTU_API_URL;
	const db = process.env.ENTU_DATABASE;
	const adminKey = process.env.ENTU_ADMIN_KEY;
	if (!rawBase || !db || !adminKey) {
		return { attempted: false, note: 'ENTU_ADMIN_KEY/ENTU_API_URL/ENTU_DATABASE not fully set — skipped' };
	}
	const base = normalizeBase(rawBase);
	const url = `${base}auth`;
	const authRes = await fetch(url, { headers: { Authorization: `Bearer ${adminKey}`, Accept: 'application/json' } });
	const authBody = (await authRes.json()) as { accounts?: unknown[]; user?: Record<string, unknown>; token?: string };
	const isAnonymousFloor = Array.isArray(authBody.accounts) && authBody.accounts.length === 0;
	if (isAnonymousFloor || !authBody.token) {
		return {
			attempted: true,
			usable: false,
			reason: 'ENTU_ADMIN_KEY resolves to an anonymous floor JWT (accounts:[]) — not identity-linked to a real member/OAuth account. Cannot be used to simulate a genuine domain-tier member seat.'
		};
	}
	// (Not reached today, but kept so a future real second-seat credential exercises this path.)
	const res = await entuFetch(db, `entity/${TARGET_PERSON_ID}?props=entu_api_key,entu_passkey`, authBody.token);
	type Row = { entu_api_key?: Array<{ _id: string }>; entu_passkey?: Array<{ _id: string }> };
	if (!res.ok) return { attempted: true, usable: true, httpOutcome: res.status };
	const body = (await res.json()) as { entity: Row };
	return {
		attempted: true,
		usable: true,
		httpOutcome: 200,
		entu_api_key_visible: (body.entity.entu_api_key?.length ?? 0) > 0,
		entu_passkey_visible: (body.entity.entu_passkey?.length ?? 0) > 0
	};
}

async function main() {
	const adminSeatResult = await attemptAdminSeatRead();

	const rootCfg = await loadCfg();
	const res = await entuFetch(
		rootCfg.db,
		`entity/${TARGET_PERSON_ID}?props=entu_api_key,_sharing,_created`,
		rootCfg.token
	);
	if (!res.ok) throw new Error(`db-root read of target failed: ${res.status}`);
	type Row = {
		entu_api_key?: Array<{ _id: string; string?: unknown }>;
		_sharing?: Array<{ string: string }>;
		_created?: Array<{ datetime: string }>;
	};
	const body = (await res.json()) as { entity: Row };
	const instanceSharing = body.entity._sharing?.[0]?.string ?? '(absent)';
	// Presence-only redaction — count + ids, never the value.
	const apiKeyValueCount = body.entity.entu_api_key?.length ?? 0;
	const apiKeyValueIds = (body.entity.entu_api_key ?? []).map((v) => v._id);
	const createdAt = body.entity._created?.[0]?.datetime ?? '(unknown)';

	const gate1 = ENTU_API_KEY_PROPDEF_SHARING_FROM_41;
	const gate2 = PERSON_TYPE_OWN_SHARING_FROM_41;
	const gate3 = instanceSharing;
	const allThreeDomainOrPublic = ['domain', 'public'].includes(gate1) && ['domain', 'public'].includes(gate2) && ['domain', 'public'].includes(gate3);

	console.log(
		JSON.stringify(
			{
				issue: '#44 pre-execution gate (epic #37 D3) — is entu_api_key on the #43 hit domain-bucket-visible?',
				readOnly: true,
				valuesLogged: false,
				targetPersonId: TARGET_PERSON_ID,
				targetPersonCreatedAt: createdAt,
				adminSeatAttempt: adminSeatResult,
				threeGateAndCheck: {
					gate1_propDefSharing: gate1,
					gate2_typeOwnSharing: gate2,
					gate3_instanceOwnSharing: gate3,
					allThreeDomainOrPublic
				},
				credentialValuePresence: { count: apiKeyValueCount, propertyIds: apiKeyValueIds },
				verdict: allThreeDomainOrPublic
					? 'DOMAIN-BUCKET-VISIBLE — all three gates clear; the entu_api_key value is exposed to any authenticated domain reader. Key rotation is Mihkel operational call.'
					: `NOT domain-bucket-visible — gate 3 (instance _sharing) is "${gate3}", which caps every property on this entity out of the domain bucket regardless of the prop-def (gate 1, "${gate1}") or type (gate 2, "${gate2}") being domain-tier. The credential is structurally private today.`,
				flagForAwareness:
					apiKeyValueCount > 1
						? `entu_api_key carries ${apiKeyValueCount} STACKED values on this entity (POST-appends-never-replaces — see architecture-decisions.md). Multiple historical/rotated keys may all still be independently valid at auth time; worth folding into whatever rotation decision follows.`
						: null
			},
			null,
			2
		)
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
