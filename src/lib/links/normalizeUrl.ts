// #374 + #375 — url normalisation at SAVE time, page layer only.
//
// Contract (pinned in normalizeUrl.spec.ts; supersedes the #256 "stored as
// given" ruling for the SAVE path — the data layer and display stay verbatim):
//
//   (a) #374 — an input carrying no scheme gets `https://` prepended; an
//       input with any scheme (http:, https:, mailto:, tel:, …) passes as
//       typed. A leading `//` (protocol-relative) counts as schemeless and
//       gets `https:` in front; a `host:port` shape (colon followed by
//       digits before any `/`) counts as schemeless too.
//   (b) #375 — then, if the parsed WHATWG `.host` (lowercased, includes the
//       port) equals `currentHost` literally, return pathname+search+hash —
//       ALWAYS beginning with '/' (Gama pin, 2026-09-18): a trim that would
//       leave nothing stores '/', never the empty string. Otherwise return
//       the (possibly prepended) string unchanged.
//   An input that ALREADY begins with a single '/' is an own-surface
//   relative path — exactly what (b) stores — and passes through untouched,
//   so normalizeUrl is idempotent over its own output. Without that, a
//   re-save of a stored '/salvestused' (edit the name only) would be read as
//   schemeless and glued into 'https:///salvestused' — a dead link to a host
//   named `salvestused`.
//
//   Unparseable after the prepend → return the input unchanged, never throw
//   (pinned decision — no fallback wanted; the page saves what was typed).
//
export function normalizeUrl(input: string, currentHost: string): string {
	// Step (a) — scheme detection. `//host/…` is protocol-relative: prepend
	// `https:` only (the input already carries the two slashes). Otherwise
	// look at the text up to the first '/' (or the whole string, if none):
	// no ':' in there → schemeless. A ':' followed by digits-only up to that
	// point (a port) is schemeless too; anything else after the ':' is a
	// real scheme, left as typed.
	let prepared = input;
	if (input.startsWith('//')) {
		prepared = `https:${input}`;
	} else if (input.startsWith('/')) {
		// Already a relative own-surface path (the shape step (b) stores).
		// Checked AFTER the protocol-relative case above, so `//host/…` never
		// reaches here. Returned verbatim: it already starts with '/', which
		// is the whole of the Gama pin.
		return input;
	} else {
		const slashIdx = input.indexOf('/');
		const head = slashIdx === -1 ? input : input.slice(0, slashIdx);
		const colonIdx = head.indexOf(':');
		if (colonIdx === -1) {
			prepared = `https://${input}`;
		} else {
			const afterColon = head.slice(colonIdx + 1);
			if (afterColon.length > 0 && /^\d+$/.test(afterColon)) {
				prepared = `https://${input}`;
			}
			// else: a real scheme — `prepared` stays `input`, unchanged.
		}
	}

	let parsed: URL;
	try {
		parsed = new URL(prepared);
	} catch {
		// Unparseable even after the prepend — no fallback wanted; the page
		// saves what was typed, not the prepend attempt.
		return input;
	}

	// Step (b) — own-host trim. `.host` includes the port; the compare is
	// literal (URL parsing already lowercases it).
	if (parsed.host.toLowerCase() === currentHost.toLowerCase()) {
		const rest = `${parsed.pathname}${parsed.search}${parsed.hash}`;
		return rest || '/';
	}

	return prepared;
}
