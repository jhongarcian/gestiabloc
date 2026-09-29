// src/lib/prisma.ts
import { PrismaClient } from "../generated/prisma/index.js"
import { PrismaPg } from "@prisma/adapter-pg"

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing")

const configuredPoolSize = Number(process.env.PRISMA_POOL_MAX ?? "20")
if (!Number.isInteger(configuredPoolSize) || configuredPoolSize < 5 || configuredPoolSize > 100) {
  throw new Error("PRISMA_POOL_MAX must be an integer between 5 and 100.")
}

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
  max: configuredPoolSize,
})

const globalForPrisma = global as unknown as { prisma: PrismaClient }

const prisma = globalForPrisma.prisma || new PrismaClient({ adapter })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma

export { prisma }
