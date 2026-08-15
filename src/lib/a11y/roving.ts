// src/lib/a11y/roving.ts
//
// #156 — shared arrow-key math for every roving-tabindex button group in the
// app. This file intentionally owns ONLY the "given a key and a position in
// a list, which position comes next" question. Everything else (which
// elements count as members, whether the roving stop lives in `$state` or
// derives from existing selection state, whether arrows also ACTIVATE, and
// per-instance vs per-row keying) stays local to each component — those
// differ enough per group (see the #156 audit) that folding them into this
// helper would just relocate the boilerplate rather than remove it.
//
// Usage shape, in every call site:
//
//   function handleKeydown(e: KeyboardEvent): void {
//     const group = e.currentTarget as HTMLElement;
//     const members = Array.from(group.querySelectorAll<HTMLElement>('button:not([disabled])'));
//     const idx = members.indexOf(e.target as HTMLElement);
//     if (idx < 0) return;
//     const next = rovingNextIndex(e.key, idx, members.length);
//     if (next < 0) return;
//     e.preventDefault();
//     members[next].focus();
//   }

/** Given the pressed key, the focused member's index, and the member count,
 *  returns the index arrow/Home/End navigation should move to, or -1 if the
 *  key isn't one this helper handles (caller should ignore it and NOT call
 *  `preventDefault`).
 *
 *  Both axes (Left/Right AND Up/Down) always move — groups that `flex-wrap`
 *  need both regardless of visual orientation, and groups that don't simply
 *  never see the other axis's keys. Always wraps (WAI-APG toolbar/radiogroup
 *  default); callers wanting clamp behaviour (none currently do post-#156 —
 *  the arrange-row reorder widget clamps, but that is a DIFFERENT state
 *  machine, not this helper) can special-case it themselves. */
export function rovingNextIndex(key: string, idx: number, length: number): number {
	if (length === 0) return -1;
	if (key === 'ArrowRight' || key === 'ArrowDown') return (idx + 1) % length;
	if (key === 'ArrowLeft' || key === 'ArrowUp') return (idx - 1 + length) % length;
	if (key === 'Home') return 0;
	if (key === 'End') return length - 1;
	return -1;
}
