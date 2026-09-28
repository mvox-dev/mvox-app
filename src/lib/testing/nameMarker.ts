// src/lib/testing/nameMarker.ts
//
// #361 — shared assertions for the capture-redaction marker on rendered
// member names. Used by every route/component spec that pins a name-bearing
// surface, so the "marked, and marked ONCE" rule reads the same everywhere.
//
// ONE MARKER PER RENDERED VALUE (Gama, #361): a name wrapped in PersonName
// inside another RedactedText would still blank, but a double marker is a
// sign the surface was wrapped twice — so every helper also asserts the
// marker element has no marked ancestor of its own.
import { expect } from 'vitest';
import { REDACT_ATTR } from '$lib/redact/redact';

const MARKER = `[${REDACT_ATTR}]`;

/** Every text node under `root` whose text contains `needle`. */
export function textNodesContaining(root: Node, needle: string): Text[] {
	const out: Text[] = [];
	const doc = root.ownerDocument ?? (root as Document);
	const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
	let n = walker.nextNode();
	while (n) {
		if ((n.textContent ?? '').includes(needle)) out.push(n as Text);
		n = walker.nextNode();
	}
	return out;
}

/** The nearest marked element enclosing `node`, or null. */
export function markerOf(node: Node): Element | null {
	const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
	return el?.closest(MARKER) ?? null;
}

/**
 * Every rendered occurrence of `name` under `root` sits inside a marker, and
 * that marker is not itself inside a second marker. Fails loudly if the name
 * is not rendered at all (a vacuous pass proves nothing).
 */
export function expectNameMarkedOnce(root: Element, name: string, where = ''): void {
	const nodes = textNodesContaining(root, name);
	expect(nodes.length, `"${name}" must be rendered ${where}`).toBeGreaterThan(0);
	for (const node of nodes) {
		const marker = markerOf(node);
		expect(marker, `"${name}" ${where} must sit inside a [${REDACT_ATTR}] element`).not.toBeNull();
		expect(
			marker?.parentElement?.closest(MARKER) ?? null,
			`"${name}" ${where} must carry exactly ONE marker, not a nested second one`
		).toBeNull();
	}
}

/**
 * A control whose text is a whole translated sentence with the name baked in
 * (admin_roles_remove, library_copy_lent_to): the marker cannot blank part of
 * a sentence, so the element's WHOLE text content sits in exactly one marker
 * element inside it, and nothing else in it is marked.
 */
export function expectWholeTextMarkedOnce(el: Element, where = ''): void {
	const markers = el.querySelectorAll(MARKER);
	expect(markers.length, `${where}: exactly one marker inside the element`).toBe(1);
	const text = (el.textContent ?? '').trim();
	expect(text.length, `${where}: element renders text`).toBeGreaterThan(0);
	expect((markers[0].textContent ?? '').trim(), `${where}: the marker holds the whole text`).toBe(
		text
	);
	expect(el.closest(MARKER), `${where}: no marker around the control itself`).toBeNull();
}

// (*MVOX:Tallis* — #361 RED: shared name-marker assertions)
