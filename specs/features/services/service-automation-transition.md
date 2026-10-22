Status: Chunks 1–18 implemented. Chunk 19 is next.

# Build the transition in small, reviewable chunks

Keep each chunk focused on one behavior, include its relevant tests, and finish its acceptance check before moving on. **Next: Chunk 19.**

The agreed direction stays the same: parent services group enrollable sub-services; configuration inherits by section; Automations handles actions; active enrollments receive reviewed updates. No customer-data backfill is needed.

## Phase 1 — Make service configuration safe

### 1. Preserve checklist items when saving
Replace delete-and-recreate behavior with updates using stable IDs. Archive removed items that have enrollment history.

**Done when:** Editing or reordering a checklist preserves existing enrollment statuses and history.

### 2. Preserve professional assignments when saving
Update professionals by ID and archive referenced professionals instead of deleting them.

**Done when:** Editing a professional does not clear existing assignments.

### 3. Add parent services and sub-services
Add the database relationship and APIs. Allow two levels; only sub-services can receive enrollments.

**Done when:** Medicare can contain Advantage, Part A, and Part B, and the API rejects enrollment into Medicare itself.

### 4. Show the service hierarchy
Update service configuration navigation to create and open groups and sub-services.

**Done when:** An admin can navigate from Medicare to each offering and back.

### 5. Add billing inheritance
Allow a sub-service to inherit its parent’s Billing section or customize the whole section. Resolve and snapshot billing terms when enrolling.

**Done when:** Changing parent pricing affects new inherited enrollments without changing existing purchases.

### 6. Add checklist and professional inheritance
Give each section its own **Inherit**, **Customize**, and **Restore defaults** controls.

**Done when:** Parent changes reach inheriting sub-services while customized sections remain independent.

## Phase 2 — Establish steps and automation execution

### 7. Create service-owned steps
Add stable step records with instructions, order, and a completion timeframe in minutes, hours, or days. Support Steps-section inheritance and reordering.

**Done when:** Steps can be edited without a template, and reordering does not move enrolled contacts.

### 8. Snapshot enrollment configuration
Store the resolved setup for each enrollment, including step definitions and checklist details. Add step-entry occurrences to preserve history when revisiting steps.

**Done when:** Later configuration edits leave an existing enrollment unchanged.

### 9. Add enrollment context to Automations
Carry enrollment, sub-service, step, and occurrence identifiers through events, runs, logs, and waits.

**Done when:** An automation targets the correct enrollment when one contact has several services.

Implemented: nullable immutable `serviceContext` on events, runs, node logs, and execution summaries.
Context contains the enrollment, sub-service, saved step, source step, and entry occurrence IDs.
Queueing and every resumed segment validate tenant/contact/enrollment ownership. Context survives
waits and chained workflows; execution logs and waiting-run APIs return it. Ordinary contact events
remain unscoped. Service triggers and linked drafts remain in Chunk 10.

### 10. Implement “Step entered”
Add the trigger and create a disabled entry-automation draft for each step. Link it to the existing Automations editor.

**Done when:** Entering a step executes its enabled entry workflow once; empty drafts remain disabled.

Implemented: every step owns a disabled entry draft linked to the existing Automations editor.
New entry occurrences queue their matching published workflow atomically with the entry. Retries
reuse the occurrence; revisits get independent events. Queued actions are pinned and tenant scoped.
The automation sidebar now supports selecting service, sub-service, step and entry/completion event.
Multiple workflows can target each step. Triggers can be reassigned or deleted; occurrence context is
required to execute them. Empty drafts cannot publish.

### 11. Implement completion and default advancement
Add the completion trigger and linked draft. Advance immediately without an enabled completion workflow; otherwise advance after its actions finish.

**Implemented:** Each step also owns a disabled completion draft. Staff can complete an active enrolled
occurrence. Enrollment locking and saved progression states make repeated requests and worker retries
idempotent. All matching completion workflows must succeed to release the next saved step and its entry trigger; failed or
stopped workflows visibly pause progression. Waits retain the gate until the final segment succeeds.
The final step completes paid enrollments or waits for payment. Regression coverage includes concurrent
requests, pinned actions, waits, failures, exits, tenant isolation, configuration edits, branches and payment reconciliation.

**Done when:** Completing a step advances exactly once, and workflow failures pause progression visibly.

### 12. Support waits and bypass
Connect completion workflows to existing duration/fixed-date waits. Add **Continue now** and **Reschedule** controls.

