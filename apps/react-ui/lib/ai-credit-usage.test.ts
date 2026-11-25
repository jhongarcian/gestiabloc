import assert from "node:assert/strict"
import { test } from "node:test"
import { creditDisplay, creditUsageIsConsistent, formatCreditDate, nextCreditRefresh, type AiCreditOverview } from "./ai-credit-usage"
const overview = (): AiCreditOverview => ({ enabled: true, enforcementEnabled: true, asOf: "2026-10-30T12:00:00Z", timeZone: "America/Chicago", plan: { key: "STARTER", name: "Starter", monthlyAllowance: 1200 }, access: { crmAllowed: true, aiAllowed: true, state: "PAID", graceEndsAt: null }, purchasesEnabled: true, eligible: true, canResume: true, pendingCheckout: null, usage: { revision: 1, purchaseReviewRequired: false, period: { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" }, monthly: { granted: 1200, used: 240, reserved: 60, remaining: 900 }, purchased: { balance: 1000, reserved: 20, available: 980 }, available: 1880 } })
test("monthly remaining percentage excludes both spent and reserved credits; purchased balance is separate", () => {
  const d = overview(), view = creditDisplay(d)
  assert.deepEqual(view, { state: "ready", reserved: 80, available: 1880, monthlyPercent: 75 })
  assert.equal(creditUsageIsConsistent(d.usage!), true)
})
test("unavailable, missing or inconsistent data never becomes a zero-credit chart", () => {
  const d = overview()
  assert.deepEqual(creditDisplay({ ...d, enabled: false }), { state: "unavailable" })
  assert.deepEqual(creditDisplay({ ...d, enforcementEnabled: false }), { state: "unavailable" })
  assert.deepEqual(creditDisplay({ ...d, usage: null }), { state: "unavailable" })
  for (const value of [-1, NaN, Infinity, .5]) assert.equal(creditDisplay({ ...d, usage: { ...d.usage!, available: value } }).state, "invalid")
  assert.equal(creditDisplay({ ...d, usage: { ...d.usage!, monthly: { ...d.usage!.monthly, reserved: 900 } } }).state, "invalid")
})
test("review and paid-access pauses override a healthy or exhausted balance", () => {
  const d = overview()
  assert.equal(creditDisplay({ ...d, usage: { ...d.usage!, purchaseReviewRequired: true } }).state, "review")
  assert.equal(creditDisplay({ ...d, access: { crmAllowed: true, aiAllowed: false, state: "GRACE", graceEndsAt: "2026-11-02T12:00:00Z" } }).state, "paused")
})
test("low, fully reserved and exhausted wallets are distinct; rollover can change while revision stays the same", () => {
  const d = overview(), u = d.usage!
  u.purchased = { balance: 0, reserved: 0, available: 0 }
  u.monthly = { granted: 1200, used: 1100, reserved: 0, remaining: 100 }; u.available = 100
  assert.equal(creditDisplay(d).state, "low")
  u.monthly = { granted: 1200, used: 1190, reserved: 10, remaining: 0 }; u.available = 0
  assert.equal(creditDisplay(d).state, "reserved")
  u.monthly = { granted: 1200, used: 1200, reserved: 0, remaining: 0 }
  assert.equal(creditDisplay(d).state, "exhausted")
  u.monthly = { granted: 0, used: 0, reserved: 0, remaining: 0 }; u.period = null
  const next = creditDisplay(d)
  assert.ok("monthlyPercent" in next); assert.equal(next.monthlyPercent, null)
  u.monthly = { granted: 1200, used: 0, reserved: 0, remaining: 1200 }; u.available = 1200
  u.period = { startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" }
  const fresh = creditDisplay(d); assert.ok("monthlyPercent" in fresh); assert.equal(fresh.monthlyPercent, 100)
})
test("expiry refresh uses timestamps instead of revision, and tenant dates safely handle invalid timezones", () => {
  const d = overview(), now = Date.parse("2026-10-31T23:59:55Z")
  assert.equal(nextCreditRefresh(d, now), 5100)
  assert.equal(nextCreditRefresh(d, Date.parse("2026-11-02T00:00:00Z")), 30000)
  assert.match(formatCreditDate(d.asOf, "America/Chicago")!, /Oct 30/)
  assert.match(formatCreditDate(d.asOf, "invalid-zone")!, /UTC/)
  assert.equal(formatCreditDate("bad"), null)
})
