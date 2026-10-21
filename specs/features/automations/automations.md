# Automations

## 1. Purpose

Automations turn opportunity events into repeatable work on a contact.

An automation defines:

- the opportunity event that starts evaluation
- the pipeline and selected stage or Won/Lost outcome that the event must match
- optional contact filters
- the ordered actions to execute
- optional waits, conditional branches, random routes, and cross-path routing
- actions that can update opportunities or explicitly start another workflow
- whether the automation is a draft or published

This document describes the current product behavior for administrators, support, QA, and engineering. It covers the builder, execution rules, monitoring, and the main API surface.

## 2. Location And Access

Automation management lives under:

- `/app/{tenantSlug}/account-settings/automations`
- `/app/{tenantSlug}/account-settings/automations/new`
- `/app/{tenantSlug}/account-settings/automations/{automationId}`

Only tenant administrators can read or change automation configuration and monitoring data.

The automation list allows an administrator to:

- create an automation
- open the builder
- publish an automation or move it to draft
- change automation execution order
- review the last run status
- delete an automation
- open bulk-enrollment process history

## 3. Core Execution Model

An automation does not run merely because a contact was added to it.

The normal lifecycle is:

1. A qualifying opportunity event occurs.
2. Published automations with the same trigger type and pipeline are evaluated.
3. The configured stage or Won/Lost change and contact filters are evaluated.
4. A matching automation creates an independent run for that contact.
5. Actions execute in order until the run completes, exits, fails, or reaches a Wait action.
6. Once an automation matches its trigger and contact filters, every trigger and action result is recorded in the execution logs.

Repeated qualifying opportunity events may create separate runs for the same contact. Parallel runs do not share formatter values or cursor state.

An Add to workflow action is an explicit entry mechanism. It starts the selected published automation at its first action without evaluating that automation's opportunity trigger or contact filters.

## 4. Draft, Save, And Publish

Every automation is either:

- `Draft`: saved but not eligible to start from new opportunity events
- `Published`: eligible to start when its trigger and filters match

The sidebar Save button only applies the selected trigger or action edit to the builder draft. The header **Save changes** button persists the complete automation.

Important rules:

- unsaved builder changes never execute
- an automation must be saved before it can be published
- publishing is blocked while the builder has unsaved or invalid changes
- moving an automation to draft prevents new runs but does not cancel runs already waiting
- changing a published automation does not alter a run that already started; the run uses its pinned action snapshot

Deleting an automation removes its editable definition while preserving historical execution snapshots and logs. Runs that already started continue from their pinned configuration.

## 5. Triggers

The builder currently supports two opportunity triggers.

### Opportunity created

Runs when a new opportunity is created for a contact in the configured pipeline.

The trigger does not require the contact to have been manually enrolled first.

### Opportunity changed

Runs when an existing opportunity enters the configured stage or is marked Won or Lost in the configured pipeline.

Each automation listens for exactly one change. A selected destination stage matches entry from any other stage. Won and Lost match a transition from any different result; Open is not available as an outcome trigger.

If one update changes both the stage and result, it creates one durable opportunity event. Stage and outcome automations that match that event each run once. Creating an opportunity only evaluates Opportunity created automations, even when the new opportunity is already Won or Lost.

### Trigger configuration

The first graph node may be unconfigured. Selecting it opens the trigger sidebar.

The trigger sidebar contains:

- automation name
- trigger type
- pipeline
- change to listen for: Enters a stage, Marked won, or Marked lost
- destination stage when using Enters a stage
- optional contact filters

The automation name appears first, before the trigger selection.

Saving the sidebar configuration closes it and updates the builder draft. The header Save button must still be used to persist the automation.

## 6. Trigger Filters

Filters narrow which contacts may continue after a relevant opportunity event.

Supported filter sources include:

- opportunity value
- contact status
- contact assignee
- contact tags
- active, non-sensitive, non-encrypted custom fields

Operators are selected according to the field type, including equality, comparison, range, inclusion, boolean, empty, and not-empty operations.

All configured top-level trigger filters must match.

Filters are not displayed as graph nodes. Their behavior is:

- trigger, pipeline, stage, or outcome mismatch: no execution log is created
- matching trigger with failed filters: no execution log is created
- full match: trigger and actions execute

