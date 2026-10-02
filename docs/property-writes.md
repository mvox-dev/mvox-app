# Property writes in `src/`

Describes `origin/main` as of 2026-10-02 (67d60ad, after #675, #676 and #680), plus #698 (rows 1 and 3).

Entu facts used (entu-www `src/api/properties/index.md`, `src/db-mutations/index.md`, read this turn):
- POST without `_id` appends a value. POST with an existing value's `_id` overwrites that value.
- DELETE `/property/{id}` is a soft-delete: the record stays in the database "for audit purposes".
- Every change soft-deletes the old record and inserts a new one, so Entu already keeps old values. The app just cannot see them on normal reads. [unverified: whether a user-facing API can read soft-deleted values; I found none in the docs]

All paths are under `src/lib/` unless stated. Every write goes through `entuFetch`. No other files in `src/` (routes included, bar row 15) call POST or DELETE.

## Strategies

| # | Strategy | File:function | Failure leaves behind |
|---|---|---|---|
| 1 | **Atomic overwrite, shared helper** (GET ids, one POST with `_id` of first old value, extras DELETEd after) | `entu/replaceProperty.ts:34 replaceEntityProperty`. Callers: `collectives/collectiveName.ts:70 updateCollectiveName`, `collective/rosterNames.ts:81 updateRosterShowRealNames`, `events/eventFieldEdit.ts:38 updateEventField`, `repertoire/repertoireActions.ts:44 updateRepertoireStatus`, `:53 pinEdition`, `:103 updateProgramItemOrdinal`, `roster/memberLifecycle.ts:34 flipMemberStatus`, `schedule/scheduleData.ts:119 updateScheduleItemField`, `seasons/seasonFieldEdit.ts:19 updateSeasonField`, `sections/sectionTreeWrites.ts:112 renameSection`, `sections/sectionTreeWrites.ts:23 renumberDisplayOrder` (exported as `reorderSections` and `reorderLinks`), `roster/memberRecord.ts:127 updateMemberRecord` (non-empty fields), `profile/profileData.ts:144 saveProfileFields` (non-empty fields, name then email) | GET fails: nothing changed. POST fails: old value intact. Extras DELETE fails (corrupt multi-value state only): new value landed, stale extras remain, call throws. Race: a POST whose `_id` is already gone appends, leaving two values, no error (documented above `overwriteEntityValues`). `saveProfileFields` writes one field at a time: a failed email write leaves the new name and the old email. `renumberDisplayOrder` loops per item and stops at the first failure: earlier items renumbered, later ones keep old numbers (`SectionReparentPartialError` names the position, via the helper's `fail` option). |
| 2 | **Remove only, shared helper** | `entu/replaceProperty.ts:90 clearEntityProperty`; callers `roster/memberRecord.ts:141` (cleared birthdate), `profile/profileData.ts:153 saveProfileFields` (empty field) | GET fails: nothing. DELETE fails: old value intact, throws. |
| 3 | **Atomic overwrite, shared helper, caller reads the existing values** (one POST, each entry paired with the first of its own existing ids, extras DELETEd after) | `entu/replaceProperty.ts:55 overwriteEntityValues`. Callers: `rsvp/rsvpData.ts:220 updateRsvpStatus` (status + sentinel in one POST); `attendance/attendanceData.ts:135 updateAttendanceStatus` (same, three sentinels); `links/linkActions.ts:91 updateLink` (name, url, description in one POST); `sections/sectionTreeWrites.ts:78 reparentSection` (`_parent`, refuses unless exactly one existing, so no extras); `events/eventSeriesActions.ts:27 reassignEventSeries` (only the `event_series` `_parent` value is paired, appends if none, never sweeps) | POST fails: old values intact. Extras DELETE fails: new landed, duplicate remains. `reparentSection` throws `SectionReparentPartialError` with the response body (helper's `fail` option). `updateLink`: a cleared description is DELETEd after the POST, so a failed DELETE leaves the old description. |
| 4 | **Add-only (POST append)** | `sections/sectionMembership.ts:15 assignMemberSection` (`_parent`); `seasons/seasonFieldEdit.ts:35 addSeasonConductor`; `library/lendingActions.ts:74 returnLending` (`returned_at`); `invite/inviteCreate.ts:173` (self `_editor` grant, inside createInvite) | POST fails: nothing. A repeat call adds a second identical value (comment at `sectionMembership.ts:13` says so; unassign sweeps every match). `returnLending`: a second call appends a second `returned_at`; `libraryReads.ts:206` reads only `[0]`. [unverified: whether `returned_at` is `list: true`] |
| 5 | **POST then DELETE old** | `admin/roleManagement.ts:132 grantRole` (POST `_editor`, then DELETE the person's older own `_editor` values) | POST fails: nothing. DELETE fails: new grant plus stale duplicate (harmless to rights, throws). Skips entirely if the person is already `_owner`. |
| 6 | **Delete placeholders, then POST mint** | `invite/inviteSelfLink.ts:117 mintSelfLinkInvite` (sweep at `:45` DELETEs old invite `entu_user` entries, then POST new mint) | Sweep fails midway: aborts, mint not attempted, some old links already revoked. Mint fails: all old links revoked, no new one. Deliberate: a surviving old link is a live credential. |
| 7 | **Remove only** | `sections/sectionMembership.ts:35 unassignMemberSection`; `seasons/seasonFieldEdit.ts:55 removeSeasonConductor`; `events/eventSeriesActions.ts:55 unassignEventSeries`; `admin/roleManagement.ts:163 revokeOwnGrant`; `invite/inviteSelfLink.ts:101 withdrawInvite` (via sweep) | DELETE loop stops at first failure; earlier values already removed, throws. Missing target: unassign throws a tagged error, conductor remove is a no-op. |
| 8 | **Multi-step: create, add-only link, delete** | `events/eventConvert.ts:215 convertEventToSeries`: create series, POST `_parent` (append) on event, DELETE the event's own name values | Throws `EventConvertError` naming the step. Step 2 ok, step 3 fails: orphan series. Step 3 ok, step 4 fails: event is in the series and still has its own name value. Nothing rolled back. |
| 9 | **Create, entity POST (shared)** | `entity/entityCreateShared.ts:94 postEntity` (callers `createLink`, `createProfile`, `createMemberRecord`, `createSection`); `:122 postCreate` (callers `entity/entityCreateEvent.ts` season/event_series/event, `entity/entityCreateLibrary.ts` work/edition) | One POST: nothing created on failure. 2xx without `_id` throws (not treated as success). |
| 10 | **Create, entity POST (own copy)** | `rsvp/rsvpData.ts:172 createRsvp`; `attendance/attendanceData.ts:83 createAttendance`; `library/lendingActions.ts:29 createLending`; `repertoire/repertoireActions.ts:~20 createRepertoireItem`, `:78 createProgramItem`; `schedule/scheduleData.ts:88 createScheduleItem` | One POST: nothing created on failure. |
| 11 | **Create, multi-step with rollback** | `feedback/feedbackActions.ts:103 createFeedback`: create entity, POST screenshot metadata, PUT bytes | Metadata or PUT fails: entity (and phantom property) DELETEd, rollback errors swallowed. If rollback itself fails, half-built feedback stays. |
| 12 | **Create, multi-step, no rollback** | `invite/inviteCreate.ts:100 createInvite`: create person (mints invite token), POST self `_editor`, create member | Grant fails: person exists without self-edit, error says repair in Entu. Member create fails: person exists with a live invite token. Neither is undone. |
| 13 | **Add-only file upload** | `library/editionFiles.ts:129 uploadEditionFiles`: one POST appends a `file` value per file, then PUT bytes per file | Per-file PUT failure: that phantom property DELETEd and reported (`cleanup: 'deleted'` or `'delete-failed'`); other files stay attached. Unreadable 2xx envelope: all reported failed, nothing cleaned (no ids). |
| 14 | **Phantom cleanup helper** | `files/entuUpload.ts:49 deletePhantomProperty` (used by 11 and 13) | Never throws; returns false on failure. |
| 15 | **Best-effort delete** | `routes/auth/callback/run-link-callback.ts:144` (drops a duplicate identity entry after a same-person re-link) | Failure only `console.warn`s; the duplicate stays; sign-in still succeeds. |

Entity-level DELETEs (not property writes, listed for completeness): `deleteAttendance`, `deleteRsvp`, `deleteLink`, `deleteRepertoireItem`, `deleteScheduleItem`, `deleteSection`, season/event delete (`seasons/seasonDeleteEvent.ts:58`).

## Notes

- One overwrite implementation exists (#698): `overwriteEntityValues` does the POST and the extras sweep; `replaceEntityProperty` is its GET-first wrapper. No hand-rolled copies remain.
- No save path removes a value before its replacement lands (since #680 moved `saveProfileFields` from delete-first to rows 1 and 2). Rows 6 and 7 remove values by intent.
- Row 1/3 overwrites are not compare-and-swap; callers rely on UI single-flight guards (helper header, #264 review F2).
- Because Entu soft-deletes, an overwrite already keeps the old value in the database. "Keep old values" only needs a way to read them, or a separate append entity, not a change of write strategy. [speculative]

## Where keeping old values could help

All [speculative]; these are candidates, not requirements.

- **RSVP and attendance status** (rows 3): status flips lose the change history (who changed when, "going" then "not going"). An event log per rsvp/attendance would give that. Today the sentinel props exist only to count current state.
- **Lending** (`returnLending`): already one entity per loan, which is an event log. A re-lend creates a new lending, so history is kept; the `returned_at` append is the odd one (see row 4).
- **Member status** (`flipMemberStatus`): active, inactive, active flips overwrite. A log would answer "when did they leave".
- **Role grants** (`grantRole`, `revokeOwnGrant`, `unassignMemberSection`): grants and revokes leave no trace of who held a role when. Relevant for admin accountability.
- **Collective name, roster-names setting, event fields** (row 1): low value; current value is what matters.
- **Profile name/email** (rows 1, 2): low value; the old delete-first data loss is gone since #680.
- **Invites** (row 6): withdraw "leaves no marker" by design (`inviteSelfLink.ts:101`); a log would be a deliberate reversal.

(*MVOX:Finn*)
