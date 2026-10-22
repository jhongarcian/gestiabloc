# Service Configuration Feature Spec

## Template cutover (Chunk 20)

Service steps and linked Automations replace template configuration. All new enrollments require
configured steps; there is no template picker or fallback. Template builders, routes, runtime models,
and backfill commands have been removed. Existing saved manual follow-ups and historical attribution
remain usable. References to template configuration in the original specification below describe
historical behavior, superseded by [Chunks 19–20](service-automation-transition.md).
See [the deployment guide](../../../apps/backend/docs/service-template-retirement.md) for the required
backup, old-worker shutdown and archival migration order.

## Service hierarchy (implemented in Chunks 3–4)

The catalog has exactly two levels:

- Parent services (`GROUP`), such as Medicare, organize the catalog.
- Sub-services (`OFFERING`), such as Medicare Advantage, belong to one parent in the same tenant.
- Contacts enroll only into active sub-services whose parent is also active.
- Deactivating a parent pauses new enrollments without changing existing enrollment records.
- A parent with sub-services cannot be deleted. Kind and parent are fixed after creation in this phase.

The service list shows parent services and their offering counts. Opening a parent shows editable
name/description/status and a paginated, searchable sub-service list with a Create sub-service action.
Opening a sub-service uses the existing configuration workspace and provides a link back to its parent.
Names retain the existing account-wide uniqueness rule. Searches for a sub-service also find its parent.

Existing flat service records are preserved under an automatically created Existing services group
per tenant. Original IDs, configuration, prices, and enrollment links remain unchanged; an available
suffix is used if that group name is already taken. Billing, checklist, and professional inheritance are implemented below. Steps inheritance and enrollment snapshots are implemented in Chunks 7–8 below.

API additions:

- Service payloads include `kind`, `parentServiceId`, and `parentService` (ID, name, active status).
- Create requests default to `GROUP`; `OFFERING` requires a parent ID.
- List requests accept `kind` and `parentServiceId`. Parent detail responses include `subServiceCount`;
  list items include `_count.subServices`.
- Service option lists default to offerings; `kind=GROUP` requests parent choices explicitly.
- Enrollment rejects a group with `SUB_SERVICE_REQUIRED` and an unavailable offering with `SERVICE_NOT_AVAILABLE`.

## Section inheritance (implemented in Chunks 5–6)

Parent services now expose their billing, checklist, and professional defaults in the configuration
workspace. Each offering independently chooses `INHERIT` or `CUSTOM` for those three whole sections.
New offerings inherit all three by default. The migration retains `CUSTOM` for every existing service
so current configurations remain unchanged.

- Inherited sections display **Inherited from [parent]** and read-only effective values.
- **Customize this section** copies the parent's current effective section into independent local
  settings. Checklist items and professionals receive new IDs; their labels, details, and order are copied.
- **Restore parent settings** switches to current parent defaults and archives local collection records.
  Existing enrolled checklist items and professional assignments retain their original relationships.
- Modes are changed separately from editing values. Direct writes to inherited sections are rejected.
- Parent services always own their defaults and cannot inherit.
- Catalog prices, readiness counts, purchase configuration, and assignment options use resolved sections.

Enrollment locks the parent and offering, resolves configuration, validates the selected professional,
and creates enrolled checklist records within the purchase transaction. Billing snapshots store price,
currency, tax policy, deposit requirements, and installment terms. Existing purchases keep their total,
payment policy, and displayed billing terms after configuration or tenant tax edits. The migration
freezes available billing terms for earlier purchases while retaining recorded totals/currency/policy.
Checklist label and professional attribution snapshots are implemented in Chunk 8 below.

API mode fields are `billingMode`, `checklistMode`, and `professionalsMode`. GET/list/mutation responses
contain effective values and an `inheritance` object with each section's mode and parent source ID.
PATCH mode changes copy/archive records atomically with other submitted changes. A request cannot
change a section's mode and submit values for that same section. Foreign, archived, or parent-owned
IDs cannot be saved into an offering's custom collections.

## Service-owned steps and enrollment snapshots (Chunks 7–8)

Chunk 18 adds **Enrollment updates** to both service-group and sub-service settings. Admins review
exact differences and choose which active service-step enrollments receive current configuration.
Reviews expire after 15 minutes and are rejected if the enrollment, pending work, active-member choices
or source configuration changes. Each selected enrollment applies atomically, one request at a time;
completed/canceled and template enrollments are excluded. Applied reviews retain actor, time and the
comparison in history and the enrollment activity log. Repeating an applied receipt is idempotent.

