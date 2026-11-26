import assert from "node:assert/strict"
import { test } from "node:test"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { AiCreditOverview } from "./ai-credit-usage"
import { AiCreditUsageCard } from "../components/ai-credit-usage"
const data: AiCreditOverview = { enabled: true, enforcementEnabled: true, asOf: "2026-10-30T12:00:00Z", timeZone: "America/Chicago", plan: { key: "STARTER", name: "Starter", monthlyAllowance: 1200 }, access: { crmAllowed: true, aiAllowed: true, state: "PAID", graceEndsAt: null }, purchasesEnabled: true, eligible: true, canResume: true, pendingCheckout: null, usage: { revision: 1, purchaseReviewRequired: false, period: { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" }, monthly: { granted: 1200, used: 240, reserved: 60, remaining: 900 }, purchased: { balance: 1000, reserved: 20, available: 980 }, available: 1880 } }
const render = (value?: AiCreditOverview, error?: string, userRole = "TENANT_ADMIN") => renderToStaticMarkup(React.createElement(AiCreditUsageCard, { controller: { data: value, loading: !value && !error, error, refresh: () => {} }, manageHref: "/billing", userRole }))
test("the real shared progress exposes remaining value and precise reservation counts to screen readers", () => {
  const html = render(data)
  assert.match(html, /role="progressbar"/); assert.match(html, /aria-valuenow="75"/)
  assert.match(html, /900 of 1,200 credits available, 240 used and 60 reserved/)
  assert.match(html, /1,880/); assert.match(html, /980/)
})
test("the usage summary describes the server-selected model charge without assuming one credit", () => {
  assert.match(render({ ...data, replyCreditCost: 6 }), /Each generated AI reply uses 6 credits/)
  assert.match(render({ ...data, replyCreditCost: 1 }), /Each generated AI reply uses 1 credit\./)
  assert.doesNotMatch(render({ ...data, enforcementEnabled: false, replyCreditCost: 6 }), /Each generated AI reply uses/)
})
test("errors, loading, unavailable and non-admin views never render invented balances or a zero-value chart", () => {
  for (const html of [render(), render(data, "Could not refresh"), render({ ...data, usage: null, enabled: false }), render(data, undefined, "TENANT_USER")]) {
    assert.doesNotMatch(html, /role="progressbar"/)
    assert.doesNotMatch(html, /1,880/)
  }
  assert.doesNotMatch(render(data, undefined, "TENANT_USER"), /Buy AI credits|Manage billing/)
})
test("paused balances are not labelled spendable and exhausted states remain readable", () => {
  const paused = render({ ...data, access: { crmAllowed: true, aiAllowed: false, state: "GRACE", graceEndsAt: "2026-11-02T12:00:00Z" } })
  assert.match(paused, /Credits in balance/); assert.doesNotMatch(paused, /Credits available to spend/)
  const exhausted = render({ ...data, usage: { ...data.usage!, monthly: { granted: 1200, used: 1200, reserved: 0, remaining: 0 }, purchased: { balance: 0, reserved: 0, available: 0 }, available: 0 } })
  assert.match(exhausted, /aria-valuenow="0"/); assert.match(exhausted, /No credits available/)
})
test("the compact analytics balance still exposes exact progress and explains its independent billing scope", () => {
  const html = renderToStaticMarkup(React.createElement(AiCreditUsageCard, { controller: { data, loading: false, error: undefined, refresh: () => {} }, manageHref: "/billing", compact: true }))
  assert.match(html, /Current credit balance/)
  assert.match(html, /Current billing period · all activity/)
  assert.match(html, /Report filters do not change this balance/)
  assert.match(html, /1,880/)
  assert.match(html, /900 of 1,200 credits available, 240 used and 60 reserved/)
})
