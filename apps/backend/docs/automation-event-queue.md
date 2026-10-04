# Opportunity automation event queue

Opportunity automations can be dispatched through the durable PostgreSQL queue by setting:

```env
AUTOMATION_ASYNC_EVENTS_ENABLED=true
```

The flag defaults to `false` so the additive migration and worker can be deployed before traffic is moved to the queue.

## Worker configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `AUTOMATION_EVENT_POLL_MS` | `1000` | Queue and outbox polling interval |
| `AUTOMATION_EVENT_CONCURRENCY` | `8` | Maximum events claimed per backend pass |
| `AUTOMATION_EVENT_TENANT_CONCURRENCY` | `4` | Maximum active events selected for one tenant |
| `AUTOMATION_EVENT_CLAIM_SIZE` | `16` | Maximum candidates considered per claim |
| `AUTOMATION_EVENT_LEASE_MS` | `120000` | Event lease duration |
| `AUTOMATION_EVENT_METRICS_MS` | `60000` | Queue-health reporting interval |
| `AUTOMATION_EVENT_FAILURE_ALERT_PERCENT` | `10` | Five-minute permanent-failure alert threshold |
| `PRISMA_POOL_MAX` | `20` | PostgreSQL connections per backend instance |

Every value is validated during startup. Keep enough PostgreSQL connections available for ordinary API traffic when changing worker concurrency or the Prisma pool limit.

## Rollout

1. Apply `20260929120000_scalable_opportunity_automation_queue` with the flag disabled.
2. Deploy the backend and confirm the dormant schema and worker configuration.
3. Enable the flag in staging and run the 1,000-event load test.
4. Enable production while monitoring `automation_queue_health`, expired-lease, retry, and completion logs.
5. Remove the synchronous compatibility path after the production soak period.

## Matching and persistence

Only automations whose opportunity trigger, pipeline, destination stage, and contact filters all match are queued and logged. If no automation matches, the request reports the automation result as `NOT_APPLICABLE` and creates no automation event, dispatch, run, or node-execution record.

Skipped node logs remain part of a run after it has matched and started, including unselected branches and nodes bypassed because of an earlier in-run outcome. Older queued dispatches with saved skip decisions remain processable for deployment compatibility, but new opportunity events do not create them.