**Implemented:** Waiting completion workflows show their current resume time, **Continue now**, and
**Reschedule** in the enrollment. Staff can choose a duration or a future date/time in the tenant's
time zone. Continue now releases only the current wait; the remaining pinned actions still run before
advancement. Each request identifies the exact run, wait execution and displayed schedule. Worker
claim fencing and row locks prevent stale staff requests and stale workers from replaying actions or
altering a later wait. Schedule changes retain the actor, old/new times and service context in the
execution history. Regression coverage includes claimed/executing workers, late failure reporting,
multiple waits, fixed dates, branches, permissions, isolation and transaction rollback.

**Done when:** Staff can bypass a wait without duplicate actions, including when a worker is attempting to resume it.

### 13. Support manual step movement
Add **Move to step**, skip, and revisit behavior. Supersede obsolete progression work and record skipped steps and movement reasons.

**Implemented:** Move and skip controls require a reason and preserve earlier entries. Forward moves
record skipped steps; revisits create a fresh entry, deadline and matching destination triggers.
Enrollment locks and exact request/source identifiers prevent duplicate or stale moves. Queued and
waiting work for obsolete entries is superseded, including scoped child workflows. Executing workers
finish before movement revalidates its source. Movement history records staff, time, reason and saved
source/destination titles. All changes roll back together. Final skips retain payment requirements,
and revisiting pending-payment work cannot be completed by a later payment while a step is active.

**Done when:** Forward and backward moves preserve history, fire destination entry triggers, and prevent stale workers from moving the enrollment again.

## Phase 3 — Complete scheduling and service automation

### 14. Add contact-specific scheduling
Start each step’s timeframe on entry. Allow staff to change its deadline using a duration or date/time and restore the default.

**Implemented:** Every entry freezes its default deadline. Staff can set a duration from entry or a
fixed date/time in the tenant's time zone and restore that saved default. Overrides and audit history
belong to one occurrence; other contacts, later steps, service configuration and automation waits are
unchanged. Completion, skips and moves preserve earlier deadlines, while revisits start a new default.
Enrollment locks, revision checks and idempotent requests reject stale edits. Regression coverage
includes 20-day isolation, configuration edits/archival, offset dates, restoration, revisits, automation
waits, permissions, concurrent edits/movement, rollback and exact migration backfill.

**Done when:** Changing one contact’s step to 20 days leaves other contacts and later steps unchanged.

### 15. Add urgency to the follow-up queue
Show remaining time, overdue status, and a warning during the final 25% of the effective timeframe. Separate scheduled work from actionable work.

**Implemented:** The follow-up queue includes service-owned steps alongside existing template work.
Latest saved occurrences supply actionable deadlines; completion automation gates are Scheduled and
paused progression is Needs attention. Finished work remains separate, including unpaid enrollments.
Remaining time, overdue badges and a final-25% warning use the effective entry-to-deadline timeframe.
Most urgent ordering and all date/queue filters apply before pagination. Overrides/restores are read
on every request; focus/visibility refresh and a 30-second visible-page refresh keep the queue current.
Revisits use their fresh entry, superseded history cannot determine urgency, and unentered steps never
inherit a deadline. Regression checks cover boundaries, cross-page reorder, waits, paused progression,
legacy work, moves, revisits, completion, cancellation, filters and tenant access.

**Done when:** Deadline changes immediately update ordering and urgency; unentered steps never appear overdue.

### 16. Add service actions
Expose movement, completion, skipping, scheduling, step-owner assignment, coordinator assignment, professional assignment, checklist updates, and valid service-status changes.

**Implemented:** The builder has all nine Service actions, with typed `serviceConfig` preserved through
saves, reloads and pinned action snapshots. Step-entry/completion triggers supply the exact enrollment;
manual bulk enrollment without that context cannot mutate a service. Source IDs resolve only against
saved enrollment records. Shared triggers offer the intersection of eligible sub-service choices.
Move, Skip, Complete and cancellation end the path in validation, canvas and runtime.

Shared enrollment-first transaction helpers serve manual and automated controls. Saved step owners
survive revisits and feed workspace/queue assignment filters. Coordinators support unfinished
service-owned steps. Archived checklist history remains usable; archived professionals can remain
assigned but cannot receive new assignments. Status changes respect unfinished work and derived
payment/completion rules. Audits record the automation, run, node, enrollment, occurrence and values
without inventing a human actor.

Event and resumed workers share atomic PostgreSQL admission: 4 global, 2 per tenant by default,
validated against pool capacity with four reserved connections. Durable leases, contact serialization,
tenant rotation, fencing and per-run/node results prevent overlapping mutations and duplicate history.
Service-context runs checkpoint after each service mutation or 10 nodes / 500 ms, preserving cursor,
variables, routing, logs and outbox together. Queued continuations retain completion gates. Retries use
5/30/120 seconds; chain depth and repeated-transition guards stop loops across different workflows.

