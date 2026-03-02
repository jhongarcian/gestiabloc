import { type NextFunction, type Response, Router } from "express";
import { z } from "zod";

import {
  decryptCustomFieldValue,
  encryptCustomFieldValue,
} from "../lib/contact-custom-field-encryption.js";
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

const UpdateContactSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  middleName: optionalStringField(120),
  lastName: z.string().trim().min(1).max(120),
  dateOfBirth: optionalDateField(),
  phone: optionalStringField(60),
  secondaryPhone: optionalStringField(60),
  email: optionalEmailField(),
  addressLine1: optionalStringField(255),
  addressLine2: optionalStringField(255),
  city: optionalStringField(120),
  state: optionalStringField(120),
  postalCode: optionalStringField(40),
  country: optionalStringField(120),
  statusConfigId: optionalStringField(80),
  customFieldValues: z
    .array(
      z.object({
        fieldId: z.string().min(1),
        value: z.unknown().nullable().optional(),
      }),
    )
    .optional()
    .default([]),
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

function normalizeCustomFieldValue(
  field: {
    id: string;
    label: string;
    fieldType:
      | "TEXT"
      | "NUMBER"
      | "PHONE"
      | "CURRENCY"
      | "DATE"
      | "SELECT"
      | "MULTI_SELECT"
      | "RADIO"
      | "TEXTAREA"
      | "CHECKBOX";
    isRequired: boolean;
    options: string[];
  },
  rawValue: unknown,
) {
  if (field.fieldType === "CHECKBOX") {
    const value = typeof rawValue === "boolean" ? rawValue : false;
    if (field.isRequired && value !== true) {
      return { ok: false as const, message: `${field.label} is required.` };
    }
    return { ok: true as const, value };
  }

  if (field.fieldType === "MULTI_SELECT") {
    const value = Array.isArray(rawValue)
      ? rawValue.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];

    if (value.some((item) => !field.options.includes(item))) {
      return { ok: false as const, message: `${field.label} has invalid option values.` };
    }
    if (field.isRequired && value.length === 0) {
      return { ok: false as const, message: `${field.label} is required.` };
    }
    return { ok: true as const, value: value.length > 0 ? value : null };
  }

  if (field.fieldType === "NUMBER") {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      if (field.isRequired) {
        return { ok: false as const, message: `${field.label} is required.` };
      }
      return { ok: true as const, value: null };
    }

    const numericValue =
      typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string"
          ? Number(rawValue)
          : Number.NaN;

    if (Number.isNaN(numericValue)) {
      return { ok: false as const, message: `${field.label} must be a number.` };
    }

    return { ok: true as const, value: numericValue };
  }

  if (field.fieldType === "CURRENCY") {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      if (field.isRequired) {
        return { ok: false as const, message: `${field.label} is required.` };
      }
      return { ok: true as const, value: null };
    }

    const numericValue =
      typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string"
          ? Number(rawValue)
          : Number.NaN;

    if (Number.isNaN(numericValue)) {
      return { ok: false as const, message: `${field.label} must be a valid amount.` };
    }

    return { ok: true as const, value: numericValue };
  }

  if (field.fieldType === "PHONE") {
    const textValue =
      typeof rawValue === "string" && rawValue.trim().length > 0
        ? rawValue.trim()
        : null;

    if (field.isRequired && !textValue) {
      return { ok: false as const, message: `${field.label} is required.` };
    }

    if (textValue && !/^\+[1-9]\d{7,14}$/.test(textValue)) {
      return { ok: false as const, message: `${field.label} must be a valid phone number.` };
    }

    return { ok: true as const, value: textValue };
  }

  if (field.fieldType === "DATE") {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      if (field.isRequired) {
        return { ok: false as const, message: `${field.label} is required.` };
      }
      return { ok: true as const, value: null };
    }

    if (typeof rawValue !== "string") {
      return { ok: false as const, message: `${field.label} must be a valid date.` };
    }

    const parsedDate = new Date(rawValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return { ok: false as const, message: `${field.label} must be a valid date.` };
    }

    return { ok: true as const, value: parsedDate.toISOString() };
  }

  const textValue =
    typeof rawValue === "string" && rawValue.trim().length > 0
      ? rawValue.trim()
      : null;

  if ((field.fieldType === "SELECT" || field.fieldType === "RADIO") && textValue) {
    if (!field.options.includes(textValue)) {
      return { ok: false as const, message: `${field.label} has an invalid option.` };
    }
  }

  if (field.isRequired && !textValue) {
    return { ok: false as const, message: `${field.label} is required.` };
  }

  return { ok: true as const, value: textValue };
}

