# Collective links: saving and showing a url

Code: `src/lib/links/normalizeUrl.ts`, `src/lib/links/safeLinkUrl.ts`.

## normalizeUrl(input, currentHost): the save-time fix (#374, #375)

Page layer only; the data layer stores what it is given.

1. **No scheme (#374):** `https://` is prepended. Any scheme passes as typed.
   - `//host/path` is schemeless: `https:` goes in front.
   - `host:port/...` (a colon followed by digits only, up to the first `/` or the end) is
     schemeless, not a scheme.
   - `mailto:` and `tel:` are schemes even when digits follow the colon (#1066), so `tel:1234`
     stays as typed. Matched case-insensitively.
2. **Own host (#375):** when the parsed WHATWG `.host` (lowercased, includes the port) equals
   `currentHost`, the result is pathname + search + hash. It always begins with `/`; an empty
   path stores `/`, never the empty string (Gama pin, 2026-09-18). `www.` is not the bare host.
   The scheme does not matter: an `http:` own-host url is trimmed too. A url on any other host
   comes back verbatim, with no re-serialising (no lowercasing).
3. **Already a path:** an input that starts with a single `/` passes through untouched, so
   `normalizeUrl` is idempotent over its own output. Without this, re-saving a stored
   `/salvestused` would be read as schemeless and become `https:///salvestused`, a dead link to
   a host named `salvestused`. The `//` case is decided first.
4. **Unparseable** after the prepend: the input comes back unchanged and nothing throws. The
   page saves what was typed (pinned: no fallback wanted).
5. Whitespace-only input is rejected earlier by the page's non-empty check.

`normalizeUrl` does not judge schemes; `safeLinkUrl` does.

## safeLinkUrl(url): what a link may point at (#1066)

Allowed: an own path (one leading `/`, not `//host` or `/\host`) or an absolute url with
protocol `http:`, `https:`, `mailto:` or `tel:`. Everything else is refused: `javascript:`,
`data:`, `vbscript:`, `file:`, `ftp:`, unparseable, and case or whitespace tricks. Parsing is
the browser's, so ` JavaScript:` and `java<tab>script:` land as `javascript:`.

- **Save:** create and edit run `normalizeUrl`, then `safeLinkUrl`; a refusal writes nothing
  and shows `links_url_scheme_refused`.
- **Show:** `linkHref` gives a stored url's href, or null. A schemeless url saved before #374
  gets `https://` the way the save path gives it. Null shows the name as plain text on `/links`
  and the landing, and files one problem report per link per page load (id and scheme only,
  never the url).
- `workRows.ts` filters `external_link` with the same check.
