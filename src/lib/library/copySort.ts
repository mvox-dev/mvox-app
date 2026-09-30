import { rovingKeydown } from '$lib/a11y/roving';
import type { Copy, Lending } from '$lib/library/libraryData';

export type CopySortKey = 'nr' | 'member' | 'since';

export const COPY_SORT_KEYS: readonly CopySortKey[] = ['nr', 'member', 'since'];

export interface CopySortContext {
	activeLendingForCopy: (copyId: string) => Lending | undefined;
	borrowerNames: Map<string, string>;
}

// Null always sorts last; an available copy has no lending, so no member or since value.
function copySortValue(copy: Copy, key: CopySortKey, ctx: CopySortContext): string | number | null {
	if (key === 'nr') return copy.copyNumber ? copy.copyNumber : null;
	const lending = ctx.activeLendingForCopy(copy.id);
	if (!lending) return null;
	if (key === 'member') return ctx.borrowerNames.get(lending.memberId) || null;
	return lending.assignedAt || null;
}

function compareByKey(a: Copy, b: Copy, key: CopySortKey, ctx: CopySortContext): number {
	const av = copySortValue(a, key, ctx);
	const bv = copySortValue(b, key, ctx);
	if (av === null && bv === null) return 0;
	if (av === null) return 1;
	if (bv === null) return -1;
	if (typeof av === 'number' && typeof bv === 'number') return av - bv;
	return String(av).localeCompare(String(bv));
}

/** Lent copies first, sorted by `key`; available ones below, always by nr (#114). */
export function sortCopies(copies: Copy[], key: CopySortKey, ctx: CopySortContext): Copy[] {
	const lent = copies.filter((c) => ctx.activeLendingForCopy(c.id));
	const available = copies.filter((c) => !ctx.activeLendingForCopy(c.id));
	lent.sort((a, b) => compareByKey(a, b, key, ctx));
	available.sort((a, b) => compareByKey(a, b, 'nr', ctx));
	return [...lent, ...available];
}

/** Radiogroup keys: arrows move AND select. The walk stays inside the group that got the
 *  event, so one edition's chips never move another's. */
export function handleCopySortKeydown(e: KeyboardEvent, select: (key: CopySortKey) => void): void {
	rovingKeydown(e, {
		beforeFocus: (member) => {
			const key = member.dataset.sortKey as CopySortKey | undefined;
			if (!key) return false;
			select(key);
		}
	});
}
