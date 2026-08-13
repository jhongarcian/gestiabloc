import assert from "node:assert/strict"
import test from "node:test"

import {
  buildOnboardingStateUpdate,
  normalizeOnboardingStep,
} from "./onboarding.js"

const now = new Date("2026-08-11T15:00:00.000Z")

test("normalizes unknown saved steps to welcome", () => {
  assert.equal(normalizeOnboardingStep("unknown"), "welcome")
  assert.equal(normalizeOnboardingStep("workflow"), "workflow")
})

test("advancing starts onboarding and saves the requested step", () => {
  assert.deepEqual(
    buildOnboardingStateUpdate(
      {
        status: "NOT_STARTED",
        currentStep: "welcome",
        startedAt: null,
      },
      { action: "advance", step: "business-profile" },
      now,
    ),
    {
      onboardingStatus: "IN_PROGRESS",
      onboardingCurrentStep: "business-profile",
      onboardingStartedAt: now,
      onboardingChecklistDismissedAt: null,
    },
  )
})

test("skipping preserves the current step and exposes the checklist", () => {
  assert.deepEqual(
    buildOnboardingStateUpdate(
      {
        status: "IN_PROGRESS",
        currentStep: "workflow",
        startedAt: now,
      },
      { action: "skip" },
      now,
    ),
    {
      onboardingStatus: "SKIPPED",
      onboardingStartedAt: now,
      onboardingSkippedAt: now,
      onboardingChecklistDismissedAt: null,
    },
  )
})

test("completed onboarding cannot be reopened accidentally", () => {
  assert.deepEqual(
    buildOnboardingStateUpdate(
      {
        status: "COMPLETED",
        currentStep: "ready",
        startedAt: now,
      },
      { action: "resume" },
      now,
    ),
    {},
  )
})

test("only skipped onboarding can dismiss the dashboard checklist", () => {
  assert.deepEqual(
    buildOnboardingStateUpdate(
      {
        status: "SKIPPED",
        currentStep: "workflow",
        startedAt: now,
      },
      { action: "dismissChecklist" },
      now,
    ),
    { onboardingChecklistDismissedAt: now },
  )

  assert.deepEqual(
    buildOnboardingStateUpdate(
      {
        status: "IN_PROGRESS",
        currentStep: "workflow",
        startedAt: now,
      },
      { action: "dismissChecklist" },
      now,
    ),
    {},
  )
})
