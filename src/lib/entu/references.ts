// Ids only, never `.string`: a reference's string bakes in a display name (PII).
export function referenceIds(refs: ReadonlyArray<{ reference?: string }> | undefined): string[] {
	return (refs ?? []).flatMap((r) => (r.reference ? [r.reference] : []));
}
