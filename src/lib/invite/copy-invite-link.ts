// #346 — the ONE copy implementation for invite links, extracted from
// InviteSurface's `copyLink()` (#345, f501a78) so the roster row can share it
// verbatim instead of growing a second copy path with second failure
// semantics.
//
// Contract (pinned in copy-invite-link.spec.ts, and at the routes in
// page.admin-invite-copy*.spec.ts / page.roster-invite-copy.spec.ts):
// - `copy()` resets BOTH flags synchronously at entry (the persistent status
//   region clears at the START of every attempt — no timer, ever).
// - An absent `navigator.clipboard?.writeText` fails VISIBLY (`copyFailed`
//   true) — never a silent no-op; the caller's readonly input stays manually
//   copyable and the caller leaves the text selected.
// - No throw ever escapes `copy()` — failure is a flag, not an exception.
// - The payload is `getText()` read at copy time, handed to the clipboard
//   exactly once per attempt.

/** One row's / one surface's copy state — create one instance per value. */
export interface InviteLinkCopier {
	/** Attempt the copy; settles flags, never throws. */
	copy(): Promise<void>;
	/** Last attempt succeeded (cleared at the entry of every attempt). */
	readonly copied: boolean;
	/** Last attempt failed visibly (cleared at the entry of every attempt). */
	readonly copyFailed: boolean;
}

export function createInviteLinkCopier(getText: () => string): InviteLinkCopier {
	let copied = false;
	let copyFailed = false;
	return {
		async copy(): Promise<void> {
			// Both flags reset synchronously at ENTRY — before the first `await` —
			// so a caller reading them the instant `copy()` is invoked (not after
			// it settles) already sees the cleared state, even while a prior/new
			// attempt's clipboard write is still pending.
			copied = false;
			copyFailed = false;
			try {
				// No silent no-op: an unavailable clipboard (non-secure context)
				// fails visibly — the caller's readonly input stays manually
				// copyable.
				if (!navigator.clipboard?.writeText) {
					throw new Error('clipboard unavailable in this context');
				}
				await navigator.clipboard.writeText(getText());
				copied = true;
			} catch (e) {
				console.error('invite link copy failed', e);
				copyFailed = true;
			}
		},
		get copied() {
			return copied;
		},
		get copyFailed() {
			return copyFailed;
		}
	};
}

// (*MVOX:Byrd* — #346 GREEN: #345's exact copyLink() semantics, extracted
//  verbatim so InviteSurface and the roster row ride one implementation)
