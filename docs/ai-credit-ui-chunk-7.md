# AI credit usage interface — chunk 7

Added the shared AI credit summary to AI Settings and the subscription page. All rollout flags remain off. No application migration, Stripe payment, model change, credit grant or rollout activation was performed.

## Balances and progress

The administrator-only summary reads `GET /api/billing/:tenantId/credits`. The response now includes billing/enforcement flags, server `asOf`, tenant timezone, configured plan allowance, paid-access state, paid-through date and cancellation status alongside the existing wallet and purchase metadata. The endpoint remains read-only and sends `Cache-Control: no-store`. Billing-off responses avoid billing-table reads; enforcement-off responses never read or create a wallet.

The monthly bar shows **credits remaining**, calculated as `(granted - used - reserved) / granted`. Its emerald fill represents available capacity. Exact granted, used and reserved counts accompany the percentage; purchased credits have a separate available/reserved summary because they carry over and are consumed after monthly credits. The headline total excludes both kinds of reservation. Screen readers receive the actual numeric progress value and the precise counts, including reservations. The shared Progress primitive now forwards its value to Radix as well as using it for the visual fill.

Configured plan allowances are labelled as allowances, never as current balances. A missing grant has explanatory text instead of a percentage. Loading, disabled rollout, failed reads and inconsistent snapshots never display a fabricated zero-credit bar. Non-administrators see an administrator message and do not fetch the financial endpoint or receive purchase actions.

The summary distinguishes ready, low (total availability at or below 10% of the monthly grant), exhausted, fully reserved, unpaid/grace and purchase-review states. An unpaid or review-held balance is labelled as a balance rather than spendable credits. Review holds preserve the existing balances and direct the user to billing. Purchase links lead to the existing subscription-page purchase controls.

## Refresh and payment recovery

One tenant-scoped hook powers the usage and purchase cards on the subscription page. It aborts superseded reads, prevents a previous tenant's snapshot from being displayed, and hides balances when a refresh fails. It refreshes manually, on window focus or visibility return, after AI activity and purchase changes, and every 30 seconds while visible. It also refreshes near credit-period expiry, paid-through and grace deadlines. This depends on timestamps, not only wallet revision: an expired period can change availability without changing that revision. Hidden tabs stop polling; returning from hosted Checkout retrieves server state rather than adding credits optimistically.

The tenant shell displays a payment recovery notice when its existing subscription response reports grace or blocked access. The notice explains the access state and links administrators to billing; refresh requests the latest server-rendered subscription state. Dates use the tenant timezone. This notice does not replace backend access checks. The existing subscription endpoint remains administrator-only, so a staff session without that subscription response does not receive the shell notice; backend restrictions still apply.

No-trial copy is explicit on pricing, signup and subscription controls. The legacy trial date message now requests payment, and renewal text avoids promising an allowance before payment confirmation. Purchased-credit carryover, monthly expiry, and the payment requirement are explained next to the balances.

## Verification and rollout

- 551 backend tests passed, 9 existing opt-in integrations skipped, zero failures. The new route test covers real snapshot arithmetic, plan/access/timezone metadata, no-store, enforcement-off reads and administrator access. Financial integration tests use a temporary PostgreSQL cluster and disposable schemas, not the application database.
- Eight interface tests passed. They cover snapshot invariants, reservation subtraction, remaining percentages, payment/review precedence, low/exhausted/reserved states, period rollover without revision changes, timestamp refresh, invalid timezones and the rendered shared component's accessible progress values. Error, loading, disabled and non-admin renders expose no fabricated balance.
- Backend and frontend production builds passed, including TypeScript validation. Frontend lint has zero errors and the same four existing date-input warnings. OpenAPI YAML parsing and `git diff --check` passed.
- Desktop and 375px mobile layouts were inspected using the actual summary component, production CSS and synthetic balances. This is visual verification, not a live Stripe or authenticated browser payment test.

Run interface tests from the repository root:

```sh
TSX_TSCONFIG_PATH=apps/react-ui/tsconfig.json node --import tsx --test apps/react-ui/lib/ai-credit-usage.test.ts apps/react-ui/lib/ai-credit-usage-render.test.ts
```

Live billing remains gated on the model quality/cost review, final rollout work and real Stripe test-mode verification described in the earlier chunks. This chunk adds no database migration and does not enable any billing or credit flag.
