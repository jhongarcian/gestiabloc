import { configurationDigest } from "./service-configuration-digest.js"
import { Prisma } from "../generated/prisma/index.js"
import { ServiceCollectionError } from "./service-configuration-collections.js"
import { loadEffectiveServiceConfiguration, lockServiceHierarchyTx } from "./service-configuration-inheritance.js"
import { captureServiceAutomationsTx, readSavedServiceAutomations } from "./service-automation-snapshots.js"
import { captureEnrollmentConfiguration, serializeEnrolledChecklistItem } from "./service-enrollment-snapshots.js"
import { flattenAutomationActionTree, parseActionSnapshot } from "./opportunity-automations.js"

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
const stepDefinition = (step: { sourceStepId?: string; id: string; title: string; instructions: string | null; completionDuration: number; completionUnit: string; sortOrder: number }) => ({
  id: step.sourceStepId ?? step.id, title: step.title, instructions: step.instructions,
  completionDuration: step.completionDuration, completionUnit: step.completionUnit, sortOrder: step.sortOrder,
})
export type ConfigurationDifference = {
  section: "Service" | "Steps" | "Checklist" | "Professionals" | "Automations" | "Billing"
  label: string; kind: "ADD" | "UPDATE" | "REMOVE" | "PRESERVE"
  before: unknown; after: unknown; explanation?: string
}
export type ConfigurationReview = {
  contactServiceId: string; serviceId: string; serviceName: string; contactName: string
  canApply: boolean; hasChanges: boolean; blockers: string[]; differences: ConfigurationDifference[]
  preserved: string[]
  references: Record<string, string>
}
const enrollmentInclude = {
  contact: { select: { firstName: true, lastName: true } },
  serviceSteps: { orderBy: { sortOrder: "asc" }, include: { occurrences: { orderBy: { id: "asc" } } } },
  checklistItems: { orderBy: { id: "asc" }, include: { checklistItem: true, _count: { select: { checklistActivities: true } } } },
  payments: { orderBy: { id: "asc" } },
} satisfies Prisma.ContactServiceInclude
type Enrollment = Prisma.ContactServiceGetPayload<{ include: typeof enrollmentInclude }>
type Effective = Awaited<ReturnType<typeof loadEffectiveServiceConfiguration>>

function differencesById(section: ConfigurationDifference["section"], before: Array<{ id: string }>, after: Array<{ id: string }>, label: (item: any) => string): ConfigurationDifference[] {
  const old = new Map(before.map(item => [item.id, item]))
  const next = new Map(after.map(item => [item.id, item]))
  return [...new Set([...old.keys(), ...next.keys()])].flatMap(id => {
    const previous = old.get(id), current = next.get(id)
    return configurationDigest(previous ?? null) === configurationDigest(current ?? null) ? [] : [{
      section, label: label(current ?? previous), kind: !previous ? "ADD" as const : !current ? "REMOVE" as const : "UPDATE" as const,
      before: previous ?? null, after: current ?? null,
    }]
  })
}

