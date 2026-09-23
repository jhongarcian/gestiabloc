import { randomUUID } from "node:crypto"

import {
  getAutomationActionLabel,
  getAutomationTriggerLabel,
  getContactDisplayName,
} from "./automation-node-executions.js"
import { AutomationActionInputSchema } from "./opportunity-automations.js"

function enrollmentErrorDetails(error: unknown) {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string"
      ? error.code
      : "AUTOMATION_ENROLLMENT_FAILED"
    return { code, message: error.message.slice(0, 500) }
  }

  return {
    code: "AUTOMATION_ENROLLMENT_FAILED",
    message: "The contact could not be enrolled in the automation.",
  }
}

export async function enrollAutomationProcessContact(
  prismaClient: any,
  batch: any,
  item: any,
) {
  const process = batch.process

  try {
    await prismaClient.$transaction(async (transaction: any) => {
      const contact = await transaction.contact.findFirst({
        where: { tenantId: process.tenantId, id: item.contactId },
        select: { id: true, firstName: true, middleName: true, lastName: true },
      })
      if (!contact) throw new Error("This contact is no longer available.")

      const actions = AutomationActionInputSchema.array().max(20).parse(process.actionSnapshot)
      const occurredAt = new Date()
      const attemptId = randomUUID()
      const base = {
        tenantId: process.tenantId,
        automationId: process.automationId,
        automationName: process.automationName,
        contactId: contact.id,
        contactName: getContactDisplayName(contact),
        actorUserId: process.requestedByUserId ?? null,
        processId: process.id,
        opportunityId: null,
        attemptId,
        eventSource: "MANUAL_ENROLLMENT" as const,
        occurredAt,
      }

      await transaction.automationNodeExecution.createMany({
        data: [
          {
            ...base,
            nodeKind: "TRIGGER",
            nodeOrder: 0,
            nodeKey: process.triggerType,
            nodeLabel: getAutomationTriggerLabel(process.triggerType),
            status: "SKIPPED",
            reasonCode: "NO_TRIGGER_EVENT",
            details: "No opportunity event occurred; the contact was enrolled manually.",
          },
          ...actions.map((action, index) => ({
            ...base,
            nodeKind: "ACTION" as const,
            nodeOrder: index + 1,
            nodeKey: action.type,
            nodeLabel: getAutomationActionLabel(action.type),
            status: "SKIPPED" as const,
            reasonCode: "TRIGGER_NOT_MET",
            details: "Skipped because the automation trigger did not run.",
          })),
        ],
      })

      await transaction.automationProcessContact.update({
        where: { id: item.id },
        data: { status: "SUCCEEDED", startedAt: new Date(), completedAt: new Date() },
      })
    })
  } catch (error) {
    const details = enrollmentErrorDetails(error)

    await prismaClient.$transaction([
      prismaClient.automationProcessContact.update({
        where: { id: item.id },
        data: {
          status: "FAILED",
          errorCode: details.code,
          errorMessage: details.message,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      }),
    ])
  }
}
