import { serviceStepSelect, saveServiceStepsTx } from "./service-steps.js"
import { z } from "zod"
import { resolvePaymentSettings } from "./service-billing.js"
import { Prisma } from "../generated/prisma/index.js"
import {
  ServiceCollectionError,
  lockServiceConfigurationTx,
  saveServiceCollectionsTx,
  serviceChecklistItemSelect,
  serviceProfessionalSelect,
} from "./service-configuration-collections.js"

export const ServiceSectionModeSchema = z.enum(["INHERIT", "CUSTOM"])
export const serviceSectionModesSchema = z.object({
  billingMode: ServiceSectionModeSchema.optional(),
  checklistMode: ServiceSectionModeSchema.optional(),
  professionalsMode: ServiceSectionModeSchema.optional(),
  stepsMode: ServiceSectionModeSchema.optional(),
})
export const billingSelect = {
  paymentSettings: true,
  basePriceCents: true,
  currency: true,
  isTaxExempt: true,
  allowPartialPayments: true,
  minimumPartialPaymentCents: true,
  installmentCount: true,
  installmentFrequency: true,
} satisfies Prisma.ServiceSelect
const sectionSelect = {
  ...billingSelect,
  steps: {
    where: { archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: serviceStepSelect,
  },
  checklistItems: {
    where: { archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: serviceChecklistItemSelect,
  },
  professionals: {
    where: { archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: serviceProfessionalSelect,
  },
} satisfies Prisma.ServiceSelect
export const serviceConfigurationSelect = {
  id: true,
  name: true,
  description: true,
  ...sectionSelect,
  kind: true,
  billingMode: true,
  checklistMode: true,
  professionalsMode: true,
  stepsMode: true,
  parentServiceId: true,
  parentService: { select: { id: true, name: true, isActive: true, ...sectionSelect } },
} satisfies Prisma.ServiceSelect
type Configuration = Prisma.ServiceGetPayload<{ select: typeof serviceConfigurationSelect }>
const billingKeys = Object.keys(billingSelect) as Array<keyof typeof billingSelect>
export function pickBilling(service: Omit<Pick<Configuration, keyof typeof billingSelect>, "paymentSettings"> & { paymentSettings?: unknown }) {
  return {
    paymentSettings: resolvePaymentSettings(service),
    basePriceCents: service.basePriceCents,
    currency: service.currency,
    isTaxExempt: service.isTaxExempt,
    allowPartialPayments: service.allowPartialPayments,
    minimumPartialPaymentCents: service.minimumPartialPaymentCents,
    installmentCount: service.installmentCount,
    installmentFrequency: service.installmentFrequency,
  }
}
export function resolveServiceConfiguration<T extends Configuration>(service: T) {
  const parent = service.parentService
  const inherited = (mode: string) => service.kind === "OFFERING" && mode === "INHERIT" && !!parent
  return {
    ...service,
    ...pickBilling(inherited(service.billingMode) ? parent! : service),
    steps: inherited(service.stepsMode) ? parent!.steps : service.steps,
    checklistItems: inherited(service.checklistMode)
      ? parent!.checklistItems
      : service.checklistItems,
    professionals: inherited(service.professionalsMode)
      ? parent!.professionals
      : service.professionals,
    parentService: parent ? { id: parent.id, name: parent.name, isActive: parent.isActive } : null,
    inheritance: {
      steps: {
        mode: service.stepsMode,
        sourceServiceId: inherited(service.stepsMode) ? parent!.id : null,
      },
      billing: {
        mode: service.billingMode,
        sourceServiceId: inherited(service.billingMode) ? parent!.id : null,
      },
      checklist: {
        mode: service.checklistMode,
        sourceServiceId: inherited(service.checklistMode) ? parent!.id : null,
      },
      professionals: {
        mode: service.professionalsMode,
        sourceServiceId: inherited(service.professionalsMode) ? parent!.id : null,
      },
    },
  }
}
export async function lockServiceHierarchyTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  serviceId: string,
) {
  const service = await tx.service.findFirst({
    where: { tenantId, id: serviceId },
    select: { parentServiceId: true },
  })
  if (!service) throw new ServiceCollectionError("SERVICE_NOT_FOUND", 404)
  if (service.parentServiceId)
    await lockServiceConfigurationTx(tx, tenantId, service.parentServiceId)
  await lockServiceConfigurationTx(tx, tenantId, serviceId)
}
export async function loadEffectiveServiceConfiguration(
  tx: Prisma.TransactionClient,
  tenantId: string,
  serviceId: string,
) {
  const service = await tx.service.findFirst({
    where: { tenantId, id: serviceId },
    select: serviceConfigurationSelect,
  })
  if (!service) throw new ServiceCollectionError("SERVICE_NOT_FOUND", 404)
  return resolveServiceConfiguration(service)
}

type SectionPatch = z.infer<typeof serviceSectionModesSchema> &
  Partial<ReturnType<typeof pickBilling>> & {
    checklistItems?: unknown[]
    professionals?: unknown[]
    steps?: unknown[]
  }
// Mode changes and copies share the service save transaction. Restoration archives local
// records so existing enrollment history and assignments keep their original references.
export async function prepareServiceSectionsTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  serviceId: string,
  payload: SectionPatch,
) {
  await lockServiceHierarchyTx(tx, tenantId, serviceId)
  const raw = await tx.service.findFirstOrThrow({
    where: { tenantId, id: serviceId },
    select: serviceConfigurationSelect,
  })
  const effective = resolveServiceConfiguration(raw)
  const data: Prisma.ServiceUpdateInput = {}
  const sections = [
    { mode: "billingMode", values: billingKeys },
    { mode: "checklistMode", values: ["checklistItems"] },
    { mode: "professionalsMode", values: ["professionals"] },
    { mode: "stepsMode", values: ["steps"] },
  ] as const
  for (const section of sections) {
    const next = payload[section.mode] ?? raw[section.mode]
    const changing = next !== raw[section.mode]
    const hasValues = section.values.some((key) => payload[key as keyof SectionPatch] !== undefined)
    if (raw.kind === "GROUP" && next === "INHERIT")
      throw new ServiceCollectionError("PARENT_SECTION_CANNOT_INHERIT")
    if (changing && hasValues) throw new ServiceCollectionError("SECTION_MODE_CHANGE_WITH_VALUES")
    if (next === "INHERIT" && hasValues)
      throw new ServiceCollectionError("INHERITED_SECTION_READ_ONLY")
    if (!changing) continue
    data[section.mode] = next
    if (section.mode === "billingMode") {
      if (next === "CUSTOM") Object.assign(data, pickBilling(effective))
    } else if (section.mode === "checklistMode") {
      await saveServiceCollectionsTx(tx, tenantId, serviceId, {
        checklistItems:
          next === "CUSTOM" ? effective.checklistItems.map(({ id, ...item }) => item) : [],
      })
    } else if (section.mode === "professionalsMode") {
      await saveServiceCollectionsTx(tx, tenantId, serviceId, {
        professionals:
          next === "CUSTOM" ? effective.professionals.map(({ id, user, ...item }) => item) : [],
      })
    } else {
      await saveServiceStepsTx(
        tx,
        tenantId,
        serviceId,
        next === "CUSTOM" ? effective.steps.map(({ id, ...step }) => step) : [],
      )
    }
  }
  return data
}

const billingSnapshotSchema = z.object({
  paymentSettings: z.unknown().optional(),
  basePriceCents: z.number().int(),
  currency: z.string(),
  isTaxExempt: z.boolean(),
  allowPartialPayments: z.boolean(),
  minimumPartialPaymentCents: z.number().int().nullable(),
  installmentCount: z.number().int().nullable(),
  installmentFrequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]).nullable(),
  taxEnabled: z.boolean(),
  taxLabel: z.string().nullable(),
  defaultTaxRateBps: z.number().int().nullable(),
})
export function readBillingSnapshot(value: unknown) {
  const parsed = billingSnapshotSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
