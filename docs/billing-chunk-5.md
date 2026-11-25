# Stripe subscriptions and no-trial signup — chunk 5

Implemented subscription Checkout, billing portal access, paid plan changes, signed payment/subscription notifications, monthly credit grants and payment recovery. Added administrator controls to the existing subscription screen, including payment status refresh and confirmation before a potentially chargeable upgrade. This chunk does not enable live billing, create Stripe products/prices, process a real payment, apply application-database migrations or approve the AI model gate. Credit pack purchases remain Chunk 6.

## Signup and access

All new Starter, Pro and Business accounts begin with status NONE, no paid-through date and no trial/initial credit grant. Signup strictly rejects unknown fields including `paidNow`, payment status and trial overrides. The frontend no longer sends `paidNow` or advertises a free trial. The transitional trial helper is removed.

New seeds also begin unpaid. `SEED_PAID_NOW` and `--paid-now` are retired and explicitly rejected. Re-seeding an existing tenant preserves its existing subscription/plan/payment state. Legacy trial/development rows are not silently rewritten here; their activation cleanup remains the final rollout step.

When BILLING_ENABLED is true, authenticated CRM HTTP routes check current tenant membership and paid access. Conflicting tenant IDs in route/body/query are rejected. Verified file ownership is checked again for download authorization; multipart avatars are checked after parsing. Paid ACTIVE access lasts until paidThrough. Failed renewal pauses generated AI immediately and allows CRM access through paidThrough + 72 hours. Repeated or delayed events do not restart grace. Clock checks enforce expiry even if a webhook/worker is delayed. Rules-only qualification remains usable during grace. Authentication, onboarding, subscription status reads and billing recovery remain reachable when CRM access is blocked. Existing data and purchased balances are retained.

## Payment handling

The official Stripe Node SDK is pinned to API version `2026-09-30.endive` (SDK 23.0.1 installed). Server configuration selects three distinct monthly, licensed, per-unit USD prices matching the catalog exactly: $49/$99/$199 with quantity one. Client price/customer IDs, cadence, redirect URLs, payment claims and trial options are not accepted. Checkout uses classic subscription billing, card filtering, server-owned metadata and a canonical return URL. A successful browser redirect never activates access.

The webhook route is mounted **before** express.json and validates the raw bytes with Stripe's signature verification. Wrong mode and connected-account events are rejected. Recognized notifications trigger fresh reads of current Stripe subscription/invoice state, not blind application of an old event payload. Customer mapping and server-created checkout command provenance bind a subscription to its tenant. Only a validated paid current invoice can activate the corresponding entitlement and monthly grant. Receipts, subscription state and grants commit in one transaction. The wallet's stable invoice source key prevents multiple grants across different event types/retries for the same invoice.

Completed paid upgrades use prorated immediate invoicing with pending updates, so entitlement/allowance changes follow payment confirmation. The monthly allowance increases only by the difference, preserving used/reserved credits. An incomplete upgrade retains the old paid plan and can return the hosted invoice URL for payment authentication. Downgrades use an owned Stripe subscription schedule at renewal, with no immediate credit reset or plan reduction. The active team must fit the target seat limit; subsequent account user creation also observes the scheduled cap. Existing members are never silently deleted. Selecting the current plan removes an owned scheduled downgrade. Later changes cannot overwrite an unrelated/manual schedule. Remove a scheduled change before making another change or using a cancellation flow that cannot manage schedules.

Portal configuration must enable payment-method updates, invoice history and cancellation at period end, and disable portal subscription updates. This keeps price changes in the controlled upgrade/downgrade flow. Cancellation at period end preserves the current paid period; a canceled subscription cannot spend AI credits. The app refuses a replacement Checkout while a manually canceled subscription still has an unexpired paid period, avoiding overlapping monthly grant windows. Manual immediate cancellations or unsupported Stripe arrangements need operator reconciliation.

See Stripe's official documentation for [subscription notifications](https://docs.stripe.com/billing/subscriptions/webhooks), [pending paid updates](https://docs.stripe.com/billing/subscriptions/pending-updates), [subscription schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules) and [webhook verification/retries](https://docs.stripe.com/events/manage-webhook-endpoints).

## Idempotency and reconciliation

Billing commands are tenant/actor/request-UUID scoped and fingerprint their immutable action/target. Same-ID changed input conflicts. A per-tenant five-minute lease prevents concurrent commands/reconciliation, with fencing on local writes and checks before provider mutations. Network requests run outside database transactions and use stable Stripe idempotency keys. Customer creation is stable per tenant; Checkout also searches for the existing command/session and rejects another open session/live subscription. Checkout expiry parameters remain stable across retries.

Plan commands persist their original direction, source subscription/price/period and schedule ownership before mutation. If a later plan change supersedes an interrupted command, a retry stops with BILLING_RECONCILIATION_REQUIRED rather than reinterpreting the old intent. Pending commands older than 23 hours require review before another provider mutation; an old uncertain customer creation also blocks automatic replacement. Stripe's external state is not transactionally coupled to Postgres, so unresolved provider/database failures must be reconciled rather than retried with a fresh UUID. The browser preserves request IDs after ambiguous failures and never automatically confirms another charge.

