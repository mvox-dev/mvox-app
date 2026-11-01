// `/` sends the visitor on to the agenda, which lives at /agenda.
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ url, parent }) => {
	await parent(); // the sign-in guard in +layout.ts answers first
	redirect(302, `/agenda${url.search}`);
};
