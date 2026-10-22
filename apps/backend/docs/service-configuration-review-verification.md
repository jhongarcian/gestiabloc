# Chunk 18 — Configuration review and selective application

Verified against a disposable PostgreSQL 14 database and a local production UI preview.

## Delivered

- Enrollment updates tab on service groups and sub-services, with 20-record pages, comparisons,
  preserved-work explanations, blockers, per-enrollment selection and sequential requests.
- Durable 15-minute review receipts, tenant/admin checks, enrollment-first locking, source/state
  hashes, complete transaction rollback, idempotent retries and actor-attributed application history.
- Future unentered steps can be added, edited, reordered or removed while preserving retained IDs.
  Entered work and order remain frozen; owned steps and unfinished workflow targets cannot be removed.
- Checklist additions and safe detail edits preserve existing statuses and timestamps. Removed items
  remain available, and items with activity retain saved details. Billing, payments, assignments,
  deadlines, queued actions and waiting schedules remain intact. Pending-payment work cannot gain steps.
- Service identity and section-source changes are included in the comparison. Purchased billing
  attribution stays frozen when configuration changes between inherited and customized pricing.
- Full service workflow snapshots include trigger selectors, contact filters, publication state,
  nested actions and waits. New service events use saved definitions; library deletion retains
  snapshot attribution without dangling foreign keys. Older enrollments adopt snapshots explicitly,
  with no historical replay. Existing execution limits and checkpoints remain unchanged.

## Regression verification

Backend: **517 passed, zero failed or skipped**. Frontend: **122 passed, zero failed**.
Both app type checks, backend build and frontend production webpack build pass.
Frontend lint has zero errors and six existing warnings in subscription-dashboard/date-input.
Prisma schema validation passes. OpenAPI parses and all **1,122** local references resolve.

Database coverage includes stale source/enrollment changes, expiration, foreign receipts, admin
permissions, concurrent applications, forced rollback, preserved IDs/owners/coordinator/professional
attribution, checklist completion/activity, a 20-day manual deadline, selective updates, future-step
reordering/removal, waiting completion recovery, pinned target incompatibility, pending-payment work,
saved workflow deletion and metadata/billing-source preservation. Existing service-trigger and shared
queue concurrency, retry and checkpoint regressions also pass.

The Chunk 16/17 5,000-job reports remain the queue load baseline. Chunk 18 introduces no new execution
worker or bulk-draining endpoint; its browser processes a maximum 20-record page one request at a time.
No new hosted load test was run for this configuration-only feature.

## Browser verification

Using disposable Medicare demo data on ports 4007/3017:

1. Opened the offering's Enrollment updates tab and reviewed a future-step edit, checklist addition
   and adoption of service workflow snapshots.
2. Confirmed before/after details and service, step and professional display names.
3. Confirmed expired reviews cannot apply.
4. Changed the source after a fresh review and confirmed stale application is rejected.
5. Refreshed the comparison, selected one enrollment and observed “Reviewed changes applied.”

Screenshot: `/private/tmp/gestiabloc-chunk18-enrollment-updates.png`.

## Migration and rollout

`20261021130000_service_configuration_review` was applied successfully to the disposable database
and the configured database. It only adds review/audit storage; no existing enrollment is rewritten.
Deploy application changes after this migration. No application deployment was performed here.
Expired unapplied receipts may be pruned in a future retention task; applied receipts remain history.
