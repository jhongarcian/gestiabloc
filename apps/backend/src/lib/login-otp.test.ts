import assert from "node:assert/strict"
import test from "node:test"

import {
  getLoginOtpExpiresAt,
  getOtpSendEligibility,
  LOGIN_OTP_MAX_SENDS,
} from "./login-otp-policy.js"
import { generateOtp6 } from "./crypto.js"

const now = new Date("2026-08-29T18:00:00.000Z")

test("allows an OTP send for a current unused challenge", () => {
  assert.deepEqual(
    getOtpSendEligibility(
      {
        expiresAt: new Date("2026-08-29T18:10:00.000Z"),
        otpSendCount: 0,
        otpLastSentAt: null,
      },
      now,
    ),
    { allowed: true },
  )
})

test("generates fixed-width numeric OTP values", () => {
  for (let index = 0; index < 100; index += 1) {
    assert.match(generateOtp6(), /^\d{6}$/)
  }
})

test("enforces the resend cooldown using an exact retry duration", () => {
  assert.deepEqual(
    getOtpSendEligibility(
      {
        expiresAt: new Date("2026-08-29T18:10:00.000Z"),
        otpSendCount: 1,
        otpLastSentAt: new Date("2026-08-29T17:59:48.000Z"),
      },
      now,
    ),
    {
      allowed: false,
      reason: "OTP_RESEND_TOO_SOON",
      retryAfterSeconds: 18,
    },
  )
})

test("blocks sends after the per-challenge limit", () => {
  assert.deepEqual(
    getOtpSendEligibility(
      {
        expiresAt: new Date("2026-08-29T18:10:00.000Z"),
        otpSendCount: LOGIN_OTP_MAX_SENDS,
        otpLastSentAt: new Date("2026-08-29T17:58:00.000Z"),
      },
      now,
    ),
    { allowed: false, reason: "OTP_SEND_LIMIT" },
  )
})

test("blocks expired password-verified challenges", () => {
  assert.deepEqual(
    getOtpSendEligibility(
      {
        expiresAt: now,
        otpSendCount: 0,
        otpLastSentAt: null,
      },
      now,
    ),
    { allowed: false, reason: "CHALLENGE_EXPIRED" },
  )
})

test("caps OTP expiry at the challenge expiry", () => {
  assert.equal(
    getLoginOtpExpiresAt(
      new Date("2026-08-29T18:03:00.000Z"),
      now,
    ).toISOString(),
    "2026-08-29T18:03:00.000Z",
  )
  assert.equal(
    getLoginOtpExpiresAt(
      new Date("2026-08-29T18:10:00.000Z"),
      now,
    ).toISOString(),
    "2026-08-29T18:05:00.000Z",
  )
})