Regression, browser and 5,000-job verification is documented in
[`service-actions-verification.md`](../../../apps/backend/docs/service-actions-verification.md).
The additive service-actions and fairness migrations must precede deployment. No new bulk-selection
interface, Chunk 17 triggers or Chunk 18 propagation was introduced.

**Done when:** These actions work through the existing editor with tenant validation, enrollment isolation, and readable logs.

### 17. Add the remaining service triggers
Implemented enrollment-created, service-status, checklist-status and payment-change triggers in the
builder. Select a service and one or all sub-services. Shared selectors use stable source IDs common
to eligible offerings. Contact fields, safe custom fields and tags match event-time values. Only
SERVICE_STEPS enrollments participate; there is no historical replay or new completion gate.

Enrollment-only context supports coordinator, professional, checklist and service-status actions.
Step actions retain occurrence context; service workflows cannot be generic workflow targets or
contextless manual bulk starts. Saved archived checklist trigger references remain usable.

Enrollment-first transactions persist changes, history, payment reconciliation and revision-keyed
immutable events together. Initial positive payments count as Added; edits compare amount, date,
method and note; removals retain the deleted snapshot. No-op saves produce no event or timestamp
rewrite. Zero-match events finish without background work. Actual service status changes are emitted
from cancellation, movement, completion and payments. Unfinished work cannot be completed by payment;
finished unpaid work stays Pending payment. Generated events preserve their causal chain.

Execution reuses the bounded queue and checkpoint rules from Chunk 16. Verification is recorded in
`apps/backend/docs/service-triggers-verification.md`.

**Done when:** Actual changes produce one event of each applicable type; unchanged saves produce none.
Finishing unpaid work still results in Pending payment.

## Phase 4 — Make changes manageable and replace templates

### 18. Preview and apply configuration changes
First build the comparison preview; then add selective application to active enrollments. Include saved service-automation definitions in configuration snapshots.

Preserve completed work, billing, assignments, and manual scheduling overrides. Reject stale previews and changes that invalidate current or waiting work.

**Implemented:** Service and sub-service configuration now includes an Enrollment updates tab. Admins
review saved versus proposed steps, checklist, professional options and complete service workflow
definitions, then select individual active enrollments. Pages contain at most 20 enrollments; preview
and apply requests run one enrollment at a time. Each apply is an enrollment-locked transaction with
a durable, 15-minute review receipt, exact state/configuration digests, idempotent retries and audit history.

Entered step definitions and their order are protected. Only unentered future steps may change;
owned future steps and targets of unfinished workflows cannot be removed. Checklist records are never
deleted, and items with activity retain their details. Billing, payments, existing assignments, manual
deadlines and queued/waiting actions stay intact. Finished work awaiting payment cannot gain new steps.
Stale, expired, incompatible and cross-tenant previews cannot apply.

New service-step enrollments capture complete workflow definitions, filters and nested actions. Later
events use those saved definitions, including after library deletion. Existing enrollments without this
snapshot retain compatibility behavior until explicitly reviewed; there is no replay or backfill.
Apply `20261021130000_service_configuration_review` before deploying. Verification is recorded in
`apps/backend/docs/service-configuration-review-verification.md`.

**Done when:** Admins can review exactly what will change and update selected enrollments safely.

### 19. Connect the complete interface
Replace template selection with sub-service selection. Finish the Steps workspace, linked automation summaries, contact controls, and service/sub-service filters.

Update transactions, service-fit suggestions, appointment pickers, and reports.

**Implemented:** New enrollment dialogs choose a service and sub-service, review effective steps and
linked entry/completion automations, and create service-step work explicitly. Missing steps block new
enrollment instead of falling back to a template. Public catalog access supports ordinary tenant members.
The settings Steps workspace links to existing workflows and creates additional automations with the
service, sub-service, step and event preselected. Template setup is removed from the normal settings navigation.

Contact summaries and the enrollment Steps workspace use saved definitions, occurrence history,
movement bypasses, owners and deadlines. Service/sub-service filters scope the catalog, follow-up queue,
enrollments, transactions and their financial totals. Service-fit suggestions and calendar selections show
parent/sub-service identity. Historical inactive services remain available in report filters.

Existing template enrollment history and compatibility APIs remain for Chunk 20. No database migration,
queue policy change or automatic conversion is introduced. Verification is recorded in
`apps/backend/docs/service-interface-verification.md`.

**Done when:** The complete Medicare workflow can be configured and operated without opening a template screen.

### 20. Cut over and remove templates
After the new flow passes end-to-end checks, remove template models, builders, routes, backfill commands, and the separate follow-up executor. Update documentation and OpenAPI.

**Done when:** Backend tests, both app type checks, frontend lint, and production build pass; existing unrelated automations still work.

**First milestone:** Complete Chunks 1–4. This fixes current data-loss risks and makes the Medicare/sub-service structure visible before taking on the automation engine.

