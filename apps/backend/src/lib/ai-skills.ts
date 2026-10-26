import { aiProfileRevision } from "./ai-profile-revision.js"
import { knowledgeRevision, knowledgeReadOnlyReason } from "./ai-knowledge.js"
import { z } from "zod"
import type { Prisma, PrismaClient } from "../generated/prisma/index.js"
import {
  buildServiceFitFieldCatalog,
  normalizeServiceFitProfile,
  validateServiceFitProfile,
  SERVICE_FIT_OPERATORS,
  SERVICE_FIT_RULE_SOURCES,
  SERVICE_FIT_VALUE_TYPES,
  type ServiceFitProfile,
} from "./service-fit.js"
import { serviceChecklistItemSelect } from "./service-configuration-collections.js"
import { lockServiceHierarchyTx } from "./service-configuration-inheritance.js"

const optionalLabel = (max: number) => z.string().trim().max(max).nullable()
export const AiQualificationSchema = z
  .object({
    enabled: z.boolean(),
    summary: z.string().trim().max(2000),
    rules: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            source: z.enum(SERVICE_FIT_RULE_SOURCES),
            fieldKey: z.string().trim().min(1).max(120),
            valueType: z.enum(SERVICE_FIT_VALUE_TYPES),
            operator: z.enum(SERVICE_FIT_OPERATORS),
            compareValue: z.json(),
            required: z.boolean(),
            requiredGroup: optionalLabel(120),
            requiredBranch: optionalLabel(120),
            weight: z.number().int().min(1).max(10),
            label: optionalLabel(160),
            explanation: optionalLabel(300),
          })
          .strict(),
      )
      .max(200),
    requirementMetadata: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            description: z.string().trim().max(2000),
          })
          .strict(),
      )
      .max(200),
    optionMetadata: z
      .array(
        z
          .object({
            requirementName: z.string().trim().min(1).max(120),
            optionName: z.string().trim().min(1).max(120),
            description: z.string().trim().max(2000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>()
    value.rules.forEach((rule, index) => {
      if (ids.has(rule.id))
        ctx.addIssue({
          code: "custom",
          path: ["rules", index, "id"],
          message: "Each condition needs a unique ID.",
        })
      ids.add(rule.id)
    })
  })
export const AiQualificationUpdateSchema = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    qualification: AiQualificationSchema,
  })
  .strict()
export type AiQualification = Pick<
  ServiceFitProfile,
  "enabled" | "summary" | "rules" | "requirementMetadata" | "optionMetadata"
>

export class AiSkillError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: string,
  ) {
    super(code)
  }
}
export function qualificationFields(
  profile: ServiceFitProfile,
): AiQualification {
  return {
    enabled: profile.enabled,
    summary: profile.summary,
    rules: profile.rules,
    requirementMetadata: profile.requirementMetadata,
    optionMetadata: profile.optionMetadata,
  }
}
export function aiSkillRevision(value: unknown) {
  return aiProfileRevision(value)
}
export function qualificationReadOnlyReason(raw: unknown) {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== "object" || Array.isArray(raw))
    return "The saved profile format needs review before it can be edited."
  const record = raw as Record<string, unknown>
  const profile = normalizeServiceFitProfile(raw)
  if (
    (record.rules !== undefined && !Array.isArray(record.rules)) ||
    (Array.isArray(record.rules) &&
      record.rules.length !== profile.rules.length)
  )
    return "Some saved conditions use an unsupported format. They have been preserved; saving is disabled until they can be reviewed."
  if (!AiQualificationSchema.safeParse(qualificationFields(profile)).success)
    return "The saved qualification exceeds the editor’s supported limits. It has been preserved; saving is disabled until it can be reviewed."
  return null
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false
  const day = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/)
  if (day) {
    const parsed = new Date(`${day[1]}-${day[2]}-${day[3]}T12:00:00Z`)
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== day[0].slice(0, 10)
    )
      return false
  } else if (/^[\d/]+$/.test(value)) {
    const us = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    return us ? validDate(`${us[3]}-${us[1]}-${us[2]}`) : false
  }
  return !Number.isNaN(new Date(value).getTime())
}

