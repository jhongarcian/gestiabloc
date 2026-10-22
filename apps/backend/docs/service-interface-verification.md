# Chunk 19 — Connected service interface

Verified with a disposable PostgreSQL 14 database and a local production UI preview.

## Delivered

- All three new-enrollment entrypoints select a service/sub-service and review effective steps,
  instructions, linked entry/completion workflows, checklist, professionals and billing. They submit
  explicit `SERVICE_STEPS` context; missing steps block enrollment rather than selecting a template.
- A paginated, member-readable catalog resolves inherited configuration and excludes automations
  scoped to other sub-services. Historical inactive offerings remain available to report filters.
- The settings Steps workspace links to workflow editors and seeds additional entry/completion
  automations with the selected service, sub-service and stable step ID. Template setup is hidden
  from normal settings navigation; readiness requires steps.
- Enrollment registers identify service-step workflows, and workspace/contact summaries use saved
  steps, occurrence history, movement bypasses and revisits. Owners, deadlines, completion, movement,
  checklist and coordinator controls remain connected to the exact enrollment.
- Service/sub-service filters scope catalog cards, transactions and their financial summaries,
  enrollments and the follow-up queue before pagination. Enrollment activity includes service-step
  entries, movements and deadline changes. Recommendations and calendar pickers show parent identity.
- New appointment selections require an active offering under an active parent. Existing unchanged
  appointment selections can retain inactive historical services.

## Verification

- Backend: **524 passed, zero failed or skipped**; frontend: **126 passed, zero failed**.
- Both app type checks and production builds pass. Frontend lint has zero errors and six existing
  warnings in subscription-dashboard/date-input.
- OpenAPI parses and all **1,131** local references resolve.
- New regressions exercise inherited public configuration for ordinary members, scoped automation
  summaries, active/historical options, explicit enrollment initialization, missing-step rollback,
  template-only readiness, contact badges, appointment hierarchy validation, parent/offering filter
  intersections and financial totals, saved progress/history, bypasses/revisits and activity ordering.
- Existing legacy enrollment, event, bounded queue, retry, checkpoint, snapshot and configuration
  review regressions remain green.

## Browser walkthrough

Using Medicare and Medicare Advantage in the disposable demo:

1. Selected a parent and sub-service in the catalog enrollment wizard, reviewed saved workflow and
   checklist summaries, and created an enrollment with no initial payment or template selection.
2. Opened its Steps workspace, assigned Alex Coordinator as the step owner, completed Review
   documents and verified the second saved step became current while the owner/history remained.
3. Verified the contact shows **1 of 2 steps finished / 50%**, and Open steps returns to the exact
   enrollment. The final register shows **Service steps** in its Workflow column.
4. Applied the parent filter and confirmed the register changed from three rows to the two matching
   enrollments. API regressions cover matching transaction/queue counts and report totals.
5. Opened Add entry automation from the inherited Steps workspace and verified Medicare, Medicare
   Advantage, Review documents and Entry step were preselected in the builder sidebar.
6. Opened the appointment picker and verified parent/sub-service labels. No appointment was booked;
   this fixture has no configured staff availability.

Proof screenshot: `/private/tmp/gestiabloc-chunk19-steps.png`.

## Rollout boundary

No additive migration is needed for Chunk 19. Existing template models, compatibility APIs, executor
and historical enrollments remain for Chunk 20. There is no automatic historical conversion or replay.
Queue admission, fairness, leases, checkpoints and the 4-global/2-per-tenant limits are unchanged;
the earlier 5,000-job load test was not repeated for these interface changes. Temporary preview
servers were stopped and the normal frontend build restored after verification.
