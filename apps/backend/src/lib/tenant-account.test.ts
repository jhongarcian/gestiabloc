import assert from "node:assert/strict"
import { test } from "node:test"
import { z } from "zod"
import {
  TenantAccountUpdateSchema,
  prepareTenantAccountUpdate,
  presentTenantAccount,
  type TenantAccountRecord,
} from "./tenant-account.js"

function accountFixture(): TenantAccountRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Existing company",
    description: null,
    accountRevision: 0,
    email: "contact@example.test",
    phone: "+13125550142",
    website: "https://example.test",
    addressLine1: "120 Harbor Avenue",
    addressLine2: "Suite 2",
    city: "Chicago",
    state: "IL",
    postalCode: "60601",
    country: "US",
    timezone: "America/Chicago",
    taxEnabled: true,
    taxLabel: "Sales Tax",
    defaultTaxRateBps: 825,
    emailVerified: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  }
}

test("company-only patches preserve existing contact, address, timezone, and billing settings", () => {
  const current = accountFixture()
  const input = TenantAccountUpdateSchema.parse({
    name: "  New company  ",
    description: "  About our team  ",
    revision: 0,
  })
  const update = prepareTenantAccountUpdate(current, input)
  assert.deepEqual(update, {
    name: "New company",
    description: "About our team",
    accountRevision: { increment: 1 },
  })
  assert.equal(presentTenantAccount(current).defaultTaxRatePercent, 8.25)
  assert.equal(presentTenantAccount(current).revision, 0)
})

test("blank optional fields clear deliberately while omitted fields remain absent", () => {
  const input = TenantAccountUpdateSchema.parse({
    description: " ",
    website: "",
    email: "",
    addressLine2: "  ",
    revision: 0,
  })
  assert.deepEqual(input, {
    description: null,
    website: null,
    email: null,
    addressLine2: null,
    revision: 0,
  })
  assert.equal("phone" in input, false)
  assert.equal("taxEnabled" in input, false)
})

test("website validation normalizes domains and rejects unsafe schemes or login details", () => {
  assert.equal(
    TenantAccountUpdateSchema.parse({
      website: " company.example ",
      revision: 0,
    }).website,
    "https://company.example",
  )
  for (const website of [
    "javascript:alert(1)",
    "ftp://files.example",
    "https://admin:password@example.test",
    "not a valid domain",
  ]) {
    assert.equal(
      TenantAccountUpdateSchema.safeParse({ website, revision: 0 }).success,
      false,
    )
  }
})

test("profile validation rejects missing revisions, empty updates, unexpected fields, invalid email and field limits", () => {
  for (const input of [
    { name: "Name" },
    { revision: 0 },
    { revision: -1, name: "Name" },
    { revision: 0, name: " " },
    { revision: 0, name: "x".repeat(121) },
    { revision: 0, description: "x".repeat(4001) },
    { revision: 0, email: "invalid" },
    { revision: 0, timezone: "Not/A_Zone" },
    { revision: 0, name: "Name", tenantId: "foreign" },
    { revision: 0, name: "Name", fitProfile: {} },
    { revision: 0, accountRevision: 0 },
  ])
    assert.equal(TenantAccountUpdateSchema.safeParse(input).success, false)
})

test("billing patches retain the existing tax rate, validate enabled taxes, and clear disabled tax fields", () => {
  const current = accountFixture()
  const label = prepareTenantAccountUpdate(
    current,
    TenantAccountUpdateSchema.parse({ taxLabel: "VAT", revision: 0 }),
  )
  assert.equal(label.defaultTaxRateBps, 825)
  assert.equal(label.taxLabel, "VAT")
  assert.equal(label.taxEnabled, true)
  const off = prepareTenantAccountUpdate(
    current,
    TenantAccountUpdateSchema.parse({ taxEnabled: false, revision: 0 }),
  )
  assert.equal(off.defaultTaxRateBps, null)
  assert.equal(off.taxLabel, null)
  assert.throws(
    () =>
      prepareTenantAccountUpdate(
        { ...current, taxEnabled: false, defaultTaxRateBps: null },
        TenantAccountUpdateSchema.parse({ taxEnabled: true, revision: 0 }),
      ),
    z.ZodError,
  )
  assert.equal(
    prepareTenantAccountUpdate(
      current,
      TenantAccountUpdateSchema.parse({
        defaultTaxRatePercent: "0",
        revision: 0,
      }),
    ).defaultTaxRateBps,
    0,
  )
})
