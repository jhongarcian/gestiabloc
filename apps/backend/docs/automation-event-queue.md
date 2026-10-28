# Automation event queue

## Template retirement (Chunk 20)

Template graphs and their separate executor have been removed. The existing event/run workers,
shared global/tenant admission, retries, checkpoints, leases and completion gates are unchanged.
Old template cursors are archived as history and never replayed through this queue. Saved manual
follow-up steps remain in the staff queue and keep overdue reminders; that reminder poller does not
execute workflow actions. All new enrollments require service steps, including requests that omit
`workflowKind`. Removed template APIs and run retry/reschedule/continue endpoints return 404.
See [retirement and deployment](service-template-retirement.md) before applying the cutover migration.

## Reviewed service configuration (Chunk 18)

New service-step enrollments save complete service workflow definitions (publication state, trigger
selectors, contact filters, nested actions and waits) in `configurationSnapshot.serviceAutomations`.
Future service events match these saved definitions. Library edits and deletion cannot replace them;
a deleted workflow keeps its snapshot ID/name while nullable library foreign keys remain null.
Contact filters still evaluate when the business event occurs. Existing queued dispatches and waiting
runs retain their pinned actions, variables, routing, leases and schedules across configuration updates.

Older enrollments with no saved workflow collection retain their existing live-definition behavior.
An explicit configuration review adopts current definitions; an empty saved collection means no workflows,
while malformed saved data fails rather than falling back live. Configuration application never replays
enrollment, entry, checklist, payment or status events and never drains automation execution in a request.
The shared 4-global/2-tenant queue limits, fencing, retries and checkpoints continue to apply.

Apply `20261021130000_service_configuration_review` before application deployment. It adds durable
15-minute preview receipts and applied audit records, without rewriting existing enrollments. Admin
review/apply requests address one enrollment, lock it before configuration, and reject state or source
changes. UI pages are capped at 20 and issue requests sequentially. Applied receipts are retained as
history; expired unapplied receipts can be removed by a future retention task without affecting work.

Opportunity automations can be dispatched through the durable PostgreSQL queue by setting:

```env
AUTOMATION_ASYNC_EVENTS_ENABLED=true
```

The flag defaults to `false` so the additive migration and worker can be deployed before traffic is moved to the queue.

## Worker configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `AUTOMATION_EVENT_POLL_MS` | `1000` | Queue and outbox polling interval |
| `AUTOMATION_EXECUTION_CONCURRENCY` | `4` | Shared database-wide active event and run limit |
| `AUTOMATION_EXECUTION_TENANT_CONCURRENCY` | `2` | Shared active execution limit per tenant |
| `AUTOMATION_EVENT_CLAIM_SIZE` | `16` | Maximum candidates considered per claim |
| Execution lease | `120000 ms` | Shared event/run lease duration |
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

`GET /api/services/:tenantId/follow-ups` combines service-owned step work and retained manual
follow-ups from retired workflows. It reads saved enrollment steps and only their latest entry, never live service definitions,
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
scheduled work. Service, sub-service and assignee filters remain supported. Template selection filters were removed
in Chunk 20; service-step owners are supported by Chunk 16.

Each request reads a consistent database snapshot and computes all timing from the response's `asOf`.
The client reloads on navigation/focus/visibility and every 30 seconds while visible, preserving filters
and pagination. Older or canceled requests cannot overwrite a newer queue response. No stored urgency
flags, notifications, new triggers, schema changes or background data backfill are needed.

## Service actions and shared admission (Chunk 16)

Service-step entry/completion workflows offer **Service actions**. Every action operates on the exact
triggering enrollment, saved step and occurrence. Contextless manual/bulk enrollment fails before a
service mutation. There is no fallback to another enrollment and no creation of missing snapshot items.

| Action | `serviceConfig` |
| --- | --- |
| `MOVE_SERVICE_STEP` | `targetSourceStepId`, required `reason` |
| `COMPLETE_SERVICE_STEP` | `{}` |
| `SKIP_SERVICE_STEP` | required `reason` |
| `SCHEDULE_SERVICE_STEP` | `schedule`: duration from entry, offset-aware fixed date, or default restore |
| `SET_SERVICE_STEP_OWNER` | `assignedToUserId`: active member UUID or null |
| `SET_SERVICE_COORDINATOR` | `assignedToUserId`: active member UUID or null |
| `SET_SERVICE_PROFESSIONAL` | `professionalId`: eligible saved professional UUID or null |
| `SET_SERVICE_CHECKLIST_STATUS` | stable source `checklistItemId`, `status`: NOT_RECEIVED, INFORMED, MISSING, RECEIVED |
| `SET_SERVICE_STATUS` | `status`: IN_PROGRESS or CANCELED |

The catalog's `serviceActionOfferings` supplies effective choices per active offering. A scoped trigger
uses that offering; a shared trigger uses the intersection across eligible offerings. Runtime validation
resolves source IDs against saved enrollment records. Archived checklist history stays usable. An already
assigned archived professional can remain, but cannot be newly assigned. Internal professionals and owners
require active membership. Payment/completion statuses remain derived from finished work and payments.

