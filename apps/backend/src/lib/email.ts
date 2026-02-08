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
    text: `Your login code is: ${code}\n\nIt expires in 10 minutes.`,
  })
}
