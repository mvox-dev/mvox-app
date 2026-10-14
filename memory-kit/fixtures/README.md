# fixtures

**The contract.** A schema can be reinterpreted; a fixture cannot. An implementation in any
language is conformant when `lint/run-fixtures.sh` passes against it.

- `valid/` -- trees the gate must accept. Includes the legal blanks (blank `ref`, blank
  `refute`, blank `check`) and every form of the ref grammar.
- `invalid/` -- trees the gate must reject, **one violation each**, named for that violation.
  A fixture that fails for the wrong reason is a test passing by accident. So each invalid
  fixture carries an `expect` file: one line of text that its single FAIL line must contain.
  `lint/run-fixtures.sh` fails a fixture with no `expect`, with more than one FAIL line, or
  whose FAIL line does not contain the text.
- A valid fixture may carry an `expect` file too: every line in it must appear in the output
  (used for notes and counts, which never fail a gate).

Prefix a fixture `shipped-` when it needs the shipped-rules checks (`core`, `incident`).

Adding a check means adding a fixture for it in the same commit. A check with no fixture is
a claim about behaviour with no way to hold it.
