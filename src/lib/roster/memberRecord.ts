// admin_member_record reads and writes (#268). Real PII on crede: errors carry field names only.
import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import { postEntity } from '$lib/entity/entityCreateShared';
import { replaceEntityProperty, clearEntityProperty } from '$lib/entu/replaceProperty';

export interface MemberRecord {
	_id: string;
	name: string;
	phone: string;
	email: string;
	birthdate: string;
	id_code: string;
}

export type MemberRecordLookup =
	| { state: 'none' }
	| { state: 'one'; record: MemberRecord }
	| { state: 'damaged'; count: number };

export interface CreateMemberRecordInput {
	dbEntityId: string;
	personId: string;
	name: string;
	phone?: string;
	email?: string;
	birthdate?: string;
	id_code?: string;
}

// Names what landed before the failure, so the page can say exactly what was saved (#253).
export class MemberRecordPartialSaveError extends Error {
	landedFields: string[];
	failedField: string;
	constructor(landedFields: string[], failedField: string) {
		super('member record save incomplete');
		this.name = 'MemberRecordPartialSaveError';
		this.landedFields = landedFields;
		this.failedField = failedField;
	}
}

// A calendar date in a datetime slot: string work only, so no timezone shifts the day (#207).
export function birthdateToWire(date: string): string {
	return `${date}T00:00:00.000Z`;
}

export function birthdateFromWire(wire: string): string {
	return wire.split('T')[0];
}

export async function loadMemberRecord(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<MemberRecordLookup> {
	// By person, not _parent: one collective per db makes a _parent filter redundant.
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=admin_member_record&person.reference=${encodeURIComponent(personId)}&props=name,phone,email,birthdate,id_code&limit=10`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`loadMemberRecord failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			phone?: Array<{ string: string }>;
			email?: Array<{ string: string }>;
			birthdate?: Array<{ datetime: string }>;
			id_code?: Array<{ string: string }>;
		}>;
	};
	const entities = body.entities ?? [];
	if (entities.length === 0) return { state: 'none' };
	// More than one is damaged data (#264): reported, never guessed at or repaired.
	if (entities.length > 1) return { state: 'damaged', count: entities.length };
	const raw = entities[0];
	const wireBirthdate = raw.birthdate?.[0]?.datetime;
	return {
		state: 'one',
		record: {
			_id: raw._id,
			name: raw.name?.[0]?.string ?? '',
			phone: raw.phone?.[0]?.string ?? '',
			email: raw.email?.[0]?.string ?? '',
			birthdate: wireBirthdate ? birthdateFromWire(wireBirthdate) : '',
			id_code: raw.id_code?.[0]?.string ?? ''
		}
	};
}

export async function createMemberRecord(
	cfg: EntuCfg,
	input: CreateMemberRecordInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const typeId = await resolveTypeId(cfg, 'admin_member_record', fetchImpl);

	const props: Array<{ type: string; reference?: string; string?: string; datetime?: string }> = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: input.dbEntityId },
		{ type: 'person', reference: input.personId },
		{ type: 'name', string: input.name }
	];
	if (input.phone) props.push({ type: 'phone', string: input.phone });
	if (input.email) props.push({ type: 'email', string: input.email });
	if (input.birthdate) props.push({ type: 'birthdate', datetime: birthdateToWire(input.birthdate) });
	if (input.id_code) props.push({ type: 'id_code', string: input.id_code });

	return postEntity(cfg, 'createMemberRecord', props, fetchImpl);
}

// A fixed order, matching the create payload, so a partial failure always reads the same.
const FIELD_ORDER: Array<keyof Pick<MemberRecord, 'name' | 'phone' | 'email' | 'birthdate' | 'id_code'>> = [
	'name',
	'phone',
	'email',
	'birthdate',
	'id_code'
];

export async function updateMemberRecord(
	cfg: EntuCfg,
	recordId: string,
	changes: Partial<Pick<MemberRecord, 'name' | 'phone' | 'email' | 'birthdate' | 'id_code'>>,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const landed: string[] = [];
	for (const field of FIELD_ORDER) {
		if (!(field in changes)) continue;
		const value = changes[field] as string;
		try {
			if (field === 'birthdate') {
				// A cleared date is removed: Entu stores `datetime: ''` verbatim and answers 200.
				if (value === '') {
					await clearEntityProperty(cfg, recordId, 'birthdate', fetchImpl, 'updateMemberRecord');
				} else {
					await replaceEntityProperty(
						cfg,
						recordId,
						{ type: 'birthdate', datetime: birthdateToWire(value) },
						fetchImpl,
						'updateMemberRecord'
					);
				}
			} else {
				await replaceEntityProperty(
					cfg,
					recordId,
					{ type: field, string: value },
					fetchImpl,
					'updateMemberRecord'
				);
			}
			landed.push(field);
		} catch {
			throw new MemberRecordPartialSaveError(landed, field);
		}
	}
}

// (*MVOX:Josquin*)
