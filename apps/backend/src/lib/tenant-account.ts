import { z } from "zod"
import { Prisma, type PrismaClient } from "../generated/prisma/index.js"

const nullableText = (max: number) => z.preprocess((value) => typeof value === "string" ? value.trim() || null : value, z.string().max(max).nullable()).optional()
const email = z.preprocess((value) => typeof value === "string" ? value.trim() || null : value, z.email().max(255).nullable()).optional()
const website = z.preprocess((value) => {
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  if (!trimmed) return null
  return /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
}, z.url().max(255).refine((value) => {
  const url = new URL(value)
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
}, "Enter an http:// or https:// website without login details.").nullable()).optional()
const percentage = z.preprocess((value) => typeof value === "string" ? value.trim() ? Number(value) : null : value, z.number().min(0).max(100).nullable()).optional()

export const TenantAccountUpdateSchema = z.object({
  revision: z.number().int().min(0).max(2147483646),
  name: z.string().trim().min(1).max(120).optional(),
  description: nullableText(4000),
  email,
  phone: nullableText(60),
  website,
  addressLine1: nullableText(255),
  addressLine2: nullableText(255),
  city: nullableText(120),
  state: nullableText(120),
  postalCode: nullableText(40),
  country: nullableText(120),
  timezone: nullableText(100).refine((value) => {
    if (!value) return true
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true } catch { return false }
  }, "Choose a valid timezone."),
  taxEnabled: z.boolean().optional(),
  taxLabel: nullableText(60),
  defaultTaxRatePercent: percentage,
}).strict().refine((value) => Object.entries(value).some(([key, item]) => key !== "revision" && item !== undefined), "Include at least one account field.")

export type TenantAccountUpdate = z.infer<typeof TenantAccountUpdateSchema>
export const tenantAccountSelect = {
  id: true, name: true, description: true, accountRevision: true, email: true, phone: true, website: true,
  addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true, country: true,
  timezone: true, taxEnabled: true, taxLabel: true, defaultTaxRateBps: true, emailVerified: true, createdAt: true, updatedAt: true,
} satisfies Prisma.TenantSelect
export type TenantAccountRecord = Prisma.TenantGetPayload<{ select: typeof tenantAccountSelect }>

export class TenantAccountError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code) }
}

export function presentTenantAccount(record: TenantAccountRecord) {
  const { accountRevision, ...tenant } = record
  return { ...tenant, revision: accountRevision, defaultTaxRatePercent: record.defaultTaxRateBps === null ? null : record.defaultTaxRateBps / 100 }
}

export function prepareTenantAccountUpdate(current: TenantAccountRecord, input: TenantAccountUpdate): Prisma.TenantUpdateManyMutationInput {
  const { revision: _revision, defaultTaxRatePercent, ...patch } = input
  const data: Prisma.TenantUpdateManyMutationInput = { ...patch, accountRevision: { increment: 1 } }
  const taxesChanged = input.taxEnabled !== undefined || input.taxLabel !== undefined || defaultTaxRatePercent !== undefined
  if (taxesChanged) {
    const enabled = input.taxEnabled ?? current.taxEnabled
    const rate = defaultTaxRatePercent === undefined ? current.defaultTaxRateBps : defaultTaxRatePercent === null ? null : Math.round(defaultTaxRatePercent * 100)
    if (enabled && rate === null) throw new z.ZodError([{ code: "custom", path: ["defaultTaxRatePercent"], message: "Tax rate is required when taxes are enabled." }])
    data.taxEnabled = enabled
    data.defaultTaxRateBps = enabled ? rate : null
    data.taxLabel = enabled ? input.taxLabel === undefined ? current.taxLabel : input.taxLabel : null
  }
  return data
}

export async function readTenantAccount(client: PrismaClient, tenantId: string) {
  const tenant = await client.tenant.findUnique({ where: { id: tenantId }, select: tenantAccountSelect })
  if (!tenant) throw new TenantAccountError(404, "TENANT_NOT_FOUND")
  return presentTenantAccount(tenant)
}

export async function saveTenantAccount(client: PrismaClient, tenantId: string, input: TenantAccountUpdate) {
  return client.$transaction(async (tx) => {
    const current = await tx.tenant.findUnique({ where: { id: tenantId }, select: tenantAccountSelect })
    if (!current) throw new TenantAccountError(404, "TENANT_NOT_FOUND")
    if (current.accountRevision !== input.revision) throw new TenantAccountError(409, "ACCOUNT_INFO_CONFLICT")
    const result = await tx.tenant.updateMany({ where: { id: tenantId, accountRevision: input.revision }, data: prepareTenantAccountUpdate(current, input) })
    if (result.count !== 1) throw new TenantAccountError(409, "ACCOUNT_INFO_CONFLICT")
    return presentTenantAccount(await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: tenantAccountSelect }))
  })
}
