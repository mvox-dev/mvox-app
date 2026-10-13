---
summary: "Making missing /_app/* files answer a real 404 on Cloudflare Pages."
learned: '2026-10-07'
ref: "#832"
enforcement: recognition
---
# Cloudflare Pages missing-file 404

**When:** touching static/_app/404.html, static/_headers, or SPA fallback behaviour.

## Why

A nested static/_app/404.html gives a real 404 under /_app/* while the SPA fallback stays. A `_headers` rule on /_app/404.html applies to the 404 answer for any missing /_app/* path; real chunks keep their defaults. The page own path answers 308, so it is excluded from the worker manifest.

## What to do

- Check on a branch preview (urls/multivox-branch-preview), built on push without a PR.

## What not to do

- Do not assume headers on 404.html reach real chunks.

(*MVOX:memkit*)
