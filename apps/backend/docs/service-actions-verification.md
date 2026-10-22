# Chunk 16 verification

Verified on October 21, 2026.

## Automated checks

- 492 backend tests pass, including the real PostgreSQL service hierarchy/API suite.
- 117 frontend regression tests pass.
- Both app TypeScript checks pass.
- Frontend lint has zero errors and the six existing warnings in unrelated files.
- Backend compilation and the Next.js production webpack build pass.
- OpenAPI parses successfully and all local schema references resolve.

Coverage includes all nine action configurations through save/reload, pinned execution snapshots,
inherited/shared picker scopes, enrollment/tenant isolation, archived selections, active membership,
no-op saves, duplicate delivery, atomic rollback, terminal tails, owner retention on revisits and queue
assignment filtering. Recovery tests cover simultaneous event/run admission, tenant rotation, expired
and revoked tokens, checkpoint routing/variables/logs, all three transient delays, completion gates,
already-completed entries and recursive transitions across different workflows.

## 5,000-job staging harness

Environment: a disposable local PostgreSQL instance with current migrations, two independent Prisma
clients, simultaneous workers and the real authenticated CRM follow-up API. This is an isolated staging
harness; it is not a measurement of a hosted production deployment.

| Measurement | Result |
| --- | ---: |
| Workflows / tenants | 5,000 / 10 |
| Initial events / queued runs | 2,500 / 2,500 |
| Total harness time, including setup and baseline | 88.7 seconds |
| Completed workflows | 5,000 |
| Peak shared executions | 4 globally, 2 per tenant |
| Deliberate duplicate deliveries | 78 |
| Unique owner mutations / audit entries / result ledger records | 5,000 each |
| Unique continuation notes | 5,000 |
| Duplicate changes | 0 |
| Baseline API median / p95, 12 requests | 26 / 155 ms |
| Loaded API median / p95, 670 requests | 28 / 32 ms |
| Maximum loaded API latency | 55 ms |
| API timeouts | 0 |

The small baseline includes cold requests; the lower loaded p95 is not evidence of a production speed
improvement. The useful result is bounded execution, complete terminal accounting, no duplicate changes,
and continued API responses during the batch. The harness also exercises expired claims/restarts.
Raw results are saved in [service-actions-load-result.json](service-actions-load-result.json).

Repeat against a migrated, disposable staging database from `apps/backend`:

```bash
DATABASE_URL="$SERVICE_CONFIGURATION_TEST_DATABASE_URL" node --import tsx scripts/service-automation-load.ts
```

The harness requires `SERVICE_CONFIGURATION_TEST_DATABASE_URL`, seeds only temporary fixtures and
cleans them up. `SERVICE_LOAD_JOBS` defaults to 5000; `SERVICE_LOAD_REPORT` overrides the JSON report path.

## Browser checks

Verified the production frontend against a disposable Medicare / Medicare Advantage enrollment:

- All nine actions appear under Service actions.
- Fixed date/time edits persist, save and reload; the displayed time zone matches the enrollment.
- A terminal action explains its effect, removes the trailing Add control and rejects placement before
  another action with readable guidance.
- The step owner saves to an active member and remains assigned after moving forward and revisiting.
- The coordinator can be changed on an unfinished service-owned workflow.
- The follow-up queue's owner filter returns that enrollment with the correct assignee and deadline.
- Automated deadline history names the automation rather than a fabricated staff actor.

## Rollout

Both Chunk 16 additive migrations were applied successfully to the project’s configured database on
October 21, 2026, after disposable-database regression and load checks.

Apply `20261021010000_service_automation_actions` and `20261021011000_service_execution_fairness` before
starting the updated backend. Existing owners default to Unassigned. The earlier deadline migration
must also be present. Regenerate Prisma Client with the new schema.

Shared capacity defaults to 4 globally and 2 per tenant. Startup validates capacity against the database
pool and leaves four connections for other traffic; a smaller pool lowers the defaults. Set the same
execution settings on every backend instance. Watch active executions, tenant usage, queued
continuations, retries and oldest-job age. The queue remains available after a restart through durable
claims, fencing tokens and persisted checkpoints.
