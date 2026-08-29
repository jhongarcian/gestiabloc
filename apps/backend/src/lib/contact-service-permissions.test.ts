import assert from "node:assert/strict"
import test from "node:test"

import { canManageContactServices } from "./contact-service-permissions.js"

test("tenant admins can manage contact services", () => {
  assert.equal(
    canManageContactServices({
      role: "TENANT_ADMIN",
      securityLevel: "LOW",
    }),
    true,
  )
})

test("low-security tenant users cannot manage contact services", () => {
  assert.equal(
    canManageContactServices({
      role: "TENANT_USER",
      securityLevel: "LOW",
    }),
    false,
  )
})

test("medium-security tenant users can manage contact services", () => {
  assert.equal(
    canManageContactServices({
      role: "TENANT_USER",
      securityLevel: "MEDIUM",
    }),
    true,
  )
})

test("max-security tenant users can manage contact services", () => {
  assert.equal(
    canManageContactServices({
      role: "TENANT_USER",
      securityLevel: "MAX",
    }),
    true,
  )
})