When asynchronous event processing is enabled, filter decisions use the contact state captured when the opportunity event occurred. Actions continue to resolve live contact data when their node executes.

## 7. Builder Structure

The builder contains:

- one trigger node
- zero or more action nodes
- Add buttons between eligible nodes
- one Complete endpoint for each terminal path

Action configuration opens in a vertically scrollable sidebar. Changes remain local until **Save changes** is selected. Cancel restores the node to its previous state.

The builder supports up to 100 action nodes across the complete tree, including nodes inside nested If/Else and Split routes.

Actions are grouped as:

- Internal actions
- Opportunity actions
- Contact actions
- Communication actions

The Communication group is reserved for future actions and is currently empty.

## 8. Internal Actions

### Wait

Wait pauses one automation run without blocking other runs.

Supported modes:

- duration in seconds, minutes, hours, or days
- fixed date and time

A fixed date can proceed:

- on the selected time
- before the selected time by an offset
- after the selected time by an offset

If the calculated time has already passed, the node can:

- continue to the next action
- exit the run
- go to a later action in the same path

A go-to target cannot point backward or enter another branch path.

Future waits are durable. The run stores its action snapshot, cursor, automation values, branch decisions, and resume time. Editing, unpublishing, or deleting the automation does not change that waiting run.

### Date/Time formatter

Date/Time formatter creates a named run-scoped automation value.

It can:

- format a date
- format a date and time
- compare two dates in signed whole days, months, or years

Sources include:

- current date
- a relative date
- a safe contact date field
- a safe custom date field
- a specific date
- an earlier compatible automation value

The result is available to later nodes as `{automation.output_key}`.

### Number formatter

Number formatter creates a numeric or formatted run-scoped value.

Supported modes:

- text to number
- format number
- format currency
- format phone number
- random whole number within an inclusive range

Sources may come from compatible contact fields, custom fields, or earlier automation values.

When a configured contact or custom field is empty, the action succeeds without creating an automation value. It does not fail merely because there is nothing to format. A later node that requires the absent output must still handle or avoid that missing value.

### Text formatter

Text formatter has an editable action name and creates a text or numeric automation value.

Supported modes:

- uppercase
- lowercase
- title case
- capitalize
- default value
- trim to a character length
- trim leading and trailing whitespace
- replace text
- find the first zero-based position
- word count
- character length
- split text by separator and one-based segment
- extract the first email address
- extract the first HTTP, HTTPS, or `www.` URL

Empty source values execute successfully. Text outputs become an empty string unless Default value supplies a fallback. Length and Word count return `0`, and Find returns `-1`.

### Math operation

Math operation creates a run-scoped number or canonical `YYYY-MM-DD` date.

Number operations:

- add
- subtract
- multiply
- divide

Date operations:

- add days, months, or years
- subtract days, months, or years

Division by zero, missing sources, incompatible sources, and non-finite results fail the node.

### If/Else

If/Else routes a run through the first matching condition branch.

Rules:

- branches are evaluated from top to bottom
- branch order determines priority
- a branch may require all conditions (AND) or any condition (OR)
- only the selected branch executes
- unselected branch actions are logged as skipped
- the permanent Default branch is selected when no condition branch matches
- Default contains no actions and completes the path
- If/Else can be nested up to three levels
- each If/Else is terminal in its containing path

Branch conditions may use live contact values, custom fields, status, assignee, tags, earlier compatible automation values, tenant-local current date/time, and the pinned opportunity event context.

If If/Else is inserted between existing actions, every following action moves into Branch 1 in its original order. When an existing action is converted, that selected action is replaced by If/Else and only the actions after it move into Branch 1. The moved actions retain their stable node keys and configurations.

### Split

Split randomly routes each automation run through one percentage-based route.

Rules:

- each Split contains between 2 and 20 ordered routes
- every percentage is a positive whole number
- route percentages must total exactly 100%
- route assignment is independent for every run
- retries and Wait resumes retain the route already selected for that run
- only the selected route executes; actions in other routes are logged as skipped
- empty routes are allowed for control groups and complete successfully
- Split is terminal in its containing path
- Split and If/Else may be nested together to a combined depth of three

When Split is inserted between existing actions, the following actions move into Route 1 without changing their order or stable node keys. Each terminal route has its own Complete endpoint in the graph.

### Go To

Go To continues the current run at an exact action in another branch or route.