export async function loadAiSkillFields(
  client: Pick<
    PrismaClient,
    "contactStatusConfig" | "tenantTag" | "contactCustomField"
  >,
  tenantId: string,
) {
  const [statuses, tags, customFields] = await Promise.all([
    client.contactStatusConfig.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    client.tenantTag.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    client.contactCustomField.findMany({
      where: { tenantId, isActive: true, isSensitive: false },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: {
        id: true,
        key: true,
        label: true,
        description: true,
        fieldType: true,
        options: true,
      },
    }),
  ])
  return buildServiceFitFieldCatalog({
    statuses,
    tags,
    customFields: customFields.map((field) => ({
      ...field,
      options: Array.isArray(field.options)
        ? field.options.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    })),
  })
}
const linkedSelect = {
  basePriceCents: true,
  currency: true,
  checklistItems: {
    where: { archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: serviceChecklistItemSelect,
  },
} satisfies Prisma.ServiceSelect
export const aiSkillSelect = {
  id: true,
  tenantId: true,
  kind: true,
  name: true,
  description: true,
  isActive: true,
  sortOrder: true,
  fitProfile: true,
  _count: { select: { aiFaqs: true } },
  billingMode: true,
  checklistMode: true,
  ...linkedSelect,
  parentServiceId: true,
  parentService: {
    select: {
      id: true,
      tenantId: true,
      kind: true,
      name: true,
      isActive: true,
      sortOrder: true,
      ...linkedSelect,
    },
  },
} satisfies Prisma.ServiceSelect
export type AiSkillRecord = Prisma.ServiceGetPayload<{
  select: typeof aiSkillSelect
}>
export function presentAiSkill(service: AiSkillRecord) {
  const parent = service.parentService
  const profile = normalizeServiceFitProfile(service.fitProfile)
  const billing = service.billingMode === "INHERIT" && parent ? parent : service
  const checklist =
    service.checklistMode === "INHERIT" && parent ? parent : service
  return {
    id: service.id,
    name: service.name,
    parentId: parent?.id ?? null,
    parentName: parent?.name ?? "No parent service",
    isActive: service.isActive,
    parentActive: parent?.isActive ?? false,
    availableToAssistant:
      service.isActive &&
      parent?.isActive === true &&
      parent.kind === "GROUP" &&
      parent.tenantId === service.tenantId,
    tagline: service.description ?? "",
    faqCount: service._count?.aiFaqs ?? 0,
    knowledgeRevision: knowledgeRevision(service.fitProfile),
    knowledgeReadOnlyReason: knowledgeReadOnlyReason(service.fitProfile),
    revision: aiSkillRevision(service.fitProfile),
    qualification: qualificationFields(profile),
    qualificationReadOnlyReason: qualificationReadOnlyReason(
      service.fitProfile,
    ),
    knowledgeProfile: profile.knowledgeProfile,
    verificationProfile: profile.verificationProfile,
    notes: {
      overview: service.description ?? "",
      pricing: {
        basePriceCents: billing.basePriceCents,
        currency: billing.currency,
      },
      checklist: checklist.checklistItems,
      sources: {
        overview: service.id,
        pricing: billing.id,
        checklist: checklist.id,
      },
    },
  }
}
export async function listAiSkills(client: PrismaClient, tenantId: string) {
  const [rows, fields] = await Promise.all([
    client.service.findMany({
      where: { tenantId, kind: "OFFERING" },
      orderBy: [
        { parentService: { sortOrder: "asc" } },
        { parentService: { name: "asc" } },
        { sortOrder: "asc" },
        { name: "asc" },
        { id: "asc" },
      ],
      select: aiSkillSelect,
    }),
    loadAiSkillFields(client, tenantId),
  ])
  return { skills: rows.map(presentAiSkill), fields }
}
export async function readAiSkill(
  client: PrismaClient,
  tenantId: string,
  serviceId: string,
) {
  const service = await client.service.findFirst({
    where: { tenantId, id: serviceId, kind: "OFFERING" },
    select: aiSkillSelect,
  })
  if (!service) throw new AiSkillError(404, "AI_SKILL_NOT_FOUND")
  return {
    skill: presentAiSkill(service),
    fields: await loadAiSkillFields(client, tenantId),
  }
}
export function mergeAiQualification(
  raw: unknown,
  qualification: AiQualification,
  fields: Awaited<ReturnType<typeof loadAiSkillFields>>,
) {
  const readOnly = qualificationReadOnlyReason(raw)
  if (readOnly)
    throw new AiSkillError(409, "AI_PROFILE_REVIEW_REQUIRED", readOnly)
  const current = normalizeServiceFitProfile(raw)
  // Check strict numeric/date bounds before the engine's compatibility normalizer.
  for (const rule of qualification.rules) {
    const field = fields.find(
      (item) => item.source === rule.source && item.fieldKey === rule.fieldKey,
    )
    if (field && field.valueType !== rule.valueType)
      throw new AiSkillError(
        400,
        "INVALID_SERVICE_FIT_PROFILE",
        "The condition type must match its saved field.",
      )
    if (
      ["is_true", "is_false", "is_empty", "is_not_empty"].includes(
        rule.operator,
      )
    )
      continue
    const range = rule.compareValue as { min?: unknown; max?: unknown } | null
    const values =
      rule.operator === "between"
        ? [range?.min, range?.max]
        : [rule.compareValue]
    if (
      rule.valueType === "number" &&
      values.some(
        (item) =>
          (typeof item !== "number" && typeof item !== "string") ||
          String(item).trim() === "" ||
          !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(
            String(item).trim(),
          ) ||
          !Number.isFinite(Number(item)),
      )
    )
      throw new AiSkillError(
        400,
        "INVALID_SERVICE_FIT_PROFILE",
        "Enter complete numeric values.",
      )
    if (rule.valueType === "date" && values.some((item) => !validDate(item)))
      throw new AiSkillError(
        400,
        "INVALID_SERVICE_FIT_PROFILE",
        "Enter complete, valid dates.",
      )
    if (rule.operator === "between") {
      if (
        !range ||
        range.min == null ||
        range.max == null ||
        (rule.valueType === "number"
          ? Number(range.min) > Number(range.max)
          : new Date(String(range.min)).getTime() >
            new Date(String(range.max)).getTime())
      )
        throw new AiSkillError(
          400,
          "INVALID_SERVICE_FIT_PROFILE",
          "The minimum must be at or below the maximum.",
        )
    }
  }
  const validated = validateServiceFitProfile(
    { ...current, ...qualification },
    fields,
  )
  if (!validated.ok)
    throw new AiSkillError(400, "INVALID_SERVICE_FIT_PROFILE", validated.error)
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  // Preserve knowledge, verification, future top-level data, and extension data on existing conditions.
  const existingRules = new Map(
    (Array.isArray(record.rules) ? record.rules : [])
      .filter((rule): rule is Record<string, unknown> =>
        Boolean(rule && typeof rule === "object" && !Array.isArray(rule)),
      )
      .map((rule) => [rule.id, rule]),
  )
  return {
    ...record,
    ...qualificationFields(validated.profile),
    rules: validated.profile.rules.map((rule) => ({
      ...existingRules.get(rule.id),
      ...rule,
    })),
  } as Prisma.InputJsonObject
}
export async function saveAiQualification(
  client: PrismaClient,
  tenantId: string,
  serviceId: string,
  input: z.infer<typeof AiQualificationUpdateSchema>,
) {
  return client.$transaction(async (tx) => {
    await lockServiceHierarchyTx(tx, tenantId, serviceId)
    const service = await tx.service.findFirst({
      where: { tenantId, id: serviceId, kind: "OFFERING" },
      select: aiSkillSelect,
    })
    if (!service) throw new AiSkillError(404, "AI_SKILL_NOT_FOUND")
    if (aiSkillRevision(service.fitProfile) !== input.revision)
      throw new AiSkillError(409, "AI_QUALIFICATION_CONFLICT")
    const fields = await loadAiSkillFields(tx, tenantId)
    const fitProfile = mergeAiQualification(
      service.fitProfile,
      input.qualification,
      fields,
    )
    const saved = await tx.service.update({
      where: { tenantId_id: { tenantId, id: serviceId } },
      data: { fitProfile },
      select: aiSkillSelect,
    })
    return { skill: presentAiSkill(saved), fields }
  })
}
