import { Router } from "express"
import argon2 from "argon2"
import { z } from "zod"

import { prisma } from "../lib/prisma.js"
import { enforceSameOrigin } from "../lib/security.js"
import { generateOtp6, randomToken, sha256 } from "../lib/crypto.js"
import { clearSessionCookie, setSessionCookie } from "../lib/cookies.js"
import {
  sendLoginOtpEmail,
  sendPasswordResetEmail,
  sendVerifyEmail,
} from "../lib/email.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.")
  .regex(/[^A-Za-z0-9]/, "Password must include at least one symbol.")

const TenantSignupSchema = z.object({
  tenantName: z.string().min(1).max(120),
  planKey: z.enum(["STARTER", "PRO", "BUSINESS"]),
  paidNow: z.boolean().default(false),
  adminName: z.string().min(1).max(120),
  adminEmail: z.string().email().max(255),
  adminPassword: passwordSchema.max(200),
})

function slugifyTenantName(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const RegisterSchema = z.object({
  email: z.string().email().max(255),
  password: passwordSchema.max(200),
  name: z.string().min(1).max(120),
})

const LoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
})

const OtpVerifySchema = z.object({
  challengeToken: z.string().min(20).max(500),
  code: z.string().regex(/^\d{6}$/),
})

const ForgotPasswordSchema = z.object({
  email: z.email().max(255),
})

const ResetPasswordSchema = z.object({
  token: z.string().min(20).max(500),
  newPassword: passwordSchema.max(200),
})

// helper: create session + cookie
async function issueSession(opts: {
  userId: string
  ipAddress?: string | null
  userAgent?: string | null
}) {
  // enforce single-session: delete old session first
  await prisma.session.deleteMany({ where: { userId: opts.userId } })

  const raw = randomToken(32)
  const tokenHash = sha256(raw)

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await prisma.session.create({
    data: {
      userId: opts.userId,
      tokenHash,
      expiresAt,
      ipAddress: opts.ipAddress ?? undefined,
      userAgent: opts.userAgent ?? undefined,
    },
  })

  return { token: raw, expiresAt }
}

async function createEmailVerification(userId: string) {
  const raw = randomToken(32)
  const tokenHash = sha256(raw)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  await prisma.emailVerification.deleteMany({ where: { userId } })
  await prisma.emailVerification.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  })

  return raw
}

async function createPasswordResetToken(userId: string) {
  const raw = randomToken(32)
  const tokenHash = sha256(raw)
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

  await prisma.passwordResetToken.deleteMany({ where: { userId } })
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  })

  return raw
}

/**
 * POST /api/auth/register
 * Creates a user (password-based).
 * You can later force OTP on first login or send verify email.
 */
router.post("/register", async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const { email, password, name } = RegisterSchema.parse(req.body)

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return res.status(409).json({ error: "EMAIL_IN_USE" })

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id })

    const user = await prisma.user.create({
      data: { email, passwordHash, name  },
      select: { id: true, email: true },
    })

    // optional: auto-login after register?
    // We'll NOT auto-login; require login + OTP.
    return res.status(201).json({ ok: true, userId: user.id })
  } catch (e) {
    return next(e)
  }
})

/**
 * POST /api/auth/tenant/signup
 * Public tenant signup: creates Tenant + TenantSubscription + admin User + Membership.
 */
