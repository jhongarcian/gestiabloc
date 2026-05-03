import type { Request } from "express";

function normalizeOrigin(origin: string) {
  return origin.replace(/\/$/, "")
}

function getOriginVariants(origin: string) {
  const normalized = normalizeOrigin(origin)

  try {
    const url = new URL(normalized)

    if (url.hostname === "localhost" || url.hostname.startsWith("127.")) {
      return [normalized]
    }

    const hostname = url.hostname.startsWith("www.")
      ? url.hostname.slice(4)
      : `www.${url.hostname}`

    const variant = new URL(normalized)
    variant.hostname = hostname

    return [normalized, normalizeOrigin(variant.toString())]
  } catch {
    return [normalized]
  }
}

export function getAllowedWebOrigins() {
  const configuredOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000"

  return [...new Set(getOriginVariants(configuredOrigin))]
}

/**
 * For cookie-based auth, a simple Origin check is a strong baseline.
 * Blocks cross-site POSTs in most CSRF scenarios.
 */
export function enforceSameOrigin(req: Request) {
  const allowed = new Set(getAllowedWebOrigins())

  const origin = normalizeOrigin(req.headers.origin ?? "")
  if (!origin) return; // non-browser clients

  if (!allowed.has(origin)) {
    const err = new Error("Invalid origin");
    (err as any).status = 403;
    throw err;
  }
}