Entered steps and order remain frozen. Future unentered steps may be added, edited, reordered or
removed unless an owner or unfinished workflow depends on them. Checklist additions start at the
default status without a change event; removals preserve saved records and all activity. Checklist
details with prior work remain frozen. Existing billing, payments, coordinator/professional/owner
assignments, deadlines and waiting actions/schedules remain unchanged. Finished work awaiting payment
cannot receive new unfinished steps. Restore/customize operations create distinct source IDs; matching
never uses labels, and replacing entered source IDs blocks propagation.

New service-step purchases also freeze complete service automation definitions, filters and nested
actions. Future events use those saved definitions until a reviewed application updates them. Older
enrollments without saved definitions retain live behavior until adoption; no history is replayed.

The Steps tab is available for both parent defaults and sub-services. A step has a stable ID,
name, instructions, order, and a positive integer completion timeframe in minutes, hours, or days
(up to ten years). Admins can add, edit, drag, move up/down, or remove a step without a template.
Step collection saves preserve IDs and archive omissions. New offerings inherit Steps by default;
existing offerings retain CUSTOM. Customizing copies the current parent steps into independent IDs,
and restoring parent steps archives local records. Configuration edits never advance an enrollment
or run an automation.

Each purchase captures an internal configuration snapshot containing service identity, section
sources, billing terms, checklist details, professional attribution, step definitions, and the selected
legacy template version when applicable. Enrolled checklist labels, descriptions, required flags, and
order are read from captured columns. Reads no longer append catalog checklist items to a captured
enrollment. Assignment choices use its saved professional list while still excluding archived records
from new assignments. The existing assigned person keeps their captured attribution; explicit
reassignment captures the selected attribution. Legacy records freeze the available details during
migration, preserving their IDs, statuses, timestamps, template runs, and billing snapshots.

When service-owned steps are configured and no legacy template is explicitly requested, enrollment
uses SERVICE_STEPS. It copies the resolved step definitions and enters only the first step. The first
entry uses the actual enrollment creation time; backdating the service's startedAt does not backdate
the step clock. Future steps have no occurrence or deadline until entered. Every entry has an immutable
occurrence number, entry key and entry timestamp, plus its effective deadline, status and resolution history. An idempotent,
enrollment-locked entry primitive preserves earlier entries on a revisit and prevents concurrent
active occurrences. Source IDs are retained as attribution, so archiving configuration does not remove
enrolled definitions or occurrence history.

Enrollment overview and follow-up views display the saved service steps and entry history. Existing
legacy template execution continues for legacy enrollments. Legacy step-mutation APIs reject
SERVICE_STEPS enrollments. Completion, movement, entry-specific deadline overrides and automation
dispatch use the saved occurrences and history described below.

API: POST/PATCH account-settings service accepts `steps` and `stepsMode`. Collection array order is
canonical; new entries omit IDs and saved entries retain IDs. Responses contain effective steps and
Steps inheritance metadata. Enrollment workspace responses expose `workflowKind`, `serviceSteps`
(with occurrences), and a read-only `configurationSnapshot`. The purchase catalog returns no legacy
template choices when service-owned steps are available.

## Enrollment context in Automations (Chunk 9)

Automation events may carry a validated, immutable `serviceContext` containing `contactServiceId`,
`serviceId`, `contactServiceStepId`, `serviceStepId` (the source configuration ID), and
`serviceStepOccurrenceId`. Enrollment-only events leave step and occurrence fields null. An occurrence
requires its saved enrollment step. Queuing and each execution segment validate all IDs against the
same tenant, contact, and enrollment. Missing or mismatched records fail before actions execute;
there is no lookup of an enrollment based only on the contact or service.

Events, runs, node logs, and execution summaries persist the same context without live foreign keys,
so audit attribution survives source deletion. Waits and Add to workflow retain the originating
context. Same-contact events generated by actions inherit it; Create contact starts an unscoped
context for the new contact. Archiving live step configuration does not invalidate a saved step.
Revisits retain their exact original occurrence instead of resolving the current occurrence again.

