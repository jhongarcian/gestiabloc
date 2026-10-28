import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express, { type ErrorRequestHandler } from "express"
import cookieParser from "cookie-parser"
import { z } from "zod"
import { sha256 } from "./crypto.js"
import { getAiChatProvider } from "./ai-test-chat.js"

// Opt-in: uses isolated DB fixtures and the configured real Groq provider.
// AI_TEST_CHAT_LIVE_TEST=1 node --env-file=.env --import tsx --test src/lib/ai-test-chat.integration.test.ts
test(
  "saved identity, company, multiple active skills and language changes affect real test replies without business-data writes",
  { skip: process.env.AI_TEST_CHAT_LIVE_TEST !== "1" },
  async (t) => {
    const { prisma } = await import("./prisma.js")
    const { createAiTestChatRouter } =
      await import("../routes/ai-test-chat.routes.js")
    assert.ok(
      getAiChatProvider(),
      "Configure the real Groq provider before this opt-in test.",
    )
    const tenantId = randomUUID(),
      otherId = randomUUID(),
      userId = randomUUID(),
      token = randomUUID()
    t.after(async () => {
      await prisma.service.deleteMany({
        where: { tenantId: { in: [tenantId, otherId] }, kind: "OFFERING" },
      })
      await prisma.tenant.deleteMany({
        where: { id: { in: [tenantId, otherId] } },
      })
      await prisma.user.deleteMany({ where: { id: userId } })
      await prisma.$disconnect()
    })
    await prisma.tenant.create({
      data: {
        id: tenantId,
        slug: `chat-test-${tenantId}`,
        name: "Harbor Test Agency",
        description:
          "Located in Westport Harbor. Agency motto: Clear next steps.",
        aiSettings: {
          create: {
            name: "Harbor Helper",
            language: "English",
            tone: "Warm",
            instructions: "End each answer with the words: Harbor hello.",
          },
        },
      },
    })
    await prisma.tenant.create({
      data: {
        id: otherId,
        slug: `chat-test-${otherId}`,
        name: "Foreign Company",
      },
    })
    await prisma.user.create({
      data: {
        id: userId,
        name: "Chat Test",
        email: `chat-test-${userId}@example.test`,
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
    const parent = await prisma.service.create({
      data: {
        tenantId,
        kind: "GROUP",
        name: "Agency services",
        basePriceCents: 7500,
        checklistItems: {
          create: {
            tenantId,
            label: "Original identity document",
            isRequired: true,
          },
        },
      },
    })
    const inactiveParent = await prisma.service.create({
      data: {
        tenantId,
        kind: "GROUP",
        name: "Inactive parent",
        isActive: false,
        basePriceCents: 888800,
      },
    })
    const first = await prisma.service.create({
      data: {
        tenantId,
        kind: "OFFERING",
        parentServiceId: parent.id,
        name: "Registration",
        basePriceCents: 1,
        billingMode: "INHERIT",
        checklistMode: "INHERIT",
        fitProfile: {
          knowledgeProfile: {
            overview: "Assistance preparing vehicle registration.",
            faqNotes: "Appointments are available on weekdays.",
          },
          rules: [
            { secret: "No qualification content should reach the chat." },
          ],
        },
      },
    })
    const second = await prisma.service.create({
      data: {
        tenantId,
        kind: "OFFERING",
        parentServiceId: parent.id,
        name: "Retirement",
        basePriceCents: 12000,
        fitProfile: {
          knowledgeProfile: {
            overview: "Preparation of retirement applications.",
          },
        },
      },
    })
    await prisma.service.createMany({
      data: [
        {
          tenantId,
          kind: "OFFERING",
          parentServiceId: parent.id,
          name: "Secret inactive offering",
          isActive: false,
          basePriceCents: 999900,
        },
        {
          tenantId,
          kind: "OFFERING",
          parentServiceId: inactiveParent.id,
          name: "Secret inactive parent offering",
          basePriceCents: 888800,
        },
      ],
    })
    const app = express()
    app.use(cookieParser(), express.json())
    app.use("/api/account-settings", createAiTestChatRouter())
    const errors: ErrorRequestHandler = (error, _req, res, _next) => {
      res
        .status(error instanceof z.ZodError ? 400 : (error.status ?? 500))
        .json({ error: error.message })
    }
    app.use(errors)
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
      cookie: `sid=${token}`,
      origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
      "content-type": "application/json",
    }
    async function ask(question: string) {
      const response = await fetch(
        `${base}/${tenantId}/ai/test-chat/messages`,
        { method: "POST", headers, body: JSON.stringify({ question }) },
      )
      const body = await response.json()
      assert.equal(response.status, 200, body.error)
      return body.reply as {
        answer: string
        helper: { name: string; tone: string; revision: number }
        sources: Array<{ skillId: string | null; section: string }>
        context: { skillCount: number }
      }
    }
    const before = await prisma.service.findMany({
      where: { tenantId },
      orderBy: { id: "asc" },
    })
    const settingsBefore = await prisma.tenantAiSettings.findUniqueOrThrow({
      where: { tenantId },
    })
    const companyBefore = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
    })
    assert.equal(
      (await fetch(`${base}/${otherId}/ai/test-chat`, { headers })).status,
      403,
    )
    const english = await ask(
      "Identify yourself and the company, then compare Registration and Retirement base prices. Follow the saved writing preferences.",
    )
    assert.match(english.answer, /Harbor Helper/i)
    assert.match(english.answer, /Harbor Test Agency/i)
    assert.match(english.answer, /75/)
    assert.match(english.answer, /120/)
    assert.match(english.answer, /Harbor hello/i)
    assert.ok(
      english.sources.some(
        (source) => source.skillId === first.id && source.section === "pricing",
      ),
    )
    assert.ok(
      english.sources.some(
        (source) =>
          source.skillId === second.id && source.section === "pricing",
      ),
    )
    assert.equal(english.context.skillCount, 2)
    assert.doesNotMatch(english.answer, /9999|8888|Secret inactive/)
    assert.deepEqual(
      await prisma.service.findMany({
        where: { tenantId },
        orderBy: { id: "asc" },
      }),
      before,
    )
    assert.deepEqual(
      await prisma.tenantAiSettings.findUniqueOrThrow({ where: { tenantId } }),
      settingsBefore,
    )
    assert.deepEqual(
      await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      companyBefore,
    )
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { description: "The company motto is Ready together." },
    })
    await prisma.tenantAiSettings.update({
      where: { tenantId },
      data: {
        name: "Harbor Dos",
        language: "English and Spanish",
        tone: "Direct",
        instructions:
          "Termina cada respuesta con las palabras: Saludos Harbor.",
        revision: { increment: 1 },
      },
    })
    const spanish = await ask(
      "¿Cómo te llamas y cuál es el lema de la empresa? Sigue las preferencias guardadas.",
    )
    assert.match(spanish.answer, /Harbor Dos/i)
    assert.match(spanish.answer, /Ready together/i)
    assert.match(spanish.answer, /Saludos Harbor/i)
    assert.match(spanish.answer, /llamo|nombre|soy|lema/i)
    assert.equal(spanish.helper.tone, "Direct")
    assert.equal(spanish.helper.revision, 1)
    const boundary = await ask(
      "Can you decide whether a specific client qualifies and enroll them? Do not use any contact data.",
    )
    assert.match(
      boundary.answer,
      /cannot|can't|unable|no puedo|no puedo|not able/i,
    )
    assert.deepEqual(
      await prisma.service.findMany({
        where: { tenantId },
        orderBy: { id: "asc" },
      }),
      before,
    )
    const exactAnswer =
      "The Registration intake code is Harbor H-27. Allow 3 business days. Bring your original ID."
    const faq = await prisma.serviceAiFaq.create({
      data: {
        tenantId,
        serviceId: first.id,
        question:
          "What is the Registration intake code and what should I bring?",
        answer: exactAnswer,
        exactAnswer: true,
      },
    })
    const exact = await ask(
      "What is the Registration intake code and what do I need to bring?",
    )
    assert.equal(exact.answer, exactAnswer)
    assert.doesNotMatch(exact.answer, /Saludos Harbor/)
    assert.ok(exact.sources.some((source) => source.section === "faq"))
    const translated = await ask(
      "¿Cuál es el código de intake de Registration y qué debo llevar?",
    )
    assert.match(translated.answer, /Harbor H-27/)
    assert.match(translated.answer, /3/)
    assert.match(translated.answer, /original/)
    assert.doesNotMatch(translated.answer, /Saludos Harbor/)
    await prisma.serviceAiFaq.update({
      where: { id: faq.id },
      data: {
        exactAnswer: false,
        answer:
          "The Registration intake code is Harbor H-42. Allow 5 business days. Bring your original ID.",
      },
    })
    const adapted = await ask(
      "What is the Registration intake code? Follow the saved writing preferences.",
    )
    assert.match(adapted.answer, /H-42/)
    assert.match(adapted.answer, /Saludos Harbor/)
    await prisma.serviceAiFaq.delete({ where: { id: faq.id } })
    const removed = await ask("What is the Registration intake code?")
    assert.doesNotMatch(removed.answer, /H-27|H-42/)
    assert.equal(
      removed.sources.some((source) => source.section === "faq"),
      false,
    )
  },
)
