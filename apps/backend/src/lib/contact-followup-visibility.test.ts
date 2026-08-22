import assert from "node:assert/strict"
import test from "node:test"

import {
  isContactFollowUpServiceVisible,
  summarizeVisibleContactFollowUpServices,
} from "./contact-followup-visibility.js"

test("keeps in-progress services visible when the next step is pending", () => {
  assert.equal(
    isContactFollowUpServiceVisible({ status: "IN_PROGRESS", followUpStepCount: 3 }),
    true,
  )
})

test("keeps resolved follow-ups visible while payment is pending", () => {
  assert.equal(
    isContactFollowUpServiceVisible({ status: "PENDING_PAYMENT", followUpStepCount: 3 }),
    true,
  )
})

test("hides completed, canceled, and step-less services", () => {
  assert.equal(
    isContactFollowUpServiceVisible({ status: "COMPLETED", followUpStepCount: 3 }),
    false,
  )
  assert.equal(
    isContactFollowUpServiceVisible({ status: "CANCELED", followUpStepCount: 3 }),
    false,
  )
  assert.equal(
    isContactFollowUpServiceVisible({ status: "IN_PROGRESS", followUpStepCount: 0 }),
    false,
  )
})

test("deduplicates multiple open enrollments for the same service", () => {
  const result = summarizeVisibleContactFollowUpServices([
    {
      status: "IN_PROGRESS",
      followUpStepCount: 3,
      service: { id: "service-b", name: "Submit application" },
    },
    {
      status: "PENDING_PAYMENT",
      followUpStepCount: 3,
      service: { id: "service-a", name: "Medicare" },
    },
    {
      status: "IN_PROGRESS",
      followUpStepCount: 2,
      service: { id: "service-a", name: "Medicare" },
    },
  ])

  assert.deepEqual(result, [
    { id: "service-a", name: "Medicare" },
    { id: "service-b", name: "Submit application" },
  ])
})

