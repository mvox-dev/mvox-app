// The library route and every component it is split into, for the source scans.
export const LIBRARY_SURFACES = [
	'src/routes/library/+page.svelte',
	'src/lib/library/MyLoansSection.svelte',
	'src/lib/library/BulkCheckoutPanel.svelte',
	'src/lib/library/CreateWorkForm.svelte',
	'src/lib/library/WorkRow.svelte',
	'src/lib/library/CreateEditionForm.svelte',
	'src/lib/library/EditionRow.svelte',
	'src/lib/library/CopyRow.svelte',
	'src/lib/library/EditionFiles.svelte'
] as const;
