import "dotenv/config"
import { prisma } from "../src/lib/prisma.js"
import {
  WorkflowDefinitionV3Schema,
  checksumWorkflowDefinitionAny,
  convertWorkflowDefinitionV2ToV3,
} from "../src/lib/service-followup-v3-definition.js"

const prismaWithFollowUps = prisma as any
const OPEN_RUN_STATUSES = ["RUNNING", "WAITING", "AWAITING_STEP", "FAILED"]

async function convertTemplate(template: any) {
  const existingV3 = WorkflowDefinitionV3Schema.safeParse(template.draftDefinition)
  if (existingV3.success) {
    return { converted: false, needsRepair: false, runsConverted: 0 }
  }

  const sourceDefinition = template.draftDefinition ?? template.activeVersion?.definition
  const preferredStepOrder = template.steps
    .map((step: any) => step.templateNodeId)
    .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
  const conversion = convertWorkflowDefinitionV2ToV3(sourceDefinition, preferredStepOrder)

  if (!conversion.ok) {
    if (!template.isPublished && !template.activeVersion) {
      // Incomplete drafts remain editable; needsRepair is reserved for published or live ambiguity.
      return { converted: false, needsRepair: false, runsConverted: 0 }
    }
    const runsNeedingReview = await prisma.$transaction(async (tx) => {
      const prismaTx = tx as any
      await prismaTx.serviceFollowUpTemplate.update({
        where: { id: template.id },
        data: {
          needsRepair: true,
          activeVersionId: null,
          isPublished: false,
          publishedAt: null,
        },
      })
      const runs = await prismaTx.contactServiceFollowUpRun.findMany({
        where: {
          contactService: { followUpTemplateId: template.id },
          status: { in: OPEN_RUN_STATUSES },
        },
        select: { id: true },
      })
      if (runs.length) {
        await prismaTx.contactServiceFollowUpRun.updateMany({
          where: { id: { in: runs.map((run: any) => run.id) } },
          data: {
            status: "NEEDS_REVIEW",
            failureCode: "V2_LINEAR_CONVERSION_AMBIGUOUS",
            failureMessage: "This workflow contains routing that cannot be represented as ordered manual steps without guessing.",
            leaseToken: null,
            leaseExpiresAt: null,
          },
        })
      }
      return runs.length
    })
    return { converted: false, needsRepair: true, runsConverted: runsNeedingReview }
  }

  const definition = conversion.definition
  if (!template.isPublished && !template.activeVersion) {
    await prisma.$transaction(async (tx) => {
      const prismaTx = tx as any
      await prismaTx.serviceFollowUpTemplateStep.deleteMany({
        where: { tenantId: template.tenantId, templateId: template.id },
      })
      await prismaTx.serviceFollowUpTemplateStep.createMany({
        data: definition.steps.map((step, index) => ({
          tenantId: template.tenantId,
          serviceId: template.serviceId,
          templateId: template.id,
          templateNodeId: step.id,
          title: step.name,
          notesTemplate: step.notesTemplate ?? null,
          dueDaysFromStart: step.dueDaysFromStart,
          sortOrder: (index + 1) * 10,
        })),
      })
      await prismaTx.serviceFollowUpTemplate.update({
        where: { id: template.id },
        data: { draftDefinition: definition, needsRepair: false },
      })
    })
    return { converted: true, needsRepair: false, runsConverted: 0 }
  }

  const checksum = checksumWorkflowDefinitionAny(definition)
  return prisma.$transaction(async (tx) => {
    const prismaTx = tx as any
    let version = await prismaTx.serviceFollowUpTemplateVersion.findFirst({
      where: { templateId: template.id, checksum },
    })
    if (!version) {
      const latest = await prismaTx.serviceFollowUpTemplateVersion.findFirst({
        where: { templateId: template.id },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      })
      version = await prismaTx.serviceFollowUpTemplateVersion.create({
        data: {
          tenantId: template.tenantId,
          templateId: template.id,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          schemaVersion: 3,
          checksum,
          definition,
          publishedAt: new Date(),
        },
      })
    }

    await prismaTx.serviceFollowUpTemplateStep.deleteMany({
      where: { tenantId: template.tenantId, templateId: template.id },
    })
    await prismaTx.serviceFollowUpTemplateStep.createMany({
      data: definition.steps.map((step, index) => ({
        tenantId: template.tenantId,
        serviceId: template.serviceId,
        templateId: template.id,
        templateNodeId: step.id,
        title: step.name,
        notesTemplate: step.notesTemplate ?? null,
        dueDaysFromStart: step.dueDaysFromStart,
        sortOrder: (index + 1) * 10,
      })),
    })

    await prismaTx.serviceFollowUpTemplate.update({
      where: { id: template.id },
      data: {
        draftDefinition: definition,
        needsRepair: false,
        activeVersionId: template.isPublished ? version.id : null,
        publishedAt: template.isPublished ? version.publishedAt : null,
      },
    })

    const openRuns = await prismaTx.contactServiceFollowUpRun.findMany({
      where: {
        contactService: { followUpTemplateId: template.id },
        status: { in: OPEN_RUN_STATUSES },
        templateVersion: { schemaVersion: 2 },
      },
      select: {
        id: true,
        contactServiceId: true,
        cursorNodeId: true,
        activeStepId: true,
        steps: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, templateNodeId: true, status: true },
        },
      },
    })

    let runsConverted = 0
    for (const run of openRuns) {
      const runStepIds = run.steps.map((step: any) => step.templateNodeId)
      const expectedStepIds = definition.steps.map((step) => step.id)
      const stepOrderMatches =
        runStepIds.length === expectedStepIds.length &&
        runStepIds.every((id: string | null, index: number) => id === expectedStepIds[index])
      if (!stepOrderMatches || !run.cursorNodeId) {
        await prismaTx.contactServiceFollowUpRun.update({
          where: { id: run.id },
          data: {
            status: "NEEDS_REVIEW",
            failureCode: "V2_RUN_LINEAR_STATE_AMBIGUOUS",
            failureMessage: "The active enrollment step order or cursor could not be mapped safely to V3.",
            leaseToken: null,
            leaseExpiresAt: null,
          },
        })
        continue
      }
      const cursorStep = run.steps.find((step: any) => step.templateNodeId === run.cursorNodeId)
      await prismaTx.contactServiceFollowUpRun.update({
        where: { id: run.id },
        data: {
          templateVersionId: version.id,
          activeStepId: run.activeStepId ?? cursorStep?.id ?? null,
        },
      })
      await prismaTx.contactService.update({
        where: { id: run.contactServiceId },
        data: { followUpTemplateVersionId: version.id },
      })
      runsConverted += 1
    }

    return { converted: true, needsRepair: false, runsConverted }
  })
}

async function main() {
  const templates = await prismaWithFollowUps.serviceFollowUpTemplate.findMany({
    where: {
      OR: [
        { activeVersion: { schemaVersion: 2 } },
        { draftDefinition: { not: null } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      tenantId: true,
      serviceId: true,
      isPublished: true,
      draftDefinition: true,
      activeVersion: { select: { definition: true, schemaVersion: true } },
      steps: {
        orderBy: { sortOrder: "asc" },
        select: { templateNodeId: true, sortOrder: true },
      },
    },
  })

  let converted = 0
  let needsRepair = 0
  let runsConverted = 0
  for (const template of templates) {
    const result = await convertTemplate(template)
    if (result.converted) converted += 1
    if (result.needsRepair) needsRepair += 1
    runsConverted += result.runsConverted
  }
  process.stdout.write(
    `Follow-up V3 backfill complete: ${converted} templates converted, ${needsRepair} need repair, ${runsConverted} active runs converted.\n`,
  )
}

main()
  .catch((error) => {
    console.error("Follow-up V3 backfill failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