// The entered prefix is immutable. Only unentered future steps can be edited, added,
// reordered or removed. Retained IDs are never replaced, including assigned future steps.
export function buildConfigurationReview(enrollment: Enrollment, target: Effective, serviceAutomations: Awaited<ReturnType<typeof captureServiceAutomationsTx>>, pendingActions: unknown[], activeUserIds?: Set<string>) {
  const blockers: string[] = []
  const differences: ConfigurationDifference[] = []
  if (enrollment.workflowKind !== "SERVICE_STEPS" || !["IN_PROGRESS", "PENDING_PAYMENT"].includes(enrollment.status)) blockers.push("Only active enrollments using service steps can receive updates.")
  const previous = (enrollment.configurationSnapshot ?? {}) as Record<string, any>
  if (!previous.service || previous.service.id !== enrollment.serviceId) blockers.push("This enrollment has no compatible saved configuration.")
  if (target.kind !== "OFFERING" || !target.parentService?.isActive) blockers.push("The sub-service and its parent must be active.")
  const oldSteps = enrollment.serviceSteps.map(stepDefinition)
  const requested = target.steps.map(stepDefinition)
  let lastEntered = -1
  enrollment.serviceSteps.forEach((step, index) => { if (step.occurrences.length) lastEntered = index })
  if (lastEntered < 0) blockers.push("This enrollment has no initialized step entry.")
  const protectedSteps = oldSteps.slice(0, lastEntered + 1)
  if (protectedSteps.some((step, index) => requested[index]?.id !== step.id)) blockers.push("The new step order removes or moves entered work. Keep the entered steps in their saved order before updating this enrollment.")
  const futureSteps = requested.slice(lastEntered + 1).map((step, index) => ({ ...step, sortOrder: (protectedSteps.at(-1)?.sortOrder ?? 0) + (index + 1) * 10 }))
  const finalSteps = [...protectedSteps, ...futureSteps]
  if (enrollment.status === "PENDING_PAYMENT" && futureSteps.length) blockers.push("Finished work awaiting payment cannot receive new unfinished steps. Review the enrollment before changing its workflow.")
  const requestedIds = new Set(requested.map(step => step.id))
  for (const step of enrollment.serviceSteps) {
    if (step.assignedToUserId && !requestedIds.has(step.sourceStepId)) blockers.push(`“${step.title}” has an assigned owner and cannot be removed.`)
  }
  for (const step of protectedSteps) {
    const configured = requested.find(item => item.id === step.id)
    if (configured && configurationDigest(configured) !== configurationDigest(step)) differences.push({ section: "Steps", label: step.title, kind: "PRESERVE", before: step, after: step, explanation: "Entered work retains its saved instructions, position and timeframe." })
  }
  differences.push(...differencesById("Steps", oldSteps, finalSteps, item => item.title))
  const savedChecklist = enrollment.checklistItems.map(item => {
    const saved = serializeEnrolledChecklistItem(item)
    return { id: item.checklistItemId, label: saved.label, description: saved.description, isRequired: saved.isRequired, sortOrder: saved.sortOrder }
  })
  const checklist = target.checklistItems.map(item => ({ ...item }))
  for (const [index, saved] of savedChecklist.entries()) {
    const row = enrollment.checklistItems[index]!
    const requestedItem = checklist.find(item => item.id === saved.id)
    if (!requestedItem || row.status !== "NOT_RECEIVED" || row._count.checklistActivities > 0) {
      if (requestedItem) checklist[checklist.indexOf(requestedItem)] = saved
      else checklist.push(saved)
      if (configurationDigest(saved) !== configurationDigest(requestedItem ?? null)) differences.push({ section: "Checklist", label: saved.label, kind: "PRESERVE", before: saved, after: saved, explanation: requestedItem ? "Checklist work with a status or activity keeps its saved details." : "Removed configuration remains available on this enrollment to preserve its history." })
    }
  }
  differences.push(...differencesById("Checklist", savedChecklist, checklist, item => item.label))
  differences.push(...differencesById("Professionals", previous.professionals ?? [], target.professionals, item => item.externalProfessionalName || item.user?.name || item.user?.email || "Professional"))
  const oldAutomations = readSavedServiceAutomations(previous)
  if (!oldAutomations) differences.push({ section: "Automations", label: "Save service workflows", kind: "ADD", before: null, after: serviceAutomations, explanation: "This older enrollment currently reads live workflows. Applying freezes the reviewed definitions for subsequent events." })
  else differences.push(...differencesById("Automations", oldAutomations.definitions, serviceAutomations.definitions, item => item.name))
  if (previous.billing && configurationDigest(previous.billing) !== configurationDigest({ ...previous.billing, ...Object.fromEntries(Object.keys(target).filter(key => key in previous.billing).map(key => [key, target[key as keyof Effective]])) })) differences.push({ section: "Billing", label: "Purchased billing terms", kind: "PRESERVE", before: previous.billing, after: previous.billing, explanation: "Existing prices, taxes, installments and payments stay unchanged." })
  const finalSourceIds = new Set(finalSteps.map(item => item.id))
  const finalChecklistIds = new Set(checklist.map(item => item.id))
  const finalProfessionalIds = new Set(target.professionals.map(item => item.id))
  for (const actions of [...pendingActions, ...serviceAutomations.definitions.filter(item => item.isEnabled).map(item => item.actions)]) {
    try {
      for (const { action } of flattenAutomationActionTree(parseActionSnapshot(actions))) {
        if (action.type === "MOVE_SERVICE_STEP" && !finalSourceIds.has(action.serviceConfig.targetSourceStepId)) blockers.push("A saved or unfinished workflow targets a step that would be removed.")
        if (action.type === "SET_SERVICE_CHECKLIST_STATUS" && !finalChecklistIds.has(action.serviceConfig.checklistItemId)) blockers.push("A saved or unfinished workflow targets a checklist item unavailable on this enrollment.")
        if (action.type === "SET_SERVICE_PROFESSIONAL" && action.serviceConfig.professionalId && !finalProfessionalIds.has(action.serviceConfig.professionalId)) blockers.push("A saved or unfinished workflow assigns a professional outside the reviewed selection.")
        if ((action.type === "SET_SERVICE_STEP_OWNER" || action.type === "SET_SERVICE_COORDINATOR") && action.serviceConfig.assignedToUserId && activeUserIds && !activeUserIds.has(action.serviceConfig.assignedToUserId)) blockers.push("A saved or unfinished workflow assigns an inactive tenant member.")
      }
    } catch { blockers.push("A saved or unfinished workflow has an unreadable action definition. Review that workflow before applying changes.") }
  }
  const captured = captureEnrollmentConfiguration({
    service: { ...target, steps: finalSteps, checklistItems: checklist }, billing: previous.billing ?? enrollment.billingSnapshot,
    workflowKind: "SERVICE_STEPS", followUpTemplateVersionId: null, serviceAutomations,
  }) as Prisma.InputJsonObject
  // Purchased billing attribution follows the preserved contract, even if configuration
  // switches between inherited and customized pricing after the purchase.
  const snapshot: Prisma.InputJsonObject = { ...captured, ...(previous.inheritance?.billing ? { inheritance: { ...(captured.inheritance as Prisma.InputJsonObject), billing: previous.inheritance.billing } } : {}) }
  const beforeMetadata = { service: previous.service ?? null, inheritance: previous.inheritance ?? null }
  const afterMetadata = { service: snapshot.service, inheritance: snapshot.inheritance }
  if (configurationDigest(beforeMetadata) !== configurationDigest(afterMetadata)) differences.push({ section: "Service", label: "Service details and section sources", kind: "UPDATE", before: beforeMetadata, after: afterMetadata })
  const hasChanges = differences.some(item => item.kind !== "PRESERVE")
  const review: ConfigurationReview = {
    contactServiceId: enrollment.id, serviceId: enrollment.serviceId, serviceName: target.name,
    contactName: [enrollment.contact.firstName, enrollment.contact.lastName].filter(Boolean).join(" ") || "Contact",
    canApply: !blockers.length && hasChanges, hasChanges, blockers: [...new Set(blockers)], differences,
    preserved: ["Completed and entered work", "Checklist statuses, completion times and activity", "Purchased billing terms and all payments", "Coordinator, professional and step-owner assignments", "Manual deadlines and waiting workflow schedules", "Already queued and waiting workflow actions"],
    references: Object.fromEntries([
      [target.id, target.name], ...(target.parentService ? [[target.parentService.id, target.parentService.name]] : []),
      ...oldSteps.map(item => [item.id, item.title]), ...requested.map(item => [item.id, item.title]),
      ...savedChecklist.map(item => [item.id, item.label]), ...checklist.map(item => [item.id, item.label]),
      ...(previous.professionals ?? []).map((item: any) => [item.id, item.externalProfessionalName || item.user?.name || item.user?.email || "Professional"]),
      ...target.professionals.map(item => [item.id, item.externalProfessionalName || item.user?.name || item.user?.email || "Professional"]),
    ]),
  }
  return { review, snapshot, finalSteps, checklist }
}

