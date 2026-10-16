#!/usr/bin/env python3
"""Consume courier hub mail from the harness's team-lead inbox (watch 0.5.0 doorbell consumer).

Since memory-kit alpha.17 the watch plugin only rings when the inbox grows; it no longer takes
anything out. The courier writes only into an inbox with no courier mail waiting, so courier
entries left in place block all later hub mail. This script is the home's own consumer, the
same take the watch 0.4.0 made (kit #12):

- inbox: ~/.claude/teams/session-*/inboxes/team-lead.json (shared with the harness);
- takes only entries whose `from` ends in "-courier" and that are not `read: true`, and only
  once they are GRACE seconds old (a live harness delivers and removes them itself in ~1 s);
- under the harness's lock (`<inbox>.lock`, a directory; broken when older than STALE seconds):
  re-read, write the rest back in place (temp + rename), unlock. Teammate entries stay, in order;
- appends the taken entries to inboxes/archive/team-lead-archive.json beside each inbox (where
  watch 0.4.0 archived them) and prints them in full.

Usage: scripts/hub-consume.py        (prints "no hub mail" when nothing was taken)
Waits GRACE seconds and passes once more when mail was too fresh or an inbox was locked.
Exit: 0 always, except 1 when an inbox is still locked after that (run again).
"""
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

GRACE = 10     # seconds a courier entry waits for the harness before we take it
STALE = 60     # seconds after which the harness's lock is stale and broken
home = Path.home()


def age(entry, now):
    try:
        ts = datetime.fromisoformat(str(entry.get("timestamp", "")).replace("Z", "+00:00"))
        return now - ts.timestamp()
    except ValueError:
        return GRACE  # no usable timestamp: treat as old enough


def takes(entry):
    return (isinstance(entry, dict) and str(entry.get("from", "")).endswith("-courier")
            and entry.get("read") is not True)


def lock(path):
    try:
        os.mkdir(path)
        return True
    except FileExistsError:
        try:
            if time.time() - path.stat().st_mtime <= STALE:
                return False
            os.rmdir(path)
            os.mkdir(path)
            print(f"(broke a stale lock: {path})")
            return True
        except OSError:
            return False


def consume_once():
    """One pass over the inboxes: (taken entries, an inbox was locked, fresh entries left)."""
    taken_all, locked, fresh = [], False, 0
    for inbox in sorted(home.glob(".claude/teams/session-*/inboxes/team-lead.json")):
        try:
            if not any(takes(e) for e in json.loads(inbox.read_text() or "[]")):
                continue
        except (OSError, ValueError):
            continue
        lk = inbox.with_name(inbox.name + ".lock")
        archive = inbox.parent / "archive" / "team-lead-archive.json"
        if not lock(lk):
            locked = True
            continue
        try:
            entries = json.loads(inbox.read_text() or "[]")
            if not isinstance(entries, list):
                continue
            now = time.time()
            take = [e for e in entries if takes(e) and age(e, now) >= GRACE]
            fresh += sum(1 for e in entries if takes(e) and age(e, now) < GRACE)
            if not take:
                continue
            old = json.loads(archive.read_text()) if archive.exists() else []
            archive.parent.mkdir(parents=True, exist_ok=True)
            tmp = archive.with_name(f".{archive.name}.{os.getpid()}")
            tmp.write_text(json.dumps(old + take, ensure_ascii=False, indent=1))
            tmp.replace(archive)  # archived before the inbox loses them: a crash can repeat, never lose
            rest = [e for e in entries if not any(e is t for t in take)]
            tmp = inbox.with_name(f".{inbox.name}.{os.getpid()}")
            tmp.write_text(json.dumps(rest, ensure_ascii=False, indent=2))
            tmp.replace(inbox)
            taken_all += take
        finally:
            try:
                os.rmdir(lk)
            except OSError:
                pass
    return taken_all, locked, fresh


taken_all, locked, fresh = consume_once()
if fresh or locked:
    # A ring fires within seconds of the write (before the grace ends, or while the harness holds
    # its lock), and a waiting entry never
    # rings again: wait here and take one more pass instead of leaving the mail stuck.
    time.sleep(GRACE)
    more, locked, fresh = consume_once()
    taken_all += more

for e in taken_all:
    print(f"--- hub mail from {e.get('from')} [{e.get('timestamp')}]")
    print(e.get("text") or e.get("summary") or "")
if fresh or locked:
    print(f"({fresh} courier message(s) under {GRACE} s old left for the harness; run again)")
if locked:
    print("(an inbox is locked by the harness; run again shortly)")
print(f"{len(taken_all)} message(s) consumed; archive inboxes/archive/team-lead-archive.json"
      if taken_all else "no hub mail")
sys.exit(1 if locked else 0)

# From esl-suvekool scripts/hub-consume.py (main 866654d), shared by Passepartout 2026-10-16;
# changed here only to archive beside each inbox. (*MVOX:Palestrina*)
