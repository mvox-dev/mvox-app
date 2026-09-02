// #211 — ONE color scheme for event-type badges, in the mvox palette.
//
// PO ruling (Gama, 2026-09-02): six of the eight canonical event types get a
// distinct hue family, translated into mvox's paper/ink tones (never stock
// Tailwind hues) — rehearsal/concert/retreat/festival carry polyphony's
// blue/purple/green/orange anchors, workshop and meeting get two NEW hues.
// social and other keep the app's existing quiet default. Color is an
// ADDITION only — the label text always stays on the badge, and this map
// carries color classes ONLY (bg/text/border); the badge's shape/font base
// classes stay shared in each consuming markup, not here.
//
// ONE scheme, three consumers: the agenda recent badge, the agenda upcoming
// badge, and the event-detail badge (later #214's chips too).
import { CANONICAL_EVENT_TYPES } from './eventTypeLabels';

/** The quiet default — the badge's ORIGINAL color classes, kept verbatim for
 *  social, other, unknown free text, and undefined. */
const DEFAULT_CLASS = 'text-ink-2 border-ink-4';

/** Per-type color classes, built from the NEW `--color-type-*` @theme tokens
 *  (src/app.css) — the schema key is the stable identity, the hex behind it
 *  is Mihkel's to adjust at the live gate. Exactly the 8 canonical keys,
 *  same set as EVENT_TYPE_LABEL. */
export const EVENT_TYPE_BADGE_CLASS: Record<string, string> = {
	rehearsal: 'bg-type-rehearsal-soft text-type-rehearsal border-type-rehearsal',
	concert: 'bg-type-concert-soft text-type-concert border-type-concert',
	festival: 'bg-type-festival-soft text-type-festival border-type-festival',
	retreat: 'bg-type-retreat-soft text-type-retreat border-type-retreat',
	workshop: 'bg-type-workshop-soft text-type-workshop border-type-workshop',
	meeting: 'bg-type-meeting-soft text-type-meeting border-type-meeting',
	social: DEFAULT_CLASS,
	other: DEFAULT_CLASS
};

// #211 review posture, same lesson as eventTypeLabels' own guard (F4 there):
// `event_type` is FREE TEXT on the wire, so Object.prototype member names
// ('toString', 'constructor', …) are reachable values, not hypotheticals. A
// bare `EVENT_TYPE_BADGE_CLASS[eventType]` on an object literal would resolve
// those to a prototype function instead of a class string.
const CANONICAL_TYPE_SET = new Set<string>(CANONICAL_EVENT_TYPES);

/** Per-type badge color classes; the quiet default for social/other, unknown
 *  free text, and undefined. Own-property guarded — see note above. */
export function eventTypeBadgeClass(type: string | undefined): string {
	if (type !== undefined && CANONICAL_TYPE_SET.has(type) && Object.hasOwn(EVENT_TYPE_BADGE_CLASS, type)) {
		return EVENT_TYPE_BADGE_CLASS[type];
	}
	return DEFAULT_CLASS;
}

// (*MVOX:Palestrina* — #211 GREEN)
