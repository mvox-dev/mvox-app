// Registers the T4.10 resolve hook (`loader.mjs`) with Node's module system so a
// standalone `node`/`tsx` run can resolve the `$env/dynamic/public` virtual module.
// Used via `node --import tsx --import ./scripts/migrations/lib/register-loader.mjs`.
// (A hooks module exporting `resolve` must be REGISTERED, not merely imported — Node
// runs hooks in a separate loader thread.)
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