async function loadReviewTx(tx: Prisma.TransactionClient, tenantId: string, contactServiceId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ContactService" WHERE "tenantId"=${tenantId} AND id=${contactServiceId} FOR UPDATE`)
  const enrollment = await tx.contactService.findFirst({ where: { tenantId, id: contactServiceId }, include: enrollmentInclude })
  if (!enrollment) throw new ServiceCollectionError("CONTACT_SERVICE_NOT_FOUND", 404)
  await lockServiceHierarchyTx(tx, tenantId, enrollment.serviceId)
  const target = await loadEffectiveServiceConfiguration(tx, tenantId, enrollment.serviceId)
  const active = await tx.service.findFirst({ where: { tenantId, id: enrollment.serviceId }, select: { isActive: true } })
  const automations = await captureServiceAutomationsTx(tx, { tenantId, serviceId: enrollment.serviceId, groupId: target.parentService?.id ?? null, sourceStepIds: target.steps.map(step => step.id) })
  const members = await tx.membership.findMany({ where: { tenantId, status: "ACTIVE" }, orderBy: { userId: "asc" }, select: { userId: true, user: { select: { name: true, email: true } } } })
  const contextFilter = { path: ["contactServiceId"], equals: contactServiceId }
  const runs = await tx.automationRun.findMany({ where: { tenantId, serviceContext: contextFilter, status: { in: ["RUNNING", "WAITING", "QUEUED"] } }, orderBy: { id: "asc" }, select: { id: true, status: true, actionSnapshot: true, cursorIndex: true, cursorPath: true, branchDecisions: true, variables: true, resumeAt: true, waitingNodeExecutionId: true, updatedAt: true } })
  const dispatches = await tx.automationDispatch.findMany({ where: { tenantId, event: { serviceContext: contextFilter }, status: { in: ["QUEUED", "PROCESSING"] } }, orderBy: { id: "asc" }, select: { id: true, status: true, actionSnapshot: true } })
  const plan = buildConfigurationReview(enrollment, target, automations, [...runs, ...dispatches].map(item => item.actionSnapshot), new Set(members.map(item => item.userId)))
  for (const member of members) plan.review.references[member.userId] = member.user.name || member.user.email
  if (!active?.isActive) { plan.review.blockers.push("The sub-service must be active."); plan.review.canApply = false }
  return { enrollment, ...plan, baselineDigest: configurationDigest({ enrollment, runs, dispatches }), targetDigest: configurationDigest({ target, automations, active, members }) }
}