Execution-log responses, event progress, and waiting-run rows expose nullable `serviceContext`.
Execution logs can be filtered by `contactServiceId` and/or `serviceStepOccurrenceId`; filters remain
tenant scoped and combine with AND. Existing runs and contact-only automations keep null context.
This chunk provides the execution plumbing; service triggers, drafts, and service actions follow.

## Step entry automations (Chunk 10)

Each service-owned step has one `SERVICE_STEP_ENTERED` automation. Configuration creation and saves
ensure a disabled empty draft without replacing an existing draft or its actions. Migrated steps also
receive empty disabled drafts, without dispatching historical entries. Reordering or editing a step
preserves its automation ID. Inherited sub-services use the parent step's draft. Customizing the Steps
section copies definitions into new IDs with independent disabled drafts.

Each Steps row links directly to the existing Automations editor and shows Draft/Published plus its
action count. The editor locks the trigger to the step, supports normal action editing and contact
filters, and requires an action before publishing. An empty disabled draft can still be renamed and
saved. Linked automations cannot be deleted or used as generic Add to workflow targets.

The entry primitive locks the enrollment, creates the occurrence, and queues its published automation
in the same transaction. The event carries the exact enrollment, offering, saved/source step, and entry
occurrence context. Inherited steps retain the offering ID as the enrolled service. Retrying an entry
key never dispatches again; revisiting creates another occurrence and its own idempotency key. Disabled,
empty, or nonmatching workflows create no event. Queued action/condition matching is pinned at entry,
so later definition edits leave committed work unchanged. Editing configuration never replays an entry.
Existing automation workers process entry events, waits, logs, and failures. Completion, advancement,
and public movement controls remain in Chunks 11–13.

## 1. Scope

This spec documents the account-settings service configuration experience for:

- `/app/{slug}/account-settings/services`
- `/app/{slug}/account-settings/services/{serviceId}`
- `/app/{slug}/account-settings/services/{serviceId}/follow-up-templates/*`

This spec is focused on the admin-facing `Service` configuration surface.

It should describe:

- how a tenant admin configures a service
- how tenant billing settings affect service billing
- how service readiness is shown
- how billing and partial payment rules are configured
- how checklist, follow-up templates, and professionals are organized

This spec does not cover:

- the public `/app/{slug}/services` registry table except where it consumes configured service data
- contact service enrollment execution except where the configuration directly feeds the purchase flow

## 2. Core Product Idea

The account-settings service configuration area is the source of truth for what can be sold and enrolled as a service.

Each configured service should define:

- service identity
- price and billing rules
- tax behavior
- whether the service is active
- checklist requirements
- follow-up templates
- professionals that can deliver the service

This configuration powers:

- the `/app/{slug}/services` table
- the create transaction dialog
- contact service enrollments
- enrolled checklist items
- enrolled follow-up steps
- available assigned professionals

## 3. Main Routes

### Service list

Route:

- `/app/{slug}/account-settings/services`

Purpose:

- show the tenant service catalog
- create a new service
- open one service configuration screen

### Service details

Route:

- `/app/{slug}/account-settings/services/{serviceId}`

Current implementation entry:

- [`service-details-panel-client.tsx`](gestiabloc/apps/react-ui/app/(tenants)/app/[tenantSlug]/account-settings/services/[serviceId]/_components/service-details-panel-client.tsx)

Actual interactive panel:

- [`service-details-panel.tsx`](gestiabloc/apps/react-ui/app/(tenants)/app/[tenantSlug]/account-settings/_components/service-details-panel.tsx)

Purpose:

- configure one service end to end
- expose readiness state
- guide the admin through missing configuration
- provide access to follow-up template editing

## 4. Data Model

The account-settings service configuration view is backed by:

- tenant billing settings in the account area
- `Service`
- `ServiceChecklistItem`
- `ServiceFollowUpTemplate`
- `ServiceFollowUpTemplateStep`
- `ServiceProfessional`

Important downstream consumers:

- `ContactService`
- billing-plan records derived from a sold service
- `ContactServiceChecklistItem`
- `ContactServiceFollowUpStep`

## 4A. Tenant Billing Settings Dependency

Service billing configuration depends on tenant-level billing settings configured in the account area.

Target account settings location:

- `/app/{slug}/account-settings/account`

The account page should allow the tenant to configure:

- whether taxes are enabled
- whether the tenant is a no-tax account
- the default tax percentage
- an optional tax label

