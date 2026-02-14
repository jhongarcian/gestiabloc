import { type NextFunction, type Response, Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { enforceSameOrigin } from "../lib/security.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";

const router = Router();
const prismaWithContacts = prisma as any;

const TenantPathSchema = z.object({
  tenantId: z.string().min(1),
});
const TenantContactPathSchema = TenantPathSchema.extend({
  contactId: z.string().min(1),
});

const ContactsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z
    .coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
  search: z.string().trim().max(120).optional().default(""),
  statusConfigId: z.string().trim().max(80).optional(),
});

const optionalStringField = (max: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z.string().max(max).nullable().optional(),
  );

const optionalEmailField = () =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed.toLowerCase() : null;
    },
    z.string().email().max(255).nullable().optional(),
  );

const optionalDateField = () =>
  z.preprocess(
    (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z.string().datetime().nullable().optional(),
  );

const CreateContactSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  middleName: optionalStringField(120),
  lastName: z.string().trim().min(1).max(120),
  dateOfBirth: optionalDateField(),
  phone: optionalStringField(60),
  email: optionalEmailField(),
  statusConfigId: optionalStringField(80),
});

const CONTACT_DEFAULT_STATUSES = [
  {
    name: "Active",
    bgColor: "#DCFCE7",
    textColor: "#166534",
    sortOrder: 10,
  },
  {
    name: "Inactive",
    bgColor: "#E2E8F0",
    textColor: "#334155",
    sortOrder: 20,
  },
  {
    name: "Pending",
    bgColor: "#FEF3C7",
    textColor: "#92400E",
    sortOrder: 30,
  },
] as const;

async function ensureDefaultContactStatuses(tenantId: string) {
  await prismaWithContacts.contactStatusConfig.updateMany({
    where: {
      tenantId,
      name: { in: CONTACT_DEFAULT_STATUSES.map((item) => item.name) },
      isSystemDefault: false,
    },
    data: {
      isSystemDefault: true,
    },
  });

  await prismaWithContacts.contactStatusConfig.createMany({
    data: CONTACT_DEFAULT_STATUSES.map((item) => ({
      tenantId,
      name: item.name,
      bgColor: item.bgColor,
      textColor: item.textColor,
      sortOrder: item.sortOrder,
      isActive: true,
      isSystemDefault: true,
    })),
    skipDuplicates: true,
  });
}

async function requireActiveMembership(
  req: AuthedRequest,
  res: Response,
  tenantId: string,
) {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_tenantId: {
        userId: req.user.id,
        tenantId,
      },
    },
    select: {
      role: true,
      status: true,
    },
  });

  if (!membership || membership.status !== "ACTIVE") {
    res.status(403).json({ error: "FORBIDDEN" });
    return null;
  }

  return membership;
}

