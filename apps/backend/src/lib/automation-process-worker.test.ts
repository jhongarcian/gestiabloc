import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { enrollAutomationProcessContact } from "./automation-process-enrollment.js"

describe("enrollAutomationProcessContact", () => {
  test("enrolls a contact without applying actions and records skipped node logs", async () => {
    const enrollmentUpdates: Array<Record<string, unknown>> = []
    const nodeLogWrites: Array<Record<string, unknown>> = []
    const failureUpdates: Array<Record<string, unknown>> = []
    const forbiddenSideEffect = () => {
      throw new Error("Automation actions must not run during enrollment.")
    }

    const transaction = {
      contact: {
        findFirst: async () => ({ id: "contact-1", firstName: "Avery", middleName: null, lastName: "Stone" }),
        update: forbiddenSideEffect,
      },
      contactTag: {
        deleteMany: forbiddenSideEffect,
      },
      automationExecution: {
        create: forbiddenSideEffect,
      },
      automationNodeExecution: {
        createMany: async (args: Record<string, unknown>) => {
          nodeLogWrites.push(args)
        },
      },
      automationProcessContact: {
        update: async (args: Record<string, unknown>) => {
          enrollmentUpdates.push(args)
        },
      },
    }
    const prismaClient = {
      $transaction: async (input: unknown) => {
        if (typeof input === "function") return input(transaction)
        return Promise.all(input as Promise<unknown>[])
      },
      automationProcessContact: {
        update: async (args: Record<string, unknown>) => {
          failureUpdates.push(args)
        },
      },
    }

    await enrollAutomationProcessContact(
      prismaClient,
      {
        process: {
          id: "process-1",
          tenantId: "tenant-1",
          automationId: "automation-1",
          automationName: "Welcome flow",
          triggerType: "OPPORTUNITY_CREATED",
          actionSnapshot: [
            { type: "REMOVE_CONTACT_TAG", tagId: "tag-1" },
            { type: "SET_CONTACT_STATUS", statusConfigId: "status-1" },
          ],
          requestedByUserId: "user-1",
        },
      },
      { id: "process-contact-1", contactId: "contact-1" },
    )

    assert.equal(enrollmentUpdates.length, 1)
    assert.equal(nodeLogWrites.length, 1)
    assert.equal(failureUpdates.length, 0)
    assert.deepEqual(enrollmentUpdates[0]?.where, { id: "process-contact-1" })
    assert.equal(
      (enrollmentUpdates[0]?.data as { status?: string } | undefined)?.status,
      "SUCCEEDED",
    )
    const rows = nodeLogWrites[0]?.data as Array<Record<string, unknown>>
    assert.equal(rows.length, 3)
    assert.deepEqual(rows.map((row) => [row.nodeKind, row.nodeLabel, row.status]), [
      ["TRIGGER", "Opportunity created", "SKIPPED"],
      ["ACTION", "Remove contact tag", "SKIPPED"],
      ["ACTION", "Set contact status", "SKIPPED"],
    ])
    assert.equal(rows[0]?.contactName, "Avery Stone")
  })
})
