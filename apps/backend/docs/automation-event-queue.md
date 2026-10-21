# Opportunity automation event queue

Opportunity automations can be dispatched through the durable PostgreSQL queue by setting:

```env
AUTOMATION_ASYNC_EVENTS_ENABLED=true
```

The flag defaults to `false` so the additive migration and worker can be deployed before traffic is moved to the queue.

## Worker configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `AUTOMATION_EVENT_POLL_MS` | `1000` | Queue and outbox polling interval |
| `AUTOMATION_EVENT_CONCURRENCY` | `8` | Maximum events claimed per backend pass |
| `AUTOMATION_EVENT_TENANT_CONCURRENCY` | `4` | Maximum active events selected for one tenant |
| `AUTOMATION_EVENT_CLAIM_SIZE` | `16` | Maximum candidates considered per claim |
| `AUTOMATION_EVENT_LEASE_MS` | `120000` | Event lease duration |
| `AUTOMATION_EVENT_METRICS_MS` | `60000` | Queue-health reporting interval |
| `AUTOMATION_EVENT_FAILURE_ALERT_PERCENT` | `10` | Five-minute permanent-failure alert threshold |
| `PRISMA_POOL_MAX` | `20` | PostgreSQL connections per backend instance |

Every value is validated during startup. Keep enough PostgreSQL connections available for ordinary API traffic when changing worker concurrency or the Prisma pool limit.

## Rollout

1. Apply `20260929120000_scalable_opportunity_automation_queue` with the flag disabled.
2. Deploy the backend and confirm the dormant schema and worker configuration.
3. Enable the flag in staging and run the 1,000-event load test.
4. Enable production while monitoring `automation_queue_health`, expired-lease, retry, and completion logs.
5. Remove the synchronous compatibility path after the production soak period.

## Matching and persistence

Only automations whose opportunity trigger, pipeline, destination stage, and contact filters all match are queued and logged. If no automation matches, the request reports the automation result as `NOT_APPLICABLE` and creates no automation event, dispatch, run, or node-execution record.

Skipped node logs remain part of a run after it has matched and started, including unselected branches and nodes bypassed because of an earlier in-run outcome. Older queued dispatches with saved skip decisions remain processable for deployment compatibility, but new opportunity events do not create them.

## Service enrollment attribution

`20261020170000_automation_service_context` adds nullable `serviceContext` JSON to AutomationEvent,
AutomationRun, AutomationNodeExecution, and AutomationExecution. No existing event or run is backfilled
or assigned to a guessed enrollment. Dispatches read the context from their saved event. Waiting runs
keep it on the run; it is revalidated against the tenant/contact/enrollment on every execution segment.

The context contains `contactServiceId`, `serviceId`, `contactServiceStepId`, `serviceStepId` (source),
and `serviceStepOccurrenceId`. Queue producers use `resolveAutomationServiceContextTx` to capture
canonical IDs. Step and occurrence identifiers remain tied to the saved definition and entry, including
when configuration is archived or another occurrence later becomes current. Causation-key retries with
a different enrollment context are rejected. Add to workflow and same-contact generated events inherit
the context. Events for a newly created contact do not inherit another contact's service context.

Apply the additive migration before deploying the generated Prisma client. Existing contact-only
workflows remain unchanged. Invalid service attribution fails permanently with
`INVALID_SERVICE_CONTEXT`; it never falls back to a contact-only execution. Service event producers
and trigger types are added in the following transition chunks.

## Service step entry events

Apply `20261020180000_service_step_entry_trigger` followed by
`20261020180100_service_step_entry_drafts` and `20261020180200_service_step_draft_names` before deploying the generated client. The latter creates
empty disabled drafts for existing steps and never dispatches old occurrences. New step saves ensure
a starter draft when a step has no automation for that event, without overwriting existing definitions.
Apply `20261020220000_service_step_trigger_selection` to remove the one-workflow limit and add
optional `serviceOfferingId` scope. Null scope preserves existing shared behavior.

