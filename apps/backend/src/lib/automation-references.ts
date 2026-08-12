type AutomationReference =
  | { kind: "pipeline"; id: string }
  | { kind: "stage"; ids: string[] }
  | { kind: "customField"; id: string }
  | { kind: "status"; id: string }
  | { kind: "tag"; id: string }
  | { kind: "user"; id: string }

export async function findEnabledAutomationReference(
  prismaClient: any,
  tenantId: string,
  reference: AutomationReference,
) {
  let referenceWhere: Record<string, unknown>
  if (reference.kind === "pipeline") {
    referenceWhere = { pipelineId: reference.id }
  } else if (reference.kind === "stage") {
    referenceWhere = {
      OR: [
        { sourceStageId: { in: reference.ids } },
        { targetStageId: { in: reference.ids } },
      ],
    }
  } else if (reference.kind === "customField") {
    referenceWhere = {
      OR: [
        { conditions: { some: { customFieldId: reference.id } } },
        { actions: { some: { customFieldId: reference.id } } },
      ],
    }
  } else if (reference.kind === "status") {
    referenceWhere = {
      OR: [
        { conditions: { some: { statusConfigId: reference.id } } },
        { actions: { some: { statusConfigId: reference.id } } },
      ],
    }
  } else if (reference.kind === "tag") {
    referenceWhere = {
      OR: [
        { conditions: { some: { tagId: reference.id } } },
        { actions: { some: { tagId: reference.id } } },
      ],
    }
  } else {
    referenceWhere = {
      OR: [
        { conditions: { some: { assignedUserId: reference.id } } },
        { actions: { some: { assignedUserId: reference.id } } },
      ],
    }
  }

  return prismaClient.automation.findFirst({
    where: { tenantId, isEnabled: true, ...referenceWhere },
    select: { id: true, name: true },
  })
}
