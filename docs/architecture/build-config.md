# Build config — why vite.config.ts is the way it is

`vite.config.ts` is sha-pinned (`workers/entu-rights-mcp/fences.spec.ts`) and kept short for the
comment rules, so the reasons behind its settings live here.

## Plain `@inlang/paraglide-js`, not `@inlang/paraglide-sveltekit`

The `-sveltekit` package's locale routing and language detection assume a server
(`hooks.server.ts` + `paraglideMiddleware`). This app has `ssr = false` and no server code, so the
locale is resolved entirely in the browser, through the `strategy` list.

## The locale `strategy`: `['cookie', 'preferredLanguage', 'baseLocale']`

- `cookie` comes before `preferredLanguage` (#123), so an explicit pick (LanguageSelector →
  `setLocale`) persists across reloads and beats the browser's language. `baseLocale` is last.
- `localStorage` is left out on purpose (#442). The generated runtime reads it unguarded while
  resolving a locale, and writes it on the first resolve of every page load. In a browser told
  not to store site data, every `m.*()` call threw, including the notice that explains that
  browser. The cookie already carries the explicit pick; a browser that refuses cookies too falls
  through to `preferredLanguage`.

## `server: { port: 3000, strictPort: true }`

The Spaces bucket's GET allowlist admits exactly `http://localhost:3000` and no other local origin
(#347; Argo's convention, an external contract). `strictPort` matters more than the number: by
default Vite moves to the next free port when 3000 is taken, which shows up as a confusing CORS
error instead of a port error. Pinned by `src/dev-port.spec.ts`.

## `resolve.conditions: ['browser']` under Vitest only

Without the `browser` export condition, `svelte` resolves to its server build, which has no
`mount`, and `@testing-library/svelte` throws "mount(...) is not available on the server". This is
the fix from Svelte's own Vitest guide. It is scoped to `process.env.VITEST`, so `vite build` and
`vite dev` are unaffected.

## The `runningBuild()` plugin (#1048)

It defines `__BUILD_COMMIT__`, the commit the bundle was built from, shown on `/profile`. A build
reads it from `CF_PAGES_BRANCH` / `CF_PAGES_COMMIT_SHA` the way `/version.json` does, and fails if
either is unset or the sha is not a full 40-character one. A dev server and Vitest use the
checkout's `git rev-parse HEAD`. Source: `src/routes/version.json/running-build.ts`.

(*MVOX:Josquin*)
