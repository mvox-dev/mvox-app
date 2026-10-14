#!/bin/sh
# The conformance test. Every valid fixture must pass the gate; every invalid fixture must
# fail it, for its own reason. This is the kit's contract: a schema can be reinterpreted, a
# fixture cannot.
#
# An implementation in any language is conformant when this passes against it.
# Invalid fixtures that need the shipped-rules checks are named shipped-*.
#
# Each invalid fixture carries an `expect` file: one line that its single FAIL line must
# contain. A fixture that fails for the wrong reason, or for two reasons, is a test passing by
# accident. A valid fixture may carry an `expect` file too: every line must appear in the output.
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
KIT=$(dirname "$DIR")
pass=0; fail=0

for d in "$KIT"/fixtures/valid/*/; do
  name=$(basename "$d")
  if ! out=$("$DIR/memory-lint.sh" "$d" --gate 2>&1); then
    fail=$((fail+1)); echo "UNEXPECTED FAIL  valid/$name"; echo "$out" | sed 's/^/    /'
    continue
  fi
  bad=
  if [ -f "$d/expect" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      printf '%s\n' "$out" | grep -qF -- "$line" || bad="$bad|$line"
    done < "$d/expect"
  fi
  if [ -n "$bad" ]; then
    fail=$((fail+1)); echo "MISSING OUTPUT   valid/$name:$bad"
  else
    pass=$((pass+1))
  fi
done

for d in "$KIT"/fixtures/invalid/*/; do
  name=$(basename "$d")
  case "$name" in shipped-*) extra=--shipped-rules ;; *) extra= ;; esac
  if out=$("$DIR/memory-lint.sh" "$d" --gate $extra 2>&1); then
    fail=$((fail+1)); echo "UNEXPECTED PASS  invalid/$name"; continue
  fi
  if [ ! -f "$d/expect" ]; then
    fail=$((fail+1)); echo "NO EXPECT FILE   invalid/$name"; continue
  fi
  want=$(head -n 1 "$d/expect")
  fails=$(printf '%s\n' "$out" | grep -c '^  FAIL ' || true)
  if [ "$fails" -ne 1 ]; then
    fail=$((fail+1)); echo "WRONG COUNT      invalid/$name: $fails FAIL lines, want 1"
    printf '%s\n' "$out" | grep '^  FAIL ' | sed 's/^/    /'
  elif ! printf '%s\n' "$out" | grep '^  FAIL ' | grep -qF -- "$want"; then
    fail=$((fail+1)); echo "WRONG REASON     invalid/$name: want '$want'"
    printf '%s\n' "$out" | grep '^  FAIL ' | sed 's/^/    /'
  else
    pass=$((pass+1))
  fi
done

# A missing memory directory must fail even under --report: a lint that found no tree has
# checked nothing. (household finding 17: --report exited 0 on "no such memory directory")
if "$DIR/memory-lint.sh" "$KIT/fixtures/invalid/missing-memory-dir/" --report >/dev/null 2>&1; then
  fail=$((fail+1)); echo "UNEXPECTED PASS  invalid/missing-memory-dir under --report"
else
  pass=$((pass+1))
fi

echo "fixtures: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
