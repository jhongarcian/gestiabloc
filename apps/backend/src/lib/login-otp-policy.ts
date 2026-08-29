export const LOGIN_CHALLENGE_TTL_MS = 10 * 60 * 1000
export const LOGIN_OTP_TTL_MS = 5 * 60 * 1000
export const LOGIN_OTP_RESEND_COOLDOWN_MS = 30 * 1000
export const LOGIN_OTP_MAX_SENDS = 3

type ChallengePolicyInput = {
  expiresAt: Date
  otpSendCount: number
  otpLastSentAt: Date | null
}

export type OtpSendEligibility =
  | { allowed: true }
  | { allowed: false; reason: "CHALLENGE_EXPIRED" }
  | { allowed: false; reason: "OTP_SEND_LIMIT" }
  | {
      allowed: false
      reason: "OTP_RESEND_TOO_SOON"
      retryAfterSeconds: number
    }

export function getOtpSendEligibility(
  challenge: ChallengePolicyInput,
  now: Date,
): OtpSendEligibility {
  if (challenge.expiresAt.getTime() <= now.getTime()) {
    return { allowed: false, reason: "CHALLENGE_EXPIRED" }
  }

  if (challenge.otpSendCount >= LOGIN_OTP_MAX_SENDS) {
    return { allowed: false, reason: "OTP_SEND_LIMIT" }
  }

  if (challenge.otpLastSentAt) {
    const retryAt =
      challenge.otpLastSentAt.getTime() + LOGIN_OTP_RESEND_COOLDOWN_MS
    if (retryAt > now.getTime()) {
      return {
        allowed: false,
        reason: "OTP_RESEND_TOO_SOON",
        retryAfterSeconds: Math.ceil((retryAt - now.getTime()) / 1000),
      }
    }
  }

  return { allowed: true }
}

export function getLoginOtpExpiresAt(challengeExpiresAt: Date, now: Date) {
  return new Date(
    Math.min(
      challengeExpiresAt.getTime(),
      now.getTime() + LOGIN_OTP_TTL_MS,
    ),
  )
}
