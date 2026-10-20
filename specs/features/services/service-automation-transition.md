Status: Chunks 1–8 implemented. Chunk 9 is next.

# Build the transition in small, reviewable chunks

Keep each chunk focused on one behavior, include its relevant tests, and finish its acceptance check before moving on. **Next: Chunk 9.**

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

### 10. Implement “Step entered”
Add the trigger and create a disabled entry-automation draft for each step. Link it to the existing Automations editor.

**Done when:** Entering a step executes its enabled entry workflow once; empty drafts remain disabled.

### 11. Implement completion and default advancement
Add the completion trigger and linked draft. Advance immediately without an enabled completion workflow; otherwise advance after its actions finish.

**Done when:** Completing a step advances exactly once, and workflow failures pause progression visibly.

### 12. Support waits and bypass
Connect completion workflows to existing duration/fixed-date waits. Add **Continue now** and **Reschedule** controls.

**Done when:** Staff can bypass a wait without duplicate actions, including when a worker is attempting to resume it.

### 13. Support manual step movement
Add **Move to step**, skip, and revisit behavior. Supersede obsolete progression work and record skipped steps and movement reasons.

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

