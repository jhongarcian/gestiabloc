Status: Chunks 1–13 implemented. Chunk 14 is next.

# Build the transition in small, reviewable chunks

Keep each chunk focused on one behavior, include its relevant tests, and finish its acceptance check before moving on. **Next: Chunk 14.**

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

**Done when:** Changing one contact’s step to 20 days leaves other contacts and later steps unchanged.

### 15. Add urgency to the follow-up queue
Show remaining time, overdue status, and a warning during the final 25% of the effective timeframe. Separate scheduled work from actionable work.

**Done when:** Deadline changes immediately update ordering and urgency; unentered steps never appear overdue.

### 16. Add service actions
Expose movement, completion, skipping, scheduling, step-owner assignment, coordinator assignment, professional assignment, checklist updates, and valid service-status changes.

**Done when:** These actions work through the existing editor with tenant validation, enrollment isolation, and readable logs.

### 17. Add the remaining service triggers
Add enrollment, service-status, checklist-item, and payment-change triggers. Include initial payments, payment edits, and removals.

**Done when:** Actual changes produce one event; unchanged saves produce none. Finishing unpaid work still results in Pending payment.

## Phase 4 — Make changes manageable and replace templates

### 18. Preview and apply configuration changes
First build the comparison preview; then add selective application to active enrollments. Include saved service-automation definitions in configuration snapshots.

Preserve completed work, billing, assignments, and manual scheduling overrides. Reject stale previews and changes that invalidate current or waiting work.

**Done when:** Admins can review exactly what will change and update selected enrollments safely.

### 19. Connect the complete interface
Replace template selection with sub-service selection. Finish the Steps workspace, linked automation summaries, contact controls, and service/sub-service filters.

Update transactions, service-fit suggestions, appointment pickers, and reports.

**Done when:** The complete Medicare workflow can be configured and operated without opening a template screen.

### 20. Cut over and remove templates
After the new flow passes end-to-end checks, remove template models, builders, routes, backfill commands, and the separate follow-up executor. Update documentation and OpenAPI.

**Done when:** Backend tests, both app type checks, frontend lint, and production build pass; existing unrelated automations still work.

**First milestone:** Complete Chunks 1–4. This fixes current data-loss risks and makes the Medicare/sub-service structure visible before taking on the automation engine.

