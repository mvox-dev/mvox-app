// Message-file reading helpers for the locale-parity structural specs.
//
// Paraglide 2 / @inlang/plugin-message-format values are NOT uniformly strings.
// A message is either:
//   - a plain pattern string: "Sort copies by"
//   - a VARIANT array (plural/gender/etc.):
//       [{ declarations: [...], selectors: [...], match: { "countPlural=one": "...", ... } }]
//
// Several specs read messages/*.json directly and called `.trim()` on the raw
// value, which throws the moment any key gains variants (YELLOW-128.1 added the
// first one — `library_available_summary`). These helpers normalize both shapes
// so parity guards keep working as more messages become plural-aware.

/** One entry of a Paraglide 2 variant array. */
export type MessageVariant = {
	declarations?: string[];
	selectors?: string[];
	match?: Record<string, string>;
};

/** A raw value as it appears in messages/{locale}.json. */
export type MessageValue = string | MessageVariant[];

export type MessageFile = Record<string, MessageValue>;

/**
 * Every concrete pattern string a message can render.
 *
 * - plain string -> [that string]
 * - variant array -> one entry per `match` arm
 *
 * A variant with no arms yields [] on purpose: an unrenderable message should
 * read as "empty" to the parity guards, not silently pass.
 */
export function messagePatterns(value: MessageValue | undefined): string[] {
	if (value === undefined) return [];
	if (typeof value === 'string') return [value];
	if (!Array.isArray(value)) return [];
	return value.flatMap((variant) => Object.values(variant?.match ?? {}));
}

/**
 * True when a message has no renderable content — no patterns at all, or a
 * pattern that is blank/whitespace. Variant messages must have EVERY arm
 * filled: a half-translated plural renders blank for some counts only, which
 * is exactly the bug a parity guard exists to catch.
 */
export function isMessageEmpty(value: MessageValue | undefined): boolean {
	const patterns = messagePatterns(value);
	if (patterns.length === 0) return true;
	return patterns.some((pattern) => pattern.trim() === '');
}

/**
 * True when EVERY renderable pattern of the message contains `needle`.
 * Used by guards asserting a placeholder such as `{name}` survives translation
 * — for a plural, dropping the param from one arm is just as broken as
 * dropping it from a plain string.
 */
export function everyPatternContains(value: MessageValue | undefined, needle: string): boolean {
	const patterns = messagePatterns(value);
	if (patterns.length === 0) return false;
	return patterns.every((pattern) => pattern.includes(needle));
}
