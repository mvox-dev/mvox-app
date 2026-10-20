// Second sign-in for crede member Valdur Hüvato: Entu emails him a Google-link invite.

// Run: node --import tsx --import ./scripts/migrations/lib/register-loader.mjs <this file>
// DRY_RUN=false needs AUTHORIZED_BY. Steps: drop dead placeholder, copy Gmail, send-invite.
import { readDryRun, loadCredeCfg, readAuthorizedBy } from './lib/script-runner';
import { assertLiveRunAuthorized } from './lib/ledger-writer';

const DRY_RUN = readDryRun();
assertLiveRunAuthorized(DRY_RUN, readAuthorizedBy());

const API = 'https://api.entu.app';
const PERSON_ID = '6a92a3feca67df980f415677';
const PROFILE_ID = '6a92a3feca67df980f415687';
const DEAD_PLACEHOLDER_ID = '6ad74b243ab4bc14605edf9e';

interface UserEntry {
	_id: string;
	provider?: string;
	invite?: unknown;
}

let db = '';
let token = '';

async function call(path: string, init: { method: string; body?: unknown }): Promise<Response> {
	const { method, body } = init;
	return fetch(`${API}/${db}/${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/json',
			...(body ? { 'Content-Type': 'application/json' } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
}

async function getProps(id: string, props: string): Promise<Record<string, unknown[]>> {
	const res = await call(`entity/${id}?props=${props}`, { method: 'GET' });
	if (!res.ok) throw new Error(`GET entity ${id} failed: HTTP ${res.status}`);
	return ((await res.json()) as { entity?: Record<string, unknown[]> }).entity ?? {};
}

async function readUsers(): Promise<UserEntry[]> {
	return ((await getProps(PERSON_ID, 'entu_user')).entu_user ?? []) as UserEntry[];
}

async function readEmails(id: string): Promise<string[]> {
	const entries = ((await getProps(id, 'email')).email ?? []) as Array<{ string?: string }>;
	return entries.map((e) => (e.string ?? '').trim().toLowerCase()).filter(Boolean);
}

function summarize(users: UserEntry[]): string {
	return users.map((u) => `${u._id}:${u.provider ?? (u.invite ? 'invite' : 'none')}`).join(', ');
}

async function main(): Promise<void> {
	const cfg = await loadCredeCfg();
	db = cfg.db;
	token = cfg.token;
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${db}, person=${PERSON_ID}`);

	const before = await readUsers();
	console.log(`entu_user before (${before.length}): ${summarize(before)}`);
	if (before.some((u) => u.provider === 'google')) {
		console.log('A google entry already exists — nothing to do.');
		return;
	}
	const strayInvites = before.filter((u) => u.invite && u._id !== DEAD_PLACEHOLDER_ID);
	if (strayInvites.length) throw new Error('An unexpected invite placeholder is present — aborting');
	const mobileBefore = before.find((u) => u.provider === 'mobile-id');
	if (!mobileBefore) throw new Error('mobile-id entry not found — aborting');

	const profileEmails = await readEmails(PROFILE_ID);
	const gmail = profileEmails[0] ?? '';
	if (!gmail.endsWith('@gmail.com')) throw new Error('Profile email is not on gmail.com — aborting');
	const personEmails = await readEmails(PERSON_ID);
	if (personEmails.length > 0 && !personEmails.includes(gmail)) {
		throw new Error('Person already has a different email — aborting');
	}
	const hasDead = before.some((u) => u._id === DEAD_PLACEHOLDER_ID);
	const needsEmail = personEmails.length === 0;
	console.log(`Plan: delete placeholder=${hasDead}, copy email=${needsEmail}, send-invite=true`);
	if (DRY_RUN) return;

	if (hasDead) {
		const del = await call(`property/${DEAD_PLACEHOLDER_ID}`, { method: 'DELETE' });
		if (!del.ok) throw new Error(`Step 1 delete failed: HTTP ${del.status}`);
		const users = await readUsers();
		if (users.some((u) => u.invite) || !users.some((u) => u._id === mobileBefore._id)) {
			throw new Error('Step 1 read-back wrong — aborting');
		}
		console.log('Step 1 ok: placeholder gone, mobile-id present');
	}
	if (needsEmail) {
		const res = await call(`entity/${PERSON_ID}`, {
			method: 'POST',
			body: [{ type: 'email', string: gmail }]
		});
		if (!res.ok) throw new Error(`Step 2 email POST failed: HTTP ${res.status}`);
		const now = await readEmails(PERSON_ID);
		if (now.length !== 1 || now[0] !== gmail) throw new Error('Step 2 read-back wrong — aborting');
		console.log('Step 2 ok: person email set and equals profile email (address not logged)');
	}
	const send = await call(`entity/${PERSON_ID}`, {
		method: 'POST',
		body: [{ type: 'entu_user', string: 'send-invite' }]
	});
	console.log(`Step 3 send-invite: HTTP ${send.status}`);
	if (!send.ok) throw new Error('Step 3 failed');
	const after = await readUsers();
	const invites = after.filter((u) => u.invite);
	const mobileKept = after.some((u) => u._id === mobileBefore._id && u.provider === 'mobile-id');
	console.log(`entu_user after (${after.length}): ${summarize(after)}`);
	console.log(`new invite entries: ${invites.length}; mobile-id untouched: ${mobileKept}`);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
