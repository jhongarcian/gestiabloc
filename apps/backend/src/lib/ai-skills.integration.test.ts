import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express, { type ErrorRequestHandler, type Router } from "express"
import cookieParser from "cookie-parser"
import { z } from "zod"
import { sha256 } from "./crypto.js"
import { normalizeServiceFitProfile } from "./service-fit.js"
import { qualificationFields } from "./ai-skills.js"
import { AiKnowledgeSchema } from "./ai-knowledge.js"
import { loadAiChatSnapshot } from "./ai-test-chat.js"

// AI_SKILLS_LIVE_TEST=1 node --env-file=.env --import tsx --test src/lib/ai-skills.integration.test.ts
// Isolated fixtures only. No AI, uploads, email, or external verification calls.
test(
  "real AI skills routes preserve configuration, isolate tenants, and update deterministic fit scans",
  { skip: process.env.AI_SKILLS_LIVE_TEST !== "1" },
  async (t) => {
    const { prisma } = await import("./prisma.js")
    const skillRoutes = await import("../routes/ai-skills.routes.js")
    const settingsRoutes = await import("../routes/ai-settings.routes.js")
    const accountRoutes = await import("../routes/account-settings.routes.js")
    const serviceRoutes = await import("../routes/services.routes.js")
    const tenantId = randomUUID(),
      foreignId = randomUUID(),
      userId = randomUUID()
    let token = randomUUID()
    t.after(async () => {
      await prisma.service.deleteMany({
        where: { tenantId: { in: [tenantId, foreignId] }, kind: "OFFERING" },
      })
      await prisma.tenant.deleteMany({
        where: { id: { in: [tenantId, foreignId] } },
      })
      await prisma.user.deleteMany({ where: { id: userId } })
      await prisma.$disconnect()
    })
    await prisma.tenant.createMany({
      data: [tenantId, foreignId].map((id) => ({
        id,
        slug: `ai-skills-test-${id}`,
        name: "AI Skills Test",
        timezone: "UTC",
      })),
    })
    await prisma.user.create({
      data: {
        id: userId,
        name: "Skills Test",
        email: `skills-${userId}@example.test`,
      },
    })
    await prisma.membership.create({
      data: {
        tenantId,
        userId,
        role: "TENANT_ADMIN",
        status: "ACTIVE",
        securityLevel: "MAX",
      },
    })
    const createSession = () =>
      prisma.session.create({
        data: {
          userId,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 300000),
        },
      })
    await createSession()
    const parent = await prisma.service.create({
      data: {
        tenantId,
        kind: "GROUP",
        name: "Coverage",
        basePriceCents: 12345,
        checklistItems: {
          create: [
            {
              tenantId,
              label: "Identity proof",
              description: "Government ID",
              isRequired: true,
            },
            { tenantId, label: "Old item", archivedAt: new Date() },
          ],
        },
      },
    })
    const inactiveParent = await prisma.service.create({
      data: {
        tenantId,
        kind: "GROUP",
        name: "Retired parent",
        isActive: false,
        basePriceCents: 500,
      },
    })
    const foreignParent = await prisma.service.create({
      data: {
        tenantId: foreignId,
        kind: "GROUP",
        name: "Foreign",
        basePriceCents: 500,
      },
    })
    const initialProfile = {
      enabled: true,
      summary: "Existing rules",
      rules: [
        {
          id: "email",
          source: "core",
          fieldKey: "email",
          valueType: "string",
          operator: "is_not_empty",
          compareValue: null,
          required: true,
          requiredGroup: "Contact",
          requiredBranch: null,
          weight: 1,
        },
        {
          id: "score",
          source: "core",
          fieldKey: "firstName",
          valueType: "string",
          operator: "is_not_empty",
          compareValue: null,
          required: false,
          weight: 7,
        },
      ],
      requirementMetadata: [
        { name: "Contact", description: "Contact requirement" },
      ],
      optionMetadata: [
        {
          requirementName: "Contact",
          optionName: "Contact",
          description: "Email option",
        },
      ],
      knowledgeProfile: {
        overview: "Saved knowledge",
        pricingNotes: "Saved price guidance",
        workflowNotes: "Workflow guidance",
        faqNotes: "Legacy FAQ text",
        adapter: "NONE",
        future: "keep",
      },
      verificationProfile: {
        mode: "NONE",
        guidance: "Verify source",
        sourceUrls: ["https://example.test"],
        triggerKeywords: ["official"],
        future: "keep",
      },
      future: { keep: true },
    }
    const offering = await prisma.service.create({
      data: {
        tenantId,
        kind: "OFFERING",
        parentServiceId: parent.id,
        name: "Active skill",
        description: "Saved service overview",
        basePriceCents: 100,
        billingMode: "INHERIT",
        checklistMode: "INHERIT",
        fitProfile: initialProfile,
        steps: { create: { title: "Intake" } },
      },
    })
    const inactive = await prisma.service.create({
      data: {
        tenantId,
        kind: "OFFERING",
        parentServiceId: parent.id,
        name: "Inactive skill",
        isActive: false,
        basePriceCents: 100,
        fitProfile: initialProfile,
      },
    })
    const parentInactive = await prisma.service.create({
      data: {
        tenantId,
        kind: "OFFERING",
        parentServiceId: inactiveParent.id,
        name: "Parent inactive skill",
        basePriceCents: 100,
        fitProfile: initialProfile,
      },
    })
    const foreign = await prisma.service.create({
      data: {
        tenantId: foreignId,
        kind: "OFFERING",
        parentServiceId: foreignParent.id,
        name: "Foreign skill",
        basePriceCents: 100,
      },
    })
    await prisma.contactCustomField.createMany({
      data: [
        {
          tenantId,
          key: "publicField",
          label: "Public field",
          fieldType: "SELECT",
          options: ["One", "Two"],
        },
        {
          tenantId,
          key: "sensitiveField",
          label: "Sensitive field",
          fieldType: "TEXT",
          isSensitive: true,
        },
        {
          tenantId,
          key: "inactiveField",
          label: "Inactive field",
          fieldType: "TEXT",
          isActive: false,
        },
      ],
    })
    const status = await prisma.contactStatusConfig.create({
      data: {
        tenantId,
        name: "Active",
        bgColor: "#ffffff",
        textColor: "#111111",
      },
    })
    const contact = await prisma.contact.create({
      data: {
        tenantId,
        firstName: "Test",
        lastName: "Contact",
        email: "test@example.test",
        statusConfigId: status.id,
      },
    })
    const stepBefore = await prisma.serviceStep.findMany({
      where: { serviceId: offering.id },
    })
    const app = express()
    app.use(cookieParser(), express.json())
    app.use(
      "/api/account-settings",
      settingsRoutes.default as unknown as Router,
      skillRoutes.default as unknown as Router,
      accountRoutes.default as unknown as Router,
    )
    app.use("/api/services", serviceRoutes.default as unknown as Router)
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
    const path = `/api/account-settings/${tenantId}/ai/skills`
    const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000"
    async function request(
      url = path,
      method = "GET",
      body?: unknown,
      headers: Record<string, string> = {},
    ) {
      const response = await fetch(`${root}${url}`, {
        method,
        headers: {
          cookie: `sid=${token}`,
          origin,
          "content-type": "application/json",
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: response.status, data: await response.json() }
    }
    assert.equal(
      (await request(path, "GET", undefined, { cookie: "" })).status,
      401,
    )
    for (const changes of [
      { role: "TENANT_USER" as const, status: "ACTIVE" as const },
      { role: "TENANT_ADMIN" as const, status: "DISABLED" as const },
    ]) {
      await prisma.membership.update({
        where: { userId_tenantId: { userId, tenantId } },
        data: changes,
      })
      assert.equal((await request()).status, 403)
      assert.equal((await request(`${path}/${offering.id}/faqs`)).status, 403)
      assert.equal(
        (await request(`${path}/${offering.id}/knowledge`, "PATCH", {})).status,
        403,
      )
      assert.equal(
        (await request(`${path}/${offering.id}/qualification`, "PATCH", {}))
          .status,
        403,
      )
    }
    await prisma.membership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { role: "TENANT_ADMIN", status: "ACTIVE" },
    })
    assert.equal(
      (
        await request(
          `/api/account-settings/${foreignId}/ai/skills?tenantId=${tenantId}`,
        )
      ).status,
      403,
    )
    assert.equal((await request(`${path}/${foreign.id}`)).status, 404)
    assert.equal((await request(`${path}/${parent.id}`)).status, 404)
    const catalog = await request()
    assert.equal(catalog.status, 200)
    assert.deepEqual(
      catalog.data.skills.map((skill: { id: string }) => skill.id).sort(),
      [offering.id, inactive.id, parentInactive.id].sort(),
    )
    assert.equal(
      catalog.data.skills.filter(
        (skill: { availableToAssistant: boolean }) =>
          skill.availableToAssistant,
      ).length,
      1,
    )
    assert.ok(
      catalog.data.fields.some(
        (field: { fieldKey: string }) => field.fieldKey === "publicField",
      ),
    )
    assert.equal(
      catalog.data.fields.some((field: { fieldKey: string }) =>
        ["sensitiveField", "inactiveField"].includes(field.fieldKey),
      ),
      false,
    )
    const detail = (await request(`${path}/${offering.id}`)).data
    assert.equal(detail.skill.notes.pricing.basePriceCents, 12345)
    assert.deepEqual(
      detail.skill.notes.checklist.map((item: { label: string }) => item.label),
      ["Identity proof"],
    )
    assert.equal(detail.skill.notes.sources.pricing, parent.id)
    assert.equal(detail.skill.notes.sources.checklist, parent.id)
    assert.equal(detail.skill.notes.overview, "Saved service overview")
    const scanUrl = `/api/services/${tenantId}/fit-scan?contactId=${contact.id}`
    const scanBefore = await request(scanUrl)
    assert.equal(scanBefore.status, 200)
    assert.equal(scanBefore.data.items.length, 1)
    assert.equal(scanBefore.data.items[0].eligibilityStatus, "ELIGIBLE")
    const changed = structuredClone(detail.skill.qualification)
    changed.summary = "Updated from AI workspace"
    changed.rules[0].operator = "equals"
    changed.rules[0].compareValue = "different@example.test"
    const patchUrl = `${path}/${offering.id}/qualification`
    const body = { revision: detail.skill.revision, qualification: changed }
    assert.equal(
      (
        await request(patchUrl, "PATCH", body, {
          origin: "https://foreign.example",
        })
      ).status,
      403,
    )
    assert.equal(
      (await request(patchUrl, "PATCH", { ...body, tenantId: foreignId }))
        .status,
      400,
    )
    assert.equal(
      (await request(`${path}/${foreign.id}/qualification`, "PATCH", body))
        .status,
      404,
    )
    const saved = await request(patchUrl, "PATCH", body)
    assert.equal(saved.status, 200)
    assert.equal((await request(patchUrl, "PATCH", body)).status, 409)
    assert.equal(
      (await request(scanUrl)).data.items[0].eligibilityStatus,
      "NOT_ELIGIBLE",
    )
    const record = await prisma.service.findUniqueOrThrow({
      where: { id: offering.id },
    })
    assert.deepEqual(
      (record.fitProfile as typeof initialProfile).knowledgeProfile,
      initialProfile.knowledgeProfile,
    )
    assert.deepEqual(
      (record.fitProfile as typeof initialProfile).verificationProfile,
      initialProfile.verificationProfile,
    )
    assert.deepEqual(
      (record.fitProfile as typeof initialProfile).future,
      initialProfile.future,
    )
    assert.equal(record.basePriceCents, 100)
    assert.equal(record.billingMode, "INHERIT")
    assert.deepEqual(
      await prisma.serviceStep.findMany({ where: { serviceId: offering.id } }),
      stepBefore,
    )
    assert.deepEqual(
      qualificationFields(normalizeServiceFitProfile(record.fitProfile)),
      changed,
    )
    const race = await Promise.all([
      request(patchUrl, "PATCH", {
        revision: saved.data.skill.revision,
        qualification: { ...changed, summary: "First administrator" },
      }),
      request(patchUrl, "PATCH", {
        revision: saved.data.skill.revision,
        qualification: { ...changed, summary: "Second administrator" },
      }),
    ])
    assert.deepEqual(race.map((item) => item.status).sort(), [200, 409])
    const faqPath = `${path}/${offering.id}/faqs`
    let faqs = (await request(faqPath)).data
    assert.equal(faqs.faqs.length, 0)
    assert.equal((await request(`${path}/${foreign.id}/faqs`)).status, 404)
    const faq = {
      question: "What is the intake code?",
      answer: "Use Harbor H-27. Allow 3 days.",
      exactAnswer: true,
    }
    assert.equal(
      (
        await request(
          faqPath,
          "POST",
          { revision: faqs.revision, faq },
          { origin: "https://foreign.example" },
        )
      ).status,
      403,
    )
    assert.equal(
      (
        await request(faqPath, "POST", {
          revision: faqs.revision,
          faq: { ...faq, question: " " },
        })
      ).status,
      400,
    )
    const created = await request(faqPath, "POST", {
      revision: faqs.revision,
      faq,
    })
    assert.equal(created.status, 201)
    const firstFaqId = created.data.faqs[0].id
    assert.equal(
      (await request(faqPath, "POST", { revision: faqs.revision, faq })).status,
      409,
    )
    faqs = (
      await request(faqPath, "POST", {
        revision: created.data.revision,
        faq: {
          question: "What should I bring?",
          answer: "Original ID.",
          exactAnswer: false,
        },
      })
    ).data
    const secondFaqId = faqs.faqs[1].id
    const reordered = await request(`${faqPath}/order`, "PUT", {
      revision: faqs.revision,
      ids: [secondFaqId, firstFaqId],
    })
    assert.equal(reordered.status, 200)
    assert.deepEqual(
      reordered.data.faqs.map((f: { id: string }) => f.id),
      [secondFaqId, firstFaqId],
    )
    assert.equal(
      (
        await request(`${faqPath}/order`, "PUT", {
          revision: reordered.data.revision,
          ids: [firstFaqId, firstFaqId],
        })
      ).status,
      400,
    )
    const edited = await request(`${faqPath}/${firstFaqId}`, "PATCH", {
      revision: reordered.data.revision,
      faq: { ...faq, answer: "Updated code H-42. Allow 5 days." },
    })
    assert.equal(edited.status, 200)
    assert.equal(edited.data.faqs[1].id, firstFaqId)
    assert.equal(
      (
        await request(`${path}/${foreign.id}/faqs/${firstFaqId}`, "DELETE", {
          revision: edited.data.revision,
        })
      ).status,
      404,
    )
    let snapshot = await loadAiChatSnapshot(prisma, tenantId)
    assert.ok(
      snapshot.sources.some(
        (source) =>
          source.faqId === firstFaqId && source.content.includes("H-42"),
      ),
    )
    const removed = await request(`${faqPath}/${firstFaqId}`, "DELETE", {
      revision: edited.data.revision,
    })
    assert.equal(removed.status, 200)
    snapshot = await loadAiChatSnapshot(prisma, tenantId)
    assert.equal(
      snapshot.sources.some((source) => source.faqId === firstFaqId),
      false,
    )
    const faqRace = await Promise.all(
      [1, 2].map(() =>
        request(faqPath, "POST", { revision: removed.data.revision, faq }),
      ),
    )
    assert.deepEqual(faqRace.map((r) => r.status).sort(), [201, 409])
    const latest = (await request(`${path}/${offering.id}`)).data.skill
    const beforeKnowledge = (
      await prisma.service.findUniqueOrThrow({ where: { id: offering.id } })
    ).fitProfile as Record<string, unknown>
    const knowledge = AiKnowledgeSchema.parse({
      description: "Updated saved knowledge overview",
      pricingNotes: "New pricing guidance",
      workflowNotes: "Updated operating notes",
      adapter: "NONE",
      verification: {
        mode: "NONE",
        guidance: "Confirm intake details",
        triggerKeywords: ["intake"],
      },
    })
    const knowledgeBody = { revision: latest.knowledgeRevision, knowledge }
    assert.equal(
      (
        await request(`${path}/${offering.id}/knowledge`, "PATCH", {
          ...knowledgeBody,
          rules: [],
        })
      ).status,
      400,
    )
    const knowledgeSaved = await request(
      `${path}/${offering.id}/knowledge`,
      "PATCH",
      knowledgeBody,
    )
    assert.equal(knowledgeSaved.status, 200)
    assert.equal(
      (
        await request(
          `${path}/${offering.id}/knowledge`,
          "PATCH",
          knowledgeBody,
        )
      ).status,
      409,
    )
    const afterKnowledge = await prisma.service.findUniqueOrThrow({
      where: { id: offering.id },
    })
    const profileAfter = afterKnowledge.fitProfile as Record<string, unknown>
    assert.deepEqual(profileAfter.rules, beforeKnowledge.rules)
    assert.deepEqual(profileAfter.future, beforeKnowledge.future)
    assert.equal(
      (profileAfter.knowledgeProfile as Record<string, unknown>).faqNotes,
      (beforeKnowledge.knowledgeProfile as Record<string, unknown>).faqNotes,
    )
    assert.deepEqual(
      (profileAfter.verificationProfile as Record<string, unknown>).sourceUrls,
      (beforeKnowledge.verificationProfile as Record<string, unknown>)
        .sourceUrls,
    )
    assert.deepEqual(
      await prisma.serviceStep.findMany({ where: { serviceId: offering.id } }),
      stepBefore,
    )
    assert.equal(afterKnowledge.basePriceCents, 100)
    assert.equal(afterKnowledge.billingMode, "INHERIT")
    snapshot = await loadAiChatSnapshot(prisma, tenantId)
    assert.ok(
      snapshot.sources.some((source) =>
        source.content.includes("Updated saved knowledge overview"),
      ),
    )
    assert.ok(
      snapshot.sources.some((source) =>
        source.content.includes("Updated operating notes"),
      ),
    )
    assert.equal(
      (await request(`${path}/${offering.id}`)).data.skill.faqCount,
      2,
    )
    const beforeOrdinarySave = (
      await prisma.service.findUniqueOrThrow({ where: { id: offering.id } })
    ).fitProfile
    const ordinarySave = await request(
      `/api/account-settings/${tenantId}/services/${offering.id}`,
      "PATCH",
      {
        name: "Updated service name",
        description: "Updated service description",
      },
    )
    assert.equal(ordinarySave.status, 200)
    assert.deepEqual(
      (await prisma.service.findUniqueOrThrow({ where: { id: offering.id } }))
        .fitProfile,
      beforeOrdinarySave,
    )
    await prisma.session.deleteMany({ where: { userId } })
    assert.equal((await request()).status, 401)
    token = randomUUID()
    await createSession()
    assert.deepEqual(
      (await request(`${path}/${offering.id}`)).data.skill.qualification,
      qualificationFields(normalizeServiceFitProfile(beforeOrdinarySave)),
    )
  },
)
