# Invite flow — how a stranger becomes a member

> **Canonical mechanics anchor.** This repo doc is the authority for the invite path (division of record: `docs/` wins for mechanics). The wiki page `Reference-invite-flow` is the readable companion built from this file. Extend this from `entu-api` source or from something observed live — never from a summary.

- **Status:** Active reference · 2026-08-07 (updated with live T4.9/#29 gate findings)
- **Built from:** `entu-api` source @`82cb25b` and this repo `main` @`cf66173`, each claim verified `file:line` this session; slice-4 (onboarding, #21) as built. Live corrections from the T4.9 gate (#29, 2026-08-07) marked **[LIVE]** below.
- **Companions:** `docs/architecture/entu-rights-and-visibility-model.md` (rights/visibility) · wiki [Runbook — Entu visibility](https://github.com/mvox-dev/mvox-app/wiki/Runbook-entu-visibility) §0 "where a `person` comes from".

> **Changed by #1031 (2026-10-24).** The admin invite surface no longer mints or shows a link. A new person is created with the email the admin enters, then sent the invite by `send-invite`; an existing person is sent to the email on their person record (§8). §2–§4 still describe the mint that /profile's self-link uses.

**Provenance discipline.** Every mechanics claim is **[SRC]** (traceable to `entu-api` source `file:line`), **[LIVE]** (empirically confirmed, with what was observed), or **[CONV]** (an mvox-app convention — true because we chose it, not because Entu enforces it). Unmarked is not established. **The invite path's anonymity and one-shot binding are Entu platform behaviours** — mvox uses the right field and reads the result; it does not re-implement them.

---

## The shape, in one breath

The admin's app puts a fixed trigger constant in a special field; **Entu swaps it for an anonymous, signed, one-shot ticket and throws the string away** (the invitee's real email never went there) — the ticket's stated lifetime is **24 hours on the live deployment** (§7 — the pinned source reads 7 days; the two disagree). mvox grabs that ticket on its single readable pass, wraps it in a link, shows the link to the admin once, and forgets it. The admin hands the link to the invitee through a channel he trusts. She opens a public page that can *describe* the invitation but can't *verify* it, signs in as herself, and in doing so **the ticket she's holding is permanently bound to her real identity** — whoever holds it first, once, no check on the address.

---

## 1. The admin clicks create

The admin enters the invitee's email and no name (#36 dropped the membership record's name). `CreateInviteInput` carries the collective's database entity id and that email · **[CONV]** `src/lib/invite/inviteCreate.ts` `CreateInviteInput`. The email is written onto the new person and Entu sends the invite there (§8). Ruling (a), Mihkel 2026-10-24 (#1031), supersedes #34's "no email" for this surface. Until #1031 the admin entered nothing and mvox minted a link the admin passed on; §2–§4 describe that mint, which /profile's self-link still uses.

## 2. mvox creates the `person` — and Entu performs the swap

mvox POSTs a new `person` with a **fixed trigger constant** in the `entu_user` property — `INVITE_MINT_TRIGGER = 'trigger invite token'` · **[CONV]** `mvox-app src/lib/invite/inviteConstants.ts:2` — not the invitee's email.

The instant Entu sees text in an `entu_user` field, it does this · **[SRC]** `entu-api utils/entity.js:462-467`:

```js
if (property.type === 'entu_user' && property.string) {
  property.invite = jwt.sign({ db: entu.account, entityId: entityId.toString() }, jwtSecret, { expiresIn: '7d' })
  delete property.string
}
```

- **The trigger is only "text in an `entu_user` field."** *Any* truthy string mints the token — there is no invite "mode." mvox exploits this to send a self-documenting constant instead of a person's data.
- **The token carries no identity** — signed from `{ db, entityId }` only. The address appears nowhere in it. This is *why* the invite binds by possession, not identity.
- **The string is deleted, not hidden** — `delete property.string`. Consumed to mint, then dropped; never stored on the person.
- **No email goes into the mint trigger** · **[CONV]** #34: the trigger is the fixed constant, never an address. (Historically the real email was sent here and deleted; #34 removed even that transient exposure.) This holds for the trigger only: since #1031 the admin surface writes the email as the person's own `email` property and mints nothing (§1, §8).
- Choosing the constant `'trigger invite token'` deliberately avoids the literal `'send-invite'`, which is magic only on Entu's *update* endpoint (`POST /[db]/entity/[_id]`) where it fires the SES invite email · **[SRC]** `entu-api routes/[db]/entity/[_id]/index.post.js:122`. mvox's person-create hits the *create* endpoint (`POST /[db]/entity`), which reads only truthiness — so no email is ever sent by Entu, which is what we want (mvox delivers the link manually).

## 3. mvox reads the token back — its one and only chance

Right after create, mvox reads the minted token out of Entu's **response** · **[CONV]** `inviteCreate.ts:162-166` (it looks for `entu_user.invite`). This is the **only** readable pass: every later GET of the person masks the token as `***` · **[SRC]** `entu-api utils/entity.js:594-598`. So "created but no token in the response" is treated as a hard, fail-loud error — no half-made invite, no blind retry. mvox then grants the person self-`_editor` (so she can edit her own record on arrival) and creates the `member` entity — and mvox **must** do this itself: Entu's invite-acceptance path grants no rights at all · **[SRC]** `entu-api routes/auth/index.get.js:279` (`replaceInviteWithCredentials` writes only the `entu_user` credential property; zero `_editor` work — unlike auto-provision, which self-grants at `:330`).

## 4. The token becomes a link — shown once, then forgotten

mvox builds `…/invite/<token>` · **[CONV]** `invite-links.ts`. The link lives **only in the admin page's memory** — never stored, never logged — shown once with its expiry read from the token's own `exp`, and discarded when dismissed. From that moment the **only copy of the token in existence is wherever the admin pastes it** — not in mvox storage, and (per the `***` masking) not retrievable from Entu either. A genuine one-shot bearer secret on both ends. The admin pastes it into a channel he trusts.

## 5. The invitee lands on a public page that reads the ticket but trusts nothing

She opens `/invite/<token>` — public by allowlist · **[CONV]** `src/lib/auth/guard.ts:45`. The page **decodes** the token client-side (unverified) to show which collective and the expiry — it **cannot name her** (no email in the token) and **cannot verify** it (the signature is a server secret). She sees a greeting and one sign-in button per provider, each carrying the token forward. A client-clock "expired" keeps the buttons (only a warning) — only the server can declare an invite truly dead. **Nothing is bound to her yet.**

## 6. She signs in — and that is the binding

She authenticates as herself and returns carrying two things: her proven identity (a real session) and the ticket. Entu redeems · **[SRC]** `entu-api routes/auth/index.get.js:200-232`:

```js
const inviteData = jwt.verify(query.invite, jwtSecret)   // verified for real, first time
if (inviteData.db === onlyForAccount) {
  const storedInvite = await findStoredInvite(inviteEntu, inviteData.entityId)
  if (!existingEntry) {                                   // she has no identity here yet
    if (storedInvite) {
      await replaceInviteWithCredentials(inviteEntu, inviteData.entityId, storedInvite._id, session)
      addAccount(onlyForAccount, inviteData.entityId, session.user.name)
    }
  } ...
```

`replaceInviteWithCredentials` stamps **her** proven identity onto the person the *ticket* points at (`inviteData.entityId`) — the anonymous invite property is replaced by her real credentials. Every promised property falls out of this:

- **Possession, not identity / first-claim-wins** — the person comes from the ticket, the identity from whoever signed in (`session`). Nothing compares her email to anything. Had someone else held the link and signed in first, they'd be stamped on.
- **Redeem-once** — the bind *replaces* the invite property, so a second attempt finds no `storedInvite` → no bind → the second visitor gets `outcome=dead`.
- **No auto-provision** — when an invite is in play, Entu's separate auto-create path is skipped (`inviteAttempted`) · **[SRC]** `routes/auth/index.get.js:237`. The only way in is claiming a minted ticket.
- **Conflict guard** — if she already had a *different* identity in this collective, it refuses to bind a second one and returns `conflict: 'invite'`.

## 7. Expiry — where the limit is actually enforced (and two honest edges)

The mint stamps an `exp` (§2), but **nothing enforces it until redemption**, and the mechanism is worth stating precisely rather than smoothing over:

- The landing page only `jwt.decode`s the token (unverified) — it enforces nothing (that is why a client-clock "expired" keeps the buttons, §5).
- The real gate is `jwt.verify(query.invite, jwtSecret)` · **[SRC]** `entu-api routes/auth/index.get.js:206`, called with **no `ignoreExpiration`** — so an expired token *throws* and the surrounding `catch { /* invalid/expired invite */ }` · **[SRC]** `:232` swallows it: no bind, nothing written, the invitee lands on `outcome=dead`.
- **Honest edge 1:** that enforcement **rides on the `jsonwebtoken` library's default `exp` check, not an explicit comparison in Entu's own code** — and Entu's *separate* unverified `jwt.decode` · **[SRC]** `:127` (used only to route by db) checks nothing. Whatever the lifetime is, it's a library default, not a hand-written gate.
- **Honest edge 2 — [LIVE] the source and the deployment disagree.** The pinned source (`@82cb25b`) signs with `expiresIn: '7d'` (§2). But a token minted live during the T4.9 gate walkthrough (2026-08-07, PO Gama + Mihkel) measured **`exp − iat` = 24 hours** — not 7 days. So **the deployed `entu-api` differs from the pinned commit this doc cites**; the 7-day figure is source-accurate but not currently deployment-accurate. Treat the live lifetime as **24h until re-pinned against the actual running version.** No raw token was recorded (bearer secret); only the delta was observed. Filed as a qualified note on #23 (the report that first quoted 7d).

## 8. Minting onto an existing person, and withdrawing

A member's own link for adding a sign-in on /profile mints onto a person who already exists · **[CONV]** `src/lib/invite/inviteSelfLink.ts` `mintSelfLinkInvite`. mvox first deletes the person's un-redeemed `entu_user` placeholders, because redemption takes the first value carrying `invite`, then POSTs the trigger constant (§2) onto the person. A value without `invite` is a bound identity and is never touched (#1030). Entu allows the mint on another person only for `_owner` · **[CONV]** as stated at `inviteSelfLink.ts:116`, not re-read in `entu-api` here; a person minting for herself needs her self-`_editor` (§3), and a 403 says it is missing. `withdrawInvite` deletes the un-redeemed placeholders and leaves no marker. What a failure midway leaves behind: `docs/property-writes.md`, row 6.

The roster's invite and resend mint nothing (#1003) · **[CONV]** `src/lib/invite/sendInvite.ts` `sendInvite`. mvox reads the person's own `email`; with none it sends nothing and says so. Otherwise it POSTs `send-invite` onto the person and Entu emails the link there, so no token reaches mvox. It sweeps no placeholders, so after a resend the earlier link stays valid until it expires (§7).

The admin invite surface sends the same way (#1031) · **[CONV]** `src/lib/invite/inviteSurfaceOps.ts` `submitInvite`. For a new person, `createInvite` first writes `_type`, `_parent` and the entered `email`, with no trigger, then the self-`_editor` grant and the member; then `sendInvite` runs on the new id. If that send fails, the new person joins the surface's person list so a retry sends to them rather than creating a second person.

## Why this is safe

- The mint trigger carries no email — mvox sends a constant, so a minted token's request has no address in it (#34). The admin surface does store the invitee's email on their person record (ruling (a), 2026-10-24, #1031); that is a `person` property at the tier the schema sets, and Entu emails the invite there.
- The token **names no one**; a leaked link exposes only *that one membership slot*, claimable once, expiring within a day on the live deployment (§7 — source says 7 days, observed live lifetime is 24h; either way, bounded).
- **[LIVE]** who may mint an invite is governed by Entu's own create-time admin gate — creating a `person` with `_parent` set to the database entity requires the caller to hold `_expander` (or higher) on it; the mechanism is in `docs/architecture/entu-rights-and-visibility-model.md`. A non-admin account attempting `createInvite` gets a 400 there, confirmed live during the T4.9 gate. This makes the parent-expander list a de facto "who may invite" register — any future access-control change for inviting lives in Entu's admin configuration, not in mvox code.
- The admin is the gate: entry is his deliberate act (create person + member + mint), never self-service — the counterpart to [Runbook §0](https://github.com/mvox-dev/mvox-app/wiki/Runbook-entu-visibility) "a new sign-in gets no `person`."
- The link is a bearer secret and is treated as one end to end: show-once, never stored by mvox, `***`-masked by Entu, delivered by a human through a trusted channel.

## Where to read the code

- **Entu platform** (`github.com/entu/api` @`82cb25b`):
  - mint + email deletion `utils/entity.js:462-467`;
  - token masking `utils/entity.js:594-598`;
  - redemption/binding `routes/auth/index.get.js:198-267`;
  - SES email sentinel `routes/[db]/entity/[_id]/index.post.js:122`.
- **mvox** (`main` @`cf66173`):
  - `src/lib/invite/inviteCreate.ts` (create + token read-back), `inviteConstants.ts`, `inviteOf.ts`,
  - `src/lib/invite/inviteSelfLink.ts` (mint onto an existing person, withdraw),
  - `parse-invite-token.ts`,
  - `invite-links.ts`,
  - `redeem.ts`,
  - `src/routes/invite/[token]/+page.svelte`,
  - `src/routes/admin/invite/+page.svelte`,
  - `src/lib/auth/guard.ts:45`.

---

*Status: the invite path (T4.5/#31) and the email→constant change (#34) are merged and live. The T4.9/#29 live gate is CLOSED (2026-08-07): end-to-end invite creation + redemption observed against real polyphony (the `resolvePersonParentId`→`entity._id` fix confirmed working live; the completion gate fired correctly on an empty-name arrival, per the tracked #9 prefill follow-up), plus the admin-cannot-read-private-profile control (positive control present, non-empty data both sides — verdict recorded by the check owner on #29). Two live findings folded into this doc: the parent-expander admin gate (§"Why this is safe") and the 24h-vs-7d token lifetime (§7).*

*Authored `(*MVOX:Palestrina*)` from source this session; provenance-tagged for PO Gama's record.*
