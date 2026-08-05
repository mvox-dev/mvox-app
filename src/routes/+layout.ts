// Pure client-side SPA: no server ever renders this app, and Entu JWTs are
// aud=IP-bound so only the browser can hold them. Disabling SSR here is what
// makes adapter-static emit a single fallback shell instead of prerendering.
export const ssr = false;
