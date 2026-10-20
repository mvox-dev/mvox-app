// The page metadata a feedback carries (#611): nothing personal, only where, when and on what
// browser (#1006) it was given.
import { getLocale } from '$lib/paraglide/runtime';
import type { SentProblem } from '$lib/problems/problemLog';

export interface PageContext {
	route: string;
	time: string;
	locale: string;
	viewport: string;
	// Optional: a feedback saved on the device before #1006 has none.
	userAgent?: string;
}

/** The #350 build stamp; both are null on a build outside Cloudflare Pages. */
export interface AppVersion {
	branch: string | null;
	commit: string | null;
}

export function capturePage(route: string): PageContext {
	return {
		route,
		time: new Date().toISOString(),
		locale: getLocale(),
		viewport: `${window.innerWidth}x${window.innerHeight}`,
		userAgent: navigator.userAgent
	};
}

// Read when the feedback reaches Entu, so a feedback saved offline names the build that sent it.
export async function readAppVersion(fetchImpl: typeof fetch = fetch): Promise<AppVersion> {
	const res = await fetchImpl('/version.json');
	if (!res.ok) throw new Error(`readAppVersion: /version.json answered HTTP ${res.status}`);
	const stamp = (await res.json()) as Partial<AppVersion>;
	if (stamp.branch === undefined || stamp.commit === undefined) {
		throw new Error('readAppVersion: /version.json carries no branch and commit');
	}
	return { branch: stamp.branch, commit: stamp.commit };
}

export function feedbackMetadata(
	page: PageContext,
	version: AppVersion,
	problems: SentProblem[]
): string {
	return JSON.stringify({
		route: page.route,
		time: page.time,
		version: { branch: version.branch, commit: version.commit },
		locale: page.locale,
		viewport: page.viewport,
		userAgent: page.userAgent,
		problems
	});
}

// (*MVOX:Josquin*)
