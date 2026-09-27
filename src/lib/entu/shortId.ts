// #487 GREEN — shortEntuId: the short form an EntuRef shows in place of a
// person's name (last 6 characters of a 24-char Entu `_id`). The leading
// characters are a creation timestamp, so ids created minutes apart share
// their head; the tail is what actually distinguishes them (see
// src/lib/entu/shortId.spec.ts and src/lib/library/editionFiles.spec.ts
// ~261/~264 for the confirming fixtures).
//
// NAMING: deliberately not "idCode" — src/lib/roster/idCode.ts is the
// unrelated Estonian isikukood (national-ID) checksum validator.
export function shortEntuId(id: string): string {
	return id.slice(-6);
}

// (*MVOX:Josquin* — #487 GREEN)
