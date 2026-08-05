import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
	},
	kit: {
		adapter: adapter({
			// Cloudflare Pages' SPA mode looks for index.html specifically when no
			// top-level 404.html is present (routes all unmatched paths to '/').
			// '200.html' is a Netlify-only convention — CF doesn't recognize it and
			// 404s at root. See [GOTCHA] in memory/byrd.md.
			fallback: 'index.html',
		}),
		// No server ever renders this SPA, so relative asset paths (which depend
		// on the request path) would be wrong under the locale-agnostic fallback.
		paths: {
			relative: false,
		},
	},
};

export default config;
