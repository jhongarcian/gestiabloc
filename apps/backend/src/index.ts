import "dotenv/config"
import http from "http"
import express from "express"
import cors, { type CorsOptions } from "cors"
import cookieParser from "cookie-parser"
import { prisma } from "./lib/prisma"
import { Server } from "socket.io"
import authRoutes from "./routes/auth.routes"
import filesRoutes from "./routes/files.routes"
import { ZodError } from "zod"
import swaggerUi from "swagger-ui-express"
import { readFileSync } from "fs"
import { resolve } from "path"
import { parse as parseYaml } from "yaml"

const env = {
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
}

const app = express()

const corsOptions: CorsOptions = {
  origin: env.webOrigin,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
}

app.use(cors(corsOptions))
app.options("/*splat", cors(corsOptions))
app.use(cookieParser())
app.use(express.json())

app.get("/api/heartbeat", (_req, res) => {
  res.status(200).json({ ok: true })
})

const openApiPath = resolve(process.cwd(), "docs/openapi.yml")
const openApiSpec = parseYaml(readFileSync(openApiPath, "utf-8"))
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec))

app.use("/api/auth", authRoutes)
app.use("/api/files", filesRoutes);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: "INVALID_REQUEST",
        details: err.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      })
    }

    console.error("API error:", err)

    const status = typeof (err as any)?.status === "number" ? (err as any).status : 500

    const prismaCode = (err as any)?.code
    if (prismaCode === "P2002") {
      return res.status(409).json({ error: "UNIQUE_CONSTRAINT" })
    }

    return res.status(status).json({ error: "INTERNAL_ERROR" })
  },
)

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