router.post("/tenant/signup", async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const {
      tenantName,
      planKey,
      paidNow,
      adminName,
      adminEmail,
      adminPassword,
    } = TenantSignupSchema.parse(req.body)

    const baseSlug = slugifyTenantName(tenantName)
    if (!baseSlug || baseSlug.length < 2) {
      return res.status(400).json({ error: "INVALID_TENANT_NAME" })
    }

    const [existingUser, existingTenantByEmail] = await Promise.all([
      prisma.user.findUnique({ where: { email: adminEmail } }),
      prisma.tenant.findFirst({ where: { email: adminEmail } }),
    ])

    if (existingUser) return res.status(409).json({ error: "EMAIL_IN_USE" })
    if (existingTenantByEmail)
      return res.status(409).json({ error: "TENANT_EMAIL_IN_USE" })

    let tenantSlug = baseSlug
    for (let i = 0; i < 10; i += 1) {
      const exists = await prisma.tenant.findUnique({
        where: { slug: tenantSlug },
        select: { id: true },
      })
      if (!exists) break
      tenantSlug = `${baseSlug}-${i + 2}`
    }

    const slugTaken = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    })
    if (slugTaken) {
      return res.status(409).json({ error: "TENANT_SLUG_IN_USE" })
    }

    const passwordHash = await argon2.hash(adminPassword, {
      type: argon2.argon2id,
    })

    const seatLimitByPlan: Record<string, number> = {
      STARTER: 3,
      PRO: 10,
      BUSINESS: 25,
    }

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: tenantName,
          slug: tenantSlug,
          email: adminEmail,
        },
        select: { id: true },
      })

      const user = await tx.user.create({
        data: {
          name: adminName,
          email: adminEmail,
          passwordHash,
        },
        select: { id: true },
      })

      await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          role: "TENANT_ADMIN",
        },
      })

      await tx.tenantSubscription.create({
        data: {
          tenantId: tenant.id,
          planKey,
          seatLimit: seatLimitByPlan[planKey] ?? 3,
          status: paidNow ? "ACTIVE" : "TRIALING",
          currentPeriodEnd: paidNow
            ? null
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      return { tenantId: tenant.id, userId: user.id }
    })

    const verifyToken = await createEmailVerification(result.userId)
    const base = (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(
      /\/$/,
      "",
    )
    const verifyUrl = `${base}/verify?token=${encodeURIComponent(verifyToken)}`
    await sendVerifyEmail(adminEmail, verifyUrl)

    return res.status(201).json({ ok: true, ...result })
  } catch (e) {
    return next(e)
  }
})

/**
 * POST /api/auth/login
 * Step 1: verify password -> send OTP -> return challengeToken
 */
router.post("/login", async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const { email, password } = LoginSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { email } })
    // Avoid email enumeration: always respond same-ish
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS" })
    }

    const ok = await argon2.verify(user.passwordHash, password)
    if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS" })

    // If OTP is disabled for some reason, issue session immediately
    if (!user.otpEnabled) {
      const { token } = await issueSession({
        userId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      })
      setSessionCookie(res, token)
      return res.json({ ok: true, requiresOtp: false })
    }

    // Create login challenge (binds OTP step to this login attempt)
    const challengeToken = randomToken(32)
    const nonceHash = sha256(challengeToken)
    const challengeExpiresAt = new Date(Date.now() + 5 * 60 * 1000)

    // Replace any existing challenges for that user
    await prisma.loginChallenge.deleteMany({ where: { userId: user.id } })
    await prisma.loginChallenge.create({
      data: {
        userId: user.id,
        nonceHash,
        expiresAt: challengeExpiresAt,
      },
    })

    // Create OTP for email (hash stored)
    const code = generateOtp6()
    const codeHash = sha256(code)
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000)

    // delete old unused OTPs for this email
    await prisma.emailOtp.deleteMany({
      where: { email, purpose: "LOGIN", usedAt: null },
    })

    await prisma.emailOtp.create({
      data: {
        email,
        purpose: "LOGIN",
        codeHash,
        expiresAt: otpExpiresAt,
      },
    })

    await sendLoginOtpEmail(email, code)

    return res.json({
      ok: true,
      requiresOtp: true,
      challengeToken, // frontend redirects to OTP page with this
    })
  } catch (e) {
    return next(e)
  }
})

/**
 * POST /api/auth/otp/verify
 * Step 2: verify OTP + challenge -> issue session cookie
 */