Rules:

- Go To must be the final action in its source path
- the destination action executes, followed by the remaining actions in that destination path
- actions before the selected destination are bypassed and recorded as skipped where applicable
- self-targets, same-path backward jumps, missing targets, and any connection that creates a cycle are rejected
- destinations must preserve the availability of automation values used by downstream actions
- the run persists visited-node and transition history across Waits so it cannot repeat a routed node indefinitely

Go To displays a dotted routing connector in the graph and has no local Complete node because execution continues at its destination. This action is separate from a fixed Wait's Go to step option, which may only select a later action in the same path.

### Add to workflow

Add to workflow explicitly starts another published automation for the same contact.

Configuration includes an editable action name and a searchable published-workflow selection. The current automation and any target that would create a direct or indirect dependency cycle are unavailable.

Runtime behavior:

- the target starts from its first action without evaluating its opportunity trigger or contact filters
- the target is queued independently and the source automation continues immediately
- each source execution creates a separate target run, even if the contact already has an active run there
- transaction retries use a causation key so the same node execution cannot create a duplicate target run
- the target's current published action definition is pinned when this node executes
- the contact, actor, opportunity, and original opportunity-event context are inherited
- formatter values are not copied; the target starts with an empty automation-value collection
- target failures remain isolated and do not retroactively fail the source run
- chained workflows cannot revisit an automation already in the chain and may start at most 20 workflows

An enabled automation that is referenced by Add to workflow cannot be unpublished or deleted until the reference is removed. If Delete contact runs, queued or waiting child runs are exited and their remaining actions are logged as skipped.

### Create task

Create task creates a standard contact-linked task.

Configuration includes:

- task-name template
- optional description template
- active task status
- assignee mode: unassigned, live contact assignee, or a specific active user
- optional linked service snapshot
- optional due date and time
- optional reminder date, time, and message template

Scheduling can use the current date, a relative date, a contact date field, a custom date field, or a specific date. Reminders require a due date and a resolvable active assignee.

Task content is resolved when the action executes. A task created before a Wait remains committed even if a later segment fails.

### Create appointment

Create appointment books a Scheduled, timed appointment for the current contact. Authors give the action a name, add a required title template and optional notes template, choose the contact's live assignee or a specific active teammate, and optionally select an active service. The start date can be fixed, today, relative to execution, read from a safe contact or custom date field, or supplied by an earlier DATE automation value available on every route; authors also choose the local time.

The action uses the tenant's current meeting duration and the same locked availability check as manual booking. Missing data, a past or nonexistent local time, an inactive reference, or an unavailable slot fails the action without creating an appointment. The audit log attributes a successful booking to `Automation · [workflow name]`; the booked-by user is empty. The appointment-created event is queued in the same transaction and follows the existing automation-chain loop protection. Later actions continue on the original contact, and the action produces no automation value.

### Update appointment status

Update appointment status changes one appointment for the current contact to Scheduled, Confirmed, Show, No show, Canceled, or Completed. Authors name the action and choose either the triggering appointment (for appointment-created or appointment-status-changed triggers) or the next upcoming appointment. The latter is the earliest future appointment by start time and ID, regardless of its current status.

Up to 20 optional contact-field, safe custom-field, and tag filters are combined with AND and evaluated against the contact's live state. A filter mismatch or missing appointment skips this action and the workflow continues. An unchanged status is recorded without an audit entry or event. A successful change records `Automation · [workflow name]` in appointment history and queues an appointment-status-changed event in the same transaction with chain context. Changing to Scheduled also requires a future time, active assignee, and available calendar slot; a conflict fails the action.

### Add contact note

Add contact note creates a standard contact note with a required title and body.

The title and body support live template values. The note is attributed to:

`Automation · [automation name]`

Automation-authored notes remain identifiable after the automation or triggering user is removed. Tenant administrators control editing and deletion of these notes.

## 9. Opportunity Actions

### Update/create opportunity

Update/create opportunity creates or updates the contact's opportunity in a selected pipeline.

Configuration includes:

- editable action name
- pipeline
- destination stage
- outcome: Keep current, Open, Won, or Lost
- fixed USD value

The action may move an opportunity forward or backward. The configured value applies both when creating a missing opportunity and when updating an existing one. Open clears the closed timestamp; Won or Lost records a closed timestamp. Keep current preserves an existing result and creates a missing opportunity as Open.

