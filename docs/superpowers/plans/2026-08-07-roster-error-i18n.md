# #38 — Roster Load-Error i18n Leak Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop leaking raw English developer-facing error text to end users on the roster page; show a generic localized message instead, log the detail to console.

**Architecture:** The fix is at the rendering boundary only — `rosterData.ts`'s thrown errors stay as-is (correct for logs/debugging). The `+page.svelte` component stops interpolating error messages into the i18n template, and the `roster_load_error` i18n key drops its `{message}` parameter across all 4 locales.

**Tech Stack:** SvelteKit 2 / Svelte 5 (Runes), Paraglide i18n, Vitest + happy-dom

## Global Constraints

- Svelte 5 Runes only (`$state`, `$derived`, `$effect`) — never legacy `export let` / `$:`
- `pnpm`, never `npm`
- Paraglide generates TS types from message files — removing `{message}` from the i18n string changes the generated call signature from `(p: { message: string }) => string` to `() => string`
- TDD chain: Tallis (RED) → Byrd (GREEN) + Comenius (i18n) → Bentham (REVIEW) → Josquin (MERGE)

---

### Task 1: RED — Update test expectations (Tallis)

**Files:**
- Modify: `src/routes/page.roster.spec.ts:12-18` (mock), `src/routes/page.roster.spec.ts:124-144` (load-error test)

**Interfaces:**
- Produces: Failing test that expects (a) generic message rendered, (b) raw error NOT in output, (c) `console.error` called with detail

- [ ] **Step 1: Update the `roster_load_error` mock to drop the `{message}` parameter**

In `src/routes/page.roster.spec.ts`, change the mock (inside `vi.mock('$lib/paraglide/messages.js', ...)`):

```typescript
// OLD:
roster_load_error: (p: { message: string }) => `Couldn't load the roster: ${p.message}`,

// NEW:
roster_load_error: () => 'Something went wrong loading the roster.',
```

- [ ] **Step 2: Rewrite the load-error test case**

Replace the existing `'/roster — load-error state'` describe block with:

```typescript
describe('/roster — load-error state', () => {
	it('shows a generic localized error (not the raw thrown message); logs detail to console.error; retry calls loadRoster again', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		loadRosterMock.mockRejectedValue(new Error('boom 500'));
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-load-error"]')).not.toBeNull();
		});
		// Generic message shown, raw error NOT shown
		expect(container.textContent).toContain('Something went wrong loading the roster.');
		expect(container.textContent).not.toContain('boom 500');
		// Detail logged to console
		expect(consoleSpy).toHaveBeenCalled();
		const loggedArgs = consoleSpy.mock.calls.flat();
		const loggedDetail = loggedArgs.some(
			(arg) => arg instanceof Error && arg.message === 'boom 500'
		);
		expect(loggedDetail).toBe(true);
		expect(loadRosterMock).toHaveBeenCalledTimes(1);

		// Retry still works
		const retryBtn = container.querySelector('[data-testid="roster-retry-load"]') as HTMLButtonElement;
		expect(retryBtn).not.toBeNull();
		await fireEvent.click(retryBtn);

		await waitFor(() => {
			expect(loadRosterMock).toHaveBeenCalledTimes(2);
		});

		consoleSpy.mockRestore();
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/routes/page.roster.spec.ts`

Expected: FAIL — the component still interpolates `{message}` and renders `'boom 500'` in the output. The `not.toContain('boom 500')` assertion fails, and `console.error` is not yet called.

- [ ] **Step 4: Commit**

```bash
git add src/routes/page.roster.spec.ts
git commit -m "test(#38): RED — roster load-error expects generic message, not raw error"
```

---

### Task 2: GREEN — Fix the component (Byrd)

**Files:**
- Modify: `src/routes/roster/+page.svelte:22-23,35-39,47-51,59-62,88`
- Modify: `messages/en.json:83`

**Interfaces:**
- Consumes: Test from Task 1 defines the expected behavior
- Produces: Component that console.errors detail, renders generic `m.roster_load_error()`. English message file updated so Paraglide types match.

- [ ] **Step 1: Remove `loadError` state and add `console.error` to all error paths**

In `src/routes/roster/+page.svelte`:

Remove the `loadError` state declaration (line 23):
```typescript
// DELETE this line:
let loadError = $state('');
```

Update the no-token path (lines 35-39):
```typescript
// OLD:
if (!token) {
    loadError = 'no auth token in storage on a protected route';
    status = 'load-error';
    return;
}

// NEW:
if (!token) {
    console.error('roster: no auth token in storage on a protected route');
    status = 'load-error';
    return;
}
```

Update the try/catch in `loadForSelected` (lines 47-51):
```typescript
// OLD:
} catch (e) {
    if (g !== generation) return;
    loadError = e instanceof Error ? e.message : String(e);
    status = 'load-error';
}

