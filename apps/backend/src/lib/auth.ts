import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { prisma } from "./prisma"
import dotenv from "dotenv"

dotenv.config()

const TRUSTED_ORIGINS = [
  process.env.WEB_ORIGIN ?? "http://localhost:3000",
  "http://127.0.0.1:3000",
]

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")

const ensureUniqueTenantSlug = async (base: string) => {
  const baseSlug = slugify(base) || "tenant"
  const existing = await prisma.tenant.findUnique({ where: { slug: baseSlug } })
  if (!existing) return baseSlug
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${baseSlug}-${suffix}`
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
  },
  trustedOrigins: TRUSTED_ORIGINS,
  basePath: "/api/auth",
  databaseHooks: {
    user: {
      create: {
        after: async (user, context) => {
          const totalUsers = await prisma.user.count()
          if (totalUsers === 1) {
            await prisma.user.update({
              where: { id: user.id },
              data: { platformRole: "SAAS_OWNER" },
            })
          }

          const body = (context?.body ?? {}) as Record<string, unknown>
          const tenantId =
            typeof body.tenantId === "string" ? body.tenantId : undefined

          if (tenantId) {
            await prisma.membership.create({
              data: {
                userId: user.id,
                tenantId,
                role: "CLIENT_USER",
              },
            })
            return
          }

          const tenantName =
            typeof body.tenantName === "string" && body.tenantName.trim().length
              ? body.tenantName.trim()
              : (user.name ?? user.email.split("@")[0])
          const slug = await ensureUniqueTenantSlug(tenantName)
          const tenant = await prisma.tenant.create({
            data: {
              name: tenantName,
              slug,
            },
          })

          await prisma.membership.create({
            data: {
              userId: user.id,
              tenantId: tenant.id,
              role: "CLIENT_ADMIN",
            },
          })
        },
      },
    },
  },
})
