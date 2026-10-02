# Rights writes in `src/`

Every place the app writes a rights property (`_sharing`, `_inheritrights`, `_owner`, `_editor`, `_viewer`, `_expander`, `_noaccess`), with its reason. Everywhere else the app leaves rights to Entu (#699): a write we make here is not guaranteed by the Entu app, so each one needs a reason.

The guard `src/lib/testing/rightsWrites.spec.ts` scans `src/` (specs and `src/lib/testing/` excluded) and fails on a write that is not in the register `RIGHTS_WRITES_REGISTER` in `src/lib/testing/rightsWrites.ts`, on a register entry it no longer finds, and when this table and the register differ. To add a write: give it a row here and an entry there.

What the scan counts as a rights write:

- A prop object naming a rights property: `{ type: '_editor', ... }`.
- A `DELETE property/{id}` in a module that reads a rights property (`value DELETE` below). The DELETE names no property on the wire, so the module is the evidence. Only a DELETE with `property/…` written inline in such a module is seen; a delete through a helper (`clearEntityProperty`, `replaceEntityProperty`) is not.

A rights name in any other form (a call argument, a constant, a name built at run time) fails the guard as untraceable. Type union members (`| '_owner'`) are not writes.

| File | Function | Property | Reason |
|---|---|---|---|
| `src/lib/profile/profileData.ts` | `createProfile` | `_inheritrights` | Fixed `false`: a profile must not inherit the person's rights or tier (#133). Entu sets the flag on a child whose parent has it (`docs/create-inheritance.md`), so without the `false` everyone holding rights on the person would also read a `private` profile. Kept, not removed. |
| `src/lib/profile/profileData.ts` | `createProfile` | `_sharing` | The visibility level is what a profile is: one profile per level (`public`, `domain`, `private`), chosen by the user. Left to Entu it would copy the person's level. |
| `src/lib/profile/profileData.ts` | `createProfile` | `_owner` | Only when `ownerIds` is passed. A create run as db root must grant the member ownership of their own profile; a self-create is already owner. No caller in `src/` passes it; `scripts/migrations/lib/t4-10-plan.ts:262` does. |
| `src/lib/admin/roleManagement.ts` | `grantRole` | `_editor` | The /admin role grant itself: admin and librarian are `_editor` on the collective or library entity. |
| `src/lib/admin/roleManagement.ts` | `grantRole` | value DELETE | After the grant, deletes the person's older own `_editor` values on that entity, so one direct grant remains. |
| `src/lib/admin/roleManagement.ts` | `revokeOwnGrant` | value DELETE | The /admin role revoke: deletes the person's own `_owner` (admins) and `_editor` values; refuses to remove the last owner. |
| `src/lib/invite/inviteCreate.ts` | `createInvite` | `_editor` | Self-edit grant on the invited person. The inviting admin is the creator, so Entu grants them, not the person; the person needs it to edit their own record and to be in their own `_expander` set for later creates, as with Entu's own auto-create. |

(*MVOX:Josquin*)
