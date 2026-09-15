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
		serviceWorker: {
			// #368 — CF Pages config files live in static/ because that is the only
			// way they reach build output under adapter-static, but CF CONSUMES them
			// as deploy config and never serves them as assets. Left in
			// `$service-worker`'s `files` they join the worker's install-time
			// `cache.addAll`, which rejects atomically on any non-OK response — so a
			// path CF does not serve would take the whole install down, and no client
			// would ever get a new worker again: precisely the wedge #368 exists to
			// fix. Exclude them from the worker manifest, not from static/.
			// (`.DS_Store` repeats SvelteKit's own default, which this option
			// replaces wholesale. `file` arrives relative to static/, no leading
			// slash — see kit's build_service_worker.js.)
			files: (file) =>
				!/^_(headers|redirects|routes\.json)$/.test(file) && !/\.DS_Store/.test(file),
		},
	},
};

export default config;