function decodeCustomFieldValue(
  field: {
    id: string;
    isEncrypted: boolean;
  },
  storedValue: {
    value: unknown;
    valueCiphertext: string | null;
    valueIv: string | null;
    valueAuthTag: string | null;
    valueKeyVersion: number | null;
  },
) {
  if (!field.isEncrypted) {
    return storedValue.value ?? null;
  }

  return decryptCustomFieldValue({
    valueCiphertext: storedValue.valueCiphertext,
    valueIv: storedValue.valueIv,
    valueAuthTag: storedValue.valueAuthTag,
    valueKeyVersion: storedValue.valueKeyVersion,
  });
}

type StoredCustomFieldValue = {
  fieldId: string;
  value: unknown;
  valueCiphertext: string | null;
  valueIv: string | null;
  valueAuthTag: string | null;
  valueKeyVersion: number | null;
};

const EMPTY_STORED_CUSTOM_FIELD_VALUE: Omit<StoredCustomFieldValue, "fieldId"> = {
  value: null,
  valueCiphertext: null,
  valueIv: null,
  valueAuthTag: null,
  valueKeyVersion: null,
};

function areCustomFieldValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

router.get("/:tenantId/statuses", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest;
    const { tenantId } = TenantPathSchema.parse(req.params);

    const membership = await requireActiveMembership(authed, res, tenantId);
    if (!membership) return;

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

    const [contact, customFields, customFieldValues] = await Promise.all([
      prisma.contact.findFirst({
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
      }),
      prismaWithContacts.contactCustomField.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        select: {
          id: true,
          key: true,
          label: true,
          description: true,
          fieldType: true,
          isRequired: true,
          isEncrypted: true,
          options: true,
          sortOrder: true,
        },
      }),
      prismaWithContacts.contactCustomFieldValue.findMany({
        where: { tenantId, contactId },
        select: {
          fieldId: true,
          value: true,
          valueCiphertext: true,
          valueIv: true,
          valueAuthTag: true,
          valueKeyVersion: true,
        },
      }),
    ]);

    if (!contact) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" });
    }

    const storedValueByFieldId = new Map<string, StoredCustomFieldValue>(
      customFieldValues.map((item: StoredCustomFieldValue) => [item.fieldId, item]),
    );

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
        customFields: customFields.map((field: any) => ({
          id: field.id,
          key: field.key,
          label: field.label,
          description: field.description ?? null,
          fieldType: field.fieldType,
          isRequired: field.isRequired,
          isEncrypted: field.isEncrypted,
          options: Array.isArray(field.options) ? field.options : [],
          sortOrder: field.sortOrder,
          value: decodeCustomFieldValue(
            field,
            storedValueByFieldId.get(field.id) ?? EMPTY_STORED_CUSTOM_FIELD_VALUE,
          ),
        })),
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