Creating an opportunity queues an Opportunity created event. Changing an existing opportunity's stage or marking it Won or Lost queues one Opportunity changed event. Value-only changes and reopening to Open do not queue a change event. A completely unchanged opportunity is recorded as a successful no-op.

Generated events use the durable automation queue. Repeated transitions in the same causal chain and chains deeper than 20 events are rejected to prevent automation loops.

### Delete opportunity

Delete opportunity removes the contact's opportunity from one selected pipeline.

It does not delete the contact, opportunities in other pipelines, automation history, or immutable event snapshots. If no opportunity exists in the selected pipeline, the action succeeds as a no-op. It does not generate a new opportunity event because there is no opportunity-deleted trigger.

Delete opportunity is not terminal. Later actions continue normally, and a later Update/create opportunity action may create the opportunity again. A later failure in the same transaction segment rolls the deletion back; reaching a Wait commits it.

## 10. Contact Actions

### Create contact

Create contact adds a standalone contact while the automation continues to run against its original contact.

The action supports:

- an editable action name
- required first- and last-name templates
- optional middle name, email, and phone templates
- an active contact status
- an optional active-team-member assignee selected with the searchable contact assignee picker
- an optional birthday
- up to 20 compatible custom-field values

For a fixed phone number, the editor uses the same country picker as the contact overview. It defaults to the United States, formats the value as the number is entered, and saves the normalized E.164 value. The **Insert field** control remains available for dynamic contact fields and earlier automation values. Inserting a dynamic value replaces the fixed number and opens the template editor; clearing the template returns the field to the phone picker.

At execution time, a rendered phone value must be a valid E.164 number. A configured assignee must still be an active member of the same tenant. If an existing contact in the tenant already has the same normalized email or phone, the action succeeds as a no-op and does not modify that contact. The new contact is not automatically enrolled in another workflow, and later actions continue to use the original contact.

### Update contact fields

One node can update up to 20 distinct regular or custom fields atomically.

Each row selects:

- Contact fields or Custom fields
- a field
- Set value or Clear value
- a type-appropriate value when setting

Required fields cannot be cleared. Inactive, sensitive, or encrypted custom fields are unavailable. If any row fails validation, none of the node’s field updates are committed.

### Set contact status

Sets the contact to an active configured status. Contacts always have a status; there is no Clear contact status action.

### Assign or clear contact assignee

Assign contact selects an active teammate. Clear contact assignee removes the current assignee.

### Add or remove contact tag

Adds or removes one existing tenant tag.

### Delete contact

Delete contact must be the final action in its selected path.

It permanently removes the contact from the account, exits or cancels remaining automation work for that contact, and cleans up contact-owned storage objects such as files attached through notes. Historical automation snapshots and audit logs keep readable contact-name snapshots.

This action is different from removing one waiting run. Removing a waiting run leaves the contact and all unrelated runs intact.

## 11. Templates And Inserted Values

Contact notes and task text fields use the reusable Insert field control.

### Contact fields

Examples:

```text
{contact.name}
{contact.email}
{contact.phone|phone:national}
{contact.date_of_birth|date:medium}
```

### Custom fields

Custom fields use their immutable key:

```text
{contact.custom_field.bank}
{contact.custom_field.appointment_date|date:long}
```

Renaming a custom-field label does not change its key or invalidate templates. Sensitive, encrypted, inactive, or deleted fields are not exposed and resolve as blank where applicable.

### Date values

Examples:

```text
{date.current|date:medium}
{date.relative.2.weeks|date:long}
{date.specific.2026-09-23|date:iso}
```

Supported display formats are Short, Medium, Long, With weekday, and ISO.

### Automation values

Formatters and Math operations store values in the current run:

```text
{automation.appointment_date}
{automation.formatted_phone}
{automation.adjusted_premium}
```

Output names must:

- start with a lowercase letter
- contain only lowercase letters, numbers, and underscores
- be unique within the reachable workflow path
- refer only to an earlier producer on the same path or an ancestor path

Automation values are isolated per run and survive Wait actions. They do not update the contact unless a later contact action explicitly does so.

Templates and actions resolve live contact data when their node runs. Earlier contact mutations in the same segment are visible to later nodes.

## 12. Manual Contact Enrollment