`createServiceStepOccurrenceTx` queues `SERVICE_STEP_ENTERED` inside the entry transaction. Queue
matching selects every published automation for the source step and enrolled sub-service (including
legacy null-scope workflows), with entry-time contact filters. Shared automation-row locks in stable
ID order keep publication and action snapshots
consistent with concurrent editor saves. Only the locked configuration IDs are eligible for that event;
a concurrently added or retargeted workflow cannot enter the unprotected snapshot read. Causation uses `service-step-entry:<tenantId>:<occurrenceId>`;
retries reuse the existing entry, and revisits receive fresh occurrence IDs. Disabled, empty, and
nonmatching workflows do not dispatch. No feature flag is required: the existing durable event worker
processes entry dispatches and the existing run worker resumes waits.

Raw event/outbox claim and metrics queries compare timestamp columns with UTC wall time explicitly.
This preserves scheduling when a database session uses a local time zone instead of UTC. Regression
checks claim the same due entry event under both America/Chicago and UTC sessions.

## Service step completion (Chunk 11)

The automation sidebar offers **Service step** with Service → Sub-service → Step selectors and
**Entry step** / **Completed step** events. Multiple automations may select the same step and event.
New triggers require an active sub-service and one of its effective active steps. Authors can retarget,
change, or delete these automations. Empty drafts cannot publish. Service steps still receive disabled
starter drafts. Existing shared drafts keep their original scope across sub-services using that source
step until retargeted; newly created automations target the selected sub-service. Step configuration
returns all linked automations, their sub-service scope, publication state and action counts.
Service-step workflows cannot be generic Add to workflow targets or be started without occurrence context.

`POST /api/services/:tenantId/contact-services/:contactServiceId/step-occurrences/:occurrenceId/complete`
locks the enrollment, records completion and its actor/time, and queues every matching completion
workflow atomically. Repeated requests return the saved result. Without enabled matching actions
(including a filter miss), progression enters the next saved step immediately. Otherwise the saved
`WAITING_AUTOMATION` state gates advancement until every matching root run succeeds. A dispatched event
being complete does not release a waiting run. Independent child workflows cannot release this gate.

The last successful root segment advances inside its action transaction and queues the next entry once.
Failure rolls back that segment and saves `PAUSED` with a visible reason; stopping or removing a
completion run also pauses. Previously committed segments remain in history. Canceled enrollments
cannot be advanced by late workers. `ADVANCED` and `FINISHED` states retain the progression timestamp.
The final step completes paid enrollments or leaves them pending payment; later payment changes
reconcile this status. Enrolled step order and instructions come from the enrollment snapshot.

The enrollment interface offers **Complete step**, shows pending completion work and paused reasons,
and refreshes while a completion workflow is pending. Continue-now, rescheduling, manual movement and revisits are available on the saved enrollment steps.

## Completion wait controls (Chunk 12)

Duration and fixed-date Wait actions in a completion workflow gate progression until the remaining
pinned actions finish. The enrollment shows the scheduled time and offers **Continue now** and
**Reschedule** to tenant administrators and MEDIUM/MAX members. Continue now ends just the current
wait and wakes the existing run worker. Rescheduling accepts a positive duration or a future absolute
date/time (up to ten years). Dates in the interface use the tenant's time zone. Future enrollments,
source workflow configuration and other enrollments are unchanged.

The scoped `completion-wait` GET returns `waits`, an array of root run IDs, automation names, waiting node execution IDs,
resume times and WAITING/RUNNING statuses. `wait` retains the first result or null for compatibility.
Each pending workflow has its own Continue now and Reschedule controls. POST `completion-wait/continue` and
`completion-wait/reschedule` require `runId`, `waitingNodeExecutionId`, and `expectedResumeAt`.
Reschedule additionally requires `schedule: {mode: DURATION, amount, unit}` or
`{mode: FIXED_DATE, dateTime}`. Requests for a changed/completed/canceled wait return 409; unknown
or unrelated runs return 404. Inactive tenant members cannot read or change waits.

