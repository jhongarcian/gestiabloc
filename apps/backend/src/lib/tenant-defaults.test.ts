import assert from "node:assert/strict"
import test, { describe } from "node:test"

import {
  CONTACT_DEFAULT_STATUSES,
  ensureContactsHaveDefaultStatus,
  ensureDefaultContactStatuses,
  ensureTenantOperationalDefaults,
} from "./tenant-defaults.js"

test("tenant operational defaults are idempotent", async () => {
  const contacts: Array<{ tenantId: string; name: string }> = []
  const tasks: Array<{ tenantId: string; name: string }> = []
  const pipelines: Array<{
    id: string
    tenantId: string
    name: string
    color: string
    sortOrder: number
  }> = []
  const stages: Array<{
    id: string
    tenantId: string
    pipelineId: string
    name: string
    sortOrder: number
  }> = []

  const createStatusModel = (records: Array<{ tenantId: string; name: string }>) => ({
    updateMany: async () => ({ count: 0 }),
    createMany: async ({ data }: { data: Array<{ tenantId: string; name: string }> }) => {
      for (const item of data) {
        if (!records.some((record) => record.tenantId === item.tenantId && record.name === item.name)) {
          records.push({ tenantId: item.tenantId, name: item.name })
        }
      }
      return { count: data.length }
    },
  })

  const fakeClient = {
    contactStatusConfig: createStatusModel(contacts),
    taskStatusConfig: createStatusModel(tasks),
    opportunityPipeline: {
      upsert: async ({
        where,
        create,
      }: {
        where: { tenantId_name: { tenantId: string; name: string } }
        create: { tenantId: string; name: string; color: string; sortOrder: number }
      }) => {
        let pipeline = pipelines.find(
          (item) =>
            item.tenantId === where.tenantId_name.tenantId &&
            item.name === where.tenantId_name.name,
        )
        if (!pipeline) {
          pipeline = { id: `pipeline-${pipelines.length + 1}`, ...create }
          pipelines.push(pipeline)
        }
        return { id: pipeline.id }
      },
      findUniqueOrThrow: async ({ where }: { where: { tenantId_id: { id: string } } }) => {
        const pipeline = pipelines.find((item) => item.id === where.tenantId_id.id)
        if (!pipeline) throw new Error("Pipeline not found")
        return {
          ...pipeline,
          stages: stages.filter((stage) => stage.pipelineId === pipeline.id),
        }
      },
    },
    opportunityPipelineStage: {
      createMany: async ({
        data,
      }: {
        data: Array<{
          tenantId: string
          pipelineId: string
          name: string
          sortOrder: number
        }>
      }) => {
        for (const item of data) {
          if (!stages.some((stage) => stage.pipelineId === item.pipelineId && stage.name === item.name)) {
            stages.push({ id: `stage-${stages.length + 1}`, ...item })
          }
        }
        return { count: data.length }
      },
    },
  }

  await ensureTenantOperationalDefaults(fakeClient as never, "tenant-1")
  await ensureTenantOperationalDefaults(fakeClient as never, "tenant-1")

  assert.deepEqual(
    contacts.map((item) => item.name),
    ["Active", "Inactive", "Pending"],
  )
  assert.deepEqual(
    tasks.map((item) => item.name),
    ["To Do", "In Progress", "Completed"],
  )
  assert.equal(pipelines.length, 1)
  assert.deepEqual(
    stages.map((item) => item.name),
    ["New", "Contacted", "Qualified", "Proposal"],
  )
})

describe("ensureDefaultContactStatuses", () => {
  test("keeps Active, Inactive, and Pending available as system defaults", async () => {
    const calls: Array<{ method: string; args: unknown }> = []
    const client = {
      contactStatusConfig: {
        updateMany: async (args: unknown) => {
          calls.push({ method: "updateMany", args })
        },
        createMany: async (args: unknown) => {
          calls.push({ method: "createMany", args })
        },
      },
    }

    await ensureDefaultContactStatuses(client as never, "tenant-1")

    assert.deepEqual(calls, [
      {
        method: "updateMany",
        args: {
          where: {
            tenantId: "tenant-1",
            name: { in: ["Active", "Inactive", "Pending"] },
          },
          data: { isActive: true, isSystemDefault: true },
        },
      },
      {
        method: "createMany",
        args: {
          data: CONTACT_DEFAULT_STATUSES.map((item) => ({
            tenantId: "tenant-1",
            ...item,
            isActive: true,
            isSystemDefault: true,
          })),
          skipDuplicates: true,
        },
      },
    ])
  })
})

test("legacy contacts without a status are assigned Active before reads", async () => {
  const rawQueryValues: unknown[][] = []
  const rawUpdateValues: unknown[][] = []
  const client = {
    contactStatusConfig: {
      updateMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
      findFirstOrThrow: async () => ({ id: "status-active" }),
    },
    $queryRaw: async (_query: TemplateStringsArray, ...values: unknown[]) => {
      rawQueryValues.push(values)
      return [{ id: "contact-without-status" }]
    },
    $executeRaw: async (_query: TemplateStringsArray, ...values: unknown[]) => {
      rawUpdateValues.push(values)
      return 2
    },
  }

  const statusId = await ensureContactsHaveDefaultStatus(client as never, "tenant-1")

  assert.equal(statusId, "status-active")
  assert.deepEqual(rawQueryValues, [["tenant-1"]])
  assert.deepEqual(rawUpdateValues, [["status-active", "tenant-1"]])
})
