import type { Response } from "express"

export const SESSION_COOKIE_NAME = "sid"

export function setSessionCookie(res: Response, token: string) {
  const isProd = process.env.NODE_ENV === "production"

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd, // true in prod (HTTPS)
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  })
}

export function clearSessionCookie(res: Response) {
  const isProd = process.env.NODE_ENV === "production"

  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  })
}
