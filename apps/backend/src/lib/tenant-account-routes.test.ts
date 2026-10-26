import assert from "node:assert/strict"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express, { type ErrorRequestHandler, type Router } from "express"
import cookieParser from "cookie-parser"
import { z } from "zod"
import type { TenantAccountRecord } from "./tenant-account.js"

function accountFixture(): TenantAccountRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Existing company",
    description: null,
    accountRevision: 0,
    email: "contact@example.test",
    phone: "+13125550142",
    website: "https://example.test",
    addressLine1: "120 Harbor Avenue",
    addressLine2: "Suite 2",
    city: "Chicago",
    state: "IL",
    postalCode: "60601",
    country: "US",
    timezone: "America/Chicago",
    taxEnabled: true,
    taxLabel: "Sales Tax",
    defaultTaxRateBps: 825,
    emailVerified: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  }
}

test("shared company/account routes enforce access, preserve unrelated settings, and detect stale writes", async (t) => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"
  const { prisma } = await import("./prisma.js")
  const routeModule = await import("../routes/account-settings.routes.js")
  const tenantId = accountFixture().id
  const foreignId = "22222222-2222-4222-8222-222222222222"
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000"
  let record = accountFixture()
  let role = "TENANT_ADMIN"
  let status = "ACTIVE"
  let writes = 0
  const original = {
    session: prisma.session.findUnique,
    membership: prisma.membership.findUnique,
    tenant: prisma.tenant.findUnique,
    transaction: prisma.$transaction,
  }
  prisma.session.findUnique = (async () => ({
    id: "session",
    expiresAt: new Date(Date.now() + 60000),
    user: {
      id: "admin",
      email: "admin@example.test",
      name: "Admin",
      platformRole: "NONE",
    },
  })) as unknown as typeof original.session
  prisma.membership.findUnique = (async ({
    where,
  }: {
    where: { userId_tenantId: { tenantId: string } }
  }) =>
    where.userId_tenantId.tenantId === tenantId
      ? { role, status }
      : null) as unknown as typeof original.membership
  prisma.tenant.findUnique = (async ({ where }: { where: { id: string } }) => {
    assert.equal(where.id, tenantId)
    return record
  }) as unknown as typeof original.tenant
  const tx = {
    tenant: {
      findUnique: async () => record,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; accountRevision: number }
        data: Record<string, unknown>
      }) => {
        assert.equal(where.id, tenantId)
        if (where.accountRevision !== record.accountRevision)
          return { count: 0 }
        writes++
        record = {
          ...record,
          ...data,
          accountRevision: record.accountRevision + 1,
        } as typeof record
        return { count: 1 }
      },
      findUniqueOrThrow: async () => record,
    },
  }
  prisma.$transaction = (async (fn: (client: typeof tx) => unknown) =>
    fn(tx)) as unknown as typeof original.transaction
  t.after(() => {
    prisma.session.findUnique = original.session
    prisma.membership.findUnique = original.membership
    prisma.tenant.findUnique = original.tenant
    prisma.$transaction = original.transaction
  })
  const app = express()
  app.use(cookieParser(), express.json())
  app.use("/api/account-settings", routeModule.default as unknown as Router)
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error instanceof z.ZodError ? 400 : (error.status ?? 500)).json({
      error: error instanceof z.ZodError ? "INVALID_REQUEST" : error.message,
    })
  }
  app.use(handleError)
  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener))
      listener.once("error", reject)
    },
  )
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  )
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/account-settings`
  const headers = {
    cookie: "sid=test",
    origin,
    "content-type": "application/json",
  }
  for (const method of ["GET", "PATCH"]) {
    const request = {
      method,
      headers,
      body:
        method === "PATCH"
          ? JSON.stringify({ revision: 0, name: "Name" })
          : undefined,
    }
    assert.equal(
      (
        await fetch(`${base}/${tenantId}/account`, {
          ...request,
          headers: { "content-type": "application/json" },
        })
      ).status,
      401,
    )
    role = "TENANT_USER"
    assert.equal(
      (await fetch(`${base}/${tenantId}/account`, request)).status,
      403,
    )
    role = "TENANT_ADMIN"
    status = "INACTIVE"
    assert.equal(
      (await fetch(`${base}/${tenantId}/account`, request)).status,
      403,
    )
    status = "ACTIVE"
    assert.equal(
      (
        await fetch(
          `${base}/${foreignId}/account?tenantId=${tenantId}`,
          request,
        )
      ).status,
      403,
    )
  }
  assert.equal(writes, 0)
  const update = {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      revision: 0,
      description: "Saved from AI Company Info",
    }),
  }
  assert.equal(
    (
      await fetch(`${base}/${tenantId}/account`, {
        ...update,
        headers: { ...headers, origin: "https://foreign.example" },
      })
    ).status,
    403,
  )
  const result = await fetch(`${base}/${tenantId}/account`, update)
  assert.equal(result.status, 200)
  const saved = (await result.json()).tenant
  assert.equal(saved.description, "Saved from AI Company Info")
  assert.equal(saved.taxEnabled, true)
  assert.equal(saved.defaultTaxRatePercent, 8.25)
  assert.equal(saved.timezone, "America/Chicago")
  assert.equal(saved.addressLine2, "Suite 2")
  assert.equal(saved.revision, 1)
  assert.equal((await fetch(`${base}/${tenantId}/account`, update)).status, 409)
  assert.deepEqual(
    (await (await fetch(`${base}/${tenantId}/account`, { headers })).json())
      .tenant,
    saved,
  )
  for (const body of [
    { name: "Missing revision" },
    { revision: 1, tenantId: foreignId, name: "Override" },
    { revision: 1, email: "invalid" },
  ])
    assert.equal(
      (
        await fetch(`${base}/${tenantId}/account`, {
          ...update,
          body: JSON.stringify(body),
        })
      ).status,
      400,
    )
  assert.equal(writes, 1)
})
