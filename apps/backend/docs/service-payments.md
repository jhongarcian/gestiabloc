# Service payment accounts

Each enrollment has a fixed sale total, a separately saved payment arrangement,
and an append-only receipt history. Recording money allocates it to the oldest
unpaid obligation without changing later amounts or dates. Payment settlement,
overdue amounts, and the existing work status remain separate.

## Configuration and use

- Services offer single payment, installments, and optionally flexible payments.
  Parent billing inheritance and enrollment snapshots include versioned settings.
- All enrollment forms use the server billing preview. The deposit is suggested;
  receiving nothing today is valid. Price and tax are calculated on the server.
- The service account, contact page, and transactions register share the same
  receipt dialog. Any positive receipt up to the remaining balance is accepted.
- Correcting a receipt atomically voids it and creates its replacement. Voids and
  corrections require a reason, keep the original receipt, and update existing
  automation events and all financial aggregates.
- Tenant admins can revise unpaid terms with a reason. Funded obligations and
  the previous schedule remain in history. Correcting an older receipt can reopen
  a previously funded obligation; it does not erase the revision history.
- Financial commands require a request key and current financial revision.
  Identical retries return the original result; stale writes and reused keys with
  different payloads return a conflict.

## Rollout

Apply `20261022200000_service_payment_accounts` using the normal Prisma deployment
process before starting this version of the application. Existing totals,
currencies, billing snapshots, and original receipt fields are preserved. The
paid projection is backfilled from receipts. Existing unpaid enrollments show
**Schedule needs review** and accept receipts immediately, but have no inferred
due dates or overdue amounts until an admin confirms their arrangement.

This implementation has not applied migrations to the configured application
database. Migration deployment and preservation checks used disposable local
databases, including a historical-data fixture and a fresh full migration run.

## Verification

Completed on October 22, 2026:

- Backend: 518 tests passed, including real PostgreSQL integration coverage for
  receipt allocation, revision history, voids, corrections, simultaneous writes,
  idempotency, permissions, tenant isolation, and register filters.
- Frontend utilities: 123 tests passed. Both applications pass TypeScript checks.
- Frontend lint: no errors; six existing warnings in the subscription dashboard
  and date-input component.
- Production frontend build passes with `next build --webpack`; backend build
  passes. The default Turbopack build is blocked by this host's process/port
  permissions, including an unrestricted retry.
- Browser checks using fabricated local data: main service enrollment, contact
  enrollment, and the service-specific shortcut; zero received with flexible and
  single payments; full payment; and split receipts of $75 then $125 against a
  $200 installment. The later schedule stays unchanged.
- Browser checks also cover register balance filters and direct recording,
  keyboard operation of admin settings, saving and inheriting enabled options,
  and revising an unpaid schedule while retaining funded portions and history.

For database integration tests, set both `DATABASE_URL` and
`SERVICE_CONFIGURATION_TEST_DATABASE_URL` to a disposable, fully migrated
PostgreSQL database and run `npm test --workspace=apps/backend`. Run frontend
utility tests from `apps/react-ui` with
`node --import tsx --test lib/*.test.ts` so its path aliases resolve.

Refunds, sale-price adjustments, and payment processing remain outside this
release; receipts describe money received elsewhere.
