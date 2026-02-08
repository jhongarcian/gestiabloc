import type { Request, Response, NextFunction } from "express";
import { sha256 } from "../lib/crypto.js";
import { SESSION_COOKIE_NAME } from "../lib/cookies.js";
import { prisma } from "../lib/prisma.js";

export type AuthedRequest = Request & {
  user: { id: string; email: string; name: string | null; platformRole: string };
};

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "UNAUTHENTICATED" });

    const tokenHash = sha256(token);

    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session) return res.status(401).json({ error: "UNAUTHENTICATED" });
    if (session.expiresAt.getTime() < Date.now()) {
      // expired: cleanup
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      return res.status(401).json({ error: "SESSION_EXPIRED" });
    }

    (req as AuthedRequest).user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
      platformRole: session.user.platformRole,
    };

    return next();
  } catch (e) {
    return next(e);
  }
}