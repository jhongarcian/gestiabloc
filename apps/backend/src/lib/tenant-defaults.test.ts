import assert from "node:assert/strict"
import test from "node:test"

import { ensureTenantOperationalDefaults } from "./tenant-defaults.js"

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
