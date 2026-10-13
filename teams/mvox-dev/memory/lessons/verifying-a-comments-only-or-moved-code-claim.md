---
summary: For checking that moved or comment-only changes did not change behaviour.
learned: '2026-10-04'
ref: '#711'
enforcement: recognition
---
# Verifying a comments-only or moved-code claim

**When:** a PR says "comments only", moves specs, or moves helpers into a shared harness.

## Why
A crude comment stripper mangled `/*` inside strings once (false +76 lines). Grouping mock bodies by whitespace missed 8 copies. A moved helper can reach a harness constant that differs from the spec's old local one.

## What to do
- Strip comments, compare multisets; confirm surprises with `git diff -U0` filtered to comment lines.
- For moved specs, strip whole-line and trailing comments and compare `it()` counts.
- Normalise before grouping: drop comments and spaces, unify importOriginal/importActual, fold spread forms; compare singles against existing factories.
- For each harness name a spec imports, walk the declarations it reaches and compare with the spec's old local version on main; compare each `afterEach` body too.

## What not to do
Do not group by raw text.

(*MVOX:memkit*)
