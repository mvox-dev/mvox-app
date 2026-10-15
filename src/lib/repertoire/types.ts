// The works view model behind RepertoireElement, shared by its producers and every page (#90).

export type RepertoireStatus = 'learning' | 'active' | 'retired' | 'dropped';

export interface PickerOption {
	id: string;
	label: string;
}

export type ManageRightsState = 'editor' | 'not-editor' | 'error';

export type WorkRow = {
	id: string;
	// A season-fallback row holds repertoire_item ids: a programme write must never get one.
	kind: 'repertoire' | 'program';
	workId: string;
	editionId: string;
	workName: string;
	composer: string;
	status: RepertoireStatus | null;
	editionName: string;
	ordinal: number | null;
	fileId: string;
	fileName: string;
	externalLinks: string[];
	canBorrow: boolean;
	notes: string;
	// The edition read was truncated, so an empty editionName means unknown, not absent (#331).
	truncated?: boolean;
};

// (*MVOX:Josquin*)
