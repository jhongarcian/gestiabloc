import { prisma } from "../src/lib/prisma.js"
import {
  checksumWorkflowDefinition,
  convertLegacyWorkflowDefinition,
  validateWorkflowDefinition,
} from "../src/lib/service-followup-definition.js"

const prismaWithFollowUps = prisma as any

async function backfillTemplate(template: any) {
  const definition = convertLegacyWorkflowDefinition(template.flowNodes, template.flowEdges)
  const validation = validateWorkflowDefinition(definition)

  if (!validation.ok) {
    const enrollments = await prisma.$transaction(async (tx) => {
      const prismaTx = tx as any
      await prismaTx.serviceFollowUpTemplate.update({
        where: { id: template.id },
        data: {
          draftDefinition: definition,
          needsRepair: true,
          isPublished: false,
          publishedAt: null,
          activeVersionId: null,
        },
      })
      const legacyEnrollments = await prismaTx.contactService.findMany({
        where: { tenantId: template.tenantId, followUpTemplateId: template.id, followUpRun: null },
        select: { id: true },
      })
      for (const enrollment of legacyEnrollments) {
        const run = await prismaTx.contactServiceFollowUpRun.create({
          data: {
            tenantId: template.tenantId,
            contactServiceId: enrollment.id,
            templateVersionId: null,
            status: "NEEDS_REVIEW",
            variables: {},
            branchDecisions: {},
            failureCode: "LEGACY_GRAPH_NEEDS_REPAIR",
            failureMessage: "The legacy workflow could not be converted without guessing its routing.",
          },
        })
        // Preserve the legacy step records untouched; an administrator can repair this
        // ambiguous enrollment without pretending the invalid graph was reconstructed.
      }
      return legacyEnrollments.length
    })
    return { converted: false, needsRepair: true, enrollments }
  }

  const checksum = checksumWorkflowDefinition(validation.definition)
  const result = await prisma.$transaction(async (tx) => {
    const prismaTx = tx as any
    let version = await prismaTx.serviceFollowUpTemplateVersion.findFirst({
      where: { templateId: template.id, checksum },
    })
    if (!version && template.isPublished) {
      version = await prismaTx.serviceFollowUpTemplateVersion.create({
        data: {
          tenantId: template.tenantId,
          templateId: template.id,
          versionNumber: 1,
          schemaVersion: 2,
          checksum,
          definition: validation.definition,
          publishedAt: template.publishedAt ?? template.updatedAt,
        },
      })
    }

    await prismaTx.serviceFollowUpTemplate.update({
      where: { id: template.id },
      data: {
        draftDefinition: validation.definition,
        needsRepair: false,
        activeVersionId: version?.id ?? null,
        isPublished: Boolean(version),
      },
    })

    if (!version) return { converted: true, needsRepair: false, enrollments: 0 }

    const enrollments = await prismaTx.contactService.findMany({
      where: {
        tenantId: template.tenantId,
        followUpTemplateId: template.id,
        followUpTemplateVersionId: null,
      },
      select: {
        id: true,
        status: true,
        followUpSteps: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            templateNodeId: true,
            status: true,
            availableAt: true,
          },
        },
        executionLogs: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { actorUserId: true },
        },
      },
    })

    for (const enrollment of enrollments) {
      const activeSteps = enrollment.followUpSteps.filter((step: any) => step.status === "ACTIVE")
      const unresolved = enrollment.followUpSteps.filter((step: any) =>
        ["PENDING", "ACTIVE", "POSTPONED"].includes(step.status),
      )
      const allResolved = unresolved.length === 0
      const scheduled = unresolved.find(
        (step: any) =>
          step.status !== "ACTIVE" &&
          step.templateNodeId &&
          step.availableAt &&
          step.availableAt.getTime() > Date.now(),
      )
      const reconstructableActive =
        activeSteps.length === 1 && Boolean(activeSteps[0].templateNodeId)
      const runStatus = allResolved
        ? "COMPLETED"
        : reconstructableActive
          ? "AWAITING_STEP"
          : scheduled
            ? "WAITING"
            : "NEEDS_REVIEW"
      const cursorNodeId = reconstructableActive
        ? activeSteps[0].templateNodeId
        : scheduled?.templateNodeId ?? null
      const run = await prismaTx.contactServiceFollowUpRun.create({
        data: {
          tenantId: template.tenantId,
          contactServiceId: enrollment.id,
          templateVersionId: version.id,
          startedByUserId: enrollment.executionLogs[0]?.actorUserId ?? null,
          status: runStatus,
          cursorNodeId,
          activeStepId: reconstructableActive ? activeSteps[0].id : null,
          resumeAt: scheduled?.availableAt ?? null,
          variables: {},
          branchDecisions: {},
          completedAt: allResolved ? new Date() : null,
        },
      })
      await prismaTx.contactService.update({
        where: { id: enrollment.id },
        data: { followUpTemplateVersionId: version.id },
      })
      if (activeSteps.length <= 1) {
        await prismaTx.contactServiceFollowUpStep.updateMany({
          where: { contactServiceId: enrollment.id },
          data: { runId: run.id },
        })
      }
    }

    return { converted: true, needsRepair: false, enrollments: enrollments.length }
  })

  return result
}

async function main() {
  const templates = await prismaWithFollowUps.serviceFollowUpTemplate.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      tenantId: true,
      isPublished: true,
      publishedAt: true,
      updatedAt: true,
      flowNodes: true,
      flowEdges: true,
    },
  })
  let converted = 0
  let needsRepair = 0
  let enrollments = 0
  for (const template of templates) {
    const result = await backfillTemplate(template)
    if (result.converted) converted += 1
    if (result.needsRepair) needsRepair += 1
    enrollments += result.enrollments
  }
  process.stdout.write(
    `Follow-up V2 backfill complete: ${converted} templates converted, ${needsRepair} need repair, ${enrollments} enrollments pinned.\n`,
  )
}

main()
  .catch((error) => {
    console.error("Follow-up V2 backfill failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
