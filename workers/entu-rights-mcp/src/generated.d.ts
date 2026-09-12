// #318 REVIEW fix (findings comment 5642106513, item 2) — ambient fallback
// type for the GITIGNORED generated bundle. A leading-wildcard ambient
// module declaration is consulted ONLY when the real file cannot be
// resolved (verified empirically: a relative-literal `declare module
// '../generated/rules-bundle.json'` does NOT act as a fallback under
// moduleResolution "bundler" — the wildcard form does); when
// `pnpm mcp:bundle` has run and the JSON file exists, `resolveJsonModule`
// resolves it for real and this declaration is not consulted. That is what
// makes src/index.ts typecheck identically in both states, replacing the
// `@ts-expect-error` that was wrong in exactly the state deploys require
// (bundle present → TS2578, since the suppressed error no longer occurs).
declare module '*rules-bundle.json' {
	const bundle: unknown;
	export default bundle;
}
