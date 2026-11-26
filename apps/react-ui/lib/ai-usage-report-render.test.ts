import assert from "node:assert/strict"
import { test } from "node:test"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AiUsageReport } from "../app/(tenants)/app/[tenantSlug]/account-settings/ai/_components/ai-usage-report"
import type { AiUsageAnalytics } from "../app/(tenants)/app/[tenantSlug]/account-settings/ai/_lib/analytics"
import type { AiCreditOverviewController } from "./use-ai-credit-overview"

const usage: AiUsageAnalytics = {
  meteringEnabled: true, creditEnforcementEnabled: true,
  totals: { creditsUsed: 12, chargedReplies: 1, providerCalls: 3, inputTokens: 1200, outputTokens: 80, unknownTokenCalls: 0, failedCalls: 1, inProgressCalls: 0 },
  daily: [{ date: "2026-11-25", creditsUsed: 12, chargedReplies: 1, providerCalls: 3, inputTokens: 1200, outputTokens: 80, unknownTokenCalls: 0, failedCalls: 1, inProgressCalls: 0 }],
}
const credits: AiCreditOverviewController = { data: undefined, loading: false, error: "Could not refresh", refresh: () => {} }
const render = (value?: AiUsageAnalytics, loading = false, userRole = "TENANT_ADMIN") => renderToStaticMarkup(React.createElement(AiUsageReport, { usage: value, loading, userRole, credits, tenantSlug: "fixture" }))

test("usage presents charged replies separately from provider calls and preserves a daily table when the wallet fails", () => {
  const html = render(usage)
  assert.match(html, /Current credit balance/)
  assert.match(html, /Credit usage unavailable/)
  assert.match(html, /Usage in selected period/)
  assert.match(html, /1 generated reply charged/)
  assert.match(html, /1,280/)
  assert.match(html, /1,200 input · 80 output/)
  assert.match(html, /1 failed · 0 in progress/)
  assert.match(html, /Daily recorded usage in UTC/)
  assert.match(html, /View daily usage table/)
  assert.doesNotMatch(html, /USD|estimatedCostUsd|\$[0-9]/)
  assert.doesNotMatch(render(usage, false, "TENANT_USER"), /Manage credits/)
})
test("unknown provider usage is explicit and never presented as a known zero", () => {
  const partial = render({ ...usage, totals: { ...usage.totals, unknownTokenCalls: 1 } })
  assert.match(partial, /1,280 known/)
  assert.match(partial, /Token counts are missing for 1 of 3 calls/)
  const unknown = render({ ...usage, totals: { ...usage.totals, unknownTokenCalls: 3, inputTokens: 0, outputTokens: 0 } })
  assert.match(unknown, /Unavailable/)
  assert.doesNotMatch(unknown, /0 input · 0 output/)
})
test("unavailable reports and paused token tracking do not invent measurements", () => {
  assert.doesNotMatch(render(), /generated repl|View daily usage table|No usage recorded/)
  assert.doesNotMatch(render(undefined, true), /generated repl|View daily usage table/)
  const paused = render({ ...usage, meteringEnabled: false, creditEnforcementEnabled: false, totals: { ...usage.totals, providerCalls: 0, inputTokens: 0, outputTokens: 0 } })
  assert.match(paused, /Token tracking paused/)
  assert.match(paused, /Not tracking/)
  assert.match(paused, /Credit deductions are currently off/)
  assert.doesNotMatch(paused, /0 input · 0 output/)
})
