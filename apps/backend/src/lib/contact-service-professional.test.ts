import assert from "node:assert/strict"
import test from "node:test"

import {
  assignedServiceProfessionalIdSchema,
  resolveServiceProfessionalChange,
} from "./contact-service-professional.js"

const internal = { id: "internal", user: { name: "Jordan Lee", email: "jordan@example.com" } }
const external = { id: "external", externalProfessionalName: "Alex Smith" }
const professionals = [internal, external]

test("professional input distinguishes omission, clearing, and a selected ID", () => {
  assert.equal(assignedServiceProfessionalIdSchema.parse(undefined), undefined)
  assert.equal(assignedServiceProfessionalIdSchema.parse(null), null)
  assert.equal(assignedServiceProfessionalIdSchema.parse(" internal "), "internal")
  for (const value of ["", "  ", false, 123, {}]) {
    assert.equal(assignedServiceProfessionalIdSchema.safeParse(value).success, false)
  }
})

test("switching to a configured external professional records both identities", () => {
  assert.deepEqual(resolveServiceProfessionalChange({
    assignedProfessionalId: external.id, previousProfessional: internal, professionals,
  }), {
    valid: true,
    activity: {
      previousProfessionalId: internal.id, previousProfessionalName: "Jordan Lee",
      professionalId: external.id, professionalName: "Alex Smith",
    },
  })
})

test("an internal professional can be assigned to an unassigned enrollment", () => {
  const result = resolveServiceProfessionalChange({
    assignedProfessionalId: internal.id, previousProfessional: null, professionals,
  })
  assert.equal(result.valid, true)
  if (result.valid) {
    assert.equal(result.activity?.previousProfessionalName, "Unassigned")
    assert.equal(result.activity?.professionalName, "Jordan Lee")
  }
})

test("explicit null clears the professional and records the previous identity", () => {
  assert.deepEqual(resolveServiceProfessionalChange({
    assignedProfessionalId: null, previousProfessional: external, professionals,
  }), {
    valid: true,
    activity: {
      previousProfessionalId: external.id, previousProfessionalName: "Alex Smith",
      professionalId: null, professionalName: "Unassigned",
    },
  })
})

test("omitted and unchanged assignments do not create duplicate activity", () => {
  for (const assignedProfessionalId of [undefined, internal.id]) {
    assert.deepEqual(resolveServiceProfessionalChange({
      assignedProfessionalId, previousProfessional: internal, professionals,
    }), { valid: true, activity: null })
  }
  assert.deepEqual(resolveServiceProfessionalChange({
    assignedProfessionalId: null, previousProfessional: null, professionals: [],
  }), { valid: true, activity: null })
})

test("professionals outside this service are rejected", () => {
  assert.deepEqual(resolveServiceProfessionalChange({
    assignedProfessionalId: "other-service-or-tenant", previousProfessional: internal, professionals,
  }), { valid: false })
})

test("audit labels fall back to email or external contact when names are absent", () => {
  const previousProfessional = { id: "old", user: { name: " ", email: "old@example.com" } }
  const nextProfessional = { id: "new", externalContact: "new@example.com" }
  const result = resolveServiceProfessionalChange({
    assignedProfessionalId: "new", previousProfessional, professionals: [nextProfessional],
  })
  assert.equal(result.valid, true)
  if (result.valid) {
    assert.equal(result.activity?.previousProfessionalName, "old@example.com")
    assert.equal(result.activity?.professionalName, "new@example.com")
  }
})
