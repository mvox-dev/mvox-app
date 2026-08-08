# #39 — Name Prefill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prefill the mandatory domain name field from `EntuUser.name` (identity provider) on first visit to /profile, so the user confirms rather than retypes.

**Architecture:** One-seam change in `loadForSelected()` — after profiles load, if no domain profile exists, prefill the draft from localStorage's stored provider name. Test-driven: RED tests first, then GREEN implementation.

**Tech Stack:** SvelteKit 2 / Svelte 5 (Runes), Vitest + happy-dom

## Global Constraints

- Svelte 5 Runes only
- `pnpm`, never `npm`
- Domain-tier only (mandatory name per #28)
- `setUser` MUST be called BEFORE `setToken` (token-version ordering invariant, storage.ts:23-27)

---

### Task 1: RED — Write failing tests for name prefill

**Files:**
- Modify: `src/routes/page.profile.spec.ts`

**Interfaces:**
- Produces: 3 failing test cases covering prefill, no-overwrite, and empty-provider-name

- [ ] **Step 1: Add `setUser` to the storage import**

```typescript
// OLD (line 112):
import { setToken, clearAll } from '$lib/auth/storage';
// NEW:
import { setToken, setUser, clearAll } from '$lib/auth/storage';
```

- [ ] **Step 2: Add the prefill test describe block**

Append before the final closing of the file:

```typescript
describe('/profile — #39 name prefill from EntuUser', () => {
	it('prefills domain name from EntuUser.name when no domain profile exists', async () => {
		setUser({ _id: 'u1', name: 'Ada Lovelace' });
		h.listMyProfilesMock.mockResolvedValue([]);
		selectPolyphony();

		const { container } = render(Page);

		await waitFor(() => {
			const input = q(container, '[data-testid="profile-domain-name"]') as HTMLInputElement;
			expect(input).not.toBeNull();
			expect(input.value).toBe('Ada Lovelace');
		});
	});

	it('does NOT overwrite an existing domain name with EntuUser.name', async () => {
		setUser({ _id: 'u1', name: 'Ada Lovelace' });
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-d', name: 'Her Chosen Name', email: 'a@b.c', _sharing: 'domain' }
		]);
		selectPolyphony();

		const { container } = render(Page);

		await waitFor(() => {
			const input = q(container, '[data-testid="profile-domain-name"]') as HTMLInputElement;
			expect(input.value).toBe('Her Chosen Name');
		});
	});

	it('leaves domain name empty when EntuUser has no name', async () => {
		setUser({ _id: 'u1' });
		h.listMyProfilesMock.mockResolvedValue([]);
		selectPolyphony();

		const { container } = render(Page);

		await waitFor(() => {
			const input = q(container, '[data-testid="profile-domain-name"]') as HTMLInputElement;
			expect(input).not.toBeNull();
			expect(input.value).toBe('');
		});
	});
});
```

- [ ] **Step 3: Run tests — expect RED**

Run: `pnpm vitest run src/routes/page.profile.spec.ts`

Expected: the first test FAILS (domain name input is '' instead of 'Ada Lovelace'). The other two should pass (they assert empty / existing behavior which already works).

- [ ] **Step 4: Commit**

```bash
git add src/routes/page.profile.spec.ts
git commit -m "test(#39): RED — profile prefills domain name from EntuUser.name"
```

---

### Task 2: GREEN — Implement the prefill

**Files:**
- Modify: `src/routes/profile/+page.svelte` (import + 4 lines in loadForSelected)

**Interfaces:**
- Consumes: Tests from Task 1
- Produces: Working prefill, all tests green

- [ ] **Step 1: Add `getUser` to the import**

```typescript
// OLD (line 9):
import { getToken } from '$lib/auth/storage';
// NEW:
import { getToken, getUser } from '$lib/auth/storage';
```

- [ ] **Step 2: Add prefill logic in `loadForSelected()`**

After the `for (const level of LEVELS)` loop (after line 189) and BEFORE `draft = nextDraft` (line 190), insert:

```typescript
if (nextDraft.domain.name === '' && nextConfirmed.domain.id === null) {
	const providerName = getUser()?.name?.trim();
	if (providerName) {
		nextDraft.domain.name = providerName;
	}
}
```

- [ ] **Step 3: Run tests — expect GREEN**

Run: `pnpm vitest run src/routes/page.profile.spec.ts`

Expected: ALL PASS

- [ ] **Step 4: Run type check**

Run: `pnpm check`

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/routes/profile/+page.svelte
git commit -m "feat(#39): prefill domain name from EntuUser.name on first profile visit"
```

---

## TDD Chain

| Phase | Task |
|-------|------|
| Branch | `git checkout -b feat/39-name-prefill` |
| RED | Task 1 |
| GREEN | Task 2 |
| i18n | SKIP (no new user-facing strings) |
| REVIEW | Full diff review |
| MERGE | Squash-merge to main |

(*MVOX:Palestrina*)
