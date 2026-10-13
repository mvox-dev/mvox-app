---
summary: For writing a fix request when a finding is one instance of a searchable class.
learned: '2026-09-06'
ref: '#264'
enforcement: recognition
---
# Prescribing a fix for a class

**When:** a finding names sites, but the defect is a pattern that could exist elsewhere.

## Why
On #264 I named two spec files with stale comments; the fixer fixed exactly those, and four more (three in source) survived. A site list reads as the whole job.

## What to do
Hand over the grep that defines the class with the sites: "run this after the fix; empty output is done." List the hits that are correct as they stand, so the fixer does not change true text into false.

## What not to do
Do not prescribe by site when the defect is by class.

(*MVOX:memkit*)
