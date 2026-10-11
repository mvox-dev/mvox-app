#!/usr/bin/env bash
# Reads changed paths on stdin; prints true only if the list is non-empty and all are under teams/.
count=0
while IFS= read -r path; do
	[ -z "$path" ] && continue
	count=$((count + 1))
	case "$path" in
		teams/*) ;;
		*) echo false; exit 0 ;;
	esac
done
if [ "$count" -gt 0 ]; then echo true; else echo false; fi
