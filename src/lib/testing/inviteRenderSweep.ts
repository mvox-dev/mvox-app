// #360 — pure classifier behind the no-rendered-invite-link sweep: finds each invite-link site
// in one file and classifies its use. markup-value and markup-text are forbidden. Context is
// line-based: a carrier on an attribute's continuation line reads as text, a loud false positive.

export type InviteSiteKind =
	| 'script-compose'
	| 'markup-guard'
	| 'markup-handler'
	| 'markup-href'
	| 'markup-value'
	| 'markup-text';

export interface InviteSite {
	file: string;
	line: number; // 1-based
	kind: InviteSiteKind;
	excerpt: string;
}

export const FORBIDDEN_KINDS: ReadonlySet<InviteSiteKind> = new Set([
	'markup-value',
	'markup-text'
]);

/** Builders whose OUTPUT is an invite URL (or a token-carrying href). */
const BUILDERS = /buildInviteUrl|buildInviteProviderHref/;
/** A template-literal interpolation composing an /invite/<token> path. */
const INVITE_INTERPOLATION = /\/invite\/\$\{/;
/** Invite-link material wherever it appears in markup, whatever the scan sees assigned. */
const BUILTIN_CARRIERS = ['inviteToken', 'inviteLinkByMemberId'];

/** Split a .svelte source into script and markup, blanking the other region line by line. */
function splitSvelte(source: string): { script: string; markup: string } {
	const lines = source.split('\n');
	const scriptLines: string[] = [];
	const markupLines: string[] = [];
	let inScript = false;
	for (const line of lines) {
		const opens = /<script[\s>]/.test(line);
		const closes = /<\/script>/.test(line);
		const isScript = inScript || opens;
		scriptLines.push(isScript ? line : '');
		markupLines.push(isScript ? '' : line);
		inScript = (inScript || opens) && !closes;
	}
	return { script: scriptLines.join('\n'), markup: markupLines.join('\n') };
}

/** Identifiers assigned (directly, via $derived, or via an object-literal
 *  update) from a builder or an /invite/ interpolation. */
export function findCarriers(script: string): string[] {
	const carriers = new Set<string>(BUILTIN_CARRIERS);
	const direct =
		/\b([A-Za-z_$][\w$]*)\s*=\s*(?:\$derived\(\s*)?(?:buildInviteUrl|buildInviteProviderHref|`[^`]*\/invite\/\$\{)/g;
	const objectUpdate = /\b([A-Za-z_$][\w$]*)\s*=\s*\{[^{}]*(?:buildInviteUrl|buildInviteProviderHref)/g;
	for (const re of [direct, objectUpdate]) {
		for (let m = re.exec(script); m; m = re.exec(script)) carriers.add(m[1]);
	}
	return [...carriers];
}

function classifyMarkupLine(line: string, occurrenceIndex: number): InviteSiteKind {
	const contexts: Array<{ re: RegExp; kind: InviteSiteKind }> = [
		{ re: /\{#if\s|\{:else\s+if\s|\{#each\s/, kind: 'markup-guard' },
		{ re: /\bon[a-z]+\s*=\s*\{/, kind: 'markup-handler' },
		{ re: /\bhref\s*=\s*\{/, kind: 'markup-href' },
		{ re: /\bvalue\s*=\s*\{/, kind: 'markup-value' }
	];
	for (const { re, kind } of contexts) {
		const m = re.exec(line);
		if (m && m.index < occurrenceIndex) return kind;
	}
	return 'markup-text';
}

/** Scan one file's source for every invite-link-material site. */
export function scanInviteUrlSites(file: string, source: string): InviteSite[] {
	const isSvelte = file.endsWith('.svelte');
	const { script, markup } = isSvelte
		? splitSvelte(source)
		: { script: source, markup: '' };
	const sites: InviteSite[] = [];

	const scriptLines = script.split('\n');
	scriptLines.forEach((line, i) => {
		if (BUILDERS.test(line) || INVITE_INTERPOLATION.test(line)) {
			sites.push({ file, line: i + 1, kind: 'script-compose', excerpt: line.trim() });
		}
	});

	if (!isSvelte) return sites;

	const carriers = findCarriers(script);
	const markupLines = markup.split('\n');
	markupLines.forEach((line, i) => {
		const names = [
			...carriers.map((c) => new RegExp(`\\b${c.replace(/\$/g, '\\$')}\\b`)),
			BUILDERS,
			INVITE_INTERPOLATION
		];
		for (const re of names) {
			const m = re.exec(line);
			if (!m) continue;
			sites.push({
				file,
				line: i + 1,
				kind: classifyMarkupLine(line, m.index),
				excerpt: line.trim()
			});
			break; // one site per line — enumeration, not a token counter
		}
	});
	return sites;
}

// (*MVOX:Tallis*)
