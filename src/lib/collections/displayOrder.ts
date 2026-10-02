// Display order sort: a missing display_order sorts last, ties by name.
export function byDisplayOrder(
	a: { displayOrder: number | null; name: string },
	b: { displayOrder: number | null; name: string }
): number {
	const delta = (a.displayOrder ?? Infinity) - (b.displayOrder ?? Infinity);
	return delta || a.name.localeCompare(b.name);
}
