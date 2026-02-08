import type { Request } from "express";

/**
 * For cookie-based auth, a simple Origin check is a strong baseline.
 * Blocks cross-site POSTs in most CSRF scenarios.
 */
export function enforceSameOrigin(req: Request) {
  const allowed = new Set(
    (process.env.WEB_ORIGIN ? [process.env.WEB_ORIGIN] : ["http://localhost:3000"])
      .map((s) => s.replace(/\/$/, ""))
  );

  const origin = (req.headers.origin ?? "").replace(/\/$/, "");
  if (!origin) return; // non-browser clients

  if (!allowed.has(origin)) {
    const err = new Error("Invalid origin");
    (err as any).status = 403;
    throw err;
  }
}