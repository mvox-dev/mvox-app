// What a link may point at (#1066): see docs/architecture/links.md.
import { normalizeUrl } from './normalizeUrl';

const ALLOWED = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const PROBE_HOST = 'probe.invalid';
const PROBE = `https://${PROBE_HOST}`;

export function safeLinkUrl(url: string): boolean {
	if (url.startsWith('/')) {
		try {
			return new URL(url, PROBE).origin === PROBE;
		} catch {
			return false;
		}
	}
	try {
		const { protocol } = new URL(url);
		return ALLOWED.has(protocol);
	} catch {
		return false;
	}
}

/** The href a stored url renders as; null when it must show as plain text. A schemeless url
 *  (saved before #374) gets https:// the way the save path gives it. */
export function linkHref(url: string): string | null {
	const href = normalizeUrl(url, PROBE_HOST);
	return safeLinkUrl(href) ? href : null;
}

/** The scheme for a report, lowercased; 'none' when there is none. Never the url itself. */
export function linkScheme(url: string): string {
	try {
		const { protocol } = new URL(url);
		return protocol.slice(0, -1);
	} catch {
		return 'none';
	}
}

// (*MVOX:Josquin*)
