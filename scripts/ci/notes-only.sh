#!/usr/bin/env bash
# Reads paths on stdin; prints true only if non-empty and all are team memory/ or inboxes/ files.
count=0
while IFS= read -r path; do
	[ -z "$path" ] && continue
	count=$((count + 1))
	case "$path" in
		teams/mvox-dev/memory/* | teams/mvox-dev/inboxes/*) ;;
		*) echo false; exit 0 ;;
	esac
done
if [ "$count" -gt 0 ]; then echo true; else echo false; fi
