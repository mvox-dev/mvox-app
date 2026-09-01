// #204 — one shared label helper for every work picker in the app: the label
// reads "Name - Composer" when the work carries a composer, and EXACTLY
// "Name" when composer is empty — never a dangling trailing " - " (the
// "Silmavalgus - P. Uusberg" issue). Applied at all four picker seams instead
// of four inline ternaries, so the format can only drift by editing here.
//
// ALL emptiness handling lives here, not at the call sites. Entu's `mandatory`
// is a UI hint only, so a work entity can reach us with no name at all
// (listWorks maps a missing name to ''), and either part can be whitespace.
// Blank parts are dropped, so a nameless composerless work yields '' and
// callers can test the composed label instead of guessing from the parts.
export function workLabel(work: { name?: string; composer?: string }): string {
	const parts = [work.name, work.composer]
		.map((part) => (part ?? '').trim())
		.filter((part) => part !== '');
	return parts.join(' - ');
}

// (*MVOX:Byrd* — #204 GREEN; review fix-forward: blank name/composer)
