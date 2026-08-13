import type { Prisma } from "../generated/prisma/index.js"

export const CONTACT_DEFAULT_STATUSES = [
  {
    name: "Active",
    bgColor: "#DCFCE7",
    textColor: "#166534",
    sortOrder: 10,
  },
  {
    name: "Inactive",
    bgColor: "#E2E8F0",
    textColor: "#334155",
    sortOrder: 20,
  },
  {
    name: "Pending",
    bgColor: "#FEF3C7",
    textColor: "#92400E",
    sortOrder: 30,
  },
] as const

export const TASK_DEFAULT_STATUSES = [
  {
    name: "To Do",
    bgColor: "#E2E8F0",
    textColor: "#334155",
    sortOrder: 10,
  },
  {
    name: "In Progress",
    bgColor: "#DBEAFE",
    textColor: "#1E3A8A",
    sortOrder: 20,
  },
  {
    name: "Completed",
    bgColor: "#DCFCE7",
    textColor: "#166534",
    sortOrder: 30,
  },
] as const

export const STARTER_PIPELINE = {
  name: "Sales Pipeline",
  color: "#4F46E5",
  stages: ["New", "Contacted", "Qualified", "Proposal"],
} as const

type TenantDefaultsClient = Prisma.TransactionClient

export async function ensureDefaultContactStatuses(
  client: TenantDefaultsClient,
  tenantId: string,
) {
  await client.contactStatusConfig.updateMany({
    where: {
      tenantId,
      name: { in: CONTACT_DEFAULT_STATUSES.map((item) => item.name) },
      isSystemDefault: false,
    },
    data: { isSystemDefault: true },
  })

  await client.contactStatusConfig.createMany({
    data: CONTACT_DEFAULT_STATUSES.map((item) => ({
      tenantId,
      ...item,
      isActive: true,
      isSystemDefault: true,
    })),
    skipDuplicates: true,
  })
}

export async function ensureDefaultTaskStatuses(
  client: TenantDefaultsClient,
  tenantId: string,
) {
  await client.taskStatusConfig.updateMany({
    where: {
      tenantId,
      name: { in: TASK_DEFAULT_STATUSES.map((item) => item.name) },
      isSystemDefault: false,
    },
    data: { isSystemDefault: true },
  })

  await client.taskStatusConfig.createMany({
    data: TASK_DEFAULT_STATUSES.map((item) => ({
      tenantId,
      ...item,
      isActive: true,
      isSystemDefault: true,
    })),
    skipDuplicates: true,
  })
}

export async function ensureStarterOpportunityPipeline(
  client: TenantDefaultsClient,
  tenantId: string,
) {
  const pipeline = await client.opportunityPipeline.upsert({
    where: {
      tenantId_name: {
        tenantId,
        name: STARTER_PIPELINE.name,
      },
    },
    update: {},
    create: {
      tenantId,
      name: STARTER_PIPELINE.name,
      color: STARTER_PIPELINE.color,
      sortOrder: 10,
    },
    select: { id: true },
  })

  await client.opportunityPipelineStage.createMany({
    data: STARTER_PIPELINE.stages.map((name, index) => ({
      tenantId,
      pipelineId: pipeline.id,
      name,
      sortOrder: (index + 1) * 10,
    })),
    skipDuplicates: true,
  })

  return client.opportunityPipeline.findUniqueOrThrow({
    where: {
      tenantId_id: {
        tenantId,
        id: pipeline.id,
      },
    },
    select: {
      id: true,
      name: true,
      color: true,
      sortOrder: true,
      stages: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, sortOrder: true },
      },
    },
  })
}

export async function ensureTenantOperationalDefaults(
  client: TenantDefaultsClient,
  tenantId: string,
) {
  await ensureDefaultContactStatuses(client, tenantId)
  await ensureDefaultTaskStatuses(client, tenantId)
  return ensureStarterOpportunityPipeline(client, tenantId)
}
