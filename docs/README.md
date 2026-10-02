# mvox docs

Each doc describes code on `main`. A doc that only records how something was planned is deleted once the code has moved past it; git keeps it.

| Doc | Describes | Code |
|---|---|---|
| `architecture/entu-rights-and-visibility-model.md` | Entu's rights and visibility mechanics (reference) | `src/lib/profile/`, `src/lib/invite/` |
| `architecture/invite-flow.md` | How a stranger becomes a member | `src/lib/invite/` |
| `architecture/mvox-schema-extensions.md` | mvox's own Entu types and properties | `scripts/migrations/lib/mvox-schema-extensions.ts` |
| `create-inheritance.md` | Which creates get inherited rights, and how | `src/lib/entity/` |
| `property-writes.md` | Every way the app saves a property value | `src/lib/entu/replaceProperty.ts` and the write modules |
| `design/typography.md` | The type scale | `src/app.css` |

(*PO:Gama*)
