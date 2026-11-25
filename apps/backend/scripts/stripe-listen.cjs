const fs = require("node:fs")
const path = require("node:path")
const { randomUUID } = require("node:crypto")
const { execFileSync, spawn } = require("node:child_process")
const dotenv = require("dotenv")

const envFile = path.resolve(__dirname, "../.env")
dotenv.config({ path: envFile, quiet: true })

function main() {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!/^(sk|rk)_test_/.test(key ?? "")) {
    throw new Error("Local webhook forwarding requires STRIPE_SECRET_KEY from your test sandbox.")
  }
  const port = Number(process.env.PORT ?? 4000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid local port.")
  const childEnv = { ...process.env, STRIPE_API_KEY: key, STRIPE_DEVICE_NAME: "gestiabloc-local" }
  const common = ["--skip-update", "--color", "off", "--device-name", "gestiabloc-local"]

  if (process.argv.includes("--configure")) {
    let output
    try {
      output = execFileSync("stripe", ["listen", "--print-secret", ...common], {
        env: childEnv, encoding: "utf8", timeout: 25000, stdio: ["ignore", "pipe", "pipe"],
      })
    } catch {
      throw new Error("Could not obtain the local signing secret. Check that Stripe CLI is installed and the sandbox key has access.")
    }
    const secret = output.match(/\bwhsec_[A-Za-z0-9]+\b/)?.[0]
    if (!secret) throw new Error("Stripe did not return a webhook signing secret.")

    const current = fs.readFileSync(envFile, "utf8"), parsed = dotenv.parse(current)
    if (parsed.STRIPE_SECRET_KEY?.trim() !== key) throw new Error("The local Stripe key changed. Run configuration again.")
    const pattern = /^(?:export[ \t]+)?STRIPE_WEBHOOK_SECRET[ \t]*=.*$/gm
    const matches = [...current.matchAll(pattern)]
    if (matches.length > 1) throw new Error("Remove duplicate STRIPE_WEBHOOK_SECRET entries before configuring.")
    const updated = matches.length
      ? current.replace(pattern, `STRIPE_WEBHOOK_SECRET=${secret}`)
      : current + (current.endsWith("\n") ? "" : "\n") + `STRIPE_WEBHOOK_SECRET=${secret}\n`
    const temp = `${envFile}.stripe-${randomUUID()}`
    fs.chmodSync(envFile, 0o600)
    try {
      fs.writeFileSync(temp, updated, { mode: 0o600, flag: "wx" })
      fs.renameSync(temp, envFile)
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp)
    }
    console.log("Saved the local Stripe signing secret to apps/backend/.env. Restart the backend, then run npm run stripe:listen -w backend.")
    return
  }

  if (!/^whsec_[A-Za-z0-9]+$/.test(process.env.STRIPE_WEBHOOK_SECRET ?? "")) {
    throw new Error("First run npm run stripe:listen -w backend -- --configure to save the local signing secret.")
  }
  const target = `http://localhost:${port}/api/billing/webhook`
  // These are the snapshot events handled by routes/billing.routes.ts.
  const events = [
    "invoice.paid", "invoice.payment_succeeded", "invoice.payment_failed", "invoice.payment_action_required", "invoice.marked_uncollectible", "invoice.voided",
    "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed", "customer.subscription.pending_update_applied", "customer.subscription.pending_update_expired",
    "checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed",
    "payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.canceled", "charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed", "refund.created", "refund.updated", "refund.failed",
  ]
  console.log(`Forwarding Gestiabloc test events to ${target}. Keep this terminal open while testing.`)
  const child = spawn("stripe", ["listen", "--forward-to", target, "--events", events.join(","), ...common], { env: childEnv, stdio: "inherit" })
  child.on("error", () => { console.error("Stripe CLI could not start. Verify that it is installed."); process.exitCode = 1 })
  child.on("exit", code => { process.exitCode = code ?? 0 })
}

try { main() }
catch (error) { console.error(error.message); process.exitCode = 1 }
