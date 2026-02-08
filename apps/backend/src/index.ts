import "dotenv/config"
import http from "http"
import express from "express"
import cors, { type CorsOptions } from "cors"
import cookieParser from "cookie-parser"
import { toNodeHandler } from "better-auth/node"
import { auth } from "./lib/auth"
import { prisma } from "./lib/prisma"
import { Server } from "socket.io"

const env = {
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
}

const app = express()

const corsOptions: CorsOptions = {
  origin: env.webOrigin,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
}

app.use(cors(corsOptions))
app.options("/*splat", cors(corsOptions))
app.use(cookieParser())
app.all("/api/auth/*splat", toNodeHandler(auth))
app.use(express.json())

app.get("/api/heartbeat", (_req, res) => {
  res.status(200).json({ ok: true })
})

console.log("AUTH DATABASE_URL =", process.env.DATABASE_URL);
console.log("AUTH dbname =", new URL(process.env.DATABASE_URL!).pathname);

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