Both the completion worker and controls lock the enrollment before the run. A claimed but unstarted
worker can be fenced out by resetting its lease. Workers recheck their lease under the row lock before
executing any actions. Once execution starts, controls wait for that transaction and then revalidate
the exact wait and schedule. Late failure reporting also rechecks the lease before modifying logs.
An old request cannot affect a later wait in the same run. Continuation preserves its cursor,
branch decisions, variables and action snapshot. Schedule changes and their actor/time/context are
recorded as separate execution-history entries so later worker updates cannot erase them. No schema
migration is required for these controls.


## Manual step movement (Chunk 13)

Enrollment steps offer **Move to step** and **Skip current step**, with a required reason. Moves use
saved enrollment steps, so later configuration edits and archival cannot change the destination.
Forward moves mark the current active entry skipped and record intermediate bypassed steps in the
movement history. Intermediate steps receive no fabricated entry, deadline, or trigger. Backward
moves cancel the current active entry. Revisiting a step creates a fresh occurrence, starts its default
timeframe on entry, and queues all matching destination entry automations once. Completed entries,
completion timestamps, notes, payments and earlier history remain intact. Skips bypass completion
workflows. A final skip finishes work and retains Pending payment when a balance remains.

`POST /api/services/:tenantId/contact-services/:contactServiceId/step-movements` accepts `requestId`,
`expectedOccurrenceId`, `kind` (MOVE or SKIP), and `reason` (1–1000 trimmed characters). MOVE requires
`targetStepId`; SKIP uses the next saved step or finishes the last. A repeated identical request returns
its saved movement; reusing a request ID with different inputs or moving from a stale entry returns
409. Only active tenant admins and MEDIUM/MAX members may move work. Canceled and completed
enrollments reject new moves. Pending-payment work can be revisited and returns to In progress.

`stepMovements` on enrollment workspaces records source/destination IDs and titles, skipped step IDs,
staff ID/name, reason, and timestamp. Old occurrences receive `supersededAt`; pending progression is
marked SUPERSEDED. Queued events/dispatches and unfinished runs (including scoped child workflows)
for old entries stop with SERVICE_STEP_MOVED. Ordinary contact workflows and other enrollments are
unaffected. Previously committed actions are retained. Completion events and later stale workers
cannot release obsolete progression.

All service-scoped execution, failure reporting, wait controls and movement lock the enrollment before
the dispatch/run. A claimed but unstarted worker loses its lease; an executing segment finishes first,
and the waiting move revalidates its displayed source. Ownership and supersession are checked again
before any later segment. History, cancellations and destination entry events commit or roll back
together. Payment reconciliation cannot finish an enrollment while a revisited step is active.


## Enrollment-specific step deadlines (Chunk 14)

Each entered step saves `defaultDueAt` alongside its effective `dueAt`. The default is frozen from
that enrollment's captured timeframe at entry. The migration copies existing due dates exactly;
existing history and deadlines are not recalculated. Unentered steps have no occurrence or deadline.

The enrollment offers **Change deadline** by duration (minutes, hours or days from entry) or date/time
in the tenant's time zone, plus **Restore default** for an override. Restoring uses the frozen entry
deadline, including when it is now overdue. A fixed date must follow entry and be within ten years;
it may be in the past for overdue work. A duration is a positive whole number within ten years of
entry. Invalid or nonexistent local times are rejected in the interface. The form previews the
resulting deadline. Default and custom timeframes are labeled separately.

