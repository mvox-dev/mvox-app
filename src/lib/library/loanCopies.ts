// The my-loans label: one read per loaned copy gives its name and its edition / work chain.
import { m } from '$lib/paraglide/messages.js';
import { entuFetch, type EntuFetchOptions } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';
import { copyLabel } from './libraryAvailability';
import type { Copy, Edition, Work } from './libraryReads';

export interface LoanChain {
	copyNumber: number;
	workName: string;
	editionName: string;
}

export interface LoanCopy {
	name: string;
	chain: LoanChain;
}

// Settled per item: one unreadable copy is a failure, not a lost batch.
export interface SettledReads<T> {
	resolved: Map<string, T>;
	failed: unknown[];
}

type Parent = { reference: string; entity_type?: string };

export function formatLoanChainLabel(chain: LoanChain): string {
	const parts = { work: chain.workName, edition: chain.editionName };
	if (!chain.copyNumber) return m.library_loan_label_no_number(parts);
	return m.library_loan_label({ copyNumber: chain.copyNumber, ...parts });
}

// A chain with a missing part would print "Copy #3 —  / ": the copy's own name reads better.
export function loanCopyLabel(copy: LoanCopy): string {
	const { workName, editionName } = copy.chain;
	if (workName && editionName) return formatLoanChainLabel(copy.chain);
	return copy.name || m.library_copy_name_unknown();
}

export function heldLoanCopy(
	copy: Copy,
	editions: Map<string, Edition>,
	works: Map<string, Work>
): LoanCopy {
	const edition = editions.get(copy.editionId);
	const work = edition ? works.get(edition.workId ?? '') : undefined;
	return {
		name: copyLabel(copy),
		chain: { copyNumber: copy.copyNumber, workName: work?.name ?? '', editionName: edition?.name ?? '' }
	};
}

async function readEdition(
	cfg: EntuCfg,
	editionId: string,
	fetchImpl: typeof fetch,
	opts: EntuFetchOptions
): Promise<{ name: string; workId: string }> {
	const res = await entuFetch(cfg.db, `entity/${editionId}?props=name,_parent`, cfg.token, {}, fetchImpl, opts);
	if (!res.ok) throw new Error(`resolveLoanCopies: edition ${editionId} lookup failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { name?: Array<{ string: string }>; _parent?: Parent[] } };
	const workParent = (body.entity?._parent ?? []).find((p) => p.entity_type === 'work');
	return { name: body.entity?.name?.[0]?.string ?? '', workId: workParent?.reference ?? '' };
}

// Shared readers: `opts` defaults the cache off and reaches every read.
export async function resolveLoanCopies(
	cfg: EntuCfg,
	copyIds: string[],
	works: Work[],
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<SettledReads<LoanCopy>> {
	const editions = new Map<string, Promise<{ name: string; workId: string }>>();
	const resolved = new Map<string, LoanCopy>();
	const failed: unknown[] = [];

	async function readCopy(copyId: string): Promise<void> {
		const res = await entuFetch(
			cfg.db, `entity/${copyId}?props=name,copy_number,_parent`, cfg.token, {}, fetchImpl, opts
		);
		if (!res.ok) throw new Error(`resolveLoanCopies: copy ${copyId} lookup failed: ${res.status}`);
		const body = (await res.json()) as {
			entity?: { name?: Array<{ string: string }>; copy_number?: Array<{ number: number }>; _parent?: Parent[] };
		};
		const copyNumber = body.entity?.copy_number?.[0]?.number ?? 0;
		const own = body.entity?.name?.[0]?.string ?? '';
		const name = own || (copyNumber ? m.library_copy_number({ copyNumber }) : '');
		const chain: LoanChain = { copyNumber, workName: '', editionName: '' };
		resolved.set(copyId, { name, chain });

		const editionId = (body.entity?._parent ?? []).find((p) => p.entity_type === 'edition')?.reference;
		if (!editionId) return;
		if (!editions.has(editionId)) editions.set(editionId, readEdition(cfg, editionId, fetchImpl, opts));
		const edition = await editions.get(editionId)!;
		chain.editionName = edition.name;
		chain.workName = works.find((w) => w.id === edition.workId)?.name ?? '';
	}

	const results = await Promise.allSettled([...new Set(copyIds)].map(readCopy));
	for (const r of results) if (r.status === 'rejected') failed.push(r.reason);
	return { resolved, failed };
}

// (*MVOX:Josquin*)
