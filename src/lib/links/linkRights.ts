// Which row controls Entu lets the person use on each link: each checks the link it writes.
import { manageRightsFrom } from '$lib/repertoire/repertoireActions';
import type { LinkRow } from './linkData';

export interface LinkControls {
	edit: boolean;
	remove: boolean;
	move: boolean;
}

function canEdit(row: LinkRow, personId: string): boolean {
	return manageRightsFrom(row.ownerIds ?? [], row.editorIds ?? [], personId) === 'editor';
}

// Move renumbers every link, so it needs the edit right on all of them; delete is `_owner`-only.
export function linkControls(rows: LinkRow[], personId: string | null): Map<string, LinkControls> {
	const out = new Map<string, LinkControls>();
	const move = personId !== null && rows.every((r) => canEdit(r, personId));
	for (const row of rows) {
		out.set(row.id, {
			edit: personId !== null && canEdit(row, personId),
			remove: personId !== null && (row.ownerIds ?? []).includes(personId),
			move
		});
	}
	return out;
}

// (*MVOX:Josquin*)