Administrators can select contacts in the Contacts page and choose **Add to automation**.

Manual enrollment records participation, but it does not imitate an opportunity event.

For each manually enrolled contact:

- the trigger is logged as skipped because no opportunity event occurred
- every action is logged as skipped
- no Wait is scheduled
- no note, task, formatter value, mutation, or deletion action runs
- the contact remains eligible for a future real opportunity trigger

Bulk enrollment runs through the automation-process queue in batches. Progress and errors are available under `/app/{tenantSlug}/automation-processes`.

## 13. Transactions, Waits, And Failures

Actions execute in transaction segments.

- actions before a future Wait commit together
- the Wait ends the current segment
- actions after resume execute in a new segment
- a failure rolls back changes made in the current segment
- work committed before an earlier Wait remains committed

If a node fails:

- the failing node is logged as Failed
- earlier actions in the rolled-back segment are marked Failed with rollback details
- later actions are marked Skipped
- the run finishes as Failed

Configuration errors are not retried. The asynchronous event queue may retry transient database or connection failures according to its worker policy.

### Service enrollment context

Events and runs optionally carry `serviceContext`: the enrollment (`contactServiceId`), sub-service
(`serviceId`), saved enrollment step (`contactServiceStepId`), source configuration step
(`serviceStepId`), and entry occurrence (`serviceStepOccurrenceId`). Step/occurrence fields are null
for enrollment-only context. The queue and every execution segment validate ownership in the same
tenant, contact, and enrollment before actions run. The engine never guesses an enrollment from a
contact, and invalid or deleted targets fail with `INVALID_SERVICE_CONTEXT`.

The context is pinned across waits, branches, chained workflows, and same-contact generated events.
Create contact does not copy it onto a different contact. Ordinary events and older runs remain
unscoped. Node logs and aggregate history preserve the context even when source records are deleted.
The execution-log, waiting-run, and event-progress APIs return nullable `serviceContext`. Execution
logs also accept `contactServiceId` and `serviceStepOccurrenceId` filters combined with AND.
Service triggers and service actions are introduced in subsequent service transition chunks.

## 14. Monitoring Tabs

### Builder

Shows the trigger, action graph, branches, Wait badges, and Complete endpoints.

### Contacts

Shows contacts that have participated in the automation, including:

- contact name
- first entered time
- email and phone
- execution count
- latest run status

A manually enrolled contact may appear as Waiting for trigger because enrollment alone does not run actions.

### Execution logs

Execution logs contain one row per trigger or action node.

Columns:

- Contact
- Node
- Status
- Details
- Executed on

Statuses:

- `Queued`: the opportunity event has been committed and awaits processing
- `Waiting`: the run is paused at a Wait node
- `Executed`: the node completed or intentionally performed a no-op
- `Skipped`: the node did not run because of trigger, filter, branch, removal, or earlier-failure behavior
- `Failed`: the node failed or its changes were rolled back with the segment

Logs support contact-name search, status filtering, tenant-timezone timestamps, page sizes of 10, 25, or 50, desktop tables, and mobile cards. Branch actions include their saved branch breadcrumb.

## 15. Wait Node Monitoring And Removal

Every saved Wait node displays the number of active waiting runs. Unsaved Wait nodes show a save-first state.

Selecting the badge opens a drawer with 10 runs per page. Each row shows:

- contact name
- phone number
- Wait entry time
- scheduled next-action time
- remaining minutes or Due now

Removing a run from this drawer:

- exits only the selected run
- updates the Wait log with the administrator removal reason
- records all remaining actions as skipped
- leaves the contact in the account
- leaves parallel runs unchanged
- allows the contact to enter again from a future qualifying event

If the Wait worker already claimed the run, removal returns a conflict and the drawer must refresh.

## 16. Automation Ordering

Automations are listed in execution order and may be moved up or down.

For one opportunity event, relevant automations are processed independently in saved order. A failure in one automation does not prevent another automation from running.

Delete contact is the exception: after one automation deletes the contact, remaining queued work for that contact is canceled because the contact no longer exists.

## 17. API Overview

