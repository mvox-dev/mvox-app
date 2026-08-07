# Invite flow — how a stranger becomes a member

> **Canonical mechanics anchor.** This repo doc is the authority for the invite path (division of record: `docs/` wins for mechanics). The wiki page `Reference-invite-flow` is the readable companion built from this file. Extend this from `entu-api` source or from something observed live — never from a summary.

- **Status:** Active reference · 2026-08-07
- **Built from:** `entu-api` source @`82cb25b` and this repo `main` @`cf66173`, each claim verified `file:line` this session; slice-4 (onboarding, #21) as built.
- **Companions:** `docs/architecture/entu-rights-and-visibility-model.md` (rights/visibility) · wiki [Runbook — Entu visibility](https://github.com/mvox-dev/mvox-app/wiki/Runbook-entu-visibility) §0 "where a `person` comes from".

**Provenance discipline.** Every mechanics claim is **[SRC]** (traceable to `entu-api` source `file:line`), **[LIVE]** (empirically confirmed, with what was observed), or **[CONV]** (an mvox-app convention — true because we chose it, not because Entu enforces it). Unmarked is not established. **The invite path's anonymity and one-shot binding are Entu platform behaviours** — mvox uses the right field and reads the result; it does not re-implement them.

---

## The shape, in one breath

The admin's app puts a fixed trigger constant in a special field; **Entu swaps it for an anonymous, signed, 7-day, one-shot ticket and throws the string away** (the invitee's real email never went there). mvox grabs that ticket on its single readable pass, wraps it in a link, shows the link to the admin once, and forgets it. The admin hands the link to the invitee through a channel he trusts. She opens a public page that can *describe* the invitation but can't *verify* it, signs in as herself, and in doing so **the ticket she's holding is permanently bound to her real identity** — whoever holds it first, once, no check on the address.

---

## 1. The admin fills a short form

The admin enters the invitee's email, a **name** for the membership record (an admin-facing label), and the collective, then clicks create. **The email stays client-side** — it's only how the admin knows where to send the link. It is **never sent to Entu** (§2). Nothing has reached the invitee yet.

## 2. mvox creates the `person` — and Entu performs the swap

mvox POSTs a new `person` with a **fixed trigger constant** in the `entu_user` property — `INVITE_MINT_TRIGGER = 'trigger invite token'` · **[CONV]** `mvox-app src/lib/invite/inviteData.ts:211` — not the invitee's email.

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
- **The email never reaches Entu at all**, and this is now a **compile-time guarantee** · **[CONV]** #34: `CreateInviteInput` has no `email` field (`inviteData.ts:63-66`), so no caller *can* pass it — stronger than a runtime check. (Historically the real email was sent here and deleted; #34 removed even that transient exposure.)
- Choosing the constant `'trigger invite token'` deliberately avoids the literal `'send-invite'`, which is magic only on Entu's *update* endpoint (`POST /[db]/entity/[_id]`) where it fires the SES invite email · **[SRC]** `entu-api routes/[db]/entity/[_id]/index.post.js:122`. mvox's person-create hits the *create* endpoint (`POST /[db]/entity`), which reads only truthiness — so no email is ever sent by Entu, which is what we want (mvox delivers the link manually).

## 3. mvox reads the token back — its one and only chance

Right after create, mvox reads the minted token out of Entu's **response** · **[CONV]** `inviteData.ts:249-252` (it looks for `entu_user.invite`). This is the **only** readable pass: every later GET of the person masks the token as `***` · **[SRC]** `entu-api utils/entity.js:594-598`. So "created but no token in the response" is treated as a hard, fail-loud error — no half-made invite, no blind retry. mvox then grants the person self-`_editor` (so she can edit her own record on arrival) and creates the `member` entity.

## 4. The token becomes a link — shown once, then forgotten

mvox builds `…/invite/<token>` · **[CONV]** `inviteData`/`invite-links.ts`. The link lives **only in the admin page's memory** — never stored, never logged — shown once with its expiry read from the token's own `exp`, and discarded when dismissed. From that moment the **only copy of the token in existence is wherever the admin pastes it** — not in mvox storage, and (per the `***` masking) not retrievable from Entu either. A genuine one-shot bearer secret on both ends. The admin pastes it into a channel he trusts.

## 5. The invitee lands on a public page that reads the ticket but trusts nothing

She opens `/invite/<token>` — public by allowlist · **[CONV]** `src/lib/auth/guard.ts:43`. The page **decodes** the token client-side (unverified) to show which collective and the expiry — it **cannot name her** (no email in the token) and **cannot verify** it (the signature is a server secret). She sees a greeting and one sign-in button per provider, each carrying the token forward. A client-clock "expired" keeps the buttons (only a warning) — only the server can declare an invite truly dead. **Nothing is bound to her yet.**

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

## 7. Expiry — where the 7-day limit is actually enforced (and the honest edge)

The mint stamps a 7-day `exp` (§2), but **nothing enforces it until redemption**, and the mechanism is worth stating precisely rather than smoothing over:

- The landing page only `jwt.decode`s the token (unverified) — it enforces nothing (that is why a client-clock "expired" keeps the buttons, §5).
- The real gate is `jwt.verify(query.invite, jwtSecret)` · **[SRC]** `entu-api routes/auth/index.get.js:206`, called with **no `ignoreExpiration`** — so an expired token *throws* and the surrounding `catch { /* invalid/expired invite */ }` · **[SRC]** `:232` swallows it: no bind, nothing written, the invitee lands on `outcome=dead`.
- **The honest edge:** that enforcement **rides on the `jsonwebtoken` library's default `exp` check, not an explicit comparison in Entu's own code** — and Entu's *separate* unverified `jwt.decode` · **[SRC]** `:127` (used only to route by db) checks nothing. The 7-day limit holds; the mechanism is a library default. Stated here so it is not mistaken for a hand-written expiry gate.

## Why this is safe

- The invitee's email **never reaches Entu** — mvox sends a constant, so there is no server-side copy, not even a transient one in a request log (#34, compile-time-enforced).
- The token **names no one**; a leaked link exposes only *that one membership slot*, claimable once, expiring in 7 days.
- The admin is the gate: entry is his deliberate act (create person + member + mint), never self-service — the counterpart to [Runbook §0](https://github.com/mvox-dev/mvox-app/wiki/Runbook-entu-visibility) "a new sign-in gets no `person`."
- The link is a bearer secret and is treated as one end to end: show-once, never stored by mvox, `***`-masked by Entu, delivered by a human through a trusted channel.

## Where to read the code

**Entu platform** (`github.com/entu/api` @`82cb25b`): mint + email deletion `utils/entity.js:462-467` · token masking `utils/entity.js:594-598` · redemption/binding `routes/auth/index.get.js:198-267` · SES email sentinel `routes/[db]/entity/[_id]/index.post.js:122`.
**mvox** (`main` @`cf66173`): `src/lib/invite/inviteData.ts` (create + token read-back), `parse-invite-token.ts`, `invite-links.ts`, `redeem.ts`, `src/routes/invite/[token]/+page.svelte`, `src/routes/admin/invite/+page.svelte`, `src/lib/auth/guard.ts:43`.

---

*Status: the invite path (T4.5/#31) and the email→constant change (#34) are merged and live. The live end-to-end run — a real OAuth sign-in through a real invite — is deliberately a separate gate, T4.9/#29, still owed.*

*Authored `(*MVOX:Palestrina*)` from source this session; provenance-tagged for PO Gama's record.*