Recommended first version:

- `Taxes enabled`
- `Tax percentage`
- `Tax label`

No-tax account behavior:

- if taxes are disabled for the tenant, service sales should not apply tax
- the account configuration should clearly support a no-tax state

Service-level taxability should still be configurable independently through `Tax Exempt`

## 4B. Tax Resolution Model

Tax should be resolved using both tenant billing settings and service configuration.

Tax application rules:

- if tenant taxes are disabled, no tax is applied
- if tenant taxes are enabled and the service is marked tax exempt, no tax is applied
- if tenant taxes are enabled and the service is not tax exempt, use the tenant default tax percentage

This resolved tax must be snapshotted at the time the service is sold.

## 5. Service Details Screen Goal

The service details screen should feel like a guided configuration workspace, not one long stacked form.

The target structure is:

1. header and configuration progress cards
2. tabbed workspace
3. sticky save action

The top of the screen should immediately answer:

- is this service ready to be sold?
- what is still missing?
- which configuration area needs attention?

## 6. Header

The service details page should start with a strong header section.

### Header content

- service name
- short support text describing what this screen configures
- complete or incomplete overall status
- delete action

### Overall status behavior

- If all required configuration areas are complete, show a success treatment
- If one or more required configuration areas are incomplete, show an alert treatment
- The overall incomplete state should use a red family treatment rather than amber

Recommended incomplete treatment:

- soft red badge or pill
- red icon accent
- copy such as `Configuration incomplete`

Recommended complete treatment:

- soft green badge or pill
- success icon accent
- copy such as `Ready`

## 7. Configuration Progress Cards

Configuration progress should be moved into cards near the top of the screen.

It should not live as a separate bottom section.

### Card placement

- directly below the header
- above the tabbed content

### Required cards

- `Overview`
- `Checklists`
- `Follow-Up Templates`
- `Professionals`

### Card behavior

Each card should show:

- area name
- a compact count or readiness summary
- completion state
- a visual status light or accent

### Incomplete card treatment

If a configuration area is incomplete:

- the card should use a light red background or border treatment
- the status light or accent should be red
- the supporting copy should explain what is missing

Examples:

- `Overview`: missing billing rules or invalid payment setup
- `Checklists`: no checklist items configured when checklist is expected to be mandatory for service readiness
- `Follow-Up Templates`: no published or usable template configured
- `Professionals`: no professional available for the service

### Complete card treatment

If a configuration area is complete:

- the card should use a light green treatment
- the status light or accent should be green

### Progress rules

The configuration cards are the primary readiness summary on the page.

They should replace the current bottom `Configuration Progress` section.

## 8. Tabbed Workspace

The service details screen should display the main configuration areas in tabs.

Required tabs:

- `Overview`
- `Checklists`
- `Follow-Up Templates`
- `Professionals`

The tabbed layout should make the screen easier to scan and reduce perceived form length.

## 9. Overview Tab

The `Overview` tab is the home for service identity, activation, and billing configuration.

### Overview tab sections

- service identity
- pricing
- partial payment rules
- activation state

### Fields

- `Service Name`
- `Description`
- `Base Price`
- `Currency`
- `Status`
- `Tax Exempt`
- `Allow Partial Payments`
- `Minimum Deposit`
- `Number of Installments`
- `Installment Frequency`

## 10. Payment Configuration Model

The billing model should remain simple and understandable for admins and for users creating transactions.

### Required behavior

The admin should be able to:

- enable or disable partial payments
- set a minimum deposit
- choose how many future installments the service is intended to be split into
- choose the installment frequency
- mark a service as tax exempt

Example:

- service price = `100`
- tenant tax = `10%`
- service is taxable
- partial payments enabled
- number of installments = `4`
- frequency = `MONTHLY`

The UI should communicate this as:

- `Total with tax: 110.00`
- `4 monthly installments`
- `20.00 minimum deposit`
- `20.00 per installment after the first payment` when the first payment is `30.00`

### Admin mental model

The admin is not configuring a complex financing engine.

The admin is configuring a simple payment plan summary for the service:

- whether partial payments are allowed
- what the minimum upfront deposit is
- how many future installments the amount is expected to be split into
- how frequently those installments are due
- whether tax should apply to the service

### Required fields

#### Allow Partial Payments

- boolean toggle

#### Minimum Deposit

