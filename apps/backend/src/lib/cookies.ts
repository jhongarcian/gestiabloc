import type { Response } from "express"

export const SESSION_COOKIE_NAME = "sid"

function getCookieDomain() {
  const rawDomain = process.env.COOKIE_DOMAIN?.trim()
  if (!rawDomain) return undefined

  return rawDomain
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
}

export function setSessionCookie(res: Response, token: string) {
  const isProd = process.env.NODE_ENV === "production"
  const domain = getCookieDomain()

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd, // true in prod (HTTPS)
    sameSite: isProd ? "none" : "lax",
    domain,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  })
}

export function clearSessionCookie(res: Response) {
  const isProd = process.env.NODE_ENV === "production"
  const domain = getCookieDomain()

  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    domain,
    path: "/",
  })
}
