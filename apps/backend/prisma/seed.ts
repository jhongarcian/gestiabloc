import "dotenv/config"

import argon2 from "argon2"

import {
  getSeatLimitForPlan,
  trialPeriodDays,
} from "../src/lib/subscription-plans.js"
import { prisma } from "../src/lib/prisma.js"

const VALID_PLANS = ["STARTER", "PRO", "BUSINESS"] as const

type PlanKey = (typeof VALID_PLANS)[number]

function getArgValue(flag: string) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function readValue(opts: {
  env: string
  flag: string
  fallback?: string
}) {
  return process.env[opts.env] ?? getArgValue(opts.flag) ?? opts.fallback
}

function requireValue(opts: { env: string; flag: string }) {
  const value = readValue(opts)
  if (!value) {
    throw new Error(`Missing required value. Set ${opts.env} or pass ${opts.flag}.`)
  }
  return value
}

function slugifyTenantName(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function parsePlanKey(value: string | undefined): PlanKey {
  if (!value) return "STARTER"

  const normalized = value.toUpperCase()
  if (VALID_PLANS.includes(normalized as PlanKey)) {
    return normalized as PlanKey
  }

  throw new Error(
    `Invalid plan key "${value}". Expected one of: ${VALID_PLANS.join(", ")}.`,
  )
}

function parseBoolean(value: string | undefined, fallback = false) {
  if (!value) return fallback
  return ["1", "true", "yes", "y"].includes(value.toLowerCase())
}

async function main() {
  const tenantName = requireValue({
    env: "SEED_TENANT_NAME",
    flag: "--tenant-name",
  }).trim()
  const adminName = requireValue({
    env: "SEED_ADMIN_NAME",
    flag: "--admin-name",
  }).trim()
  const adminEmail = requireValue({
    env: "SEED_ADMIN_EMAIL",
    flag: "--admin-email",
  })
    .trim()
    .toLowerCase()
  const adminPassword = requireValue({
    env: "SEED_ADMIN_PASSWORD",
    flag: "--admin-password",
  })

  const tenantSlugInput = readValue({
    env: "SEED_TENANT_SLUG",
    flag: "--tenant-slug",
  })
  const tenantSlug = (tenantSlugInput?.trim() || slugifyTenantName(tenantName)).trim()
  const planKey = parsePlanKey(
    readValue({
      env: "SEED_PLAN_KEY",
      flag: "--plan-key",
      fallback: "STARTER",
    }),
  )
  const paidNow = parseBoolean(
    readValue({
      env: "SEED_PAID_NOW",
      flag: "--paid-now",
    }),
  )

  if (!tenantSlug) {
    throw new Error("Tenant slug resolved to an empty value.")
  }

  const passwordHash = await argon2.hash(adminPassword, {
    type: argon2.argon2id,
  })

  const result = await prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    })
    const existingTenantBySlug = await tx.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true, email: true },
    })

    if (existingUser && existingTenantBySlug && existingUser.id) {
      await tx.user.update({
        where: { id: existingUser.id },
        data: {
          name: adminName,
          passwordHash,
        },
      })

      await tx.tenant.update({
        where: { id: existingTenantBySlug.id },
        data: {
          name: tenantName,
          email: adminEmail,
        },
      })

      await tx.membership.upsert({
        where: {
          userId_tenantId: {
            userId: existingUser.id,
            tenantId: existingTenantBySlug.id,
          },
        },
        update: {
          role: "TENANT_ADMIN",
          status: "ACTIVE",
          securityLevel: "MAX",
        },
        create: {
          userId: existingUser.id,
          tenantId: existingTenantBySlug.id,
          role: "TENANT_ADMIN",
          status: "ACTIVE",
          securityLevel: "MAX",
        },
      })

      const subscription = await tx.tenantSubscription.upsert({
        where: { tenantId: existingTenantBySlug.id },
        update: {
          planKey,
          seatLimit: getSeatLimitForPlan(planKey),
          status: paidNow ? "ACTIVE" : "TRIALING",
          currentPeriodEnd: paidNow
            ? null
            : new Date(Date.now() + trialPeriodDays * 24 * 60 * 60 * 1000),
        },
        create: {
          tenantId: existingTenantBySlug.id,
          planKey,
          seatLimit: getSeatLimitForPlan(planKey),
          status: paidNow ? "ACTIVE" : "TRIALING",
          currentPeriodEnd: paidNow
            ? null
            : new Date(Date.now() + trialPeriodDays * 24 * 60 * 60 * 1000),
        },
      })

      return {
        tenantId: existingTenantBySlug.id,
        userId: existingUser.id,
        subscriptionId: subscription.id,
        action: "updated",
      }
    }

    if (existingUser && !existingTenantBySlug) {
      throw new Error(
        `User ${adminEmail} already exists, but tenant slug ${tenantSlug} does not. Refusing to guess how to attach that user.`,
      )
    }

    if (!existingUser && existingTenantBySlug) {
      throw new Error(
        `Tenant slug ${tenantSlug} already exists, but admin user ${adminEmail} does not. Refusing to guess ownership.`,
      )
    }

    const tenant = await tx.tenant.create({
      data: {
        name: tenantName,
        slug: tenantSlug,
        email: adminEmail,
        emailVerified: true,
      },
      select: { id: true },
    })

    const user = await tx.user.create({
      data: {
        name: adminName,
        email: adminEmail,
        passwordHash,
        emailVerified: true,
      },
      select: { id: true },
    })

    await tx.membership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        role: "TENANT_ADMIN",
        status: "ACTIVE",
        securityLevel: "MAX",
      },
    })

    const subscription = await tx.tenantSubscription.create({
      data: {
        tenantId: tenant.id,
        planKey,
        seatLimit: getSeatLimitForPlan(planKey),
        status: paidNow ? "ACTIVE" : "TRIALING",
        currentPeriodEnd: paidNow
          ? null
          : new Date(Date.now() + trialPeriodDays * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    })

    return {
      tenantId: tenant.id,
      userId: user.id,
      subscriptionId: subscription.id,
      action: "created",
    }
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        ...result,
        tenantSlug,
        adminEmail,
        planKey,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
