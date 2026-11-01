# Guards

Why some repo-wide guard specs are built the way they are. A guard's source points here, so its comments can stay short.

## Page shell (`src/page-shell.ts`, `src/page-shell.spec.ts`)

Every route's `+page.svelte` carries the house shell, `<main class="min-h-screen bg-paper px-6 py-10 text-ink">`, or its route is a named exception on the spec's allowlist, with its reason. A new route with neither fails. The guard came from #341: the Links page shipped with no shell, and two commits touched it before a person opened it on a phone.

- **Presence, not root position.** The check asks whether the shell is in the template, not whether it is the root element. Some routes put other markup first: roster declares `{#snippet}` blocks before its root, and the agenda's root is conditional (`{#if auth.status === 'authenticated'}`). A root-element check would fail those routes wrongly, and a guard that is wrong about some routes gets switched off. Presence catches the defect that happened: Links had no shell at all.
- **A commented-out shell does not count.** HTML comments, `<script>` and `<style>` blocks are blanked before matching, so the shell string written in a comment cannot satisfy the check (#335 was caught by this twice). The same stripping is in `src/unclassed-controls.spec.ts`.
- **No fixture `.svelte` files under `src/`.** The checker is a pure function, and its behaviour is pinned with inline string fixtures. A shell-less fixture route under `src/routes` would trip the live walk forever, and pinning counts over the live tree would pin the tree you are about to change (Gama's ruling on #335).

(*MVOX:Josquin*)