router.post("/otp/verify", async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const { challengeToken, code } = OtpVerifySchema.parse(req.body)

    const nonceHash = sha256(challengeToken)

    const challenge = await prisma.loginChallenge.findUnique({
      where: { nonceHash },
      include: { user: true },
    })

    if (!challenge) return res.status(401).json({ error: "INVALID_CHALLENGE" })
    if (challenge.expiresAt.getTime() < Date.now()) {
      await prisma.loginChallenge
        .delete({ where: { id: challenge.id } })
        .catch(() => {})
      return res.status(401).json({ error: "CHALLENGE_EXPIRED" })
    }

    // Find latest valid OTP
    const otp = await prisma.emailOtp.findFirst({
      where: {
        email: challenge.user.email,
        purpose: "LOGIN",
        usedAt: null,
      },
      orderBy: { createdAt: "desc" },
    })

    if (!otp) return res.status(401).json({ error: "OTP_NOT_FOUND" })
    if (otp.expiresAt.getTime() < Date.now()) {
      await prisma.emailOtp
        .update({
          where: { id: otp.id },
          data: { usedAt: new Date() },
        })
        .catch(() => {})
      return res.status(401).json({ error: "OTP_EXPIRED" })
    }

    // attempt tracking
    if (otp.attempts >= 5) {
      await prisma.emailOtp
        .update({
          where: { id: otp.id },
          data: { usedAt: new Date() },
        })
        .catch(() => {})
      return res.status(429).json({ error: "TOO_MANY_ATTEMPTS" })
    }

    const codeHash = sha256(code)

    if (codeHash !== otp.codeHash) {
      await prisma.emailOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      })
      return res.status(401).json({ error: "INVALID_OTP" })
    }

    // Mark OTP used + delete challenge
    await prisma.$transaction([
      prisma.emailOtp.update({
        where: { id: otp.id },
        data: { usedAt: new Date() },
      }),
      prisma.loginChallenge.delete({ where: { id: challenge.id } }),
    ])

    // Issue session cookie
    const { token } = await issueSession({
      userId: challenge.userId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] ?? null,
    })

    setSessionCookie(res, token)

    return res.json({ ok: true })
  } catch (e) {
    return next(e)
  }
})

/**
 * GET /api/auth/me
 */
router.get("/me", requireAuth, async (req, res) => {
  const u = (req as AuthedRequest).user
  const user = await prisma.user.findUnique({
    where: { id: u.id },
    select: {
      id: true,
      email: true,
      name: true,
      platformRole: true,
      emailVerified: true,
      memberships: {
        select: {
          role: true,
          status: true,
          tenant: { select: { id: true, slug: true, name: true } },
        },
      },
    },
  })
  return res.json({ ok: true, user })
})

/**
 * GET /api/auth/verify-email?token=...
 * Verifies user email and activates tenant(s) they admin.
 */
router.get("/verify-email", async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const token = String(req.query.token || "")
    if (!token || token.length < 10) {
      return res.status(400).json({ error: "INVALID_TOKEN" })
    }

    const tokenHash = sha256(token)
    const record = await prisma.emailVerification.findUnique({
      where: { tokenHash },
    })

    if (!record) return res.status(404).json({ error: "TOKEN_NOT_FOUND" })
    if (record.usedAt) return res.status(400).json({ error: "TOKEN_USED" })
    if (record.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: "TOKEN_EXPIRED" })
    }

    await prisma.$transaction([
      prisma.emailVerification.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: record.userId },
        data: { emailVerified: true },
      }),
      prisma.tenant.updateMany({
        where: {
          members: {
            some: { userId: record.userId, role: "TENANT_ADMIN" },
          },
        },
        data: { emailVerified: true },
      }),
    ])

    return res.json({ ok: true })
  } catch (e) {
    return next(e)
  }
})

/**
 * POST /api/auth/forgot-password
 * Always returns ok to avoid account enumeration.
 */
router.post("/forgot-password", async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const { email } = ForgotPasswordSchema.parse(req.body)
    const user = await prisma.user.findUnique({ where: { email } })

    if (user) {
      const token = await createPasswordResetToken(user.id)
      const base = (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(
        /\/$/,
        "",
      )
      const resetUrl = `${base}/create-new-password?token=${encodeURIComponent(
        token,
      )}`
      await sendPasswordResetEmail(email, resetUrl)
    }

    return res.json({ ok: true })
  } catch (e) {
    return next(e)
  }
})

/**
 * POST /api/auth/reset-password
 * Resets password and invalidates sessions.
 */
router.post("/reset-password", async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const { token, newPassword } = ResetPasswordSchema.parse(req.body)
    const tokenHash = sha256(token)

    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    })

    if (!record) return res.status(400).json({ error: "TOKEN_NOT_FOUND" })
    if (record.usedAt) return res.status(400).json({ error: "TOKEN_USED" })
    if (record.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: "TOKEN_EXPIRED" })
    }

    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    })

    await prisma.$transaction([
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      prisma.session.deleteMany({ where: { userId: record.userId } }),
    ])

    return res.json({ ok: true })
  } catch (e) {
    return next(e)
  }
})

/**
 * POST /api/auth/logout
 */
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    // Delete session by cookie token hash if present
    const token = req.cookies?.sid
    if (token) {
      const tokenHash = sha256(token)
      await prisma.session.deleteMany({ where: { tokenHash } })
    }

    clearSessionCookie(res)
    return res.json({ ok: true })
  } catch (e) {
    return next(e)
  }
})

export default router
