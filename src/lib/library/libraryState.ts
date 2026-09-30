import type { Copy, Edition, EditionFile, Lending, Work } from '$lib/library/libraryData';
import type { UploadEditionFilesResult } from '$lib/library/editionFiles';
import type { ActiveMember } from '$lib/roster/rosterData';
import type { RepertoireItem } from '$lib/repertoire/repertoireData';
import type { CopySortKey } from '$lib/library/copySort';
import type { ListRead } from '$lib/entu/listRead';
import { withItem, without } from '$lib/collections/immutable';

export type NodeStatus = 'idle' | 'loading' | 'error';

/** The browse tree's state: one $state object on the page, read by the rows. */
export interface LibraryState {
	works: Work[];
	lendings: Lending[];
	borrowerNames: Map<string, string>;
	// null = the byte store has not answered: no badge, never a wrong one (#351).
	heldFileIds: Set<string> | null;
	expandedWorks: Set<string>;
	expandedEditions: Set<string>;
	editionsByWork: Map<string, Edition[]>;
	copiesByEdition: Map<string, Copy[]>;
	editionNodeStatus: Map<string, NodeStatus>;
	copyNodeStatus: Map<string, NodeStatus>;
	repertoireByWorkId: Map<string, RepertoireItem>;
	allEditions: Edition[];
	allCopies: Copy[];
	allMembers: ActiveMember[];
	memberNames: Map<string, string>;
	optionsPartial: boolean;
	membersPartial: boolean;
	inlineCheckoutErrors: Map<string, string>;
	copySortKey: CopySortKey;
}

export function createLibraryState(): LibraryState {
	return {
		works: [],
		lendings: [],
		borrowerNames: new Map(),
		heldFileIds: null,
		expandedWorks: new Set(),
		expandedEditions: new Set(),
		editionsByWork: new Map(),
		copiesByEdition: new Map(),
		editionNodeStatus: new Map(),
		copyNodeStatus: new Map(),
		repertoireByWorkId: new Map(),
		allEditions: [],
		allCopies: [],
		allMembers: [],
		memberNames: new Map(),
		optionsPartial: false,
		membersPartial: false,
		inlineCheckoutErrors: new Map(),
		copySortKey: 'nr'
	};
}

/** Run on every load: a node cache or presence answer never outlives the collective it
 *  came from. The node statuses stay, as they always have. */
export function resetTree(lib: LibraryState): void {
	lib.expandedWorks = new Set();
	lib.expandedEditions = new Set();
	lib.editionsByWork = new Map();
	lib.copiesByEdition = new Map();
	lib.repertoireByWorkId = new Map();
	lib.heldFileIds = null;
}

/** Replace one edition's `files` in place, wherever its work sits; never a refetch. */
export function updateEditionFiles(
	lib: LibraryState,
	editionId: string,
	update: (files: EditionFile[]) => EditionFile[]
): void {
	for (const [workId, editions] of lib.editionsByWork) {
		if (!editions.some((e) => e.id === editionId)) continue;
		lib.editionsByWork = new Map(lib.editionsByWork).set(
			workId,
			editions.map((e) => (e.id === editionId ? { ...e, files: update(e.files ?? []) } : e))
		);
		return;
	}
}

export interface BulkCheckout {
	workId: string;
	editionId: string;
	members: Set<string>;
	dueDate: string;
	error: string;
}

export function createBulkCheckout(): BulkCheckout {
	return { workId: '', editionId: '', members: new Set(), dueDate: '', error: '' };
}

/** A collective switch abandons the transaction, due date included: left in place it
 *  would ride into the next collective's checkout (#300). */
export function resetBulkCheckout(bulk: BulkCheckout): void {
	bulk.workId = '';
	bulk.editionId = '';
	bulk.members = new Set();
	bulk.dueDate = '';
}

export interface WorkForm {
	open: boolean;
	name: string;
	composer: string;
	error: (() => string) | null;
	status: string;
	pending: boolean;
}

export function createWorkForm(): WorkForm {
	return { open: false, name: '', composer: '', error: null, status: '', pending: false };
}

// Opening clears the last "X created." announcement too.
export function openWorkForm(form: WorkForm): void {
	form.name = '';
	form.composer = '';
	form.error = null;
	form.status = '';
	form.open = true;
}

export function closeWorkForm(form: WorkForm): void {
	form.open = false;
	form.name = '';
	form.composer = '';
	form.error = null;
}

/** Create-edition drafts, keyed per work: several works can be open at once. */
export interface EditionDrafts {
	open: Set<string>;
	name: Map<string, string>;
	publisher: Map<string, string>;
	errors: Map<string, () => string>;
	statuses: Map<string, string>;
	pending: Set<string>;
}

export function createEditionDrafts(): EditionDrafts {
	return {
		open: new Set(),
		name: new Map(),
		publisher: new Map(),
		errors: new Map(),
		statuses: new Map(),
		pending: new Set()
	};
}

export function openEditionDraft(drafts: EditionDrafts, workId: string): void {
	drafts.name = new Map(drafts.name).set(workId, '');
	drafts.publisher = new Map(drafts.publisher).set(workId, '');
	drafts.errors = without(drafts.errors, workId);
	drafts.statuses = new Map(drafts.statuses).set(workId, '');
	drafts.open = new Set(drafts.open).add(workId);
}

export function closeEditionDraft(drafts: EditionDrafts, workId: string): void {
	drafts.open = without(drafts.open, workId);
	drafts.name = without(drafts.name, workId);
	drafts.publisher = without(drafts.publisher, workId);
	drafts.errors = without(drafts.errors, workId);
}