// NEW:
} catch (e) {
    if (g !== generation) return;
    console.error('roster: load failed', e);
    status = 'load-error';
}
```

Update the `$effect` catch (lines 59-62):
```typescript
// OLD:
loadForSelected().catch((e) => {
    loadError = e instanceof Error ? e.message : String(e);
    status = 'load-error';
});

// NEW:
loadForSelected().catch((e) => {
    console.error('roster: load failed', e);
    status = 'load-error';
});
```

- [ ] **Step 2: Update the template to use parameterless `roster_load_error`**

In the template section (line 88):
```svelte
<!-- OLD: -->
<p class="text-sm text-red-700">{m.roster_load_error({ message: loadError })}</p>

<!-- NEW: -->
<p class="text-sm text-red-700">{m.roster_load_error()}</p>
```

- [ ] **Step 3: Update `messages/en.json` to drop the `{message}` parameter**

```json
// OLD:
"roster_load_error": "Couldn't load the roster: {message}",

// NEW:
"roster_load_error": "Something went wrong loading the roster.",
```

This is required for Paraglide type generation — the component call `m.roster_load_error()` (no args) must match the message definition.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `pnpm vitest run src/routes/page.roster.spec.ts`

Expected: ALL PASS — the load-error test now sees the generic message, no raw error in output, `console.error` called with the `Error` object.

- [ ] **Step 5: Run type check**

Run: `pnpm check`

Expected: 0 errors. Paraglide regenerates types from `en.json`; the new `roster_load_error()` signature (no params) matches the component call.

- [ ] **Step 6: Commit**

```bash
git add src/routes/roster/+page.svelte messages/en.json
git commit -m "fix(#38): render generic localized error on roster, log detail to console"
```

---

### Task 3: i18n — Update et/lv/uk message strings (Comenius)

**Files:**
- Modify: `messages/et.json:83`
- Modify: `messages/lv.json:83`
- Modify: `messages/uk.json:83`

**Interfaces:**
- Consumes: English wording from Task 2 as reference
- Produces: All 4 locales consistent — no `{message}` parameter, generic user-friendly wording

- [ ] **Step 1: Update `messages/et.json`**

```json
// OLD:
"roster_load_error": "Liikmete nimekirja laadimine ebaõnnestus: {message}",

// NEW:
"roster_load_error": "Liikmete nimekirja laadimine ebaõnnestus.",
```

- [ ] **Step 2: Update `messages/lv.json`**

```json
// OLD:
"roster_load_error": "Neizdevās ielādēt dalībnieku sarakstu: {message}",

// NEW:
"roster_load_error": "Neizdevās ielādēt dalībnieku sarakstu.",
```

- [ ] **Step 3: Update `messages/uk.json`**

```json
// OLD:
"roster_load_error": "Не вдалося завантажити список учасників: {message}",

// NEW:
"roster_load_error": "Не вдалося завантажити список учасників.",
```

- [ ] **Step 4: Run type check to confirm all locales are consistent**

Run: `pnpm check`

Expected: 0 errors. All 4 locale files have the same parameter shape (none).

- [ ] **Step 5: Commit**

```bash
git add messages/et.json messages/lv.json messages/uk.json
git commit -m "i18n(#38): drop {message} param from roster_load_error in et/lv/uk"
```

---

## TDD Chain Dispatch

| Phase | Owner | Task |
|-------|-------|------|
| Branch | team-lead | `git checkout -b fix/38-roster-error-i18n` |
| RED | Tallis | Task 1 |
| GREEN | Byrd | Task 2 |
| i18n | Comenius | Task 3 |
| REVIEW | Bentham | Full diff review |
| MERGE | Josquin | Squash-merge to main |

(*MVOX:Palestrina*)
