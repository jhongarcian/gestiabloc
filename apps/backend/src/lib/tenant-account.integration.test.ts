import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express, { type ErrorRequestHandler, type Router } from "express"
import cookieParser from "cookie-parser"
import { z } from "zod"
import { sha256 } from "./crypto.js"

// Opt-in, isolated database fixtures. No email, AI, or storage calls are made.
// ACCOUNT_PROFILE_LIVE_TEST=1 node --env-file=.env --import tsx --test src/lib/tenant-account.integration.test.ts
test(
  "shared company information persists through real routes without changing account defaults or helper settings",
  { skip: process.env.ACCOUNT_PROFILE_LIVE_TEST !== "1" },
  async (t) => {
    const { prisma } = await import("./prisma.js")
    const accountRoutes = await import("../routes/account-settings.routes.js")
    const onboardingRoutes = await import("../routes/onboarding.routes.js")
    const tenantId = randomUUID()
    const otherTenantId = randomUUID()
    const userId = randomUUID()
    let token = randomUUID()
    t.after(async () => {
      await prisma.tenant.deleteMany({
        where: { id: { in: [tenantId, otherTenantId] } },
      })
      await prisma.user.deleteMany({ where: { id: userId } })
      await prisma.$disconnect()
    })
    await prisma.tenant.create({
      data: {
        id: tenantId,
        slug: `company-test-${tenantId}`,
        name: "Original company",
        timezone: "America/Chicago",
        taxEnabled: true,
        taxLabel: "Sales Tax",
        defaultTaxRateBps: 825,
        addressLine1: "120 Harbor Avenue",
        addressLine2: "Suite 2",
        aiSettings: {
          create: {
            name: "Existing helper",
            instructions: "Existing instructions",
            avatarPresetId: "compass",
          },
        },
      },
    })
    await prisma.tenant.create({
      data: {
        id: otherTenantId,
        slug: `company-test-${otherTenantId}`,
        name: "Foreign company",
      },
    })
    await prisma.user.create({
      data: {
        id: userId,
        name: "Company Test",
        email: `company-test-${userId}@example.test`,
      },
    })
    await prisma.membership.create({
      data: { tenantId, userId, role: "TENANT_ADMIN", status: "ACTIVE" },
    })
    await prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 300000),
      },
    })
    const app = express()
    app.use(cookieParser(), express.json())
    app.use("/api/account-settings", accountRoutes.default as unknown as Router)
    app.use("/api/onboarding", onboardingRoutes.default as unknown as Router)
    const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
      res
        .status(error instanceof z.ZodError ? 400 : (error.status ?? 500))
        .json({ error: error.message })
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
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const url = `${root}/api/account-settings/${tenantId}/account`
    async function request(method = "GET", body?: unknown) {
      const response = await fetch(url, {
        method,
        headers: { cookie: `sid=${token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: response.status, data: await response.json() }
    }
    const helperBefore = await prisma.tenantAiSettings.findUniqueOrThrow({
      where: { tenantId },
    })
    const initial = (await request()).data.tenant
    assert.equal(initial.description, null)
    assert.equal(initial.revision, 0)
    const companySave = await request("PATCH", {
      revision: 0,
      description: "Saved company context",
      website: "company.example",
      email: "hello@company.example",
      city: "Chicago",
    })
    assert.equal(companySave.status, 200)
    assert.equal(companySave.data.tenant.website, "https://company.example")
    assert.equal(companySave.data.tenant.timezone, "America/Chicago")
    assert.equal(companySave.data.tenant.taxEnabled, true)
    assert.equal(companySave.data.tenant.defaultTaxRatePercent, 8.25)
    assert.equal(companySave.data.tenant.addressLine2, "Suite 2")
    assert.equal(
      (
        await fetch(`${root}/api/account-settings/${otherTenantId}/account`, {
          headers: { cookie: `sid=${token}` },
        })
      ).status,
      403,
    )
    const race = await Promise.all([
      request("PATCH", {
        revision: 1,
        description: "First administrator edit",
      }),
      request("PATCH", {
        revision: 1,
        description: "Second administrator edit",
      }),
    ])
    assert.deepEqual(race.map((item) => item.status).sort(), [200, 409])
    const current = (await request()).data.tenant
    assert.equal(current.revision, 2)
    const accountSave = await request("PATCH", {
      revision: 2,
      name: "Shared company name",
      description: "Updated in Account Settings",
      email: "",
      addressLine2: "",
    })
    assert.equal(accountSave.status, 200)
    assert.equal(
      accountSave.data.tenant.description,
      "Updated in Account Settings",
    )
    assert.equal(accountSave.data.tenant.email, null)
    assert.equal(accountSave.data.tenant.addressLine2, null)
    assert.deepEqual(
      await prisma.tenantAiSettings.findUniqueOrThrow({ where: { tenantId } }),
      helperBefore,
    )
    await prisma.session.deleteMany({ where: { userId } })
    assert.equal((await request()).status, 401)
    token = randomUUID()
    await prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 300000),
      },
    })
    assert.deepEqual((await request()).data.tenant, accountSave.data.tenant)
    const onboarding = await fetch(
      `${root}/api/onboarding/${tenantId}/profile`,
      {
        method: "PATCH",
        headers: { cookie: `sid=${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Updated in onboarding",
          email: null,
          phone: null,
          website: null,
          addressLine1: null,
          addressLine2: null,
          city: null,
          state: null,
          postalCode: null,
          country: null,
          timezone: "America/Chicago",
        }),
      },
    )
    assert.equal(onboarding.status, 200)
    assert.equal(
      (await request("PATCH", { revision: 3, name: "Stale account form" }))
        .status,
      409,
    )
    assert.equal(
      (await request()).data.tenant.description,
      "Updated in Account Settings",
    )
  },
)
