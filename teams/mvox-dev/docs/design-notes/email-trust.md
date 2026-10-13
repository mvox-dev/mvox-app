<!-- Moved from the lead's harness auto-memory (project_polyphony_email_trust.md) by memkit, 2026-10-14 (memory-kit adoption); body unchanged, harness front matter dropped. Design heritage, not current schema: see scripts/migrations/lib/mvox-schema-extensions.ts. -->

# polyphony-email-trust

> Polyphony's email trust hierarchy — person.entu_user[*].email is the canonical verified set; person.email is informational; member.contact_email is outbound-only. No custom verification flow needed; reuse Entu's invite mechanism for self-link (decided 2026-05-17, session 2)

Email addresses on person and member entities have **distinct trust levels and uses**. Following these rules prevents impersonation attacks on invitation discovery (see E4 in `[[polyphony-onboarding]]`).

**Why:** When the invitation dashboard listing queries by email (the convenient UX), the source of "person's known emails" must be unforgeable. `person.email` is self-editable per `_editor: self` from Entu's auto-create flow — anyone could spoof anyone else's address. `person.entu_user[*].email` is OAuth-verified by construction.

**How to apply:** When BFF code touches email values for any identity/access decision (matching, lookup, auto-discovery), ONLY use `person.entu_user[*].email`. When showing emails in UI as user-curated display, `person.email` is fine. For outbound communication, use `member.contact_email`.

## Trust hierarchy

| Source | Trust | Use |
|---|---|---|
| `person.entu_user[*].provider + uid` | Immutable OAuth identity (top) | Identity gate for `/auth` |
| `person.entu_user[*].email` | OAuth-verified (provider attested) | Canonical verified-email set; invitation dashboard matching |
| `person.email` | Self-edited; **untrusted** | Informational only (Entu's default schema includes it); never used for identity/access |
| `member.contact_email` | Self-declared; no trust required | Outbound only (where THIS org sends mail to THIS member) |

## Why no separate `verified_email` property

We considered adding `person.verified_email[*]` with BFF-managed writes (verification round-trip), then realized Entu's existing OAuth provider list (`e-mail`, `google`, `apple`, `smart-id`, `mobile-id`, `id-card`) **already provides email verification natively**:

- Each `entu_user` entry was proven by an OAuth flow at that address
- The `e-mail` provider specifically requires clicking a link sent to the address
- Multiple `entu_user` entries = multiple verified addresses on the same person

No custom verification flow needed. No new property needed. No new BFF infrastructure needed.

## Adding a verified email to an existing person — DEFERRED at this phase

**Decision (2026-05-18 session 3 follow-up)**: polyphony will NOT implement the "add additional verified email to existing person" feature at this phase. Filed [entu/api#39](https://github.com/entu/api/issues/39) as an RFC requesting a native account-linking endpoint instead. Will adopt once that lands.

Until then: users have ONE verified email (their initial OAuth identity). Invitations sent to OTHER addresses use the soft mismatch-confirm flow (see `[[polyphony-onboarding]]` E2).

### The deferred workaround (for reference)

The workaround we identified but chose NOT to implement: reuse Entu's invite + `replaceInviteWithCredentials` flow as a self-link.

```
1. User clicks "Add login email" in polyphony settings (logged in as P)
2. BFF creates placeholder entu_user on P:
     { type: 'entu_user', invite: <token>, email: 'alice@personal.com' }
3. BFF sends email to alice@personal.com with invite link containing
     a JWT referencing entity P
4. User clicks link → e-mail OAuth flow → Entu auth:
   - Detects invite param
   - inviteData.entityId = P
   - "Same entity: clean up orphaned invite property" branch fires
   - Calls replaceInviteWithCredentials → swaps placeholder with real
     { uid: <e-mail-uid>, email: 'alice@personal.com', provider: 'e-mail' }
5. P now has TWO entu_user entries:
     { google: alice@gmail.com }
     { e-mail: alice@personal.com }
   Future invitations to EITHER address are discoverable in dashboard.
```

**Source reference:** `entu/api/routes/auth/index.get.js`, the "Same entity: clean up orphaned invite property" branch within the invite-acceptance block. Verified to handle this case during 2026-05-17 session reading.

## Rules to enforce in BFF

- **Never** use `person.email` for matching against invitations / applications / access decisions
- **Always** query `person.entu_user[*].email` when answering "what verified addresses does this person have"
- `member.contact_email` is just a string the user typed — don't treat as identity claim, never use for cross-entity matching

## `person.email` is legacy / informational

Entu's `createUserForAccount` hardcodes `{ type: 'email', string: session.user.email }` when auto-creating persons (see `entu/api/routes/auth/index.get.js`). The property will be present on every auto-created person whether we want it or not.

**Our stance:** treat as informational/display-only. Never act on it. Future option: propose to entu/api making this configurable.

## Related memory

- `[[polyphony-onboarding]]` — uses this trust hierarchy in E4 dashboard listing decision
