import { Resend } from "resend"

const from = process.env.EMAIL_FROM ?? "no-reply@yourdomain.com"
let resendClient: Resend | null = null

function getResendClient() {
  if (!process.env.RESEND_API_KEY) return null
  resendClient ??= new Resend(process.env.RESEND_API_KEY)
  return resendClient
}

export type LoginOtpDeliveryResult =
  | { status: "SENT" }
  | { status: "REJECTED" }
  | { status: "UNCONFIRMED" }

// Local development can surface the code without an email provider.
export async function sendLoginOtpEmail(
  to: string,
  code: string,
  options?: { idempotencyKey?: string; timeoutMs?: number },
): Promise<LoginOtpDeliveryResult> {
  const resend = getResendClient()
  if (!resend) {
    if (process.env.NODE_ENV === "production") {
      console.error("Login OTP delivery is not configured in production.")
      return { status: "REJECTED" }
    }
    console.log(`[DEV OTP] Send to ${to}: ${code}`)
    return { status: "SENT" }
  }

  const timeoutMs = options?.timeoutMs ?? 10_000
  let timeout: NodeJS.Timeout | undefined

  try {
    const result = await Promise.race([
      resend.emails.send(
        {
          from,
          to,
          subject: "Your login code",
          text: `Your login code is: ${code}\n\nIt expires in 5 minutes.`,
        },
        { idempotencyKey: options?.idempotencyKey },
      ),
      new Promise<"TIMEOUT">((resolve) => {
        timeout = setTimeout(() => resolve("TIMEOUT"), timeoutMs)
        timeout.unref?.()
      }),
    ])

    if (result === "TIMEOUT") {
      console.error("Login OTP delivery timed out before confirmation.")
      return { status: "UNCONFIRMED" }
    }
    if (result.error) {
      console.error("Login OTP delivery was rejected:", result.error.name)
      return { status: "REJECTED" }
    }
    return { status: "SENT" }
  } catch (error) {
    console.error(
      "Login OTP delivery could not be confirmed:",
      error instanceof Error ? error.message : "Unknown error",
    )
    return { status: "UNCONFIRMED" }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function sendVerifyEmail(to: string, verifyUrl: string) {
  const resend = getResendClient()
  if (!resend) {
    console.log(`[DEV VERIFY] Send to ${to}: ${verifyUrl}`)
    return
  }

  await resend.emails.send({
    from,
    to,
    subject: "Verify your email",
    text: `Verify your email to activate your workspace:\n\n${verifyUrl}\n\nThis link expires in 24 hours.`,
  })
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const resend = getResendClient()
  if (!resend) {
    console.log(`[DEV RESET] Send to ${to}: ${resetUrl}`)
    return
  }

  await resend.emails.send({
    from,
    to,
    subject: "Reset your password",
    text: `Reset your password using this link:\n\n${resetUrl}\n\nThis link expires in 60 minutes.`,
  })
}
