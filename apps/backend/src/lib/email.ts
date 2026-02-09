const from = process.env.EMAIL_FROM ?? "no-reply@yourdomain.com"

// If you don't want Resend yet, just console.log the code.
export async function sendLoginOtpEmail(to: string, code: string) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[DEV OTP] Send to ${to}: ${code}`)
    return
  }

  const { Resend } = await import("resend")
  const resend = new Resend(process.env.RESEND_API_KEY)

  await resend.emails.send({
    from,
    to,
    subject: "Your login code",
    text: `Your login code is: ${code}\n\nIt expires in 5 minutes.`,
  })
}

export async function sendVerifyEmail(to: string, verifyUrl: string) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[DEV VERIFY] Send to ${to}: ${verifyUrl}`)
    return
  }

  const { Resend } = await import("resend")
  const resend = new Resend(process.env.RESEND_API_KEY)

  await resend.emails.send({
    from,
    to,
    subject: "Verify your email",
    text: `Verify your email to activate your workspace:\n\n${verifyUrl}\n\nThis link expires in 24 hours.`,
  })
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[DEV RESET] Send to ${to}: ${resetUrl}`)
    return
  }

  const { Resend } = await import("resend")
  const resend = new Resend(process.env.RESEND_API_KEY)

  await resend.emails.send({
    from,
    to,
    subject: "Reset your password",
    text: `Reset your password using this link:\n\n${resetUrl}\n\nThis link expires in 60 minutes.`,
  })
}