router.get("/:tenantId/statuses", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest;
    const { tenantId } = TenantPathSchema.parse(req.params);

    const membership = await requireActiveMembership(authed, res, tenantId);
    if (!membership) return;

    await ensureDefaultContactStatuses(tenantId);

    const statuses = await prismaWithContacts.contactStatusConfig.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        isActive: true,
      },
    });

    return res.json({
      ok: true,
      items: statuses,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest;
    const { tenantId } = TenantPathSchema.parse(req.params);
    const { page, pageSize, search, statusConfigId } = ContactsListQuerySchema.parse(req.query);

    const membership = await requireActiveMembership(authed, res, tenantId);
    if (!membership) return;

    const skip = (page - 1) * pageSize;

    const where = {
      tenantId,
      ...(statusConfigId ? { statusConfigId } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" as const } },
              { middleName: { contains: search, mode: "insensitive" as const } },
              { lastName: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [total, contacts] = await prisma.$transaction([
      prisma.contact.count({ where }),
      prisma.contact.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          dateOfBirth: true,
          phone: true,
          email: true,
          statusConfig: {
            select: {
              id: true,
              name: true,
              bgColor: true,
              textColor: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return res.json({
      ok: true,
      items: contacts.map((contact) => ({
        id: contact.id,
        fullName: [contact.firstName, contact.middleName, contact.lastName]
          .filter(Boolean)
          .join(" "),
        dateOfBirth: contact.dateOfBirth,
        phoneNumber: contact.phone ?? null,
        email: contact.email ?? null,
        status: contact.statusConfig?.name ?? "Unassigned",
        statusConfigId: contact.statusConfig?.id ?? null,
        statusBgColor: contact.statusConfig?.bgColor ?? null,
        statusTextColor: contact.statusConfig?.textColor ?? null,
        followUps: 0,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/:contactId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest;
    const { tenantId, contactId } = TenantContactPathSchema.parse(req.params);

    const membership = await requireActiveMembership(authed, res, tenantId);
    if (!membership) return;

    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        tenantId,
      },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        dateOfBirth: true,
        phone: true,
        secondaryPhone: true,
        email: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        statusConfig: {
          select: {
            id: true,
            name: true,
            bgColor: true,
            textColor: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!contact) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" });
    }

    return res.json({
      ok: true,
      contact: {
        id: contact.id,
        firstName: contact.firstName,
        middleName: contact.middleName ?? null,
        lastName: contact.lastName,
        fullName: [contact.firstName, contact.middleName, contact.lastName]
          .filter(Boolean)
          .join(" "),
        dateOfBirth: contact.dateOfBirth,
        phoneNumber: contact.phone ?? null,
        secondaryPhoneNumber: contact.secondaryPhone ?? null,
        email: contact.email ?? null,
        address: {
          addressLine1: contact.addressLine1 ?? null,
          addressLine2: contact.addressLine2 ?? null,
          city: contact.city ?? null,
          state: contact.state ?? null,
          postalCode: contact.postalCode ?? null,
          country: contact.country ?? null,
        },
        status: contact.statusConfig?.name ?? "Unassigned",
        statusConfigId: contact.statusConfig?.id ?? null,
        statusBgColor: contact.statusConfig?.bgColor ?? null,
        statusTextColor: contact.statusConfig?.textColor ?? null,
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const authed = req as AuthedRequest;
    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = CreateContactSchema.parse(req.body);

    const membership = await requireActiveMembership(authed, res, tenantId);
    if (!membership) return;

    await ensureDefaultContactStatuses(tenantId);

    let resolvedStatusConfigId = payload.statusConfigId ?? null;
    if (resolvedStatusConfigId) {
      const selectedStatus = await prismaWithContacts.contactStatusConfig.findUnique({
        where: { id: resolvedStatusConfigId },
        select: { id: true, tenantId: true },
      });

      if (!selectedStatus || selectedStatus.tenantId !== tenantId) {
        return res.status(400).json({ error: "INVALID_STATUS_CONFIG" });
      }
    } else {
      const defaultStatus = await prismaWithContacts.contactStatusConfig.findFirst({
        where: {
          tenantId,
          isActive: true,
          name: "Active",
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true },
      });
      resolvedStatusConfigId = defaultStatus?.id ?? null;
    }

    const created = await prisma.contact.create({
      data: {
        tenantId,
        firstName: payload.firstName,
        middleName: payload.middleName ?? null,
        lastName: payload.lastName,
        phone: payload.phone ?? null,
        email: payload.email ?? null,
        dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : null,
        statusConfigId: resolvedStatusConfigId,
      },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        dateOfBirth: true,
        phone: true,
        email: true,
        statusConfig: {
          select: {
            id: true,
            name: true,
            bgColor: true,
            textColor: true,
          },
        },
        createdAt: true,
      },
    });

    return res.status(201).json({
      ok: true,
      contact: {
        id: created.id,
        firstName: created.firstName,
        middleName: created.middleName ?? null,
        lastName: created.lastName,
        fullName: [created.firstName, created.middleName, created.lastName]
          .filter(Boolean)
          .join(" "),
        dateOfBirth: created.dateOfBirth,
        phoneNumber: created.phone ?? null,
        email: created.email ?? null,
        status: created.statusConfig?.name ?? "Unassigned",
        statusConfigId: created.statusConfig?.id ?? null,
        statusBgColor: created.statusConfig?.bgColor ?? null,
        statusTextColor: created.statusConfig?.textColor ?? null,
        createdAt: created.createdAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
