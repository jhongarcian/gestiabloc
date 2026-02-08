import http from "http"
import dotenv from "dotenv"
import express from "express"
import cors, { type CorsOptions } from "cors"
import cookieParser from "cookie-parser"

import { Server } from "socket.io"
import { Prisma, PrismaClient } from "./generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

dotenv.config()

const env = {
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
}

const pool = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter: pool })

const app = express()

const corsOptions: CorsOptions = {
  origin: env.webOrigin,
  credentials: true,
}

app.use(cors(corsOptions))
app.use(express.json())
app.use(cookieParser())

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true })
})

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: env.webOrigin,
    credentials: true,
  },
  cookie: env.cookieDomain
    ? {
        name: "io",
        path: "/",
        domain: env.cookieDomain,
      }
    : false,
})

io.on("connection", (socket) => {
  console.log("socket connected", socket.id)

  socket.on("disconnect", (reason) => {
    console.log("socket disconnected", socket.id, reason)
  })
})

const start = async () => {
  await prisma.$connect()
  server.listen(env.port, () => {
    console.log(`Backend listening on http://localhost:${env.port}`)
    console.log(`CORS origin: ${env.webOrigin}`)
  })
}

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down...`)
  await prisma.$disconnect()
  server.close(() => {
    process.exit(0)
  })
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))

void start().catch((error) => {
  console.error("Failed to start server:", error)
  void prisma.$disconnect()
  process.exit(1)
})
