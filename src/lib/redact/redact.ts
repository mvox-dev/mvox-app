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
// control exists — the toggle is devtools-only, with no owning issue for a
// visible engage control. DEFAULT-INERT is load-bearing: without the toggle
// the marker has NO rendering effect whatsoever.
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
// WHAT THIS MARKS, AND WHAT IT LEAVES BARE. Marked, via RedactedField.svelte:
// the five admin record-editor fields (name, phone, email, birth date,
// id_code). Marked, via RedactedText.svelte (#388) — the shared marker for
// plain element content that isn't an input: the collapsed row's own name
// span (`roster-row-name`), the collapsed row's own email span
// (`roster-row-email` — `row.email` is resolveField's narrower-wins result,
// i.e. the SAME real address the editor's marked email field prefills from,
// see the PREFILL provenance comment in routes/roster/+page.svelte), the
// card activator's sr-only edit label's name, and the inactive-members row's
// name.
//
// The list above is BY RENDERED PERSONAL VALUE, not by field type. Its first
// version enumerated only real NAMES, and so silently omitted the collapsed
// row's email — a second kind of personal data on the same route, bare in the
// same way. Anything /roster puts on screen that identifies or contacts a real
// person belongs here, whatever its type.
//
// NOT marked, because there is nothing to wrap: the `roster_record_damaged`,
// `roster_member_deactivate_failed` and `roster_member_reinstate_failed`
// status messages (#388) used to interpolate the member's name INTO a
// sentence — the element-content marker cannot blank part of a sentence — so
// the name left the copy entirely; each alert now names no one and carries
// #487's EntuRef (a short id, clickable) instead.
//
// SectionPicker's `memberName` prop (fed from routes/roster/+page.svelte)
// reaches the DOM only as an `aria-label`/`title` attribute, never as element
// content — it belongs with the UNCOVERED CHANNELS above, not with the marked
// fields, and no marked wrapper can cover it.
//
// #361 — PersonName.svelte is the ONE way a bare member name renders (built
// on RedactedText). Every surface that CAN hold a marker now routes its name
// through it or, for a sentence with the name baked in, wraps the whole
// element in RedactedText. Two channels a member name reaches that NO marker
// can cover, recorded here rather than left as a silent gap:
//
// <option> content — a native <option> holds no child element, so it cannot
// host the marker's wrapping span at all (the native-control rule, #209
// standing rule 1). Sites: the season-manage, season-create and event-create
// conductor pickers (src/routes/+page.svelte —
// season-manage-conductor-select, season-create-conductor-select,
// event-create-conductor-select), the invite person select
// (src/lib/components/admin/InviteSurface.svelte — invite-person-select),
// and the library's per-copy inline-checkout picker
// (src/routes/library/+page.svelte — inline-checkout).
//
// aria-label — an attribute, never element content. Sites: AttendanceSurface
// (src/lib/components/attendance/AttendanceSurface.svelte) —
// attendance_rsvp_aria_label, attendance_group_label,
// attendance_toggle_aria_label — the season-create/event-create conductor
// chips' remove buttons (season_conductor_remove), and SectionPicker's
// memberName label (src/lib/sections/SectionPicker.svelte).
