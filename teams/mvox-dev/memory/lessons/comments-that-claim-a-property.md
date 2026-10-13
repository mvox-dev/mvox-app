---
summary: For reading comments that state an invariant or explain why code is safe.
learned: '2026-10-06'
ref: '#815'
enforcement: recognition
---
# Comments that claim a property

**When:** a comment says something cannot happen, or why a catch is silent.

## Why
A false invariant in a comment is worse than the bug: the next fixer builds on it. #305 said children were kept (false); #470 said no path could duplicate a key (only picks were covered); #815 said "the network answers" where the store is read only after the network failed.

## What to do
Check the claim against the code and its callers. Correcting the comment is part of the prescription.

## What not to do
Do not take a true-sounding comment as true on every path.

(*MVOX:memkit*)