`POST /api/services/:tenantId/contact-services/:contactServiceId/step-occurrences/:occurrenceId/deadline`
accepts `requestId`, `expectedDeadlineRevision`, and `schedule`: `{mode: DURATION, amount, unit}`,
`{mode: FIXED_DATE, dateTime}` with an explicit offset, or `{mode: DEFAULT}`. Responses return the
canonical occurrence and `deadlineChanges`. The occurrence exposes `deadlineOverride` (null for the
default) and `deadlineRevision`. Changes record the actor, timestamp, prior/new deadline and schedule.
An identical request retry is idempotent; different inputs with the same request ID or stale revisions
return 409. Unchanged saves do not increment the revision or add history.

Only the current ACTIVE, non-superseded entry can change, with the same tenant admin or MEDIUM/MAX
permissions as movement. Enrollment locking matches completion, movement and workers. A stale edit
cannot update a moved, skipped, completed or revisited entry. Canceled/completed enrollments reject
new changes. History and deadline updates commit or roll back together.

Overrides affect only that occurrence. Other enrollments (including for the same contact), saved
service/sub-service configuration, later steps and future enrollments are unchanged. Completion,
skipping and manual movement retain earlier override history; each destination or revisit starts a
fresh default with revision zero. Deadline edits do not fire entry/completion triggers, move steps,
or alter any automation run, lease or resume time. Completion workflow waits continue to use their
separate Continue now and Reschedule controls. Saved responses remain visible if workspace refresh
fails, and edit dialogs retain their drafts after save errors.


## Follow-up queue urgency (Chunk 15)

`GET /api/services/:tenantId/follow-ups` combines service-owned step work and existing template
follow-ups. It reads saved enrollment steps and only their latest entry, never live service definitions,
old deadline changes or superseded occurrences. Canceled enrollments are excluded.

- **Actionable:** An active entry. Its effective deadline is `dueAt`; elapsed time starts at `enteredAt`.
- **Scheduled:** A completed step waiting on completion automations. The earliest current matching
  root wait supplies `scheduledAt`; running/queued automation work may have no scheduled time yet.
  Resume times are not step deadlines and cannot make the next, unentered step overdue. Entry
  automation waits do not remove an otherwise active step from Actionable.
- **Needs attention:** Paused progression or an enrollment missing its current entry. Shows the saved
  progression message and no deadline urgency.
- **Finished:** Step work is finished, including enrollments still waiting for payment. No urgency.

`timing` contains `status` (NONE, ON_TRACK, DUE_SOON, OVERDUE), signed `remainingMs`, `timeframeMs`
and `warningAt`. Only an entered, actionable step with a valid deadline has elapsed timing. The
warning begins inclusively at `enteredAt + 0.75 * (dueAt - enteredAt)`; overdue begins at the deadline.
Durations use elapsed milliseconds, matching Chunk 14, including daylight-saving transitions.
Overrides and fixed dates change the effective timeframe; Restore default restores its original warning
boundary. Future steps, completed entries, superseded entries and automation waits cannot be overdue.
Legacy active/postponed work uses its available/start time; pending dates do not invent an entry clock.

The default `sort=URGENCY` lists Actionable, Needs attention, Scheduled, then Finished, with earliest
effective deadline/resume time first and undated rows last within each group. Other existing sort modes
remain supported. Filtering/sorting across both workflow types precedes pagination. `queueState` can
select one of those four groups; date presets also accept DUE_SOON. OVERDUE and DUE_SOON match
only actionable elapsed deadlines. TODAY/NEXT_7_DAYS use the tenant's calendar for deadlines or
scheduled resume times. NO_DUE_DATE matches work with no deadline/resume time. Summary counts
cover unfinished work across the tenant, independent of list filters; overdue/due-today counts exclude
scheduled work. Existing template and assignee filters remain supported; service-step owner assignment
is part of Chunk 16.

Each request reads a consistent database snapshot and computes all timing from the response's `asOf`.
The client reloads on navigation/focus/visibility and every 30 seconds while visible, preserving filters
and pagination. Older or canceled requests cannot overwrite a newer queue response. No stored urgency
flags, notifications, new triggers, schema changes or background data backfill are needed.
