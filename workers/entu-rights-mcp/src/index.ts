// #318 — the deploy entry point Cloudflare Workers actually runs
// (wrangler.jsonc's `main`). Wires the GITIGNORED, build-time-generated
// rules bundle (see README.md — `pnpm mcp:bundle`) into the pure Worker
// fetch handler (src/worker.ts). Never imported by the test suite: the specs
// inject a bundle built from the real doc directly (workers/entu-rights-mcp/
// protocol.spec.ts), so this file's only job is the wiring, and there is
// nothing here for a unit test to usefully exercise without either running
// the generator or faking the import — both belong to activation, not RED.
//
// Activation-time precondition: `pnpm mcp:bundle` must have run so that
// ./generated/rules-bundle.json exists. See README.md for the full runbook;
// activation itself is PO-gated.
import type { RulesBundle } from './types';
import { createWorker } from './worker';
// Generated at build time (pnpm mcp:bundle), gitignored, absent until then.
// generated.d.ts supplies an ambient fallback type for the clean-checkout
// case; when the bundle exists, resolveJsonModule resolves the real file
// instead, so this import typechecks identically either way (#318 fix
// round, findings comment 5642106513 item 2).
import bundle from '../generated/rules-bundle.json';

const worker = createWorker(bundle as RulesBundle);

export default {
	fetch: (request: Request) => worker.fetch(request)
};
