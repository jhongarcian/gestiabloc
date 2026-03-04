import "dotenv/config"
import http from "http"
import express from "express"
import cors, { type CorsOptions } from "cors"
import cookieParser from "cookie-parser"
import { prisma } from "./lib/prisma"
import { Server } from "socket.io"
import { SESSION_COOKIE_NAME } from "./lib/cookies"
import { sha256 } from "./lib/crypto"
import authRoutes from "./routes/auth.routes"
import filesRoutes from "./routes/files.routes"
import accountSettingsRoutes from "./routes/account-settings.routes"
import contactsRoutes from "./routes/contacts.routes"
import notificationsRoutes from "./routes/notifications.routes"
import tasksRoutes from "./routes/tasks.routes"
import { getUserRoom, setRealtimeServer } from "./lib/realtime"
import {
  getNextPriorityRefreshSchedule,
  refreshTaskPrioritiesForTenants,
} from "./lib/task-priority"
import { materializeTaskNotifications } from "./lib/task-notifications"
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

function hasNumericStatus(error: unknown): error is { status: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  )
}

function hasStringCode(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  )
}

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
app.use("/api/account-settings", accountSettingsRoutes);
app.use("/api/contacts", contactsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/tasks", tasksRoutes);

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

    const status = hasNumericStatus(err) ? err.status : 500

    const prismaCode = hasStringCode(err) ? err.code : null
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

function parseCookieHeader(header: string | undefined) {
  if (!header) return new Map<string, string>()

  return new Map(
    header
      .split(";")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => {
        const separatorIndex = segment.indexOf("=")
        if (separatorIndex === -1) return [segment, ""]
        return [
          decodeURIComponent(segment.slice(0, separatorIndex)),
          decodeURIComponent(segment.slice(separatorIndex + 1)),
        ]
      }),
  )
}

io.use(async (socket, next) => {
  try {
    const cookies = parseCookieHeader(socket.handshake.headers.cookie)
    const token = cookies.get(SESSION_COOKIE_NAME)

    if (!token) {
      return next(new Error("UNAUTHENTICATED"))
    }

    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    })

    if (!session || session.expiresAt.getTime() < Date.now()) {
      return next(new Error("UNAUTHENTICATED"))
    }

    socket.data.userId = session.user.id
    return next()
  } catch (error) {
    return next(error as Error)
  }
})

io.on("connection", (socket) => {
  const userId = socket.data.userId as string | undefined

  if (userId) {
    void socket.join(getUserRoom(userId))
  }

  console.log("socket connected", socket.id)

  socket.on("disconnect", (reason) => {
    console.log("socket disconnected", socket.id, reason)
  })
})

const start = async () => {
  await prisma.$connect()
  setRealtimeServer(io)

  await refreshTaskPrioritiesForTenants().catch((error) => {
    console.error("Failed to refresh task priorities on startup:", error)
  })

  const scheduleTaskPriorityRefresh = () => {
    void getNextPriorityRefreshSchedule()
      .then((schedule) => {
        if (!schedule) {
          const retryTimeout = setTimeout(scheduleTaskPriorityRefresh, 60 * 60 * 1000)
          retryTimeout.unref?.()
          return
        }

        const timeout = setTimeout(() => {
          void refreshTaskPrioritiesForTenants(
            schedule.tenantIds.map((tenantId) => ({
              tenantId,
              timezone: schedule.timezone,
            })),
          )
            .catch((error) => {
              console.error("Failed to refresh task priorities:", error)
            })
            .finally(() => {
              scheduleTaskPriorityRefresh()
            })
        }, schedule.delayMs)

        timeout.unref?.()
      })
      .catch((error) => {
        console.error("Failed to schedule task priority refresh:", error)
        const retryTimeout = setTimeout(scheduleTaskPriorityRefresh, 15 * 60 * 1000)
        retryTimeout.unref?.()
      })
  }

  scheduleTaskPriorityRefresh()

  const reminderInterval = setInterval(() => {
    void materializeTaskNotifications().catch((error) => {
      console.error("Failed to materialize task notifications:", error)
    })
  }, 15_000)

  reminderInterval.unref?.()

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
