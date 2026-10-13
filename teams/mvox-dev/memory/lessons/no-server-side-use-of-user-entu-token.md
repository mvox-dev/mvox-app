---
summary: "Designing anything that needs to know who the user is outside the browser."
learned: '2026-06-13'
ref: teams/mvox-dev/memory/team-lead-archive.md
enforcement: recognition
---
# No server-side use of a user Entu token

**When:** a design needs "who is this" on a server, or a server-side token exchange is proposed.

## Why

Entu JWTs are bound to the caller IP (aud). A server egress IP differs from the browser, so the exchange returns an anonymous, empty-accounts token. A whole trusted-identity stack was built and reverted for this (f819d68 in the old schema repo).

## What to do

- Use client-side reads with the user token in the browser.
- Use formulas for aggregates, or change the data model.

## What not to do

- Do not exchange or replay a user token or key on a server.

(*MVOX:memkit*)
