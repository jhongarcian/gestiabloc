import { Router } from "express"
import argon2 from "argon2"
import { z } from "zod"

import { prisma } from "../lib/prisma.js"
import { enforceSameOrigin } from "../lib/security.js"
import { generateOtp6, randomToken, sha256 } from "../lib/crypto.js"
import { clearSessionCookie, setSessionCookie } from "../lib/cookies.js"
import { sendLoginOtpEmail } from "../lib/email.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()

const RegisterSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
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
  return res.json({ ok: true, user: u })
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
