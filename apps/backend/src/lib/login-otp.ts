import { prisma } from "./prisma.js"
import { generateOtp6, randomToken, sha256 } from "./crypto.js"
import { sendLoginOtpEmail } from "./email.js"
import {
  getLoginOtpExpiresAt,
  getOtpSendEligibility,
  LOGIN_CHALLENGE_TTL_MS,
  LOGIN_OTP_MAX_SENDS,
  LOGIN_OTP_RESEND_COOLDOWN_MS,
  type OtpSendEligibility,
} from "./login-otp-policy.js"

function eligibilityFailureToResult(
  eligibility: Exclude<OtpSendEligibility, { allowed: true }>,
): LoginOtpSendResult {
  if (eligibility.reason === "OTP_RESEND_TOO_SOON") {
    return {
      status: eligibility.reason,
      retryAfterSeconds: eligibility.retryAfterSeconds,
    }
  }
  return { status: eligibility.reason }
}

export async function replaceLoginChallenge(userId: string) {
  const challengeToken = randomToken(32)
  const nonceHash = sha256(challengeToken)
  const expiresAt = new Date(Date.now() + LOGIN_CHALLENGE_TTL_MS)

  await prisma.loginChallenge.upsert({
    where: { userId },
    update: {
      nonceHash,
      expiresAt,
      otpSendCount: 0,
      otpLastSentAt: null,
    },
    create: {
      userId,
      nonceHash,
      expiresAt,
    },
  })

  return { challengeToken, expiresAt }
}

export type LoginOtpSendResult =
  | {
      status: "SENT" | "UNCONFIRMED"
      expiresAt: Date
      resendAvailableAt: Date
      sendsRemaining: number
    }
  | { status: "INVALID_CHALLENGE" | "CHALLENGE_EXPIRED" | "OTP_SEND_LIMIT" }
  | { status: "OTP_RESEND_TOO_SOON"; retryAfterSeconds: number }
  | {
      status: "DELIVERY_FAILED"
      retryAfterSeconds: number
      sendsRemaining: number
    }

export async function sendOtpForChallenge(
  challengeToken: string,
): Promise<LoginOtpSendResult> {
  const nonceHash = sha256(challengeToken)
  const now = new Date()
  const challenge = await prisma.loginChallenge.findUnique({
    where: { nonceHash },
    include: { user: { select: { email: true } } },
  })

  if (!challenge) return { status: "INVALID_CHALLENGE" }

  const eligibility = getOtpSendEligibility(challenge, now)
  if (!eligibility.allowed) return eligibilityFailureToResult(eligibility)

  const cooldownThreshold = new Date(
    now.getTime() - LOGIN_OTP_RESEND_COOLDOWN_MS,
  )
  const claimed = await prisma.loginChallenge.updateMany({
    where: {
      id: challenge.id,
      expiresAt: { gt: now },
      otpSendCount: { lt: LOGIN_OTP_MAX_SENDS },
      OR: [
        { otpLastSentAt: null },
        { otpLastSentAt: { lte: cooldownThreshold } },
      ],
    },
    data: {
      otpSendCount: { increment: 1 },
      otpLastSentAt: now,
    },
  })

  if (!claimed.count) {
    const current = await prisma.loginChallenge.findUnique({
      where: { id: challenge.id },
      select: {
        expiresAt: true,
        otpSendCount: true,
        otpLastSentAt: true,
      },
    })
    if (!current) return { status: "INVALID_CHALLENGE" }
    const currentEligibility = getOtpSendEligibility(current, new Date())
    if (!currentEligibility.allowed) {
      return eligibilityFailureToResult(currentEligibility)
    }
    return { status: "OTP_RESEND_TOO_SOON", retryAfterSeconds: 1 }
  }

  const sendNumber = challenge.otpSendCount + 1
  const sendsRemaining = Math.max(0, LOGIN_OTP_MAX_SENDS - sendNumber)
  const expiresAt = getLoginOtpExpiresAt(challenge.expiresAt, now)
  const resendAvailableAt = new Date(
    now.getTime() + LOGIN_OTP_RESEND_COOLDOWN_MS,
  )
  const code = generateOtp6()

  const createdOtp = await prisma.$transaction(async (tx) => {
    await tx.emailOtp.updateMany({
      where: {
        email: challenge.user.email,
        purpose: "LOGIN",
        usedAt: null,
      },
      data: { usedAt: now },
    })
    return tx.emailOtp.create({
      data: {
        email: challenge.user.email,
        purpose: "LOGIN",
        codeHash: sha256(code),
        expiresAt,
      },
      select: { id: true },
    })
  })

  const delivery = await sendLoginOtpEmail(challenge.user.email, code, {
    idempotencyKey: `login-otp/${challenge.id}/${sendNumber}`,
    timeoutMs: 10_000,
  })

  if (delivery.status === "REJECTED") {
    await prisma.emailOtp.updateMany({
      where: { id: createdOtp.id, usedAt: null },
      data: { usedAt: new Date() },
    })
    return {
      status: "DELIVERY_FAILED",
      retryAfterSeconds: Math.max(
        0,
        Math.ceil((resendAvailableAt.getTime() - Date.now()) / 1000),
      ),
      sendsRemaining,
    }
  }

  return {
    status: delivery.status === "SENT" ? "SENT" : "UNCONFIRMED",
    expiresAt,
    resendAvailableAt,
    sendsRemaining,
  }
}
