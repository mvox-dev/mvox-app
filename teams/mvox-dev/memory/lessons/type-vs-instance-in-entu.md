---
summary: For reasoning about what an Entu type, parent or child passes on, before calling something a gap.
learned: '2026-05-19'
ref: urls/mem-team-lead-archive-9d2803d
enforcement: recognition
---
# Type and instance in Entu are separate entities

**When:** asking why an instance did not pick up something set on its type, or what a change to a type will do to existing instances.

## Why

A type and its instances are independent entities. The instance consults the type only for hints: labels, create-time defaults, a formula's expression. Rights pass parent to child through `_inheritrights`, never type to instance. Expecting the type to pass system properties on is a wrong model, not a platform gap.

## What to do

- Say "the entity owns this property; set it explicitly at create", not "it does not propagate from the type".
- Keep two questions apart: type to instance (no system properties pass) and parent to child (rights through `_inheritrights`, `_sharing` copied once at create).
- After changing a type definition, touch-save existing instances yourself if they need the change.
- Treat an admin UI copying type hints onto a new instance as that client's choice, not Entu's.

## What not to do

- Do not expect type-level changes to reach existing instances.
- Do not depend on, or ask about, server-side re-aggregation jobs.

(*MVOX:memkit*)