- currency value
- same concept as the current minimum partial payment field
- only editable when partial payments are enabled

#### Number of Installments

- integer field or bounded select
- only editable when partial payments are enabled
- must be at least `2` if partial payments are enabled

Important semantic rule:

- installment count means the number of scheduled future installments after the first payment made during sale

#### Installment Frequency

- required when partial payments are enabled
- should be a constrained select

Supported values:

- `WEEKLY`
- `BIWEEKLY`
- `MONTHLY`

#### Tax Exempt

- boolean toggle
- if enabled, no tax should be applied to this service even if tenant tax settings are active

### Derived display

When partial payments are enabled, the overview tab should show a simple human-readable summary:

- `4 monthly installments`
- `Minimum deposit: $20.00`
- `Tax: 10%` when tax applies
- `Tax exempt` when the service is marked tax exempt

The UI should also show an easy-to-understand plan preview:

- subtotal
- tax amount
- total
- number of installments
- frequency
- a simple per-installment estimate

### Validation rules

- base price must be a valid positive currency amount
- minimum deposit must be a valid currency amount when partial payments are enabled
- minimum deposit cannot exceed the base price
- number of installments must be a valid integer greater than or equal to `2` when partial payments are enabled
- installment frequency must be selected when partial payments are enabled
- if partial payments are disabled:
  - minimum deposit should be cleared or ignored
  - number of installments should be cleared or ignored
  - installment frequency should be cleared or ignored
- tax exempt is independent from partial payment rules

### Rounding behavior

If the final remaining balance does not divide evenly by the number of installments:

- the UI should still show a simple installment summary
- backend rounding should be cent-safe
- the spec should prefer keeping any remainder handling deterministic and explicit

Example:

- total = `110.00`
- first payment = `20.00`
- remaining balance = `90.00`
- installments = `4`

Possible presentation:

- `4 installments of approximately $22.50`

Implementation note:

- exact cent remainder distribution can be finalized during implementation
- the important requirement is that the admin can understand the plan easily

## 10A. Full Payoff Rule

Even when a service is configured for partial payments and installments, staff or the contact should be able to pay the full remaining amount at any time.

Implications:

- installment plans do not block full payoff
- the billing model must allow a payment that satisfies all remaining open balance
- follow-up or checklist state is not tied to payoff behavior
- the service price itself cannot be overridden at sale time

## 10B. Fixed Schedule Rule

Installment dates are fixed by service rules.

This means:

- installment frequency is defined on the service
- the generated installment schedule should be predictable at sale time
- equal installments are the only supported structure in this spec
- custom schedules are out of scope

## 11. Overview Completion Rules

The `Overview` card should be considered complete when:

- service name exists
- base price is valid
- currency is valid
- service status is set
- tax exempt state is explicitly configurable
- if partial payments are enabled:
  - minimum deposit is valid
  - number of installments is valid
  - installment frequency is valid

The `Overview` card should be considered incomplete when any of the above is missing or invalid.

## 12. Checklists Tab

The `Checklists` tab should contain the checklist configuration tools.

### Purpose

- define service requirements that will be copied into contact-service checklist items during purchase

### Tab contents

- checklist intro text
- add checklist item action
- sortable checklist item list
- edit checklist item dialog

### Checklist item fields

- label
- description
- required or optional
- sort order

### Checklist behaviors

- drag to reorder
- inline summary of required vs optional state
- create
- edit
- delete
- persist order

### Completion rule

The `Checklists` progress card should define completion according to product policy.

Recommended rule:

- complete when at least one checklist item exists

If the product later decides checklist is optional for some services, the completion logic can evolve, but the progress card should still explain the reason.

## 13. Follow-Up Templates Tab

The `Follow-Up Templates` tab should contain the follow-up template list for this service.

### Purpose

- define which follow-up flows can be enrolled when the service is purchased

### Tab contents

- follow-up templates table
- action to add a new template
- row click navigation to template builder route
- empty state when there are no templates

### Table columns

- `#`
- `Template`
- `Nodes`
- `Edges`

### Behaviors

- rows should be clickable
- keyboard accessible row navigation should be preserved
- add-template action should route to the new template builder page
- empty state should explain that a template is needed to drive follow-up execution

### Completion rule

The `Follow-Up Templates` card should be complete when:

- there is at least one usable follow-up template for the service

Preferred usability rule:

- at least one template exists and is usable for enrollment

