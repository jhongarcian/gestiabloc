# AI credit wallet — chunk 3

This chunk adds the server-side credit wallet and balance lookup for the future usage bar. It does not connect wallet mutations to chat routes, grant credits to existing tenants, activate Stripe purchases, or change live billing flags. The current model and the incomplete Chunk 2 model evaluation remain unchanged.

## Credit rules

- Paid monthly grants use the catalog: Starter 1,200, Pro 2,400, Business 4,800. There are no automatic trial or signup grants. A paid subscription without a verified grant has zero monthly credits.
- Monthly periods use explicit paid billing boundaries, including calendar/timezone effects supplied by the billing integration. They are half-open: start inclusive, end exclusive. Unused monthly credits expire; they do not roll over.
- An upgrade within the same period grants only the difference to the higher allowance, preserving used/reserved credits. Lower-plan or delayed events cannot reduce an already granted allowance. A downgrade's lower allowance applies to a new period.
- Purchased credits have no expiry in this implementation and carry over when periods renew. Pack grants use server catalog quantities only. Monthly credits are reserved first, then purchased credits.
- New reservations require an ACTIVE subscription with `paidThrough` strictly in the future. Trials, unpaid accounts, past-due subscriptions and canceled subscriptions cannot spend either bucket. Purchased balances are retained while access is paused. Subscription events and grace handling are implemented in a later chunk; cancellation at period end should keep status ACTIVE until paid access ends.
- One reservation holds one credit for a logical AI answer, regardless of how many internal provider calls it needs. Commit only a valid, billable AI reply. Release for deterministic replies, fallback replies, provider failures or validation failures. Provider cost accounting remains separate: a failed answer may still cost the company money.

## Data and concurrency

Four additive tables store tenant wallets, billing periods, requests and an audit ledger. Every mutation takes the tenant wallet row lock inside a short transaction, including grants and reservation recovery. AI/provider calls must happen outside these transactions. Different tenants can proceed independently. Check constraints prevent negative balances, overspending, invalid states and inconsistent bucket allocations; composite foreign keys prevent cross-tenant period/request references.

Mutation functions accept either the Prisma client or an existing transaction. The billing integration can therefore update subscription/payment state and grant credits atomically; a failed outer transaction also rolls back the grant. The server clock is evaluated after the wallet lock is acquired so lock waits cannot extend reservation eligibility. The optional explicit timestamp is for trusted tests, not client input.

`sourceKey` identifies a verified payment operation globally. Reusing it with the same tenant/payload returns the original result; changing the tenant, plan, pack or billing period conflicts. **Use a stable invoice/payment identity and operation namespace, not a webhook delivery ID**: multiple Stripe events for the same payment must produce the same source key. The later Stripe integration must validate signatures, payment status, currency, amount, customer mapping and product identity before calling either grant function. There are no public grant endpoints.

The ledger appends grant/reserve/commit/release records through the wallet service. Monthly entries retain their period identity so grant/spend totals can be reconciled. Ordinary wallet operations never edit previous ledger records. Direct administrative balance edits bypass these guarantees and must not be used in production. Tenant deletion cascades wallet data with existing account deletion behavior.

Requests are unique by tenant, actor, channel and request UUID, with a server-computed request hash. The same key with different contents conflicts. Duplicate reservations return the existing request with `duplicate: true`; the caller must not call the provider again. A committed request remains committed on repeat settlement, and a later release cannot refund it. A released request cannot be committed or reused.

Reservations expire after five minutes. Settlement rejects expired reservations, fencing late workers from charging them. `recoverExpiredAiCredits` releases stale holds exactly once in batches of at most 100; new reservations also attempt bounded recovery. Retry maintenance until fewer than 100 holds are released. Old-period holds settle/release against their original period, preserving the next period's allowance. Expiry does not silently debit credits for a lost provider response.

## Internal interface

`apps/backend/src/lib/ai-credit-wallet.ts` exports:

- `grantMonthlyAiCredits` and `grantPurchasedAiCredits` for verified server-side payment handling.
- `reserveAiCredit` to atomically hold one credit before a provider request.
- `settleAiCredit` with COMMIT or RELEASE to finalize a hold.
- `recoverExpiredAiCredits` for abandoned holds.
- `readAiCreditUsage` for a consistent snapshot containing monthly granted/used/reserved/remaining, purchased balance/reserved/available, current period and wallet revision.

Balance reads do not create wallets, infer allowances from plan selection, or fabricate historical usage. They use a repeatable-read snapshot. Time crossing a period boundary can change the visible period without incrementing wallet revision; consumers must refresh at boundaries and not cache solely by revision. Expired holds remain reserved until recovery. Balances may remain visible when spending is paused.

All interfaces are trusted server-side functions. Future HTTP integration must enforce tenant membership, authenticated actor identity and feature flags before using them. Do not accept a client's cost, credit amount, plan entitlement, actor or tenant ownership claim. The hash must cover all answer-affecting input and scope. No prompts, responses or contact details are stored by this wallet. Encrypted response replay and chat integration are deferred to the next chunk; request deduplication alone does not provide a replayable answer.

## Migration and verification

`20261029120000_ai_credit_wallet/migration.sql` is additive and has **not been applied to the application database**. Deploy the Chunk 1/2 migrations before enabling dependent integrations. No signup/seed changes or retroactive grants were made in this chunk.

The new migration and concurrency tests run against a disposable schema in a temporary local PostgreSQL instance, with synthetic tenants only. Tests cover duplicate grants, upgrade differences, stale events, overlapping periods, concurrent monthly/purchased exhaustion, repeated reserve/commit/release, failed transaction rollback, tenant/actor isolation, expired holds, ledger reconciliation, period rollover, unpaid access, read-only empty wallets and database constraints.

To run those tests with a disposable database:

```sh
# From apps/backend; explicitly opt in to database tests.
AI_CREDIT_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:65439/postgres \
  node --import tsx --test src/lib/ai-credit-wallet.integration.test.ts
```

The test creates a randomly named schema and removes it afterward. It does not migrate or write application tables. The regular backend suite skips this test unless the dedicated URL is supplied. No AI/provider or Stripe requests are made by these tests.

Before activation, complete chat integration and encrypted replay, verified Stripe grants, scheduled recovery, full model evaluation/human review, and subscription/no-trial enforcement. Credit enforcement and purchases remain off.

Verification result: full backend suite with the dedicated disposable database enabled — **509 passed, 9 existing opt-in integrations skipped, 0 failures**. Prisma schema validation/client generation, backend TypeScript production build, and `git diff --check` passed. The temporary Postgres instance was stopped after testing. Applying the migration to the application database and testing live billing flows remain deployment work.
