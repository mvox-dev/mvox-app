// The save-time url fix (#374, #375): see docs/architecture/links.md.
export function normalizeUrl(input: string, currentHost: string): string {
	let prepared = input;
	if (input.startsWith('//')) {
		prepared = `https:${input}`;
	} else if (input.startsWith('/')) {
		return input;
	} else {
		const slashIdx = input.indexOf('/');
		const head = slashIdx === -1 ? input : input.slice(0, slashIdx);
		const colonIdx = head.indexOf(':');
		if (/^(mailto|tel):/i.test(head)) {
			prepared = input;
		} else if (colonIdx === -1) {
			prepared = `https://${input}`;
		} else {
			const afterColon = head.slice(colonIdx + 1);
			if (afterColon.length > 0 && /^\d+$/.test(afterColon)) {
				prepared = `https://${input}`;
			}
		}
	}

	let parsed: URL;
	try {
		parsed = new URL(prepared);
	} catch {
		return input;
	}

	if (parsed.host.toLowerCase() === currentHost.toLowerCase()) {
		const rest = `${parsed.pathname}${parsed.search}${parsed.hash}`;
		return rest || '/';
	}

	return prepared;
}
