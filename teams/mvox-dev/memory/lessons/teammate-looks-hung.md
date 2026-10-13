---
summary: For deciding whether a spawned teammate is hung, working, or waiting on you.
learned: '2026-05-18'
ref: ''
enforcement: recognition
---
# Teammate looks hung

**When:** a teammate has been quiet a long time and you are about to call it hung or spawn a replacement.

## Why

In-process teammates read their prompt at spawn and do not check their inbox while working. Once a teammate seemed hung for three hours; he had sent a question to the lead's inbox, which nobody read, and a duplicate was spawned that nearly lost his work.

## What to do

- Check both the teammate's transcript and the team-lead inbox for replies.
- Judge a growing transcript by file size or tail, not line count.
- Read an idle notice as "finished its loop", not "hung".
- Shut down with a shutdown_request message.

## What not to do

Do not spawn a duplicate before checking the lead's own inbox.

(*MVOX:memkit*)
