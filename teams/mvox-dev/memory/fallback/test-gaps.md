# mvox-dev — Test Gaps

Untested areas for triage. **Tallis** appends; **Victoria** triages into issues.

Format: `[GAP] <area> — <what's missing> — <risk level: low/med/high> — <date>`

---

## Open Gaps

[GAP] Auth flow — No tests for Entu OAuth callback, JWT cookie creation, session expiry redirect, or unauthenticated BFF route rejection. HIGH. 2026-05-18. (No auth routes exist yet — add when CHORE-5 BFF skeleton lands.)

[GAP] wrangler TOML inline table — binding check regex doesn't catch `d1_databases = {}` inline style. LOW. 2026-05-18.

[GAP] Paraglide i18n — No tests for locale switching, missing-key fallback, or SSR locale detection. MED. 2026-05-18. (Block on CHORE-3 landing.)

[GAP] Tailwind purge — No test verifying that dynamic class names aren't stripped at build time. MED. 2026-05-18. (Block on CHORE-2 + first component.)

[GAP] Cloudflare adapter output shape — smoke test only checks that `.svelte-kit/cloudflare/` exists; doesn't verify `_worker.js` or `_routes.json` are present. LOW. 2026-05-18.

[GAP] CHORE-32 — Section-of-section recursion not tested end-to-end. Current tests verify `parent_section` field is exposed in the flat response, but the recursive traversal path (GET /api/organizations/[id]/sections?parent=<sectionId>) is deferred to phase 2. MED. 2026-05-22.

[GAP] CHORE-32 — No test for Entu upstream 5xx/502 handling in org or sections endpoints. Both endpoints currently only gate on 401 and org-not-found (404). Upstream unavailability → 502 behavior untested. LOW. 2026-05-22.

[GAP] CHORE-32 — Anonymous /public/orgs endpoint not tested (deferred entirely to future scope). LOW. 2026-05-22.

[GAP] CHORE-35 — Real Entu OAuth flow not E2E testable (requires live Entu; callback route exists but the actual OAuth redirect + token exchange can't be mocked in Playwright without a test Entu instance). The /auth/login page shell is tested (renders, CTA present) but the full sign-in flow is NOT. HIGH. 2026-05-22.

[GAP] CHORE-35 — Loading skeleton appearance not tested. Playwright tests skip it because skeleton disappears before Playwright can observe it on a local dev server (SSR means data arrives with initial HTML). Would require artificial delay or a dedicated slow-BFF fixture. LOW. 2026-05-22.

[GAP] CHORE-35 — Locale switcher functionality not tested (Comenius wires it in i18n phase; Byrd only lays the structure). MED. 2026-05-22.

[GAP] CHORE-76/77 — Responsive nav viewport + stacking behaviour not E2E tested. Three checks deferred to Playwright: (1) horizontal-overflow at 320px: `page.setViewportSize({ width: 320, height: 600 })` + `page.evaluate(() => document.body.scrollWidth > window.innerWidth)`; (2) dropdown panel visibility: after clicking hamburger/avatar, assert panel bounding rect is fully within viewport (not clipped); (3) paint-order: assert panel `z-index` is above page content by comparing `document.elementsFromPoint(x, y)` at the panel's coordinates. Deferred — HIGH. 2026-05-31.

[GAP] CHORE-78 — Mobile library viewport + scroll behaviour not E2E tested. Three checks deferred to Playwright: (1) at `page.setViewportSize({ width: 375, height: 812 })`, the task cards and desktop master index are visually absent (not just class-gated); (2) mobile list scrolls correctly with sticky search box pinned to top; (3) scroll-spy genuinely does NOT fire on mobile — assert `?work=` param does not change as user scrolls the list (AC7 true check). Deferred — HIGH. 2026-05-31.

[GAP] CHORE-79 — Auth guard E2E flow not Playwright-tested. Deferred checks: (1) logged-out user navigates to `/library` → redirected to `/auth/login?redirect=%2Flibrary`; (2) completes login → cookie set → redirected back to `/library`; (3) logout → cookie cleared → `/library` redirects again. Requires preview deploy + real OAuth or a test-Entu mock harness. Deferred — HIGH. 2026-05-31.

[GAP] mvox-app #12 (RsvpControl) — the actual "tap → optimistic UI update → revert on failure" behavior (issue #12's headline AC) is not driven through a live DOM anywhere in the RED. It can't be: RsvpControl-in-AgendaList-in-Page is a stub chain at RED time, assembled only at GREEN. What IS unit-tested: RsvpControl's tap→callback mapping, AgendaList's prop-to-control wiring, and `applyRsvpChange`'s write-dispatch logic (create/update/delete/no-op decision) — separately, each real. What's NOT tested anywhere: that a real tap on the real assembled control (a) flips the DOM immediately before the write resolves and (b) snaps back to the prior state when the write rejects. A Playwright E2E (mock the #10/#11 fetch layer, assert DOM state mid-flight on a manually-controlled promise) would close this — same shape as the other deferred-to-Playwright entries above. HIGH. 2026-08-06.

(*MVOX:Tallis*)
