// #353 RED — WorkRow carries the picked file's NAME, not just its id.
//
// Spike 2b, verified: on the agenda (/) and /event/[id] paths the label write
// has work/composer/edition in hand via WorkRow — but NOT the filename:
// pickFileId returns `(pdf ?? edition.files[0]).id` and discards the rest of
// the EditionFile. The filename is load-bearing for the issue's actual
// promise: it is what distinguishes SOPRAN from ALT — "tonight's PART",
// not "tonight's piece". So the row keeps the picked file's name too.
//
// Contract: `fileName` is '' exactly when `fileId` is '' (no file), and
// otherwise names THE SAME file pickFileId picked (the PDF-preferring pick —
// the two fields must never describe different files).
import { describe, expect, it } from 'vitest';
import { buildWorkRows, collectSources } from './workRows';
import type { Edition, Work } from '$lib/library/libraryData';

const WORK: Work = { id: 'w-1', name: 'Bogoróditse Djévo', composer: 'Arvo Pärt' };

const EDITION: Edition = {
	id: 'e-1',
	name: 'SATB 1990',
	publisher: 'UE',
	workId: 'w-1',
	externalLinks: [],
	files: [
		// A non-PDF first, so the pick is exercised, not the [0] fallback.
		{ id: 'file-sib', filename: 'bogoroditse.sib', filesize: 100, filetype: 'application/octet-stream' },
		{ id: 'file-pdf', filename: 'bogoroditse-sopran.pdf', filesize: 200, filetype: 'application/pdf' }
	]
};

const SOURCES = collectSources([WORK], [EDITION], []);

describe('#353 — buildWorkRows keeps the picked file, not just its id', () => {
	it('a repertoire row carries fileName alongside fileId — the SAME picked file', () => {
		const rows = buildWorkRows(
			{
				source: 'repertoire',
				items: [{ id: 'ri-1', workId: 'w-1', editionId: 'e-1', status: 'active', name: 'Bogoróditse Djévo' }]
			},
			SOURCES
		);
		expect(rows[0].fileId).toBe('file-pdf');
		expect(rows[0].fileName).toBe('bogoroditse-sopran.pdf');
	});

	it('a program row carries fileName too — both agenda surfaces label from the row', () => {
		const rows = buildWorkRows(
			{
				source: 'program',
				items: [{ id: 'pi-1', editionId: 'e-1', ordinal: 1, notes: '', name: 'Bogoróditse Djévo' }]
			},
			SOURCES
		);
		expect(rows[0].fileId).toBe('file-pdf');
		expect(rows[0].fileName).toBe('bogoroditse-sopran.pdf');
	});

	it("no file → fileName '' exactly like fileId '' — absence is one fact, stated once", () => {
		const bare: Edition = { ...EDITION, id: 'e-2', files: [] };
		const rows = buildWorkRows(
			{
				source: 'repertoire',
				items: [{ id: 'ri-2', workId: 'w-1', editionId: 'e-2', status: 'active', name: 'Bogoróditse Djévo' }]
			},
			collectSources([WORK], [bare], [])
		);
		expect(rows[0].fileId).toBe('');
		expect(rows[0].fileName).toBe('');
	});
});

// (*MVOX:Tallis* — #353 RED)