`StripeBillingEvent` stores event IDs/type/time/tenant only, without raw webhook payloads. `BillingCommand` stores scoped operation/result metadata (including expiring hosted URLs), not card details. URLs are returned only through authenticated administrator commands. Stripe hosts payment-method/card collection.

## Endpoints and workers

- POST /api/billing/:tenantId/checkout — `{ planKey, requestId }`.
- POST /api/billing/:tenantId/portal — `{ requestId }`.
- POST /api/billing/:tenantId/plan — `{ planKey, requestId }`; current plan removes its scheduled downgrade.
- POST /api/billing/webhook — raw signed Stripe notifications; no browser session required.

Authenticated commands require an active tenant administrator and trusted origin. Error codes distinguish payment required, pending/existing subscriptions, seat capacity, price/configuration mismatch and unresolved requests. The subscription response includes billingEnabled, paidThrough, scheduled change/cancellation state and current access policy for later UI refinements.

Deploy the reconciliation worker alongside the Chunk 4 credit-maintenance worker. It refreshes up to 25 subscriptions per pass, revisits records older than five minutes and recovers missed notifications against current provider state:

```sh
npm run worker:billing -w backend
npm run worker:billing -w backend -- --once
npm run worker:ai-credits -w backend
```

The billing worker exits without provider calls when billing is disabled. Failures log no payloads/secrets; monitor failed webhook responses and worker failures. Bounded requests reject unsupported large/multi-item/custom-price/trial configurations rather than guessing entitlements. These controls govern HTTP CRM access and AI spending; background business automations are not rewritten by this chunk.

## Payment confirmation recovery

The Stripe adapter reads invoice-line subscription ownership from `parent.subscription_item_details.subscription` or `parent.invoice_item_details.subscription`, with a fallback for the older flat field. Missing line ownership remains invalid; it is never inferred from the invoice's subscription. This fixes paid invoices being rejected when Stripe supplies only the nested parent.

`POST /api/billing/:tenantId/sync` verifies current Stripe payment state using the existing administrator, same-origin, fenced-lease and invoice checks. It accepts only an empty body and cannot create a payment. If the initial webhook was missed before the subscription ID was saved, it checks the pending Checkout already recorded by the server, including its customer and command provenance. A completed Checkout still needs a verified paid invoice before granting access. Verified activation clears the old pending Checkout, and grant retries retain the unique invoice source key.

The subscription screen invokes this verification after returning from Checkout and when an administrator chooses **Refresh payment status**. The background billing worker also scans pending initial Checkouts. Incomplete sessions record their last check so abandoned Checkouts cannot monopolize the reconciliation queue. Webhooks and the reconciliation worker remain required for ongoing renewal and cancellation changes; the browser refresh provides an additional recovery path.

Recovery verification: **561 backend tests passed, 9 opt-in integrations skipped, zero failures** with a disposable local PostgreSQL cluster. Regressions cover the actual nested invoice-line shape, missing line ownership, recovery without a saved subscription ID, unpaid invoices, foreign customers/commands, repeated grants, and refresh-route authentication/origin/input checks. Backend and frontend production builds, frontend TypeScript validation, OpenAPI parsing and `git diff --check` passed. Frontend lint retains four existing date-input warnings. An existing paid Pro sandbox invoice was reprocessed through the corrected handler; paid CRM access and exactly one 2,400-credit monthly grant were verified without creating another payment.

## Deployment and verification

`20261029140000_stripe_subscriptions` adds command/receipt storage, unique customer/subscription mappings, leases, pending Checkout state, schedule ID and reconciliation indexes. Apply all prepared migrations in order before deploying/activating dependent code. Preflight duplicate non-null Stripe mappings; never reset the application database. No application migration was applied here.

Keep all rollout flags off until the remaining chunks and activation review are complete. Configure the server-only Stripe secrets, monthly Price IDs and restricted portal configuration from Chunk 1. Register the webhook endpoint with the pinned Stripe API version and relevant invoice/subscription/checkout events. Complete Stripe test-mode Checkout, payment authentication, renewal/failure recovery, scheduled changes and cancellation before live activation. Use separate test/live configuration and matching prices/mode. Do not enable AI-credit enforcement/purchases until the full model evaluation and human review pass; that gate remains incomplete from Chunk 2.

Verification uses synthetic Stripe responses plus real transactions in a disposable local Postgres schema. Tests cover unpaid signup, exact price validation, signatures/mode, access/grace boundaries, duplicate/out-of-order events, atomic rollback, lost command completion, upgrades awaiting payment, scheduled downgrade/reversal, cancellation and tenant leases. SDK request tests verify no trial parameters, stable idempotency parameters and restrictive portal settings. No live or Stripe test-account API calls were made; the real hosted payment flow remains a rollout validation requirement.

Final verification: **539 backend tests passed, 9 existing opt-in integrations skipped, 0 failures**. Prisma validation/client generation, both application TypeScript checks, backend production build and frontend webpack production build passed. Frontend lint has zero errors and four existing date-input warnings. OpenAPI YAML parsing and `git diff --check` passed. The temporary test database was stopped after verification. Application migrations, live billing and AI model/credit rollout gates remain unactivated.
