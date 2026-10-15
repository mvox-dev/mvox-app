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

# Every file read and write in the kit's Python names its encoding (kit #13): with none, Windows
# uses the locale code page (cp1257 on Estonian Windows) and crashes on the first UTF-8 letter.
# The watch's spool poller (kit #16) runs on the Windows desks too. Popen is not open.
bare=$(grep -nE "\.(read_text|write_text)\(|[^A-Za-z_]open\(" "$KIT"/lint/*.py "$KIT"/tools/*.py "$KIT"/adapters/claude-code/watch/spool/*.py | grep -v 'encoding="utf-8"' || true)
if [ -n "$bare" ]; then
  fail=$((fail+1)); echo "NO ENCODING      file I/O without encoding=\"utf-8\":"; printf '%s\n' "$bare" | sed 's/^/    /'
else
  pass=$((pass+1))
fi

# The three plugins each carry a copy of the kit_home rules and their test (kit #18): a plugin
# loads only its own folder. The copies must stay identical, or the plugins disagree on the home.
AD="$KIT/adapters/claude-code"
drift=
for f in hooks/kit-home.ts tests/kit-home.test.ts; do
  for p in obligations-pane kit-update; do
    cmp -s "$AD/watch/$f" "$AD/$p/$f" || drift="$drift $p/$f"
  done
done
if [ -n "$drift" ]; then
  fail=$((fail+1)); echo "COPIES DIFFER    kit_home copies differ from watch/:$drift"
else
  pass=$((pass+1))
fi

# caps.yaml is generated from types/caps.ts and VERSION; a stale one ships the wrong numbers or
# the wrong version (kit #26: alpha.14 shipped caps.yaml at alpha.13). A release that bumps
# VERSION without regenerating fails here.
if stale=$(python3 "$KIT/tools/extract-caps.py" --check 2>&1); then
  pass=$((pass+1))
else
  fail=$((fail+1)); echo "STALE CAPS       $stale"
fi

# The lint banner names the kit's VERSION, the one place the version lives (kit #26).
want="memory-kit lint $(head -n 1 "$KIT/VERSION") -- "
if "$DIR/memory-lint.sh" "$KIT/fixtures/valid/minimal" --gate 2>&1 | head -n 1 | grep -qF -- "$want"; then
  pass=$((pass+1))
else
  fail=$((fail+1)); echo "WRONG BANNER     the lint banner does not begin '$want'"
fi

echo "fixtures: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
