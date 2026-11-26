# Billing foundation — chunk 1

The backend catalog is authoritative for future checkout and credit grants. Frontend display values are checked against it by `billing-foundation.test.ts`.

| Plan | USD/month | Monthly AI credits | Seats |
| --- | ---: | ---: | ---: |
| Starter | 49 | 1,200 | 3 |
| Pro | 99 | 2,400 | 10 |
| Business | 199 | 4,800 | 25 |

All three plans explicitly have `trialEnabled: false`. Packs are provisional: 1,000/$5, 5,000/$24, 10,000/$45. Currency amounts are integer cents. These are allowances, not live balances; no usage is fabricated or backfilled.

## Staged rollout

`BILLING_ENABLED`, `AI_CREDIT_ENFORCEMENT_ENABLED`, `AI_CREDIT_PURCHASES_ENABLED`, and `AI_CREDIT_MODEL_GATE_PASSED` default to false. Chunk 1 defines and validates configuration only; it neither charges customers nor changes access. Credit purchases require all four switches and configured pack prices. The model-gate flag records an operational approval after benchmarks; it does not perform the benchmark itself.

Enabling billing requires server-only `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIGURATION_ID`, and `STRIPE_PRICE_STARTER_MONTHLY`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_BUSINESS_MONTHLY`. Purchases additionally require `STRIPE_PRICE_AI_1000`, `STRIPE_PRICE_AI_5000`, `STRIPE_PRICE_AI_10000`. Never expose secrets to frontend code.

The additive migration introduces `currentPeriodStart`, `paidThrough`, `graceEndsAt`, `scheduledPlanKey`, `scheduledChangeAt`, `cancelAtPeriodEnd`, and `billingRevision`. It preserves all existing tenant data and subscription statuses. Apply it through the normal deployment migration process; do not reset the database.

The existing signup/seed trial implementation is isolated in `legacy-subscription-trial.ts` until chunk 5 removes it and `paidNow`. Public trial copy is removed in chunk 7; legacy development accounts become unpaid in chunk 8. Do not enable live billing before those chunks. The new catalog does not offer trials, but this foundation alone does not retire the legacy signup flow.

`aiCreditsPerMonth` replaces `aiActionsPerMonth` in the subscription response and internal consumers. This is a breaking field rename for any external client. `AiInteraction` analytics remain separate from the future credit ledger. `billing-types.ts` defines future checkout/usage contracts and error codes, not active endpoints.

## Validation

Run `node --import tsx --test apps/backend/src/lib/billing-foundation.test.ts`, Prisma validation, both app type checks, frontend lint, and the workspace build. Later chunks supply Stripe checkout, metering, live balances, payment recovery, and the usage progress bar.

## Verification results

- Four foundation tests passed, including runtime frontend/backend catalog parity and unsafe configuration rejection.
- Full backend suite with the existing local environment loaded: 486 passed, 9 opt-in integration tests skipped, 0 failures. Command from `apps/backend`: `node --import dotenv/config --import tsx --test src/**/*.test.ts`. The default test script does not preload `.env`; tests importing the database client require that preload.
- Prisma validation and client generation passed. Both application TypeScript checks and backend production build passed.
- Frontend lint passed with six existing warnings. Frontend production build passed with `npm run build -w react-ui -- --webpack`. The default Turbopack build encountered environment restrictions fetching fonts/starting its local CSS process.
- OpenAPI YAML parsing and `git diff --check` passed.
- Migration SQL is prepared but has not been applied to a database. Database migration integration and live Stripe flows remain untested in this chunk.