Move, Skip, Complete and cancellation end their path. The builder hides the trailing Add action control,
save validation rejects a trailing action, and runtime stops even if a corrupt older snapshot has one.
Completion is successful, including an already-completed entry (no duplicate completion event). Movement,
skipping and cancellation intentionally exit; completion/destination-entry automations handle subsequent
work. Scheduling uses the same active-entry and deadline rules as the manual control and changes no Wait.

`ContactServiceStep.assignedToUserId` belongs to the saved step, retains its value across revisits, and
feeds workspace responses, queue rows and the existing assignee filter. The owner endpoint is
`PATCH /api/services/:tenantId/contact-services/:contactServiceId/service-steps/:stepId/owner`, with
`{assignedToUserId: uuid | null}`. Coordinator controls also support unfinished service-owned steps.

All mutations lock the enrollment first, then occurrence/configuration/runtime rows. The shared helpers
preserve manual behavior. A unique `ServiceAutomationActionResult(tenantId, runId, nodeKey)` stores each
result with its mutation and audit entry. Automation attribution names the automation and records its run,
node, enrollment, affected occurrence and old/new values; automated changes use no invented human actor.

### Capacity and recovery

`AUTOMATION_EXECUTION_CONCURRENCY` defaults to **4 globally**, and
`AUTOMATION_EXECUTION_TENANT_CONCURRENCY` to **2 per tenant**. Both queues share these limits across
backend instances. Values must be positive integers, tenant capacity cannot exceed global capacity, and
global capacity must leave at least four connections in `PRISMA_POOL_MAX`. A smaller pool lowers defaults.
Legacy event-only concurrency variables are superseded. Execution leases last 120 seconds.

Admission takes a short PostgreSQL advisory lock covering event and continuation claims together. Durable
leases reserve global/tenant capacity and one contact scope, which also serializes enrollments for that
contact. Tenant rotation persists `lastAdmittedAt`; the least recently admitted tenants receive the next
bounded claims. Expired leases can be reclaimed; token checks fence execution, retry and failure writes.
A process cannot overlap its own run-worker passes. Requests only persist work and wake background workers.

Service-context execution yields after each service mutation, or after **10 visited nodes / 500 ms** at
the next node boundary. Cursor, variables, routing decisions, logs, result ledger, mutations and outbox
commit together. The run stays QUEUED, releases its lease and is admitted again. A yielded completion
workflow remains unfinished and cannot release the completion gate. Unrelated workflows retain their
existing transaction behavior. Transient retries remain **5, 30 and 120 seconds**; permanent failures stop
only their run. Movement/completion events retain chain identity and depth; the result ledger rejects repeated
transitions within a chain even when different workflows attempt them. Existing repeated-workflow guards
also remain in place.

`automation_queue_health` includes active executions, per-tenant usage, execution limits, queued
continuations, oldest continuation/event age, initial-dispatch retries and resumed-run retries.

### Verification and rollout

Apply `20261021010000_service_automation_actions` and `20261021011000_service_execution_fairness` before
starting the new workers. Owners default to Unassigned. Existing workflow snapshots remain valid.

The repeatable load harness uses only `SERVICE_CONFIGURATION_TEST_DATABASE_URL`; point it at an isolated
staging database containing these migrations:

```bash
DATABASE_URL="$SERVICE_CONFIGURATION_TEST_DATABASE_URL" node --import tsx scripts/service-automation-load.ts
```

It creates 5,000 workflows across ten tenants (2,500 initial events and 2,500 queued runs), executes real
service mutations and continuations through simultaneous workers, probes the real follow-up API against
a baseline, asserts shared capacity, exactly-once outcomes and terminal accounting, then removes fixtures.
The report defaults to `/private/tmp/gestiabloc-chunk16-load-report.json`. See
[the verification report](service-actions-verification.md) for measured results and environment limits.


## Enrollment service events (Chunk 17)

`SERVICE_ENROLLED`, `SERVICE_STATUS_CHANGED`, `SERVICE_CHECKLIST_STATUS_CHANGED` and
`SERVICE_PAYMENT_CHANGED` use the same event/run admission, fairness, contact serialization, lease
fencing, checkpointing and retries as service-step workflows. There is no second queue or new worker.

All manual and automated service mutations lock the enrollment first. A real change increments
`ContactService.automationEventRevision` and commits one immutable `serviceEventSnapshot` and a
`service-change:<tenant>:<enrollment>:<revision>` causation key. No-match events are immediately COMPLETED
with zero dispatches. Matching definitions and contact-filter decisions are pinned under shared
configuration locks. Same-run/node ledgers make worker replay inert. Generated events carry chain
identity and attribution, including derived final status changes with no matching completion workflow.

The new context has no occurrence IDs. Runtime enrollment locking applies to it, but step movement only
supersedes occurrence-bound work. These roots do not join completion gates. Service actions revalidate
saved enrollment choices and business rules. Generic Add to workflow and contextless manual enrollment
exclude all service-trigger types, rather than using the presence of `serviceStepId` as a proxy.

Payment create/edit/delete, financial validation, status reconciliation and event emission share one
transaction. Payment Added includes positive initial payments; Updated compares normalized amount,
date, method and note; Removed retains its before snapshot. No-ops preserve payment timestamps. A
payment may emit a separate status event, but never bypasses active work or existing completion gates.
