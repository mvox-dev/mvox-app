// Human file sizes, for every reader that has bytes and a place to show them.
//
// #275 first needed this beside the edition-file upload path and defined it in
// $lib/library/editionFiles. #352 (review) lifted it here: the profile page's
// "Storage on this device" section renders the SAME bytes the library page
// renders, and must render them the same way — but it has no business
// importing the upload machinery to get one formatter. editionFiles.ts
// re-exports this symbol, so every existing import (and every spec that mocks
// $lib/library/editionFiles) is unchanged.

/** Human filesize: bytes plain below 1 KB, 1024-based units with one decimal
 *  from KB up. Locale-independent (numeric/tabular text — #207 rule 7). */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	return `${value.toFixed(1)} ${units[unitIndex]}`;
}

// (*MVOX:Palestrina* — #352 review fix: shared out of editionFiles.ts verbatim)