router.patch("/:tenantId/:contactId", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const authed = req as AuthedRequest;
    const { tenantId, contactId } = TenantContactPathSchema.parse(req.params);
    const payload = UpdateContactSchema.parse(req.body);

    const membership = await requireActiveMembership(authed, res, tenantId);
    if (!membership) return;

    const [existing, customFields, existingCustomFieldValues] = await Promise.all([
      prisma.contact.findFirst({
        where: {
          id: contactId,
          tenantId,
        },
        select: {
          id: true,
        },
      }),
      prismaWithContacts.contactCustomField.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        select: {
          id: true,
          key: true,
          label: true,
          description: true,
          fieldType: true,
          isRequired: true,
          isEncrypted: true,
          options: true,
          sortOrder: true,
        },
      }),
      prismaWithContacts.contactCustomFieldValue.findMany({
        where: { tenantId, contactId },
        select: {
          fieldId: true,
          value: true,
          valueCiphertext: true,
          valueIv: true,
          valueAuthTag: true,
          valueKeyVersion: true,
        },
      }),
    ]);

    if (!existing) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" });
    }

    const customFieldInputMap = new Map(
      payload.customFieldValues.map((item) => [item.fieldId, item.value]),
    );

    const normalizedCustomFieldValues: Array<{
      fieldId: string;
      value: unknown;
      isEncrypted: boolean;
    }> = [];
    const customFieldById = new Map<string, any>(
      (customFields as Array<any>).map((field) => [field.id, field]),
    );
    const existingStoredValueByFieldId = new Map<string, StoredCustomFieldValue>(
      existingCustomFieldValues.map((item: StoredCustomFieldValue) => [item.fieldId, item]),
    );
    const nextDecodedValueByFieldId = new Map<string, unknown>()

    for (const field of customFields as Array<any>) {
      const existingValue = existingStoredValueByFieldId.get(field.id)
      nextDecodedValueByFieldId.set(
        field.id,
        existingValue
          ? decodeCustomFieldValue(field, existingValue)
          : null,
      )
    }

    for (const field of customFields as Array<any>) {
      const result = normalizeCustomFieldValue(
        {
          id: field.id,
          label: field.label,
          fieldType: field.fieldType,
          isRequired: field.isRequired,
          options: Array.isArray(field.options) ? field.options : [],
        },
        customFieldInputMap.get(field.id),
      );

      if (!result.ok) {
        return res.status(400).json({
          error: "INVALID_CUSTOM_FIELD_VALUE",
          details: [{ path: `customFieldValues.${field.id}`, message: result.message }],
        });
      }

      normalizedCustomFieldValues.push({
        fieldId: field.id,
        value: result.value,
        isEncrypted: field.isEncrypted,
      });
    }

    let resolvedStatusConfigId = payload.statusConfigId ?? null;
    if (resolvedStatusConfigId) {
      const selectedStatus = await prismaWithContacts.contactStatusConfig.findUnique({
        where: { id: resolvedStatusConfigId },
        select: { id: true, tenantId: true },
      });

      if (!selectedStatus || selectedStatus.tenantId !== tenantId) {
        return res.status(400).json({ error: "INVALID_STATUS_CONFIG" });
      }
    }

    const fieldsToDelete: string[] = [];
    const fieldsToCreate: Array<Record<string, unknown>> = [];
    const fieldsToUpdate: Array<{
      fieldId: string;
      data: Record<string, unknown>;
    }> = [];

    for (const item of normalizedCustomFieldValues) {
      const field = customFieldById.get(item.fieldId);
      if (!field) {
        continue;
      }

      const existingValue = existingStoredValueByFieldId.get(item.fieldId);
      const currentDecodedValue = existingValue
        ? decodeCustomFieldValue(field, existingValue)
        : null;
      const isEmpty =
        item.value === null ||
        item.value === undefined ||
        (Array.isArray(item.value) && item.value.length === 0);

      if (isEmpty) {
        if (existingValue) {
          fieldsToDelete.push(item.fieldId);
          nextDecodedValueByFieldId.set(item.fieldId, null);
        }
        continue;
      }

      if (areCustomFieldValuesEqual(currentDecodedValue, item.value)) {
        continue;
      }

      const persistenceData = item.isEncrypted
        ? {
            value: null,
            ...encryptCustomFieldValue(item.value),
          }
        : {
            value: item.value as any,
            valueCiphertext: null,
            valueIv: null,
            valueAuthTag: null,
            valueKeyVersion: null,
          };

      nextDecodedValueByFieldId.set(item.fieldId, item.value);

      if (existingValue) {
        fieldsToUpdate.push({
          fieldId: item.fieldId,
          data: persistenceData,
        });
      } else {
        fieldsToCreate.push({
          tenantId,
          contactId,
          fieldId: item.fieldId,
          ...persistenceData,
        });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const txContacts = tx as any;
      const updatedContact = await tx.contact.update({
        where: { id: contactId },
        data: {
          firstName: payload.firstName,
          middleName: payload.middleName ?? null,
          lastName: payload.lastName,
          dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : null,
          phone: payload.phone ?? null,
          secondaryPhone: payload.secondaryPhone ?? null,
          email: payload.email ?? null,
          addressLine1: payload.addressLine1 ?? null,
          addressLine2: payload.addressLine2 ?? null,
          city: payload.city ?? null,
          state: payload.state ?? null,
          postalCode: payload.postalCode ?? null,
          country: payload.country ?? null,
          statusConfigId: resolvedStatusConfigId,
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

      if (fieldsToDelete.length > 0) {
        await txContacts.contactCustomFieldValue.deleteMany({
          where: {
            tenantId,
            contactId,
            fieldId: {
              in: fieldsToDelete,
            },
          },
        });
      }

      if (fieldsToCreate.length > 0) {
        await txContacts.contactCustomFieldValue.createMany({
          data: fieldsToCreate as any,
        });
      }

      if (fieldsToUpdate.length > 0) {
        await Promise.all(
          fieldsToUpdate.map((item) =>
            txContacts.contactCustomFieldValue.update({
              where: {
                tenantId_contactId_fieldId: {
                  tenantId,
                  contactId,
                  fieldId: item.fieldId,
                },
              },
              data: item.data as any,
            }),
          ),
        );
      }

      return { updatedContact };
    });

    return res.json({
      ok: true,
      contact: {
        id: updated.updatedContact.id,
        firstName: updated.updatedContact.firstName,
        middleName: updated.updatedContact.middleName ?? null,
        lastName: updated.updatedContact.lastName,
        fullName: [
          updated.updatedContact.firstName,
          updated.updatedContact.middleName,
          updated.updatedContact.lastName,
        ]
          .filter(Boolean)
          .join(" "),
        dateOfBirth: updated.updatedContact.dateOfBirth,
        phoneNumber: updated.updatedContact.phone ?? null,
        secondaryPhoneNumber: updated.updatedContact.secondaryPhone ?? null,
        email: updated.updatedContact.email ?? null,
        address: {
          addressLine1: updated.updatedContact.addressLine1 ?? null,
          addressLine2: updated.updatedContact.addressLine2 ?? null,
          city: updated.updatedContact.city ?? null,
          state: updated.updatedContact.state ?? null,
          postalCode: updated.updatedContact.postalCode ?? null,
          country: updated.updatedContact.country ?? null,
        },
        status: updated.updatedContact.statusConfig?.name ?? "Unassigned",
        statusConfigId: updated.updatedContact.statusConfig?.id ?? null,
        statusBgColor: updated.updatedContact.statusConfig?.bgColor ?? null,
        statusTextColor: updated.updatedContact.statusConfig?.textColor ?? null,
        customFields: customFields.map((field: any) => ({
          id: field.id,
          key: field.key,
          label: field.label,
          description: field.description ?? null,
          fieldType: field.fieldType,
          isRequired: field.isRequired,
          isEncrypted: field.isEncrypted,
          options: Array.isArray(field.options) ? field.options : [],
          sortOrder: field.sortOrder,
          value: nextDecodedValueByFieldId.get(field.id) ?? null,
        })),
        createdAt: updated.updatedContact.createdAt,
        updatedAt: updated.updatedContact.updatedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
