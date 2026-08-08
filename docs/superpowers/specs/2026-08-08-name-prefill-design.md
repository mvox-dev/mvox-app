# #39 — Prefill mandatory name from EntuUser.name

## Problem

When a new member lands on /profile (completion gate redirect), the domain name field is empty. She must retype a name her identity provider already shared at login.

## Fix

After loading profiles in `loadForSelected()`, if the domain draft name is empty AND no domain profile entity exists yet, prefill `draft.domain.name` from `getUser()?.name?.trim()`.

### Conditions

- **Prefills when:** no domain profile exists (`confirmed.domain.id === null`) AND domain name is empty AND `getUser()?.name` is non-blank
- **Does NOT prefill when:** a domain profile already exists (even with empty name — she chose to clear it)
- **Empty provider name:** field stays empty, existing gate behavior applies
- **Domain tier only:** the mandatory field lives there per #28 ruling

### Implementation

**`src/routes/profile/+page.svelte`:**
- Import `getUser` alongside `getToken`
- After the profile-loading for loop (line ~189), before `draft = nextDraft`: if domain is empty and no domain profile entity exists, set `nextDraft.domain.name` from provider name

**`src/routes/page.profile.spec.ts`:**
- Import `setUser` alongside `setToken`
- 3 test cases: prefill fires, no overwrite of existing, empty provider name

**No i18n changes** — existing completion banner wording covers both cases.

(*MVOX:Palestrina*)
