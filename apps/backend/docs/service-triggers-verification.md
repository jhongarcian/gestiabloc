# Chunk 17 verification

Verified October 21, 2026.

## Automated checks

- 504 backend tests pass, including the PostgreSQL service hierarchy and authenticated API suite.
- 120 frontend regression tests pass.
- Both app TypeScript checks and production builds pass.
- Frontend lint has zero errors and six existing warnings in unrelated files.
- Prisma schema validation passes; OpenAPI parses and all 1,120 local references resolve.

Coverage includes all four triggers through save/reload, publication and branch execution; the four
supported enrollment actions; rejection of occurrence-only actions on nested paths; event-time contact,
custom-field and tag filters; one/all/future sub-service scope; initial positive payments; every editable
payment field; no-op timestamps; payment removal snapshots; competing payment requests; rollback;
archived checklist references; exact enrollment attribution; pinned actions; duplicate delivery;
checkpoint continuation after step movement; and derived status changes with preserved causal chains.
Existing queue recovery, completion-gate, lease, tenant isolation and loop tests remain passing.

## 5,000-job queue verification

The existing disposable staging harness now seeds initial and resumed jobs for all four enrollment
trigger types. Two independent Prisma clients run simultaneous workers against local PostgreSQL and
the real authenticated CRM follow-up API. This verifies execution and recovery under load; event
production and matching are covered separately by the API regression suite. It is not a measurement
of a hosted production deployment.

| Measurement | Result |
| --- | ---: |
| Workflows / tenants | 5,000 / 10 |
| Initial event jobs / resumed jobs | 2,520 / 2,480 |
| Total time, including setup and baseline | 107.2 seconds |
| Successful workflows | 5,000 |
| Peak shared execution | 4 global / 2 per tenant |
| Deliberate duplicate deliveries | 68 |
| Unique coordinator mutations / audit entries / result records | 5,000 each |
| Unique continuation notes | 5,000 |
| Duplicate changes | 0 |
| Baseline API median / p95, 12 requests | 27 / 118 ms |
| Loaded API median / p95, 821 requests | 27 / 32 ms |
| Maximum loaded API latency | 55 ms |
| API timeouts | 0 |

The baseline includes cold requests. The lower loaded p95 does not establish a production speed
improvement. All tenants received admission; bounded concurrency, terminal accounting and unchanged
API median demonstrate the intended queue behavior. Expired claims, restart recovery and duplicate
delivery checks remain enabled. Raw results: [service-triggers-load-result.json](service-triggers-load-result.json).

Repeat from `apps/backend` with both `DATABASE_URL` and `SERVICE_CONFIGURATION_TEST_DATABASE_URL`
pointing at a migrated disposable database:

```bash
node --import tsx scripts/service-automation-load.ts
```

`SERVICE_LOAD_JOBS` defaults to 5000; `SERVICE_LOAD_REPORT` overrides the report path. The harness
creates and cleans up its own fixtures. It does not read the project's configured database URL.

## Browser and running-worker checks

Verified an isolated production frontend against the disposable local database:

- The Service triggers sidebar lists all four new triggers alongside Service step.
- All sub-services, checklist-item and From/To selectors display correctly.
- Payment Added/Edited/Removed and the Partly paid balance filter save, publish and survive reload.
- Checklist item and Received selectors save successfully.
- Enrollment workflows offer exactly the four supported service actions; occurrence-only actions are absent.
- A real payment addition and note edit each produced one successful background run and readable history.
- Repeating the normalized note save produced no additional event; the assigned professional remained intact.
- The paid portion did not complete unfinished steps: the enrollment remained In progress.

Preview evidence was saved as `/private/tmp/gestiabloc-chunk17-service-triggers.png`. Temporary preview
servers were stopped; the user's existing development server was left running.

## Rollout

The additive migrations were applied to the project's configured database after disposable-database
verification:

- `20261021120000_service_enrollment_triggers`
- `20261021121000_service_trigger_scope`

The second migration extends the earlier step-only sub-service constraint and adds tenant-scoped group
references. Existing enrollment revisions default to zero; no historical events are replayed. Regenerate
Prisma Client before starting the updated backend. Existing step-trigger payloads remain compatible.

The four triggers reuse Chunk 16's workers, shared admission budget, fairness, contact serialization,
lease fencing, checkpoints and retries. No new completion gates, bulk interface, legacy conversion or
configuration propagation was introduced. Watch the existing queue metrics for active execution,
per-tenant usage, queued continuations, retries and oldest-job age.