export function setEditionDraftError(
	drafts: EditionDrafts,
	workId: string,
	error: (() => string) | null
): void {
	drafts.errors = error ? new Map(drafts.errors).set(workId, error) : without(drafts.errors, workId);
}

export function setEditionDraftPending(drafts: EditionDrafts, workId: string, on: boolean): void {
	drafts.pending = withItem(drafts.pending, workId, on);
}

// Returns whether the lendings read was truncated; the page holds that flag, not `lib`.
export function applyLendings(
	lib: LibraryState,
	read: { lendings: ListRead<Lending>; borrowerNames: Map<string, string> }
): boolean {
	lib.lendings = read.lendings.items;
	lib.borrowerNames = read.borrowerNames;
	return read.lendings.truncated;
}

/** What InlineCreateForm reads and calls, over either state shape. */
export interface InlineCreateView {
	open: boolean;
	name: string;
	second: string;
	error: (() => string) | null;
	pending: boolean;
	status: string;
	onopen: () => void;
	onclose: () => void;
	onname: (value: string) => void;
	onsecond: (value: string) => void;
}

export function workFormView(form: WorkForm): InlineCreateView {
	return {
		open: form.open,
		name: form.name,
		second: form.composer,
		error: form.error,
		pending: form.pending,
		status: form.status,
		onopen: () => openWorkForm(form),
		onclose: () => closeWorkForm(form),
		onname: (value) => (form.name = value),
		onsecond: (value) => (form.composer = value)
	};
}

export function editionDraftView(drafts: EditionDrafts, workId: string): InlineCreateView {
	return {
		open: drafts.open.has(workId),
		name: drafts.name.get(workId) ?? '',
		second: drafts.publisher.get(workId) ?? '',
		error: drafts.errors.get(workId) ?? null,
		pending: drafts.pending.has(workId),
		status: drafts.statuses.get(workId) ?? '',
		onopen: () => openEditionDraft(drafts, workId),
		onclose: () => closeEditionDraft(drafts, workId),
		onname: (value) => (drafts.name = new Map(drafts.name).set(workId, value)),
		onsecond: (value) => (drafts.publisher = new Map(drafts.publisher).set(workId, value))
	};
}

export interface BrokenFile {
	propertyId: string;
	filename: string;
}

/** Upload state, keyed per edition. Pending is per batch: one POST carries the batch. */
export interface EditionFilesState {
	pending: Set<string>;
	// cleanup 'deleted': the phantom was removed; named per file.
	errors: Map<string, string[]>;
	// The whole POST rejected; nothing was created.
	batchError: Set<string>;
	// cleanup 'delete-failed': a phantom may remain, so these accumulate across attempts.
	broken: Map<string, BrokenFile[]>;
	// cleanup 'not-created': nothing exists server-side.
	notCreated: Map<string, string[]>;
	statuses: Map<string, string>;
}

export function createEditionFilesState(): EditionFilesState {
	return {
		pending: new Set(),
		errors: new Map(),
		batchError: new Set(),
		broken: new Map(),
		notCreated: new Map(),
		statuses: new Map()
	};
}

export function markUploadBatchError(files: EditionFilesState, editionId: string): void {
	files.batchError = new Set(files.batchError).add(editionId);
}

export function startUpload(files: EditionFilesState, editionId: string): void {
	files.pending = new Set(files.pending).add(editionId);
	files.errors = without(files.errors, editionId);
	files.batchError = without(files.batchError, editionId);
	files.notCreated = without(files.notCreated, editionId);
	files.statuses = new Map(files.statuses).set(editionId, '');
}

export function endUpload(files: EditionFilesState, editionId: string): void {
	files.pending = without(files.pending, editionId);
}

export function applyUploadFailures(
	files: EditionFilesState,
	editionId: string,
	failed: UploadEditionFilesResult['failed']
): void {
	const cleaned = failed.filter((f) => f.cleanup === 'deleted');
	if (cleaned.length > 0) {
		files.errors = new Map(files.errors).set(
			editionId,
			cleaned.map((f) => f.filename)
		);
	}
	const missing = failed.filter((f) => f.cleanup === 'not-created');
	if (missing.length > 0) {
		files.notCreated = new Map(files.notCreated).set(
			editionId,
			missing.map((f) => f.filename)
		);
	}
	// flatMap narrows on the cleanup state, which proves propertyId is a real id here.
	const broken = failed.flatMap((f) =>
		f.cleanup === 'delete-failed' ? [{ propertyId: f.propertyId, filename: f.filename }] : []
	);
	if (broken.length > 0) {
		const existing = files.broken.get(editionId) ?? [];
		files.broken = new Map(files.broken).set(editionId, [...existing, ...broken]);
	}
}

/** What the browse-tree rows ask the page to do; the page owns every write. */
export interface TreeActions {
	toggleWork(workId: string): void;
	loadEditions(workId: string): Promise<void>;
	toggleEdition(editionId: string): void;
	loadCopies(editionId: string): Promise<void>;
	setCopySortKey(key: CopySortKey): void;
	checkout(copyId: string, memberId: string): Promise<void>;
	returnLending(lendingId: string): Promise<void>;
	attachFiles(editionId: string, fileList: FileList | null): Promise<void>;
	openFile(fileId: string, work: Work, edition: Edition, filename: string): void;
	submitEdition(workId: string): Promise<void>;
	fileSize(bytes: number): string;
}
