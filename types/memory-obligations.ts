// Obligations: memory/obligations.yaml.
// What someone must do. A fact rots when the world changes; an obligation rots when the
// counterparty acts. So it carries a resolution check, not a refutation address.

import type { IsoDate, Ref } from './memory-common';

/**
 * The YAML layout readers accept. The lint reads full YAML; the obligations pane reads this
 * subset, so stay inside it:
 *
 * - One top-level key, `obligations:`, holding a block list, or `obligations: []` when empty.
 *   Comments and blank lines anywhere.
 * - List items at column 0 under the key (as `yaml.safe_dump` writes them) or indented, the
 *   same way throughout the file. Each item is a flat map of the keys below; no other key.
 * - Values are scalars: plain, 'single-quoted' ('' for a quote) or "double-quoted" (YAML
 *   escapes, \x \u \U included). A value may continue on lines indented deeper than its key;
 *   the lines fold as YAML folds them. A plain `null` or `~` is an empty value.
 * - Not accepted: block scalars (| or >), flow collections ([a] or {a: b}) as values, anchors,
 *   aliases, tags, and nested maps or lists.
 * - `since` and `expires` are ISO dates (YYYY-MM-DD), quoted or not.
 *
 * `yaml.safe_dump(data, sort_keys=False)` output is inside the subset, with or without
 * allow_unicode.
 */
export interface ObligationsFile {
  obligations: Obligation[];
}

export interface Obligation {
  /** What is owed. <= OBLIGATION_CHAR_CAP. */
  obligation: string;
  /** Who must act. Never "us" without a name. */
  actor: string;
  /** Who is waiting: a name, never "us" or "we", never the actor (kit #29). A row nobody else
   *  is owed is a to-do, and a to-do is not a kit tier: it goes in the home's own work queue.
   *  Optional so rows written before it pass: the lint counts a missing one, fails a wrong one. */
  owed_to?: string;
  /** When the waiting began, not when it was written down. */
  since: IsoDate;
  /** How to find out it is already done: a command, a page, a person. Blank is counted. */
  check: string;
  /** When it stops being believable regardless. On expiry: check, then re-state, resolve,
   *  or hand to a human. Never renew silently. */
  expires: IsoDate;
  ref: Ref;
}

// Resolved obligations are deleted. Never a copy of a real ledger -- hold the pointer.
// Why this is not a scratchpad row: lessons/obligations-are-not-facts.md
