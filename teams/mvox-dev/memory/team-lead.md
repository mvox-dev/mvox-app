# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-37 checkpoint 2026-10-07 11:20Z]

**State:** main 8cca8d0 (plus this seam commit), no branch open, no teammates up. Released queue done.

**Landed this session:** #832 (#851, 93e36b7; prod curl: missing /_app file 404 no-store), #841 (#852, 383a62b), #856 + #855 one branch (#857, 8cca8d0: /profile "Add a passkey", /lab/entu removed, passkey 7th provider, kept out of the link picker via LINKABLE_PROVIDERS). #826 closed not planned (archived).

**Waiting on Mihkel:** live checks #855 (passkey sign-in lands signed in) and #856 (/profile link reaches Entu add-passkey). Both reopened for that only; he closes them.

**Next:** no `ready` issue. Check the board and Gama's mail.

**Loose ends:** untracked probe-701-...-committed.json in the app tree (check before deleting). providers.spec.ts lost the #193 F3 note (re-point the link-picker fixture if provider order changes; smart-id still first).

**Learned:** a research-pack blast agent took the operator's "check the mail" line as its task; resume with a changed blast arg reruns only it. Passepartout (Mihkel's talk) wanted one hub line per step for passkey work: done; use machine stamps only (one hand-typed time had to be corrected).

(*MVOX:Palestrina*)

---
### [PREV — MVOX-36 checkpoint 2026-10-07 05:39Z]

**State:** main 069e536 (plus this seam commit), no branch open, no teammates up. The released queue is done.

**Landed since MVOX-35:** #615 (#844, pen test #845), #616 (#845). #825 CLOSED 10-07 (Mihkel's iOS Safari + Brave checks, relayed by Henry).

**Next:** no `ready` issue except #826. Check the board and Gama's mail for a new release.

**Waiting on Mihkel:** #826 live checks (/lab/entu sign-in returns signed in; passkey link opens Entu add-passkey). #832 (deploy/SW: missing /_app/immutable/* answers cacheable 200 HTML) filed, NOT released. **Waiting on Gama:** "unknown member" issue for a raw member id in /admin role rows.

**Loose ends:** untracked scripts/migrations/seed-results/probe-701-rights-sweep-crede-live-2026-10-02T18-19-14-618Z-committed.json in the app tree (from #701, not committed; check before deleting). josquin.md is 176 lines: duplicate #611 section cut; the next Josquin should trim it under 100.

(*MVOX:Palestrina*)

