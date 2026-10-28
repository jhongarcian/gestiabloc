# Chunk 20 — Retire service templates

## Delivered behavior

All new enrollments require configured service steps. Omitting `workflowKind` still creates
`SERVICE_STEPS`; explicit template selection and unknown collection fields are rejected. Service,
sub-service, step, checklist, professional and billing configuration continue through the connected
service workspace and Automations builder.

Removed:

- Template builders, navigation and configuration/publish/enrollment/log APIs.
- Legacy run retry, next-follow-up scheduling and continue-now APIs.
- Template/version/default-step/run/node-execution models and their two runtime status enums.
- The separate template executor, its polling call, and v2/v3 backfill commands.

The migration `20261021233000_retire_service_templates` freezes original template, published version,
run, node execution and default-step data into enrollment-specific `retiredWorkflowSnapshot` JSON
before removing the five executable tables. Old execution lease tokens are excluded. Tasks and contact
notes retain frozen source names/version attribution independently of their enrollment. Historical
source IDs remain scalar attribution; they no longer reference executable template tables.

Saved `ContactServiceFollowUpStep` records, assignments, completion/resolution timestamps, notes,
tasks, payments and execution activity remain. Staff can finish saved steps manually, assign open
steps, postpone, or explicitly reopen eligible steps. These mutations lock the enrollment first,
preserve no-op saves, audit before/after values and reconcile payment/completion state transactionally.
Resolved assignments and referenced saved workflow history cannot be deleted through step controls.
Postponing shifts the saved due/available date, resets overdue reminders and can shift later unresolved
saved dates. Reopening preserves the earlier resolution in activity history.

Existing unfinished template actions stop. The workspace and contact follow-up panel show an earlier
workflow retirement notice, original source/version, and any prior schedule as reference. Staff must
review unfinished actions and complete saved work manually. There is no conversion, inferred step,
historical replay or automatic restart of old cursors. Raw archive definitions, variables and node
inputs are never returned by these APIs.

Service and ordinary automations keep their existing shared event/run queue, pinned definitions,
leases, retries, checkpoints, fairness and **4 globally / 2 per tenant** execution budget. The retained
manual-follow-up reminder poller only creates overdue notifications; it executes no workflow actions.

## Required deployment order

This is a destructive schema cutover with archival preservation. It was applied and verified only
against a disposable local PostgreSQL 14 database. Production has not been migrated by this task.

1. Verify a restorable database backup and retain the previous application release. Arrange the
   maintenance window and staff review of unfinished template work.
2. Stop **every old backend and worker instance**, including separate legacy processes, and pause
   writes. Keep them stopped throughout migration and application rollout.
3. Let existing legacy execution leases expire. The migration locks the old executable tables and
   aborts atomically with `LEGACY_WORKER_LEASE_ACTIVE` if an unexpired lease remains. Investigate any
   still-running old worker before retrying. A failed migration leaves the original records intact;
   use Prisma's failed-migration recovery procedure before retrying deployment.
4. In `apps/backend`, with the intended deployment database selected, run `npx prisma migrate deploy`.
   Deploy the generated client and new backend/frontend release together before restoring traffic.
   Build artifacts use `npx prisma generate`, backend `npm run build`, and frontend
   `npm run build -- --webpack`.
5. Smoke-test a new sub-service enrollment, a retained manual enrollment, its completion history,
   checklist/professional attribution, and an ordinary automation. Check shared queue health and API
   responsiveness. Removed template pages/APIs should return 404.

Rollback after the table-removal commit requires the verified database backup and corresponding old
application release. Archived JSON is retained history, not an automatic database restoration or
workflow replay mechanism. Account for any writes accepted after reopening traffic before restoring.

The checked migrations preserve the SQL partial unique index enforcing one active service-step
occurrence per enrollment. Prisma schema diff still reports this pre-existing SQL-only index and the
pre-existing `ServiceStepMovement` foreign-key naming difference; neither is introduced or removed
by this cutover.

## Verification

- Backend: **493 tests passed**, zero failed or skipped, against the disposable migrated database.
- Frontend: **123 library tests plus 4 colocated transaction-search tests passed**.
- Both app type checks and production builds pass. Frontend lint has zero errors and six existing
  warnings in subscription-dashboard/date-input.
- The retirement regression rebuilds the actual pre-cutover schema from all prior migrations, seeds
  template/version/run/node/step/task/note/log history, proves active-lease rejection rolls back, then
  verifies successful archival, saved IDs, assignments, resolution timestamps and ordinary automations.
- API regressions cover retained manual completion, duplicate concurrent saves, postponed dates,
  reopening, frozen before/after audit values, no-op timestamps, assignment validation, enrollment
  isolation, forced transaction rollback, removed endpoints, strict old-payload rejection and missing
  service-step configuration. Task attribution survives later enrollment deletion and ordinary edits.
- Existing ordinary workflow, service trigger/action, payment, completion-gate, configuration review,
  bounded queue, retry and checkpoint regressions pass after removing the separate executor.
- OpenAPI parses and all **1,077** local references resolve. Removed executable APIs and schemas are absent.

Browser checks used the local production preview and disposable Medicare fixture:

1. Opened a retained enrollment and verified original source/version/schedule, old assignee and
   completion timestamp, and the retirement notice.
2. Completed the remaining step manually with a note. The enrollment became Completed with both
   original and new resolution history visible.
3. Verified the former template builder returns 404 and settings has no template navigation.
4. Opened the inherited Steps workspace and linked automation editor. Service, sub-service, step,
   entry/completion selectors and contact filters remain available.

Proof screenshot: `/private/tmp/gestiabloc-chunk20-retired-workflow.png`.
Temporary preview servers were stopped; the frontend production build uses the normal project
environment again. Queue execution policy is unchanged, so the earlier 5,000-job load test was not
repeated for this retirement.
