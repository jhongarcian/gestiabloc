// src/lib/prisma.ts
import { PrismaClient } from "../generated/prisma/index.js"
import { PrismaPg } from "@prisma/adapter-pg"

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing")

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })

const globalForPrisma = global as unknown as { prisma: PrismaClient }

const prisma = globalForPrisma.prisma || new PrismaClient({ adapter })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma

export { prisma }