export async function previewServiceConfigurationTx(tx: Prisma.TransactionClient, input: { tenantId: string; contactServiceId: string }) {
  const plan = await loadReviewTx(tx, input.tenantId, input.contactServiceId)
  const expiresAt = new Date(Date.now() + 15 * 60_000)
  const receipt = await tx.contactServiceConfigurationChange.create({ data: { ...input, baselineDigest: plan.baselineDigest, targetDigest: plan.targetDigest, preview: json(plan.review), expiresAt } })
  return { ...plan.review, previewId: receipt.id, expiresAt }
}

export async function applyServiceConfigurationTx(tx: Prisma.TransactionClient, input: { tenantId: string; contactServiceId: string; previewId: string; actorUserId: string; actorName: string }) {
  // Enrollment first, like payments, staff controls and workers. Same-preview retries return the receipt.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ContactService" WHERE "tenantId"=${input.tenantId} AND id=${input.contactServiceId} FOR UPDATE`)
  const receipt = await tx.contactServiceConfigurationChange.findFirst({ where: { tenantId: input.tenantId, contactServiceId: input.contactServiceId, id: input.previewId } })
  if (!receipt) throw new ServiceCollectionError("CONFIGURATION_PREVIEW_NOT_FOUND", 404)
  if (receipt.appliedAt) return { appliedAt: receipt.appliedAt, previewId: receipt.id, alreadyApplied: true }
  if (receipt.expiresAt.getTime() <= Date.now()) throw new ServiceCollectionError("CONFIGURATION_PREVIEW_EXPIRED", 409)
  const plan = await loadReviewTx(tx, input.tenantId, input.contactServiceId)
  if (plan.baselineDigest !== receipt.baselineDigest || plan.targetDigest !== receipt.targetDigest) throw new ServiceCollectionError("CONFIGURATION_PREVIEW_STALE", 409)
  if (!plan.review.canApply) throw new ServiceCollectionError("CONFIGURATION_UPDATE_BLOCKED", 409)
  const existing = new Map(plan.enrollment.serviceSteps.map(step => [step.sourceStepId, step]))
  await tx.contactServiceStep.deleteMany({ where: { tenantId: input.tenantId, contactServiceId: input.contactServiceId, sourceStepId: { notIn: plan.finalSteps.map(step => step.id) }, occurrences: { none: {} }, assignedToUserId: null } })
  for (const step of plan.finalSteps) {
    const { id: sourceStepId, ...definition } = step
    const old = existing.get(sourceStepId)
    if (!old) await tx.contactServiceStep.create({ data: { tenantId: input.tenantId, contactServiceId: input.contactServiceId, sourceStepId, ...definition, completionUnit: definition.completionUnit as "MINUTES" | "HOURS" | "DAYS" } })
    else if (!old.occurrences.length && configurationDigest(stepDefinition(old)) !== configurationDigest(step)) await tx.contactServiceStep.update({ where: { id: old.id }, data: { ...definition, completionUnit: definition.completionUnit as "MINUTES" | "HOURS" | "DAYS" } })
  }
  const checklist = new Map(plan.enrollment.checklistItems.map(item => [item.checklistItemId, item]))
  for (const item of plan.checklist) {
    const data = { labelSnapshot: item.label, descriptionSnapshot: item.description, isRequiredSnapshot: item.isRequired, sortOrderSnapshot: item.sortOrder }
    const old = checklist.get(item.id)
    if (!old) await tx.contactServiceChecklistItem.create({ data: { tenantId: input.tenantId, contactServiceId: input.contactServiceId, checklistItemId: item.id, ...data } })
    else if (Object.entries(data).some(([key, value]) => old[key as keyof typeof old] !== value)) await tx.contactServiceChecklistItem.update({ where: { id: old.id }, data })
  }
  await tx.contactService.update({ where: { id: input.contactServiceId }, data: { configurationSnapshot: plan.snapshot } })
  const appliedAt = new Date()
  await tx.contactServiceConfigurationChange.update({ where: { id: receipt.id }, data: { appliedAt, appliedByUserId: input.actorUserId, appliedByName: input.actorName } })
  await tx.serviceFollowUpExecutionLog.create({ data: {
    tenantId: input.tenantId, contactServiceId: input.contactServiceId, contactId: plan.enrollment.contactId,
    actorUserId: input.actorUserId, eventType: "SERVICE_CONFIGURATION_UPDATED", title: "Service configuration updated",
    details: `${input.actorName} applied ${plan.review.differences.filter(item => item.kind !== "PRESERVE").length} reviewed configuration changes. Entered work, billing, assignments and manual schedules were preserved.`,
    payload: json({ previewId: receipt.id, differences: plan.review.differences }),
  } })
  return { appliedAt, previewId: receipt.id, alreadyApplied: false }
}
