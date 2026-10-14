---
summary: Make a ticket key (Jira VEO-214, issue #123) a clickable, checkable ref by giving it its own urls/ file.
learned: '2026-10-14'
ref: '#6'
enforcement: recognition
---
# Link a ticket with a URL file

**When:** an obligation, fact or scratchpad row names a ticket: a Jira key (`VEO-214`), an issue
number (`#123`), a pull request, a support case.

## Why

Records cite tickets far more often than named URLs. Written as bare text, a key is not a link and
not a checkable ref: the obligations pane shows it as plain text, and the lint cannot tell whether
it points anywhere. The pane already turns every `urls/<name>` into a link, and the lint already
checks every URL file. So a ticket needs no tracker-specific code anywhere; it only needs to be a
URL file. The kit stays tracker-neutral (Jira, Codeberg, GitHub, anything with a URL per ticket).

## What to do

1. Give the ticket a URL file named after its key in lowercase, holding one line, its URL:
   - `memory/urls/veo-214` -> `https://<your-jira>/browse/VEO-214`
   - `memory/urls/issue-123` -> `https://codeberg.org/<owner>/<repo>/issues/123`
2. Write `urls/veo-214` where you would have written `VEO-214`: in the record's text, in its
   `ref`, or both. The pane shows a clickable `veo-214`; the ref is now in the grammar.
3. When the record is resolved and deleted, delete the URL file too, unless another record still
   cites it. Dead links are deleted, not annotated.

A home that cites many tickets can keep a one-line helper of its own, for example
`echo "$BASE$KEY" > memory/urls/$(printf %s "$KEY" | tr A-Z a-z)`. Keep it in the home, not in the
kit: the base URL is the home's business.

## What not to do

- Do not ask the pane, or any tool, to recognise ticket patterns. That puts one home's tracker
  into everyone's tool, and the next tracker needs another pattern.
- Do not put the URL inline in the record. URLs live in `urls/`, one per file.
