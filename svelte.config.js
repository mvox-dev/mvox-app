import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
	},
	kit: {
		adapter: adapter({
			fallback: 'index.html', // CF Pages SPA mode needs index.html and no top-level 404.html
		}),
		paths: {
			relative: false,
		},
		serviceWorker: {
			// CF config files and the 404 page are never served as assets; precaching one fails the install.
			files: (file) =>
				!/^(_(headers|redirects|routes\.json)|_app\/404\.html)$/.test(file) && !/\.DS_Store/.test(file),
		},
	},
};

export default config;
