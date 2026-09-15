// #357 — the capture-redaction marker's definition. Two live invite bearer
// tokens reached chat through screenshots this week; a screenshot has no
// field names, only pixels — so sensitive elements are blanked in the DOM
// BEFORE the capture, and the capture runs against the blanked DOM.
//
// REDACT_ATTR marks an element whose rendered value must not be captured. A
// data- attribute, NOT a plain CSS class — its only purpose is to be legible
// at the point of removal, and a class in a stylesheet reads as styling
// (#357 body). Distinct from memberRecord.ts's DEFAULT_REDACT_FIELDS (#282),
// which is server-side Entu readback masking — this marker is a client
// capture-time concern only.
export const REDACT_ATTR = 'data-redact';

// REDACT_TOGGLE_ATTR is the root toggle, set on <html> by a HUMAN before
// taking a screenshot (devtools:
// document.documentElement.setAttribute('data-redacting', '')). No shipped UI
// control ships in this slice — #292, the real capture path, owns wiring a
// visible engage control later. DEFAULT-INERT is load-bearing: without the
// toggle the marker has NO rendering effect whatsoever.
export const REDACT_TOGGLE_ATTR = 'data-redacting';

// THE LIMIT, stated where you meet it (the byteStore.ts:1-14 / page-shell.ts
// :1-9 carrying-the-limit pattern):
//
// The marker covers rendered element content and nothing else. Values reach
// the screen from outside marked elements: title attributes and tooltips,
// aria-label, placeholder text, the browser's own autofill dropdown (rendered
// above the page, outside the DOM entirely), the document <title>, and — if
// browser chrome is captured — the URL, which carries entity ids. None of
// those channels are covered here.
//
// Nothing here claims a marked page is a guaranteed-clean capture.
//
// Invite-link row (#357's second listed surface): since #360 the composed
// invite URL is copy-only and never rendered into the DOM on ANY surface
// (InviteSurface and the roster row both lost their readonly inputs), so
// there is no rendered element to mark.
//
// WHAT THIS SLICE MARKS, AND WHAT IT LEAVES BARE. Marked: the five admin
// record-editor fields (name, phone, email, birth date, id_code), all through
// RedactedField.svelte.
//
// The list below is BY RENDERED PERSONAL VALUE, not by field type. Its first
// version enumerated only real NAMES, and so silently omitted the collapsed
// row's email — a second kind of personal data on the same route, bare in the
// same way. Anything /roster puts on screen that identifies or contacts a real
// person belongs here, whatever its type. NOT marked, still rendered bare —
// filed as #380, deliberately not widened into this slice:
//
//   - the collapsed row's own name span (`roster-row-name`)
//   - the collapsed row's own email span (`roster-row-email`) — `row.email` is
//     resolveField's narrower-wins result, i.e. the SAME real address the
//     editor's marked email field prefills from (see the PREFILL provenance
//     comment in routes/roster/+page.svelte). A member list screenshotted with
//     the toggle engaged still ships every member's address.
//   - the deactivate dialog's `memberName`
//   - the sr-only edit label, and the `roster_record_damaged` /
//     `roster_member_deactivate_failed` status messages
//
// The first three are plain element content — a marked wrapper covers them,
// and #380 owns doing that once in a component rather than per call site. The
// sr-only label and the two status messages interpolate the name INTO a
// message string, so the element-content marker cannot cover them at all
// without blanking the whole sentence — they belong with the uncovered
// channels above, not with the marked fields.
