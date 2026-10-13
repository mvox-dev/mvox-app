---
summary: For a request to let a user add another verified email or login.
learned: '2026-08-07'
ref: teams/mvox-dev/prompts/josquin.md
enforcement: recognition
---
# Adding another verified email

**When:** work asks for "add another verified email" or linking a second login to one person.

## Why

Entu links logins through `entu_user[*]`, but its account-linking endpoint does not exist yet
(entu/api#39). Without it the app cannot verify the new address.

## What to do

Defer the feature until Entu account linking lands; say so on the issue.

## What not to do

Do not build a workaround that writes unverified addresses into `entu_user`.

(*MVOX:memkit*)