## 14. Professionals Tab

The `Professionals` tab should contain the service professional management interface.

### Purpose

- configure the professionals who can deliver this service
- provide options for assigned professional in the transaction flow

### Tab contents

- add professional action
- sortable professionals table
- professional create and edit dialog
- empty state

### Professional types

- `INTERNAL_USER`
- `EXTERNAL`

### Internal professional fields

- user
- optional notes

### External professional fields

- external professional name
- external contact
- optional notes

### Table columns

- drag handle
- type
- name
- contact number or contact detail

### Behaviors

- drag to reorder
- click row to edit
- create
- edit
- delete
- persist order

### Completion rule

The `Professionals` card should be complete when:

- at least one professional is configured for the service

## 15. Tab Design Rules

### General

- tabs should reduce visual overload compared with one long vertical page
- only the active tab content should dominate the screen
- tab labels should be short and obvious

### Navigation behavior

- the current tab should be obvious
- switching tabs should not discard unsaved local edits unexpectedly
- save behavior should remain understandable across tabs

### Mobile behavior

- tabs should remain usable on smaller screens
- card and tab density should not force horizontal scrolling

## 16. Save Behavior

The page should retain a sticky save action.

### Save expectations

- save remains globally available from the service details screen
- tab switching should not hide the save affordance
- save should persist all modified sections safely

### Error handling expectations

- backend validation errors should surface clearly
- section-specific failures should be understandable
- partial payment validation errors should reference the exact field at fault

## 17. Relationship To Transaction Flow

This configuration screen directly powers the create transaction dialog documented in [`service-managment.md`](/Users/jhongarcian/coding/gestiabloc/specs/features/services/service-managment.md).

Specifically:

- `Overview` provides price, tax, and payment-plan rules
- `Checklists` provides checklist items copied to `ContactServiceChecklistItem`
- `Follow-Up Templates` provides selectable templates in the `Follow up` step
- `Professionals` provides assigned-professional choices in the `Service` step

## 18. Transaction Flow Implications

Because of the current transaction design:

- service selection needs a configured service
- professional assignment needs configured professionals
- follow-up coordination only makes sense when follow-up templates exist
- checklist review depends on configured checklist items
- payment step depends on the billing, tax, and installment rules from the overview tab

## 19. Partial Payment Plan Implications For Purchase Flow

The transaction flow should remain easy to understand for staff users.

For that reason, the configuration screen should express partial payments in a way that can be reused downstream.

Recommended downstream display examples:

- `Full only`
- `Partial payments allowed`
- `Tax exempt`
- `Tax 10%`
- `4 monthly installments`
- `Minimum deposit $20.00`
- `Pay full at any time`

This should align with:

- service list table
- service transaction flow
- future detail screens if installment guidance is shown there

## 20. Completion Summary Rules

The top summary cards should be the canonical readiness view.

Recommended completeness model:

- service is fully ready when:
  - overview is complete
  - checklists are complete
  - follow-up templates are complete
  - professionals are complete

If any required area is incomplete:

- overall service state = incomplete
- missing areas must show red card treatment at the top

## 21. Non-Goals

This spec does not require:

- implementing installment collection logic across multiple payment records yet
- redesigning the follow-up template builder itself
- replacing the dedicated follow-up template builder route

The current goal is the service configuration experience and the data shape it should express.

## 22. Implementation Guidance

When implementation starts, the work should likely be split into:

1. tabbed layout refactor for the service details screen
2. move progress status into top cards with red/green completion states
3. add tenant billing settings in account settings
4. overview billing model update to support tax exemption, installment count, and frequency
5. backend payload and schema changes for the new payment-plan fields
6. downstream usage updates in service table and transaction flow if needed

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

## Enrollment actions and owners (Chunk 16)

Automation Service actions resolve saved source IDs against the exact triggering enrollment. No
missing step/checklist snapshot is created. Owners belong to enrolled step definitions and survive
revisits; they are independent of the enrollment coordinator and assigned professional. Owner and
coordinator controls accept active tenant members or Unassigned. Workspace responses and the
follow-up queue expose the owner, and queue assignee filtering uses it. Archived professionals may
remain assigned, while new assignments require an eligible saved professional. Archived checklist
history remains usable. Completion/payment states remain derived. See the automation queue guide
for checkpoint execution, isolation, audit attribution and migration ordering.
