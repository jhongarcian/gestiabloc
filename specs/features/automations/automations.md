# Automations

## 1. Purpose

Automations turn opportunity events into repeatable work on a contact.

An automation defines:

- the opportunity event that starts evaluation
- the pipeline and optional stage that the event must match
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
3. The trigger stage and contact filters are evaluated.
4. A matching automation creates an independent run for that contact.
5. Actions execute in order until the run completes, exits, fails, or reaches a Wait action.
6. Every trigger and action result is recorded in the execution logs.

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

### Opportunity enters stage

Runs when an existing opportunity moves into the configured stage in the configured pipeline.

The destination stage activates the trigger. A separate “from stage” value is not required.

### Trigger configuration

The first graph node may be unconfigured. Selecting it opens the trigger sidebar.

The trigger sidebar contains:

- automation name
- trigger type
- pipeline
- destination stage when using Opportunity enters stage
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

- trigger or stage mismatch: trigger and actions are skipped
- matching trigger with failed filters: trigger is recorded as executed and actions are skipped
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

Creating an opportunity queues an Opportunity created event. Changing an existing opportunity's stage queues an Opportunity enters stage event. Value-only and outcome-only changes do not create another opportunity event. A completely unchanged opportunity is recorded as a successful no-op.

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

Opportunity create and stage-change responses report whether relevant automations were queued. The event-status endpoint exposes aggregate queued, running, completed, skipped, and failed counts.

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
5. A stage-change event entered the configured destination stage.
6. The contact matched every trigger filter at event time.
7. Execution logs do not show Queued, Waiting, Skipped, or Failed nodes.
8. A required formatter output was created before a later node referenced it.
9. A Wait node has not paused the run.
10. The contact or selected referenced configuration still exists and remains active.
11. An Add to workflow target is still published and its queued start row has begun processing.
12. A Go To, Split, or opportunity update was not rejected by cycle protection.

The execution log Details column is the primary source for explaining why a node was queued, skipped, waiting, executed, or failed.
