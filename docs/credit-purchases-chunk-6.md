# Stripe AI credit purchases — chunk 6

Implemented gated one-time Checkout for 1,000/$5, 5,000/$24 and 10,000/$45 packs, administrator purchase controls, payment fulfillment, unpaid Checkout resume/cancel, and reconciliation. Prices remain provisional until the full model quality/cost review passes. All rollout flags remain off. No Stripe prices, real payments, application migrations or model changes were activated.

## Purchase and fulfillment

Only an active tenant administrator with an ACTIVE paid subscription can start a purchase. The separate purchases flag requires billing, credit enforcement, provider metering, replay encryption and the approved model gate. All six subscription/pack price IDs must be distinct. Pack prices must match the server catalog's exact USD cents, one-time cadence, per-unit billing and quantity one; clients cannot supply price, amount, customer, credit quantity, discounts or return URL.

Checkout uses payment mode, card filtering and stable server-owned metadata on both the session and PaymentIntent. The command and purchase snapshot are recorded before the provider call. Tenant leases, immutable request fingerprints, stable Stripe idempotency keys and existing-session lookup protect retries. A changed pack under the same request UUID conflicts. Another pending purchase must finish or be canceled before starting a different one. Administrators can resume a saved hosted Checkout or expire an unpaid session; cancellation does not issue a refund or remove credits. A payment that wins the race with cancellation is never silently canceled locally.

A browser success redirect is not payment proof. Signed Checkout/payment notifications retrieve current session line items, PaymentIntent and captured charge. Customer, tenant, command, pack, session/PaymentIntent association, currency, price ID, quantity, subtotal, total and captured amount must match. Incomplete/failed/uncaptured payments grant nothing. Exact capture grants the catalog quantity once, using `stripe:payment_intent:<id>:credits` as a stable ledger source across notification types. Grant, purchase status and event receipt commit together. A failure rolls all three back for a safe retry.

Purchased credits do not change the subscription, paid-through date or monthly allowance. They carry over and are reserved after monthly credits. If a payment initiated while paid completes after a subscription lapses, it is still banked; spending stays paused until the subscription is paid again. Fulfillment and refund detection continue for existing orders even if new purchases are disabled. Existing invoice/subscription handlers remain separate.

## Refunds and disputes

The app does not initiate refunds. A refund (including partial/pending refund notifications) or dispute for a verified owned purchase sets a durable REVIEW state and wallet `purchaseReviewRequired` hold. New AI reservations and new purchases are blocked with AI_PURCHASE_REVIEW_REQUIRED. In-flight reservations and already paid replay copies retain their existing behavior. Balances and ledger history are preserved; no negative balance, automatic credit clawback, re-grant or automatic unpause is invented.

If a refund predates fulfillment, credits are never granted. Unrelated payments cannot place another tenant/purchase on hold. Duplicate or out-of-order notifications read current Stripe state; review is sticky, including a later dispute outcome or failed refund. A platform operator must reconcile the Stripe outcome and any consumed/reserved credits before clearing a hold under an approved adjustment policy. There is no tenant self-service override or automated resolution policy in this chunk. Define and test that operational procedure before live activation; manual review is intentional rather than an automatic refund entitlement decision.

## API and UI

- GET /api/billing/:tenantId/credits — admin-only catalog, eligibility, wallet snapshot and pending payment. Read-only and no-store; rollout-off mode returns no balance rather than fabricating allowances.
- POST /api/billing/:tenantId/credits/checkout — strict `{ packKey, requestId }`.
- POST /api/billing/:tenantId/credits/:purchaseId/cancel — strict empty object; expires only an owned unpaid session.

The subscription screen displays the three packs, purchased available/reserved credits, payment status refresh, resume/cancel controls and review messages using existing components. It preserves request IDs after ambiguous errors. A signed payment notification adds the balance; returning from Stripe alone does not update it optimistically. The detailed monthly progress bar remains Chunk 7.

## Reconciliation and rollout

Additive migrations `20261029150000_credit_purchase_review` and `20261029151000_credit_purchases` add the wallet hold and immutable purchase snapshots with unique session/PaymentIntent IDs and tenant-safe command references. They have been tested only in disposable schemas, **not applied to the application database**. Deploy all prior migrations first.

Keep `AI_CREDIT_PURCHASES_ENABLED=false` until the model gate, final rollout and real Stripe test-mode verification pass. Configure server-only STRIPE_PRICE_AI_1000, STRIPE_PRICE_AI_5000 and STRIPE_PRICE_AI_10000 as exact one-time USD prices. Keep pack definitions immutable while orders are outstanding; catalog changes require a deliberate version/reconciliation plan. Card fees and infrastructure still affect revenue; the provisional price list is not a tested net-profit guarantee.

The signed webhook also handles payment_intent success/failure/cancel, payment Checkout notifications, charge refunds/disputes and refund updates. Register these with the pinned Stripe API version. Keep the new reconciliation worker running for existing orders even when sales are disabled:

```sh
npm run worker:credit-purchases -w backend
npm run worker:credit-purchases -w backend -- --once
```

It never creates a Checkout or charge. It checks pending orders roughly every five minutes, rechecks paid orders daily for missed reversal events, and processes up to 25 per pass with failure backoff. Missing Checkout responses can be recovered from server command metadata. Unresolvable/old ambiguous requests require operator reconciliation rather than another charge. Continue running the subscription and credit-maintenance workers from prior chunks.

Stripe sources: [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), [session line items](https://docs.stripe.com/api/checkout/sessions/line_items), [refund lifecycle](https://docs.stripe.com/refunds).

## Verification

Tests use synthetic Stripe responses and a temporary local PostgreSQL schema. They cover all pack sizes, exact price/cadence checks, stable one-time Checkout payloads, changed-input retries, duplicated/cross-type events, unpaid/uncaptured payments, missing webhook recovery, lapsed accounts, customer/line/amount/payment mismatches, refunds before/after fulfillment, disputes, scoped cancellation, review holds and atomic rollback. Real Stripe Checkout/payment-authentication/refund flows still need test-mode verification before activation. No live or test-account Stripe API calls were made.

Final results: **550 backend tests passed, 9 existing opt-in integrations skipped, 0 failures**. Prisma validation/client generation, both application TypeScript checks, backend production build and frontend webpack production build passed. Frontend lint has zero errors and four existing date-input warnings. OpenAPI parsing and `git diff --check` passed. The temporary database was stopped after testing. Application migrations, live purchases and the model approval gate remain unactivated.
