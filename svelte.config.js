import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
	},
	kit: {
		adapter: adapter({
			fallback: '200.html',
		}),
		// No server ever renders this SPA, so relative asset paths (which depend
		// on the request path) would be wrong under the locale-agnostic fallback.
		paths: {
			relative: false,
		},
	},
};

export default config;