Primary account-settings endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/account-settings/{tenantId}/automations/catalog` | Load builder choices and safe fields |
| `GET` | `/api/account-settings/{tenantId}/automations` | List automations in execution order |
| `POST` | `/api/account-settings/{tenantId}/automations` | Create an automation |
| `PATCH` | `/api/account-settings/{tenantId}/automations/reorder` | Replace execution order |
| `GET` | `/api/account-settings/{tenantId}/automations/{automationId}` | Load one automation |
| `PATCH` | `/api/account-settings/{tenantId}/automations/{automationId}` | Replace its configuration or publish state |
| `DELETE` | `/api/account-settings/{tenantId}/automations/{automationId}` | Delete while preserving history |
| `GET` | `/api/account-settings/{tenantId}/automations/{automationId}/contacts` | List participating contacts |
| `GET` | `/api/account-settings/{tenantId}/automations/{automationId}/execution-logs` | List node-level logs |
| `GET` | `/api/account-settings/{tenantId}/automations/{automationId}/wait-nodes` | Load Wait counts |
| `GET` | `/api/account-settings/{tenantId}/automations/{automationId}/wait-nodes/{nodeKey}/waiting-runs` | List waiting runs |
| `DELETE` | `/api/account-settings/{tenantId}/automations/{automationId}/wait-nodes/{nodeKey}/waiting-runs/{runId}` | Exit one waiting run |

Opportunity create and change responses report whether relevant automations were queued. The event-status endpoint exposes aggregate queued, running, completed, skipped, and failed counts.

The complete request and response schemas are maintained in `apps/backend/docs/openapi.yml`.

## 18. Asynchronous Queue Operations

Opportunity events can use the durable PostgreSQL queue when:

```env
AUTOMATION_ASYNC_EVENTS_ENABLED=true
```

The opportunity transaction commits before automation actions run. Each relevant automation receives an independent dispatch and rollback boundary. The worker uses leases, retry rules for transient failures, and idempotent action/log commits.

The same lease-based run worker claims runs created by Add to workflow. A queued workflow-start log is written in the source transaction and becomes Executed when the target run begins.

Worker configuration, rollout steps, and operational metrics are documented in:

- `apps/backend/docs/automation-event-queue.md`

## 19. Important Limits

- 20 top-level trigger filters
- 100 total action nodes across the complete automation tree
- 20 conditions per If/Else branch
- 20 branches per If/Else configuration, including Default
- 2 to 20 routes per Split, using whole percentages that total 100%
- 3 combined nested If/Else and Split levels
- 20 chained Add to workflow starts
- 20 generated opportunity-event transitions in one causal chain
- 20 field updates in one Update contact fields action
- 10 waiting runs per Wait drawer page
- 160 characters for note titles and task names
- 5,000 characters for note bodies
- 4,000 characters for task descriptions
- 500 characters for task reminder messages
- minute precision for fixed task and Wait date/time inputs

## 20. Support Checklist

When an expected automation does not run, verify:

1. The automation is published.
2. Header changes were saved after the last sidebar edit.
3. The opportunity event type matches the trigger.
4. The opportunity belongs to the configured pipeline.
5. An Opportunity changed event entered the configured destination stage or reached the configured Won/Lost result.
6. The contact matched every trigger filter at event time.
7. A qualifying execution log exists; no log means the opportunity trigger or contact filters did not match.
8. A required formatter output was created before a later node referenced it.
9. A Wait node has not paused the run.
10. The contact or selected referenced configuration still exists and remains active.
11. An Add to workflow target is still published and its queued start row has begun processing.
12. A Go To, Split, or opportunity update was not rejected by cycle protection.

The execution log Details column is the primary source for explaining why a node was queued, skipped, waiting, executed, or failed.


## Service step entered trigger

`SERVICE_STEP_ENTERED` can be created in the automation sidebar by selecting a service,
sub-service and step, then **Entry step**. Contact field, safe custom-field and tag filters can be
combined. Any number of workflows may target the same step. Each workflow retains its selected
sub-service even when several offerings inherit the same source step.

Creating an entry occurrence atomically queues all matching published workflows with exact enrollment
context and a causation key derived from the occurrence ID. Retries cannot duplicate that event, while
revisits create distinct occurrences. Contact field, safe custom-field, and tag conditions use entry-time
values. Disabled/empty drafts and filter mismatches produce no event or action. Action snapshots are
pinned when queued, and existing queue/wait workers execute them with ordinary rollback and audit rules.
There is no replay for already-entered steps when a workflow is published. Completion workflows independently gate progression as described below.

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
