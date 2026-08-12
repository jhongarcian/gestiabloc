import { type NextFunction, type Request, type Response, Router } from "express";
import argon2 from "argon2";
import multer from "multer";
import { randomUUID } from "crypto";
import { z } from "zod";
import { Prisma } from "../generated/prisma/index.js";

import { randomToken, sha256 } from "../lib/crypto.js";
import { deleteBlobByUrl, uploadPublicBlob } from "../lib/blob.js";
import {
  buildServiceFitFieldCatalog,
  DEFAULT_SERVICE_FIT_PROFILE,
  normalizeServiceFitProfile,
  SERVICE_FIT_OPERATORS,
  SERVICE_FIT_RULE_SOURCES,
  SERVICE_FIT_VALUE_TYPES,
  validateServiceFitProfile,
} from "../lib/service-fit.js";
import { sendVerifyEmail } from "../lib/email.js";
import { getSafeTimezone, getTimezoneDateParts } from "../lib/appointment-booking.js";
import { prisma } from "../lib/prisma.js";
import { enforceSameOrigin } from "../lib/security.js";
import { normalizeTenantTagName } from "../lib/tag-utils.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js";
import { getPlanDetails } from "../lib/subscription-plans.js";
import { findEnabledAutomationReference } from "../lib/automation-references.js";
import {
  ensureDefaultContactStatuses,
  ensureDefaultTaskStatuses,
} from "../lib/tenant-defaults.js";

const router = Router();
const prismaWithContacts = prisma as any;

const ACCOUNT_SETTINGS_SECTIONS = [
  "users",
  "account",
  "calendar",
  "opportunities",
  "services",
  "professionals",
  "follow-ups",
  "status-config",
  "tags",
  "features",
  "subscription",
  "custom-fields",
] as const;

type AccountSettingsSection = (typeof ACCOUNT_SETTINGS_SECTIONS)[number];

const TenantPathSchema = z.object({
  tenantId: z.string().trim().min(1),
});

const StatusConfigKeySchema = z.enum(["contacts", "tasks"]);

const TenantStatusConfigPathSchema = TenantPathSchema.extend({
  configKey: StatusConfigKeySchema,
});

const TenantRecordPathSchema = TenantPathSchema.extend({
  recordId: z.string().trim().min(1),
});
const TenantStatusConfigRecordPathSchema = TenantStatusConfigPathSchema.extend({
  recordId: z.string().trim().min(1),
});
const TenantUserPathSchema = TenantPathSchema.extend({
  userId: z.string().trim().min(1),
});

const TenantScopedMutationSchema = z
  .object({
    tenantId: z.string().trim().min(1).optional(),
  })
  .passthrough();

const UsersPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z
    .coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
});

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.")
  .regex(/[^A-Za-z0-9]/, "Password must include at least one symbol.");

const CreateTenantMemberSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  password: passwordSchema.max(200),
  role: z.enum(["TENANT_ADMIN", "TENANT_USER"]).default("TENANT_USER"),
  securityLevel: z.enum(["LOW", "MEDIUM", "MAX"]).optional(),
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
      return trimmed.length > 0 ? trimmed : null;
    },
    z.string().email().max(255).nullable().optional(),
  );

const optionalUrlField = () =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      if (trimmed.length === 0) return null;

      // Accept domain-style input (e.g. "acme.com") and normalize to https URL.
      if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
        return `https://${trimmed}`;
      }

      return trimmed;
    },
    z.string().url().max(255).nullable().optional(),
  );

const optionalPercentageField = () =>
  z.preprocess(
    (value) => {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length === 0) return null;
        return Number(trimmed);
      }

      return value;
    },
    z.number().min(0).max(100).nullable().optional(),
  );

const UpdateTenantInfoSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: optionalEmailField(),
  phone: optionalStringField(60),
  addressLine1: optionalStringField(255),
  addressLine2: optionalStringField(255),
  city: optionalStringField(120),
  state: optionalStringField(120),
  postalCode: optionalStringField(40),
  country: optionalStringField(120),
  timezone: optionalStringField(100),
  website: optionalUrlField(),
  taxEnabled: z.boolean().optional().default(false),
  taxLabel: optionalStringField(60),
  defaultTaxRatePercent: optionalPercentageField(),
}).superRefine((value, ctx) => {
  if (value.taxEnabled && value.defaultTaxRatePercent === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultTaxRatePercent"],
      message: "Tax rate is required when taxes are enabled.",
    });
  }
});

const TIME_INPUT_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CALENDAR_SLOT_DURATION_OPTIONS = [15, 30, 45, 60, 120] as const;
const CALENDAR_HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const CALENDAR_BUFFER_MODE_OPTIONS = ["BUSY", "UNAVAILABLE"] as const;

const CalendarSlotDurationMinutesSchema = z.coerce
  .number()
  .int()
  .refine(
    (value) =>
      (CALENDAR_SLOT_DURATION_OPTIONS as readonly number[]).includes(value),
    {
      message: "Slot duration must be one of 15, 30, 45, 60, or 120 minutes.",
    },
  );

const CalendarBufferAvailabilityModeSchema = z.enum(CALENDAR_BUFFER_MODE_OPTIONS);

const positiveCalendarLimitField = (max: number) =>
  z.preprocess((value) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "string") return Number(value.trim());
    return value;
  }, z.number().int().min(1).max(max).nullable());

const nonNegativeCalendarMinutesField = (max: number) =>
  z.coerce.number().int().min(0).max(max);

const CalendarWeeklyAvailabilityItemSchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    enabled: z.boolean().default(false),
    startTime: z.string().trim().regex(TIME_INPUT_REGEX).nullable().optional(),
    endTime: z.string().trim().regex(TIME_INPUT_REGEX).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) {
      return;
    }

    if (!value.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startTime"],
        message: "Start time is required when the day is enabled.",
      });
    }

    if (!value.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "End time is required when the day is enabled.",
      });
    }

    if (!value.startTime || !value.endTime) {
      return;
    }

    const [startHour, startMinute] = value.startTime.split(":").map(Number);
    const [endHour, endMinute] = value.endTime.split(":").map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    if (endMinutes <= startMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "End time must be after start time.",
      });
    }
  });

const CalendarBookingRulesSchema = z.object({
  meetingIntervalMinutes: CalendarSlotDurationMinutesSchema.default(30),
  meetingDurationMinutes: CalendarSlotDurationMinutesSchema.default(30),
  minimumScheduleNoticeMinutes: nonNegativeCalendarMinutesField(14 * 24 * 60).default(0),
  maximumBookingsPerDay: positiveCalendarLimitField(500).default(null),
  maximumBookingsPerSlot: z.coerce.number().int().min(1).max(50).default(1),
  preBufferMinutes: nonNegativeCalendarMinutesField(8 * 60).default(0),
  postBufferMinutes: nonNegativeCalendarMinutesField(8 * 60).default(0),
  bufferAvailabilityMode: CalendarBufferAvailabilityModeSchema.default("BUSY"),
});

const UpdateTenantCalendarConfigSchema = z.object({
  bookingRules: CalendarBookingRulesSchema,
  weeklyAvailability: z
    .array(CalendarWeeklyAvailabilityItemSchema)
    .max(7)
    .refine(
      (items) => new Set(items.map((item) => item.dayOfWeek)).size === items.length,
      "Each weekday can only appear once.",
    ),
});

const CalendarStaffMemberSchema = z.object({
  userId: z.string().trim().min(1),
  enabled: z.boolean().default(false),
  color: z.string().trim().regex(CALENDAR_HEX_COLOR_REGEX).nullable().optional(),
});

const UpdateCalendarStaffSchema = z.object({
  staff: z
    .array(CalendarStaffMemberSchema)
    .max(250)
    .refine(
      (items) => new Set(items.map((item) => item.userId)).size === items.length,
      "Each user can only appear once.",
    ),
});

const CalendarStaffGroupMemberIdsSchema = z
  .array(z.string().trim().min(1))
  .max(100)
  .refine(
    (items) => new Set(items).size === items.length,
    "Each user can only appear once in a group.",
  );

const CreateCalendarStaffGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: optionalStringField(500),
  memberUserIds: CalendarStaffGroupMemberIdsSchema.default([]),
});

const UpdateCalendarStaffGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: optionalStringField(500),
    memberUserIds: CalendarStaffGroupMemberIdsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "At least one field must be updated.",
      });
    }
  });

const CalendarBlockRecurrencePatternSchema = z.enum([
  "NONE",
  "DAILY",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
]);

const CalendarBlockSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: optionalStringField(1000),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  isAllDay: z.boolean().optional().default(false),
  recurrencePattern: CalendarBlockRecurrencePatternSchema.optional().default("NONE"),
  recurrenceUntil: z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z.string().datetime().nullable().optional(),
  ),
});

function validateCalendarBlockRange(
  value: {
    startsAt?: string;
    endsAt?: string;
  },
  ctx: z.RefinementCtx,
) {
  const startsAt = value.startsAt ? new Date(value.startsAt) : null;
  const endsAt = value.endsAt ? new Date(value.endsAt) : null;

  if (startsAt && Number.isNaN(startsAt.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["startsAt"],
      message: "Start time is invalid.",
    });
  }

  if (endsAt && Number.isNaN(endsAt.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "End time is invalid.",
    });
  }

  if (!startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return;
  }

  if (endsAt <= startsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "End time must be after start time.",
    });
  }
}

function compareLocalDateParts(
  left: { year: number; month: number; day: number },
  right: { year: number; month: number; day: number },
) {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

function getCalendarBlockRecurrenceValidationError(
  params: {
    startsAt: Date;
    endsAt: Date;
    recurrencePattern: z.infer<typeof CalendarBlockRecurrencePatternSchema>;
    recurrenceUntil: Date | null;
  },
  timezone: string,
) {
  if (params.recurrencePattern === "NONE") {
    return null;
  }

  const startParts = getTimezoneDateParts(params.startsAt, timezone);
  const endParts = getTimezoneDateParts(params.endsAt, timezone);

  if (compareLocalDateParts(startParts, endParts) !== 0) {
    return "RECURRING_BLOCK_MUST_STAY_WITHIN_ONE_LOCAL_DAY";
  }

  if (params.recurrenceUntil) {
    const untilParts = getTimezoneDateParts(params.recurrenceUntil, timezone);
    if (compareLocalDateParts(untilParts, startParts) < 0) {
      return "RECURRING_BLOCK_UNTIL_BEFORE_START_DATE";
    }
  }

  return null;
}

function serializeCalendarBlock(block: {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  isAllDay: boolean;
  recurrencePattern: z.infer<typeof CalendarBlockRecurrencePatternSchema>;
  recurrenceUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: block.id,
    title: block.title,
    description: block.description,
    startsAt: block.startsAt.toISOString(),
    endsAt: block.endsAt.toISOString(),
    isAllDay: block.isAllDay,
    recurrencePattern: block.recurrencePattern,
    recurrenceUntil: block.recurrenceUntil?.toISOString() ?? null,
    createdAt: block.createdAt.toISOString(),
    updatedAt: block.updatedAt.toISOString(),
  };
}

const CreateCalendarBlockSchema = CalendarBlockSchema.superRefine((value, ctx) => {
  validateCalendarBlockRange(value, ctx);
});

const UpdateCalendarBlockSchema = CalendarBlockSchema.partial().superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: "At least one field must be updated.",
    });
  }

  validateCalendarBlockRange(value, ctx);
});

const UpdateMemberSecurityLevelSchema = z.object({
  securityLevel: z.enum(["LOW", "MEDIUM", "MAX"]),
});

const UpdateTenantMemberSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
});

const STATUS_HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const CreateContactStatusConfigSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bgColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX),
  textColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().default(true),
});

const UpdateContactStatusConfigSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  bgColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX).optional(),
  textColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

const CreateTenantTagSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bgColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX),
  textColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

const UpdateTenantTagSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  bgColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX).optional(),
  textColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

const OpportunityPipelineStageInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((value) => normalizeOpportunityStageName(value)),
})

const UpsertOpportunityPipelineSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((value) => normalizeOpportunityPipelineName(value)),
  color: z.string().trim().regex(STATUS_HEX_COLOR_REGEX),
  stages: z.array(OpportunityPipelineStageInputSchema).min(1).max(50),
}).superRefine((value, ctx) => {
  if (hasDuplicateCaseInsensitiveValues(value.stages.map((stage) => stage.name))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["stages"],
      message: "Stage names must be unique within a pipeline.",
    });
  }

  const stageIds = value.stages
    .map((stage) => stage.id?.trim())
    .filter((stageId): stageId is string => Boolean(stageId));

  if (new Set(stageIds).size !== stageIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["stages"],
      message: "Stage identifiers must be unique within a pipeline.",
    });
  }
});

const ServicesPaginationQuerySchema = z.object({
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
  isActive: z
    .union([z.enum(["true", "false"]), z.boolean()])
    .optional()
    .transform((value) => {
      if (value === "true" || value === true) return true;
      if (value === "false" || value === false) return false;
      return undefined;
    }),
});

const OpportunitiesPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z
    .coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
});

const ReorderOpportunityPipelinesSchema = z.object({
  pipelineId: z.string().trim().min(1),
  targetPipelineId: z.string().trim().min(1),
  position: z.enum(["before", "after"]),
});
const ServiceOptionsQuerySchema = z.object({
  includeInactive: z
    .union([z.enum(["true", "false"]), z.boolean()])
    .optional()
    .transform((value) => value === "true" || value === true),
});
const FollowUpTemplatesPaginationQuerySchema = z.object({
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
  serviceId: z.string().trim().min(1).optional(),
});

const ServiceProfessionalKindSchema = z.enum(["INTERNAL_USER", "EXTERNAL"]);
const InstallmentFrequencySchema = z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]);

const ServiceChecklistItemInputSchema = z.object({
  label: z.string().trim().min(1).max(200),
  description: optionalStringField(1000),
  isRequired: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

const ServiceFollowUpTemplateStepInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notesTemplate: optionalStringField(1000),
  templateNodeId: z.string().trim().min(1).max(120).nullable().optional(),
  dueDaysFromStart: z.coerce.number().int().min(0).max(3650).default(0),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});
const ServiceFollowUpTemplateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isPublished: z.boolean().optional(),
  flowNodes: z.array(z.unknown()).optional(),
  flowEdges: z.array(z.unknown()).optional(),
});
const ServiceFollowUpTemplatePatchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isPublished: z.boolean().optional(),
  flowNodes: z.array(z.unknown()).optional(),
  flowEdges: z.array(z.unknown()).optional(),
  steps: z.array(ServiceFollowUpTemplateStepInputSchema).optional(),
});

const ServiceProfessionalInputSchema = z.object({
  kind: ServiceProfessionalKindSchema,
  userId: optionalStringField(120),
  externalProfessionalName: optionalStringField(160),
  externalContact: optionalStringField(160),
  notes: optionalStringField(500),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

const ServiceFitRuleSourceSchema = z.enum(SERVICE_FIT_RULE_SOURCES);
const ServiceFitValueTypeSchema = z.enum(SERVICE_FIT_VALUE_TYPES);
const ServiceFitOperatorSchema = z.enum(SERVICE_FIT_OPERATORS);

const ServiceFitRuleInputSchema = z.object({
  id: z.string().trim().min(1).max(120),
  source: ServiceFitRuleSourceSchema,
  fieldKey: z.string().trim().min(1).max(120),
  valueType: ServiceFitValueTypeSchema,
  operator: ServiceFitOperatorSchema,
  compareValue: z.unknown().nullable().optional(),
  required: z.boolean().default(false),
  requiredGroup: optionalStringField(120),
  requiredBranch: optionalStringField(120),
  weight: z.coerce.number().int().min(1).max(10).default(1),
  label: optionalStringField(160),
  explanation: optionalStringField(300),
});

const ServiceVerificationProfileSchema = z.object({
  mode: z
    .enum(["NONE", "WEB_SOURCES", "INTERNAL_KB", "EXTERNAL_API", "MANUAL_CONFIRMATION"])
    .default("NONE"),
  guidance: z.string().trim().max(2000).default(""),
  sourceUrls: z.array(z.string().trim().url().max(500)).max(8).default([]),
  triggerKeywords: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
});

const ServiceKnowledgeProfileSchema = z.object({
  overview: z.string().trim().max(4000).default(""),
  pricingNotes: z.string().trim().max(4000).default(""),
  workflowNotes: z.string().trim().max(4000).default(""),
  faqNotes: z.string().trim().max(4000).default(""),
  adapter: z.enum(["NONE", "IMMIGRATION_USCIS"]).default("NONE"),
});

const ServiceFitRequirementMetadataSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
});

const ServiceFitOptionMetadataSchema = z.object({
  requirementName: z.string().trim().min(1).max(120),
  optionName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
});

const ServiceFitProfileSchema = z.object({
  enabled: z.boolean().default(false),
  summary: z.string().trim().max(2000).default(""),
  rules: z.array(ServiceFitRuleInputSchema).max(100).default([]),
  requirementMetadata: z.array(ServiceFitRequirementMetadataSchema).max(30).default([]),
  optionMetadata: z.array(ServiceFitOptionMetadataSchema).max(100).default([]),
  verificationProfile: ServiceVerificationProfileSchema.default({
    mode: "NONE",
    guidance: "",
    sourceUrls: [],
    triggerKeywords: [],
  }),
  knowledgeProfile: ServiceKnowledgeProfileSchema.default({
    overview: "",
    pricingNotes: "",
    workflowNotes: "",
    faqNotes: "",
    adapter: "NONE",
  }),
});

const CreateServiceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalStringField(2000),
  fitProfile: ServiceFitProfileSchema.optional(),
  basePriceCents: z.coerce.number().int().min(0).max(1_000_000_000),
  currency: z.string().trim().min(3).max(3).default("USD"),
  isTaxExempt: z.boolean().default(false),
  allowPartialPayments: z.boolean().default(false),
  minimumPartialPaymentCents: z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000_000)
    .nullable()
    .optional(),
  installmentCount: z.coerce.number().int().min(2).max(365).nullable().optional(),
  installmentFrequency: InstallmentFrequencySchema.nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  checklistItems: z.array(ServiceChecklistItemInputSchema).max(100).default([]),
  followUpTemplateSteps: z
    .array(ServiceFollowUpTemplateStepInputSchema)
    .max(100)
    .default([]),
  professionals: z.array(ServiceProfessionalInputSchema).max(100).default([]),
});

const UpdateServiceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: optionalStringField(2000),
  fitProfile: ServiceFitProfileSchema.optional(),
  basePriceCents: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  isTaxExempt: z.boolean().optional(),
  allowPartialPayments: z.boolean().optional(),
  minimumPartialPaymentCents: z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000_000)
    .nullable()
    .optional(),
  installmentCount: z.coerce.number().int().min(2).max(365).nullable().optional(),
  installmentFrequency: InstallmentFrequencySchema.nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  checklistItems: z.array(ServiceChecklistItemInputSchema).max(100).optional(),
  followUpTemplateSteps: z
    .array(ServiceFollowUpTemplateStepInputSchema)
    .max(100)
    .optional(),
  professionals: z.array(ServiceProfessionalInputSchema).max(100).optional(),
});

const ContactCustomFieldTypeSchema = z.enum([
  "TEXT",
  "NUMBER",
  "PHONE",
  "CURRENCY",
  "DATE",
  "SELECT",
  "MULTI_SELECT",
  "RADIO",
  "TEXTAREA",
  "CHECKBOX",
]);

const CustomFieldOptionsSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(50)
  .optional();

const CreateContactCustomFieldSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: optionalStringField(500),
  fieldType: ContactCustomFieldTypeSchema,
  isRequired: z.boolean().default(false),
  isEncrypted: z.boolean().default(false),
  isSensitive: z.boolean().default(false),
  isActive: z.boolean().default(true),
  options: CustomFieldOptionsSchema,
});

const UpdateContactCustomFieldSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  description: optionalStringField(500),
  fieldType: ContactCustomFieldTypeSchema.optional(),
  isRequired: z.boolean().optional(),
  isEncrypted: z.boolean().optional(),
  isSensitive: z.boolean().optional(),
  isActive: z.boolean().optional(),
  options: CustomFieldOptionsSchema,
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES },
});

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function slugifyCustomFieldKey(value: string) {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "custom_field";
}

function normalizeCustomFieldOptions(options?: string[]) {
  if (!options) return null;

  const uniqueValues = [
    ...new Map(
      options
        .map((option) => option.trim())
        .filter(Boolean)
        .map((option) => [option.toLowerCase(), option]),
    ).values(),
  ];

  return uniqueValues.length > 0 ? uniqueValues : null;
}

function fieldTypeSupportsOptions(fieldType: z.infer<typeof ContactCustomFieldTypeSchema>) {
  return (
    fieldType === "SELECT" || fieldType === "MULTI_SELECT" || fieldType === "RADIO"
  );
}

function validateCustomFieldOptions(
  fieldType: z.infer<typeof ContactCustomFieldTypeSchema>,
  options?: string[] | null,
) {
  const normalizedOptions = normalizeCustomFieldOptions(options ?? undefined);

  if (fieldTypeSupportsOptions(fieldType)) {
    if (!normalizedOptions?.length) {
      return {
        ok: false as const,
        error: "FIELD_OPTIONS_REQUIRED",
        details: [{ path: "options", message: "At least one option is required." }],
      };
    }
  } else if (normalizedOptions?.length) {
    return {
      ok: false as const,
      error: "FIELD_OPTIONS_NOT_SUPPORTED",
      details: [{ path: "options", message: "Options are only supported for choice fields." }],
    };
  }

  return {
    ok: true as const,
    options: normalizedOptions,
  };
}

async function buildUniqueCustomFieldKey(tenantId: string, label: string, excludeId?: string) {
  const baseKey = slugifyCustomFieldKey(label);

  const existing = await prismaWithContacts.contactCustomField.findMany({
    where: {
      tenantId,
      key: {
        startsWith: baseKey,
      },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: {
      key: true,
    },
  });

  const existingKeys = new Set(existing.map((item: { key: string }) => item.key));
  if (!existingKeys.has(baseKey)) {
    return baseKey;
  }

  let counter = 2;
  while (existingKeys.has(`${baseKey}_${counter}`)) {
    counter += 1;
  }

  return `${baseKey}_${counter}`;
}

async function deleteLegacyAvatar(oldKey: string) {
  if (oldKey.startsWith("http://") || oldKey.startsWith("https://")) {
    await deleteBlobByUrl(oldKey).catch(() => {});
  }
}

async function ensureDefaultStatusesForConfigKey(
  tenantId: string,
  configKey: z.infer<typeof StatusConfigKeySchema>,
) {
  if (configKey === "contacts") {
    await ensureDefaultContactStatuses(prismaWithContacts, tenantId);
    return;
  }

  await ensureDefaultTaskStatuses(prismaWithContacts, tenantId);
}

async function findTenantTagByName(tenantId: string, name: string, excludeId?: string) {
  const normalizedName = normalizeTenantTagName(name);

  return prismaWithContacts.tenantTag.findFirst({
    where: {
      tenantId,
      name: normalizedName,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: {
      id: true,
    },
  });
}

function normalizeOpportunityPipelineName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeOpportunityStageName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function hasDuplicateCaseInsensitiveValues(values: string[]) {
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value.trim().toLocaleLowerCase();
    if (seen.has(normalized)) {
      return true;
    }
    seen.add(normalized);
  }

  return false;
}

async function findOpportunityPipelineByName(
  tenantId: string,
  name: string,
  excludeId?: string,
) {
  return prismaWithContacts.opportunityPipeline.findFirst({
    where: {
      tenantId,
      name: {
        equals: normalizeOpportunityPipelineName(name),
        mode: "insensitive",
      },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: {
      id: true,
    },
  });
}

const opportunityPipelineSelect = {
  id: true,
  name: true,
  color: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  stages: {
    orderBy: [{ sortOrder: "asc" as const }, { name: "asc" as const }],
    select: {
      id: true,
      name: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.OpportunityPipelineSelect;

async function findServiceByName(
  tenantId: string,
  name: string,
  excludeId?: string,
) {
  return prismaWithContacts.service.findFirst({
    where: {
      tenantId,
      name: {
        equals: name.trim(),
        mode: "insensitive",
      },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: {
      id: true,
    },
  });
}

async function loadServiceFitCatalog(tenantId: string) {
  const [statuses, tags, customFields] = await Promise.all([
    prismaWithContacts.contactStatusConfig.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
      },
    }),
    prismaWithContacts.tenantTag.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
      },
    }),
    prismaWithContacts.contactCustomField.findMany({
      where: {
        tenantId,
        isActive: true,
        isSensitive: false,
      },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: {
        id: true,
        key: true,
        label: true,
        description: true,
        fieldType: true,
        options: true,
      },
    }),
  ]);

  return buildServiceFitFieldCatalog({
    statuses,
    tags,
    customFields: customFields.map((field: any) => ({
      id: field.id,
      key: field.key,
      label: field.label,
      description: field.description ?? null,
      fieldType: field.fieldType,
      options: Array.isArray(field.options) ? field.options : [],
    })),
  });
}

function normalizeServicePayload(
  payload: z.infer<typeof CreateServiceSchema> | z.infer<typeof UpdateServiceSchema>,
) {
  const normalized = {
    ...payload,
    currency: payload.currency?.trim().toUpperCase(),
  } as typeof payload & { currency?: string };

  if (normalized.allowPartialPayments === false) {
    normalized.minimumPartialPaymentCents = null;
    normalized.installmentCount = null;
    normalized.installmentFrequency = null;
  }

  return normalized;
}

function getServiceTotalWithTaxCents({
  basePriceCents,
  isTaxExempt,
  taxEnabled,
  defaultTaxRateBps,
}: {
  basePriceCents: number;
  isTaxExempt: boolean;
  taxEnabled: boolean;
  defaultTaxRateBps: number | null;
}) {
  if (!taxEnabled || isTaxExempt || defaultTaxRateBps === null) {
    return basePriceCents;
  }

  return basePriceCents + Math.round((basePriceCents * defaultTaxRateBps) / 10_000);
}

async function validateServiceProfessionalsForTenant(
  tenantId: string,
  professionals: Array<z.infer<typeof ServiceProfessionalInputSchema>>,
) {
  const internalUserIds = [
    ...new Set(
      professionals
        .filter((item) => item.kind === "INTERNAL_USER")
        .map((item) => item.userId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  if (!internalUserIds.length) {
    return { ok: true as const };
  }

  const memberships = await prisma.membership.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      userId: { in: internalUserIds },
    },
    select: {
      userId: true,
    },
  });

  const activeUserIds = new Set(memberships.map((item) => item.userId));
  const invalidUserId = internalUserIds.find((userId) => !activeUserIds.has(userId));
  if (invalidUserId) {
    return { ok: false as const, error: "INVALID_SERVICE_PROFESSIONAL_USER" as const };
  }

  return { ok: true as const };
}

function timeInputToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTimeInput(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeCalendarGroupName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function getSafeCalendarSlotDuration(value?: number | null) {
  return (CALENDAR_SLOT_DURATION_OPTIONS as readonly number[]).includes(value ?? -1)
    ? value!
    : 30;
}

function getSafeCalendarBufferMode(value?: string | null) {
  return (CALENDAR_BUFFER_MODE_OPTIONS as readonly string[]).includes(value ?? "")
    ? (value as (typeof CALENDAR_BUFFER_MODE_OPTIONS)[number])
    : "BUSY";
}

function buildWeeklyAvailabilityFromRules(
  rules: Array<{
    dayOfWeek: number;
    startTimeMinutes: number;
    endTimeMinutes: number;
    isActive: boolean;
  }>,
) {
  const rulesByDay = new Map(rules.map((rule) => [rule.dayOfWeek, rule]));
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const rule = rulesByDay.get(dayOfWeek);
    return {
      dayOfWeek,
      enabled: Boolean(rule?.isActive),
      startTime: rule ? minutesToTimeInput(rule.startTimeMinutes) : "09:00",
      endTime: rule ? minutesToTimeInput(rule.endTimeMinutes) : "17:00",
    };
  });
}

async function validateCalendarGroupMemberUserIds(
  tenantId: string,
  memberUserIds: string[],
) {
  if (memberUserIds.length === 0) {
    return { ok: true as const };
  }

  const memberships = await prisma.membership.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      calendarEnabled: true,
      userId: { in: memberUserIds },
    },
    select: {
      userId: true,
    },
  });

  const validUserIds = new Set(memberships.map((item) => item.userId));
  const invalidUserId = memberUserIds.find((userId) => !validUserIds.has(userId));

  if (invalidUserId) {
    return {
      ok: false as const,
      invalidUserId,
    };
  }

  return { ok: true as const };
}

const readMiddlewares = [
  requireAuth,
  requireTenantAdmin({
    tenantIdLookups: [{ source: "params", key: "tenantId" }],
  }),
] as const;

const writeMiddlewares = [
  requireAuth,
  requireTenantAdmin({
    tenantIdLookups: [
      { source: "params", key: "tenantId" },
      { source: "body", key: "tenantId" },
      { source: "query", key: "tenantId" },
    ],
  }),
] as const;

router.get("/:tenantId/users", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);
    const { page, pageSize } = UsersPaginationQuerySchema.parse(req.query);
    const now = new Date();

    const skip = (page - 1) * pageSize;

    const [total, activeMembersCount, members, tenant, subscription] = await prisma.$transaction([
      prisma.membership.count({
        where: { tenantId },
      }),
      prisma.membership.count({
        where: {
          tenantId,
          status: "ACTIVE",
        },
      }),
      prisma.membership.findMany({
        where: { tenantId },
        select: {
          userId: true,
          role: true,
          status: true,
          securityLevel: true,
          user: {
            select: {
              name: true,
              email: true,
              image: true,
              emailVerified: true,
              lastLoginAt: true,
              sessions: {
                select: { createdAt: true },
                where: { expiresAt: { gt: now } },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
        orderBy: { user: { name: "asc" } },
        skip,
        take: pageSize,
      }),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { timezone: true },
      }),
      prisma.tenantSubscription.findUnique({
        where: { tenantId },
        select: {
          planKey: true,
          seatLimit: true,
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return res.json({
      ok: true,
      items: members.map((member) => ({
        id: member.userId,
        name: member.user.name,
        email: member.user.email,
        avatar: member.user.image ?? null,
        emailVerified: member.user.emailVerified,
        isOnline: member.user.sessions.length > 0,
        sessionCreatedAt: member.user.sessions[0]?.createdAt ?? null,
        role: member.role,
        accountStatus: member.status,
        securityLevel: member.securityLevel,
        lastLoginAt: member.user.lastLoginAt ?? null,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
      seatUsage: subscription
        ? {
            used: activeMembersCount,
            limit: subscription.seatLimit,
            available: Math.max(0, subscription.seatLimit - activeMembersCount),
            planKey: subscription.planKey,
          }
        : null,
      timezone: tenant?.timezone ?? null,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:tenantId/users", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = CreateTenantMemberSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { email: payload.email },
      select: { id: true },
    });

    if (existingUser) {
      return res.status(409).json({ error: "EMAIL_IN_USE" });
    }

    const [subscription, activeMembersCount] = await prisma.$transaction([
      prisma.tenantSubscription.findUnique({
        where: { tenantId },
        select: { seatLimit: true, planKey: true },
      }),
      prisma.membership.count({
        where: {
          tenantId,
          status: "ACTIVE",
        },
      }),
    ]);

    if (!subscription) {
      return res.status(409).json({ error: "SUBSCRIPTION_NOT_FOUND" });
    }

    if (activeMembersCount >= subscription.seatLimit) {
      return res.status(409).json({
        error: "SEAT_LIMIT_REACHED",
        details: {
          planKey: subscription.planKey,
          seatLimit: subscription.seatLimit,
          activeMembersCount,
        },
      });
    }

    const securityLevel =
      payload.securityLevel ??
      (payload.role === "TENANT_ADMIN" ? "MAX" : "LOW");

    const passwordHash = await argon2.hash(payload.password, {
      type: argon2.argon2id,
    });

    const verificationToken = randomToken(32);
    const verificationTokenHash = sha256(verificationToken);
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: payload.name,
          email: payload.email,
          passwordHash,
        },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          image: true,
        },
      });

      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          tenantId,
          role: payload.role,
          status: "ACTIVE",
          securityLevel,
        },
        select: {
          role: true,
          status: true,
          securityLevel: true,
        },
      });

      await tx.emailVerification.create({
        data: {
          userId: user.id,
          tokenHash: verificationTokenHash,
          expiresAt: verificationExpiresAt,
        },
      });

      return {
        user,
        membership,
      };
    });

    const base = (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(
      /\/$/,
      "",
    );
    const verifyUrl = `${base}/verify?token=${encodeURIComponent(verificationToken)}`;
    await sendVerifyEmail(payload.email, verifyUrl);

    return res.status(201).json({
      ok: true,
      user: {
        id: created.user.id,
        name: created.user.name,
        email: created.user.email,
        avatar: created.user.image,
        emailVerified: created.user.emailVerified,
        role: created.membership.role,
        accountStatus: created.membership.status,
        securityLevel: created.membership.securityLevel,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/users/:userId", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId, userId } = TenantUserPathSchema.parse(req.params);
    const now = new Date();

    const [member, tenant, recentSessions, recentVerifications] = await prisma.$transaction([
      prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
        select: {
          userId: true,
          role: true,
          status: true,
          securityLevel: true,
          user: {
            select: {
              name: true,
              email: true,
              image: true,
              emailVerified: true,
              createdAt: true,
              updatedAt: true,
              lastLoginAt: true,
              sessions: {
                select: { createdAt: true },
                where: { expiresAt: { gt: now } },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      }),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { timezone: true },
      }),
      prisma.session.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          ipAddress: true,
          userAgent: true,
        },
      }),
      prisma.emailVerification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          createdAt: true,
          usedAt: true,
          expiresAt: true,
        },
      }),
    ]);

    if (!member) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    const auditHistory = [
      {
        id: `created-${member.userId}`,
        type: "PROFILE_CREATED",
        title: "Profile created",
        detail: "User account was created.",
        at: member.user.createdAt,
      },
      ...recentVerifications.map((verification) => ({
        id: verification.id,
        type: verification.usedAt ? "EMAIL_VERIFIED" : "EMAIL_VERIFICATION_REQUESTED",
        title: verification.usedAt ? "Email verified" : "Verification requested",
        detail: verification.usedAt
          ? "User email verification was completed."
          : "Verification email was requested.",
        at: verification.usedAt ?? verification.createdAt,
      })),
      {
        id: `updated-${member.userId}`,
        type: "PROFILE_UPDATED",
        title: "Profile updated",
        detail: "User profile fields were updated.",
        at: member.user.updatedAt,
      },
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 10);

    return res.json({
      ok: true,
      user: {
        id: member.userId,
        name: member.user.name,
        email: member.user.email,
        avatar: member.user.image ?? null,
        emailVerified: member.user.emailVerified,
        isOnline: member.user.sessions.length > 0,
        sessionCreatedAt: member.user.sessions[0]?.createdAt ?? null,
        role: member.role,
        accountStatus: member.status,
        securityLevel: member.securityLevel,
        lastLoginAt: member.user.lastLoginAt ?? null,
        createdAt: member.user.createdAt,
        updatedAt: member.user.updatedAt,
        timezone: tenant?.timezone ?? null,
        activity: {
          recentSessions: recentSessions.map((session) => ({
            id: session.id,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            ipAddress: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
            isActive: session.expiresAt.getTime() > now.getTime(),
          })),
        },
        auditHistory: auditHistory.map((event) => ({
          id: event.id,
          type: event.type,
          title: event.title,
          detail: event.detail,
          at: event.at,
        })),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:tenantId/users/:userId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, userId } = TenantUserPathSchema.parse(req.params);
    const payload = UpdateTenantMemberSchema.parse(req.body);

    const membership = await prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          tenantId,
          userId,
        },
      },
      select: {
        userId: true,
        role: true,
      },
    });

    if (!membership) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!current) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    const normalizedEmail = payload.email.trim().toLowerCase();
    const isEmailChanging = normalizedEmail !== current.email;

    if (isEmailChanging) {
      const existing = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });
      if (existing && existing.id !== userId) {
        return res.status(409).json({ error: "EMAIL_IN_USE" });
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        name: payload.name,
        email: normalizedEmail,
        emailVerified: isEmailChanging ? false : undefined,
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      ok: true,
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        avatar: updated.image ?? null,
        emailVerified: updated.emailVerified,
        role: membership.role,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:tenantId/users/:userId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const authed = (req as AuthedRequest).user;
    const { tenantId, userId } = TenantUserPathSchema.parse(req.params);

    if (authed.id === userId) {
      return res.status(400).json({ error: "CANNOT_DELETE_SELF" });
    }

    const membership = await prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          tenantId,
          userId,
        },
      },
      select: {
        role: true,
      },
    });

    if (!membership) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    const referencedAutomation = await findEnabledAutomationReference(
      prismaWithContacts,
      tenantId,
      { kind: "user", id: userId },
    );
    if (referencedAutomation) {
      return res.status(409).json({
        error: "AUTOMATION_REFERENCE_CONFLICT",
        automation: referencedAutomation,
      });
    }

    if (membership.role === "TENANT_ADMIN") {
      const otherAdmins = await prisma.membership.count({
        where: {
          tenantId,
          role: "TENANT_ADMIN",
          status: "ACTIVE",
          NOT: { userId },
        },
      });

      if (otherAdmins < 1) {
        return res.status(409).json({ error: "LAST_TENANT_ADMIN" });
      }
    }

    const membershipCount = await prisma.membership.count({
      where: { userId },
    });

    if (membershipCount > 1) {
      await prisma.membership.delete({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
      });
      return res.json({
        ok: true,
        deletedScope: "TENANT_MEMBERSHIP",
      });
    }

    await prisma.user.delete({
      where: { id: userId },
    });

    return res.json({
      ok: true,
      deletedScope: "USER_ACCOUNT",
    });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/:tenantId/users/:userId/request-email-verification",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, userId } = TenantUserPathSchema.parse(req.params);

      const membership = await prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
        select: {
          user: {
            select: {
              id: true,
              email: true,
              emailVerified: true,
            },
          },
        },
      });

      if (!membership?.user) {
        return res.status(404).json({ error: "USER_NOT_FOUND" });
      }

      if (membership.user.emailVerified) {
        return res.status(409).json({ error: "EMAIL_ALREADY_VERIFIED" });
      }

      const verificationToken = randomToken(32);
      const verificationTokenHash = sha256(verificationToken);
      const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await prisma.$transaction(async (tx) => {
        await tx.emailVerification.deleteMany({
          where: { userId: membership.user.id },
        });
        await tx.emailVerification.create({
          data: {
            userId: membership.user.id,
            tokenHash: verificationTokenHash,
            expiresAt: verificationExpiresAt,
          },
        });
      });

      const base = (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(
        /\/$/,
        "",
      );
      const verifyUrl = `${base}/verify?token=${encodeURIComponent(verificationToken)}`;
      await sendVerifyEmail(membership.user.email, verifyUrl);

      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/:tenantId/users/:userId/avatar-upload",
  ...writeMiddlewares,
  avatarUpload.single("file"),
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const authed = (req as AuthedRequest).user;
      const { tenantId, userId } = TenantUserPathSchema.parse(req.params);
      const file = (req as any).file as
        | {
            mimetype: string;
            size: number;
            originalname: string;
            buffer: Buffer;
          }
        | undefined;

      if (!file) {
        return res.status(400).json({ error: "FILE_REQUIRED" });
      }

      const contentType = file.mimetype;
      if (!["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(contentType)) {
        return res.status(400).json({ error: "UNSUPPORTED_CONTENT_TYPE" });
      }
      if (file.size > IMAGE_MAX_BYTES) {
        return res.status(400).json({ error: "FILE_TOO_LARGE" });
      }

      const membership = await prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
        select: {
          userId: true,
        },
      });

      if (!membership) {
        return res.status(404).json({ error: "USER_NOT_FOUND" });
      }

      const fileId = randomUUID();
      const safeFilename = sanitizeFilename(file.originalname || "avatar");
      const pathname = `tenants/${tenantId}/avatars/${userId}/${fileId}/${safeFilename}`;
      const blob = await uploadPublicBlob({
        pathname,
        body: file.buffer,
        contentType,
      });

      await prisma.file.create({
        data: {
          id: fileId,
          tenantId,
          key: blob.url,
          contentType,
          size: file.size,
          createdById: authed.id,
          purpose: "AVATAR",
        },
      });

      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { image: true },
      });
      const oldKey = existingUser?.image ?? null;

      await prisma.user.update({
        where: { id: userId },
        data: { image: blob.url },
      });

      if (oldKey && oldKey !== blob.url) {
        const oldFile = await prisma.file.findUnique({ where: { key: oldKey } });
        if (oldFile?.tenantId === tenantId) {
          await prisma.file.delete({ where: { key: oldKey } }).catch(() => {});
        }
        await deleteLegacyAvatar(oldKey);
      }

      return res.json({ ok: true, imageUrl: blob.url, fileId });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  "/:tenantId/users/:userId/security-level",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      const { tenantId, userId } = TenantUserPathSchema.parse(req.params);
      const { securityLevel } = UpdateMemberSecurityLevelSchema.parse(req.body);

      const existingMembership = await prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
        select: {
          userId: true,
          tenantId: true,
          role: true,
          status: true,
          securityLevel: true,
        },
      });

      if (!existingMembership) {
        return res.status(404).json({ error: "USER_NOT_FOUND" });
      }

      if (
        existingMembership.role === "TENANT_ADMIN" &&
        securityLevel !== "MAX"
      ) {
        return res.status(400).json({
          error: "TENANT_ADMIN_SECURITY_LEVEL_FIXED",
        });
      }

      const membership = await prisma.membership.update({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
        data: {
          securityLevel,
        },
        select: {
          userId: true,
          tenantId: true,
          role: true,
          status: true,
          securityLevel: true,
        },
      });

      return res.json({
        ok: true,
        membership,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.get("/:tenantId/account", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        timezone: true,
        website: true,
        taxEnabled: true,
        taxLabel: true,
        defaultTaxRateBps: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!tenant) {
      return res.status(404).json({ error: "TENANT_NOT_FOUND" });
    }

    return res.json({
      ok: true,
      tenant: {
        ...tenant,
        defaultTaxRatePercent:
          tenant.defaultTaxRateBps !== null && tenant.defaultTaxRateBps !== undefined
            ? tenant.defaultTaxRateBps / 100
            : null,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:tenantId/account", ...writeMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = UpdateTenantInfoSchema.parse(req.body);

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: payload.name,
        email: payload.email ?? null,
        phone: payload.phone ?? null,
        addressLine1: payload.addressLine1 ?? null,
        addressLine2: payload.addressLine2 ?? null,
        city: payload.city ?? null,
        state: payload.state ?? null,
        postalCode: payload.postalCode ?? null,
        country: payload.country ?? null,
        timezone: payload.timezone ?? null,
        website: payload.website ?? null,
        taxEnabled: payload.taxEnabled,
        taxLabel: payload.taxEnabled ? payload.taxLabel ?? null : null,
        defaultTaxRateBps:
          payload.taxEnabled &&
          payload.defaultTaxRatePercent !== null &&
          payload.defaultTaxRatePercent !== undefined
            ? Math.round(payload.defaultTaxRatePercent * 100)
            : null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        timezone: true,
        website: true,
        taxEnabled: true,
        taxLabel: true,
        defaultTaxRateBps: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      ok: true,
      tenant: {
        ...tenant,
        defaultTaxRatePercent:
          tenant.defaultTaxRateBps !== null && tenant.defaultTaxRateBps !== undefined
            ? tenant.defaultTaxRateBps / 100
            : null,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/calendar", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);

    const [tenant, rules, blocks, users, groups] = await prisma.$transaction([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          timezone: true,
          calendarAppointmentSlotMinutes: true,
          calendarMeetingDurationMinutes: true,
          calendarMinimumScheduleNoticeMinutes: true,
          calendarMaximumBookingsPerDay: true,
          calendarMaximumBookingsPerSlot: true,
          calendarPreBufferMinutes: true,
          calendarPostBufferMinutes: true,
          calendarBufferAvailabilityMode: true,
        },
      }),
      prisma.calendarAvailabilityRule.findMany({
        where: {
          tenantId,
          scope: "TENANT",
          kind: "OPEN",
          userId: null,
        },
        orderBy: [{ dayOfWeek: "asc" }, { startTimeMinutes: "asc" }],
        select: {
          id: true,
          dayOfWeek: true,
          startTimeMinutes: true,
          endTimeMinutes: true,
          isActive: true,
        },
      }),
      prisma.calendarTimeBlock.findMany({
        where: {
          tenantId,
          scope: "TENANT",
          userId: null,
        },
        orderBy: [{ startsAt: "asc" }],
        select: {
          id: true,
          title: true,
          description: true,
          startsAt: true,
          endsAt: true,
          isAllDay: true,
          recurrencePattern: true,
          recurrenceUntil: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.membership.findMany({
        where: {
          tenantId,
          status: "ACTIVE",
        },
        orderBy: [{ user: { name: "asc" } }],
        select: {
          userId: true,
          role: true,
          calendarEnabled: true,
          calendarColor: true,
          user: {
            select: {
              name: true,
              email: true,
              image: true,
            },
          },
        },
      }),
      prisma.calendarStaffGroup.findMany({
        where: {
          tenantId,
        },
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          name: true,
          description: true,
          members: {
            orderBy: [{ userId: "asc" }],
            select: {
              userId: true,
              membership: {
                select: {
                  calendarColor: true,
                  user: {
                    select: {
                      name: true,
                      email: true,
                      image: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const weeklyAvailability = buildWeeklyAvailabilityFromRules(rules);

    return res.json({
      ok: true,
      timezone: tenant?.timezone ?? null,
      bookingRules: {
        meetingIntervalMinutes: getSafeCalendarSlotDuration(
          tenant?.calendarAppointmentSlotMinutes,
        ),
        meetingDurationMinutes: getSafeCalendarSlotDuration(
          tenant?.calendarMeetingDurationMinutes,
        ),
        minimumScheduleNoticeMinutes:
          tenant?.calendarMinimumScheduleNoticeMinutes ?? 0,
        maximumBookingsPerDay: tenant?.calendarMaximumBookingsPerDay ?? null,
        maximumBookingsPerSlot: tenant?.calendarMaximumBookingsPerSlot ?? 1,
        preBufferMinutes: tenant?.calendarPreBufferMinutes ?? 0,
        postBufferMinutes: tenant?.calendarPostBufferMinutes ?? 0,
        bufferAvailabilityMode: getSafeCalendarBufferMode(
          tenant?.calendarBufferAvailabilityMode,
        ),
      },
      weeklyAvailability,
      blocks: blocks.map(serializeCalendarBlock),
      staff: users.map((item) => ({
        id: item.userId,
        label: item.user.name?.trim() || item.user.email,
        email: item.user.email,
        image: item.user.image ?? null,
        role: item.role,
        enabled: item.calendarEnabled,
        color: item.calendarColor ?? null,
      })),
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description ?? null,
        members: group.members.map((member) => ({
          userId: member.userId,
          label:
            member.membership.user.name?.trim() || member.membership.user.email,
          email: member.membership.user.email,
          image: member.membership.user.image ?? null,
          color: member.membership.calendarColor ?? null,
        })),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:tenantId/calendar", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = UpdateTenantCalendarConfigSchema.parse(req.body);

    const enabledDays = payload.weeklyAvailability
      .filter((item) => item.enabled && item.startTime && item.endTime)
      .map((item) => ({
        tenantId,
        userId: null,
        scope: "TENANT" as const,
        kind: "OPEN" as const,
        dayOfWeek: item.dayOfWeek,
        startTimeMinutes: timeInputToMinutes(item.startTime!),
        endTimeMinutes: timeInputToMinutes(item.endTime!),
        isActive: true,
      }));

    await prisma.$transaction([
      prisma.tenant.update({
        where: { id: tenantId },
        data: {
          calendarAppointmentSlotMinutes: payload.bookingRules.meetingIntervalMinutes,
          calendarMeetingDurationMinutes: payload.bookingRules.meetingDurationMinutes,
          calendarMinimumScheduleNoticeMinutes:
            payload.bookingRules.minimumScheduleNoticeMinutes,
          calendarMaximumBookingsPerDay:
            payload.bookingRules.maximumBookingsPerDay,
          calendarMaximumBookingsPerSlot:
            payload.bookingRules.maximumBookingsPerSlot,
          calendarPreBufferMinutes: payload.bookingRules.preBufferMinutes,
          calendarPostBufferMinutes: payload.bookingRules.postBufferMinutes,
          calendarBufferAvailabilityMode:
            payload.bookingRules.bufferAvailabilityMode,
        },
      }),
      prisma.calendarAvailabilityRule.deleteMany({
        where: {
          tenantId,
          scope: "TENANT",
          kind: "OPEN",
          userId: null,
        },
      }),
      ...(enabledDays.length > 0
        ? [
            prisma.calendarAvailabilityRule.createMany({
              data: enabledDays,
            }),
          ]
        : []),
    ]);

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:tenantId/calendar/staff", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = UpdateCalendarStaffSchema.parse(req.body);

    const memberships = await prisma.membership.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
      },
      select: {
        userId: true,
      },
    });

    const activeUserIds = new Set(memberships.map((item) => item.userId));
    const invalidUserId = payload.staff.find((item) => !activeUserIds.has(item.userId));
    if (invalidUserId) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    const disabledUserIds = payload.staff
      .filter((item) => !item.enabled)
      .map((item) => item.userId);

    await prisma.$transaction([
      ...payload.staff.map((item) =>
        prisma.membership.update({
          where: {
            userId_tenantId: {
              tenantId,
              userId: item.userId,
            },
          },
          data: {
            calendarEnabled: item.enabled,
            calendarColor: item.enabled ? item.color ?? null : null,
          },
        }),
      ),
      ...(disabledUserIds.length > 0
        ? [
            prisma.calendarStaffGroupMember.deleteMany({
              where: {
                tenantId,
                userId: {
                  in: disabledUserIds,
                },
              },
            }),
          ]
        : []),
    ]);

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/:tenantId/calendar/groups", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = CreateCalendarStaffGroupSchema.parse(req.body);
    const normalizedName = normalizeCalendarGroupName(payload.name);

    const validMembers = await validateCalendarGroupMemberUserIds(
      tenantId,
      payload.memberUserIds,
    );
    if (!validMembers.ok) {
      return res.status(404).json({ error: "CALENDAR_GROUP_MEMBER_NOT_FOUND" });
    }

    const existing = await prisma.calendarStaffGroup.findFirst({
      where: {
        tenantId,
        name: {
          equals: normalizedName,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return res.status(409).json({ error: "CALENDAR_GROUP_NAME_IN_USE" });
    }

    const created = await prisma.$transaction(async (tx) => {
      const group = await tx.calendarStaffGroup.create({
        data: {
          tenantId,
          name: normalizedName,
          description: payload.description ?? null,
        },
        select: {
          id: true,
          name: true,
          description: true,
        },
      });

      if (payload.memberUserIds.length > 0) {
        await tx.calendarStaffGroupMember.createMany({
          data: payload.memberUserIds.map((userId) => ({
            tenantId,
            groupId: group.id,
            userId,
          })),
        });
      }

      const members = await tx.calendarStaffGroupMember.findMany({
        where: {
          tenantId,
          groupId: group.id,
        },
        orderBy: [{ userId: "asc" }],
        select: {
          userId: true,
          membership: {
            select: {
              calendarColor: true,
              user: {
                select: {
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
          },
        },
      });

      return {
        group,
        members,
      };
    });

    return res.status(201).json({
      ok: true,
      group: {
        id: created.group.id,
        name: created.group.name,
        description: created.group.description ?? null,
        members: created.members.map((member) => ({
          userId: member.userId,
          label: member.membership.user.name?.trim() || member.membership.user.email,
          email: member.membership.user.email,
          image: member.membership.user.image ?? null,
          color: member.membership.calendarColor ?? null,
        })),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:tenantId/calendar/groups/:recordId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
    const payload = UpdateCalendarStaffGroupSchema.parse(req.body);
    const normalizedName = payload.name
      ? normalizeCalendarGroupName(payload.name)
      : undefined;

    const existing = await prisma.calendarStaffGroup.findUnique({
      where: {
        id: recordId,
      },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "CALENDAR_GROUP_NOT_FOUND" });
    }

    if (payload.memberUserIds) {
      const validMembers = await validateCalendarGroupMemberUserIds(
        tenantId,
        payload.memberUserIds,
      );
      if (!validMembers.ok) {
        return res.status(404).json({ error: "CALENDAR_GROUP_MEMBER_NOT_FOUND" });
      }
    }

    if (payload.name) {
      const nameConflict = await prisma.calendarStaffGroup.findFirst({
        where: {
          tenantId,
          NOT: { id: recordId },
          name: {
            equals: normalizedName!,
            mode: "insensitive",
          },
        },
        select: {
          id: true,
        },
      });

      if (nameConflict) {
        return res.status(409).json({ error: "CALENDAR_GROUP_NAME_IN_USE" });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const group = await tx.calendarStaffGroup.update({
        where: {
          id: recordId,
        },
        data: {
          ...(normalizedName !== undefined ? { name: normalizedName } : {}),
          ...(payload.description !== undefined
            ? { description: payload.description ?? null }
            : {}),
        },
        select: {
          id: true,
          name: true,
          description: true,
        },
      });

      if (payload.memberUserIds) {
        await tx.calendarStaffGroupMember.deleteMany({
          where: {
            tenantId,
            groupId: recordId,
          },
        });

        if (payload.memberUserIds.length > 0) {
          await tx.calendarStaffGroupMember.createMany({
            data: payload.memberUserIds.map((userId) => ({
              tenantId,
              groupId: recordId,
              userId,
            })),
          });
        }
      }

      const members = await tx.calendarStaffGroupMember.findMany({
        where: {
          tenantId,
          groupId: recordId,
        },
        orderBy: [{ userId: "asc" }],
        select: {
          userId: true,
          membership: {
            select: {
              calendarColor: true,
              user: {
                select: {
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
          },
        },
      });

      return {
        group,
        members,
      };
    });

    return res.json({
      ok: true,
      group: {
        id: updated.group.id,
        name: updated.group.name,
        description: updated.group.description ?? null,
        members: updated.members.map((member) => ({
          userId: member.userId,
          label: member.membership.user.name?.trim() || member.membership.user.email,
          email: member.membership.user.email,
          image: member.membership.user.image ?? null,
          color: member.membership.calendarColor ?? null,
        })),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:tenantId/calendar/groups/:recordId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);

    const existing = await prisma.calendarStaffGroup.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "CALENDAR_GROUP_NOT_FOUND" });
    }

    await prisma.calendarStaffGroup.delete({
      where: { id: recordId },
    });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/calendar/users/:userId", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId, userId } = TenantUserPathSchema.parse(req.params);

    const [membership, rules, blocks] = await prisma.$transaction([
      prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
        select: {
          userId: true,
          status: true,
          role: true,
          calendarEnabled: true,
          calendarColor: true,
          user: {
            select: {
              name: true,
              email: true,
              image: true,
            },
          },
        },
      }),
      prisma.calendarAvailabilityRule.findMany({
        where: {
          tenantId,
          scope: "USER",
          kind: "OPEN",
          userId,
        },
        orderBy: [{ dayOfWeek: "asc" }, { startTimeMinutes: "asc" }],
        select: {
          id: true,
          dayOfWeek: true,
          startTimeMinutes: true,
          endTimeMinutes: true,
          isActive: true,
        },
      }),
      prisma.calendarTimeBlock.findMany({
        where: {
          tenantId,
          scope: "USER",
          userId,
        },
        orderBy: [{ startsAt: "asc" }],
        select: {
          id: true,
          title: true,
          description: true,
          startsAt: true,
          endsAt: true,
          isAllDay: true,
          recurrencePattern: true,
          recurrenceUntil: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    if (!membership || membership.status !== "ACTIVE") {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    return res.json({
      ok: true,
      user: {
        id: membership.userId,
        label: membership.user.name?.trim() || membership.user.email,
        email: membership.user.email,
        image: membership.user.image ?? null,
        role: membership.role,
        enabled: membership.calendarEnabled,
        color: membership.calendarColor ?? null,
      },
      weeklyAvailability: buildWeeklyAvailabilityFromRules(rules),
      blocks: blocks.map(serializeCalendarBlock),
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:tenantId/calendar/users/:userId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, userId } = TenantUserPathSchema.parse(req.params);
    const payload = UpdateTenantCalendarConfigSchema.pick({
      weeklyAvailability: true,
    }).parse(req.body);

    const membership = await prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          tenantId,
          userId,
        },
      },
      select: {
        userId: true,
        status: true,
      },
    });

    if (!membership || membership.status !== "ACTIVE") {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    const enabledDays = payload.weeklyAvailability
      .filter((item) => item.enabled && item.startTime && item.endTime)
      .map((item) => ({
        tenantId,
        userId,
        scope: "USER" as const,
        kind: "OPEN" as const,
        dayOfWeek: item.dayOfWeek,
        startTimeMinutes: timeInputToMinutes(item.startTime!),
        endTimeMinutes: timeInputToMinutes(item.endTime!),
        isActive: true,
      }));

    await prisma.$transaction([
      prisma.calendarAvailabilityRule.deleteMany({
        where: {
          tenantId,
          scope: "USER",
          kind: "OPEN",
          userId,
        },
      }),
      ...(enabledDays.length > 0
        ? [
            prisma.calendarAvailabilityRule.createMany({
              data: enabledDays,
            }),
          ]
        : []),
    ]);

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/:tenantId/calendar/blocks", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = CreateCalendarBlockSchema.parse(req.body);
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const startsAt = new Date(payload.startsAt);
    const endsAt = new Date(payload.endsAt);
    const recurrenceUntil = payload.recurrenceUntil ? new Date(payload.recurrenceUntil) : null;
    const recurrenceValidationError = getCalendarBlockRecurrenceValidationError(
      {
        startsAt,
        endsAt,
        recurrencePattern: payload.recurrencePattern,
        recurrenceUntil,
      },
      getSafeTimezone(tenant?.timezone),
    );

    if (recurrenceValidationError) {
      return res.status(400).json({ error: recurrenceValidationError });
    }

    const created = await prisma.calendarTimeBlock.create({
      data: {
        tenantId,
        userId: null,
        scope: "TENANT",
        title: payload.title.trim(),
        description: payload.description ?? null,
        startsAt,
        endsAt,
        isAllDay: payload.isAllDay,
        recurrencePattern: payload.recurrencePattern,
        recurrenceUntil,
      },
      select: {
        id: true,
        title: true,
        description: true,
        startsAt: true,
        endsAt: true,
        isAllDay: true,
        recurrencePattern: true,
        recurrenceUntil: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({
      ok: true,
      block: serializeCalendarBlock(created),
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:tenantId/calendar/blocks/:recordId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
    const payload = UpdateCalendarBlockSchema.parse(req.body);

    const existing = await prisma.calendarTimeBlock.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        tenantId: true,
        scope: true,
        userId: true,
        title: true,
        description: true,
        startsAt: true,
        endsAt: true,
        isAllDay: true,
        recurrencePattern: true,
        recurrenceUntil: true,
      },
    });

    if (!existing || existing.tenantId !== tenantId || existing.scope !== "TENANT" || existing.userId !== null) {
      return res.status(404).json({ error: "CALENDAR_BLOCK_NOT_FOUND" });
    }

    const startsAt =
      payload.startsAt !== undefined ? new Date(payload.startsAt) : undefined;
    const endsAt =
      payload.endsAt !== undefined ? new Date(payload.endsAt) : undefined;
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });

    if (
      startsAt &&
      endsAt &&
      !Number.isNaN(startsAt.getTime()) &&
      !Number.isNaN(endsAt.getTime()) &&
      endsAt <= startsAt
    ) {
      return res.status(400).json({ error: "INVALID_BLOCK_RANGE" });
    }

    const nextStartsAt = startsAt ?? existing.startsAt;
    const nextEndsAt = endsAt ?? existing.endsAt;
    const nextRecurrencePattern =
      payload.recurrencePattern ?? existing.recurrencePattern;
    const nextRecurrenceUntil =
      payload.recurrenceUntil !== undefined
        ? payload.recurrenceUntil
          ? new Date(payload.recurrenceUntil)
          : null
        : existing.recurrenceUntil;
    const recurrenceValidationError = getCalendarBlockRecurrenceValidationError(
      {
        startsAt: nextStartsAt,
        endsAt: nextEndsAt,
        recurrencePattern: nextRecurrencePattern,
        recurrenceUntil: nextRecurrenceUntil,
      },
      getSafeTimezone(tenant?.timezone),
    );

    if (recurrenceValidationError) {
      return res.status(400).json({ error: recurrenceValidationError });
    }

    const updated = await prisma.calendarTimeBlock.update({
      where: { id: recordId },
      data: {
        title: payload.title?.trim(),
        description: payload.description,
        startsAt,
        endsAt,
        isAllDay: payload.isAllDay,
        recurrencePattern: payload.recurrencePattern,
        recurrenceUntil:
          payload.recurrenceUntil !== undefined
            ? payload.recurrenceUntil
              ? new Date(payload.recurrenceUntil)
              : null
            : undefined,
      },
      select: {
        id: true,
        title: true,
        description: true,
        startsAt: true,
        endsAt: true,
        isAllDay: true,
        recurrencePattern: true,
        recurrenceUntil: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      ok: true,
      block: serializeCalendarBlock(updated),
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:tenantId/calendar/blocks/:recordId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);

    const existing = await prisma.calendarTimeBlock.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        tenantId: true,
        scope: true,
        userId: true,
      },
    });

    if (!existing || existing.tenantId !== tenantId || existing.scope !== "TENANT" || existing.userId !== null) {
      return res.status(404).json({ error: "CALENDAR_BLOCK_NOT_FOUND" });
    }

    await prisma.calendarTimeBlock.delete({
      where: { id: recordId },
    });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/:tenantId/calendar/users/:userId/blocks", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, userId } = TenantUserPathSchema.parse(req.params);
    const payload = CreateCalendarBlockSchema.parse(req.body);

    const [membership, tenant] = await prisma.$transaction([
      prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
        select: {
          userId: true,
          status: true,
        },
      }),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { timezone: true },
      }),
    ]);

    if (!membership || membership.status !== "ACTIVE") {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    const startsAt = new Date(payload.startsAt);
    const endsAt = new Date(payload.endsAt);
    const recurrenceUntil = payload.recurrenceUntil ? new Date(payload.recurrenceUntil) : null;
    const recurrenceValidationError = getCalendarBlockRecurrenceValidationError(
      {
        startsAt,
        endsAt,
        recurrencePattern: payload.recurrencePattern,
        recurrenceUntil,
      },
      getSafeTimezone(tenant?.timezone),
    );

    if (recurrenceValidationError) {
      return res.status(400).json({ error: recurrenceValidationError });
    }

    const created = await prisma.calendarTimeBlock.create({
      data: {
        tenantId,
        userId,
        scope: "USER",
        title: payload.title.trim(),
        description: payload.description ?? null,
        startsAt,
        endsAt,
        isAllDay: payload.isAllDay,
        recurrencePattern: payload.recurrencePattern,
        recurrenceUntil,
      },
      select: {
        id: true,
        title: true,
        description: true,
        startsAt: true,
        endsAt: true,
        isAllDay: true,
        recurrencePattern: true,
        recurrenceUntil: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({
      ok: true,
      block: serializeCalendarBlock(created),
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:tenantId/calendar/users/:userId/blocks/:recordId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, userId, recordId } = z
      .object({
        tenantId: z.string().trim().min(1),
        userId: z.string().trim().min(1),
        recordId: z.string().trim().min(1),
      })
      .parse(req.params);

    const existing = await prisma.calendarTimeBlock.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        tenantId: true,
        scope: true,
        userId: true,
      },
    });

    if (
      !existing ||
      existing.tenantId !== tenantId ||
      existing.scope !== "USER" ||
      existing.userId !== userId
    ) {
      return res.status(404).json({ error: "CALENDAR_BLOCK_NOT_FOUND" });
    }

    await prisma.calendarTimeBlock.delete({
      where: { id: recordId },
    });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/status-config", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);

    await ensureDefaultContactStatuses(prismaWithContacts, tenantId);
    await ensureDefaultTaskStatuses(prismaWithContacts, tenantId);

    const contactStatuses = await prismaWithContacts.contactStatusConfig.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        isActive: true,
        isSystemDefault: true,
      },
    });
    const taskStatuses = await prismaWithContacts.taskStatusConfig.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        isActive: true,
        isSystemDefault: true,
      },
    });

    return res.json({
      ok: true,
      configurations: [
        {
          key: "contacts",
          label: "Contacts",
          statusCount: contactStatuses.length,
          activeStatusCount: contactStatuses.filter((item: { isActive: boolean }) => item.isActive).length,
        },
        {
          key: "tasks",
          label: "Tasks",
          statusCount: taskStatuses.length,
          activeStatusCount: taskStatuses.filter((item: { isActive: boolean }) => item.isActive).length,
        },
      ],
      contactStatuses,
      taskStatuses,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/status-config/:configKey", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId, configKey } = TenantStatusConfigPathSchema.parse(req.params);
    await ensureDefaultStatusesForConfigKey(tenantId, configKey);

    const statusModel =
      configKey === "contacts"
        ? prismaWithContacts.contactStatusConfig
        : prismaWithContacts.taskStatusConfig;
    const statuses = await statusModel.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        isActive: true,
        isSystemDefault: true,
      },
    });

    return res.json({
      ok: true,
      configKey,
      statuses,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:tenantId/status-config/:configKey", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, configKey } = TenantStatusConfigPathSchema.parse(req.params);
    await ensureDefaultStatusesForConfigKey(tenantId, configKey);

    const payload = CreateContactStatusConfigSchema.parse(req.body);
    const normalizedName = payload.name.trim();
    const statusModel =
      configKey === "contacts"
        ? prismaWithContacts.contactStatusConfig
        : prismaWithContacts.taskStatusConfig;
    const maxSortOrderRecord = await statusModel.findFirst({
      where: { tenantId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = (maxSortOrderRecord?.sortOrder ?? 0) + 10;

    const created = await statusModel.create({
      data: {
        tenantId,
        name: normalizedName,
        bgColor: payload.bgColor,
        textColor: payload.textColor,
        sortOrder: payload.sortOrder ?? nextSortOrder,
        isActive: payload.isActive,
        isSystemDefault: false,
      },
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        isActive: true,
        isSystemDefault: true,
      },
    });

    return res.status(201).json({ ok: true, status: created });
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/:tenantId/status-config/:configKey/:recordId",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, configKey, recordId } =
        TenantStatusConfigRecordPathSchema.parse(req.params);
      await ensureDefaultStatusesForConfigKey(tenantId, configKey);
      const payload = UpdateContactStatusConfigSchema.parse(req.body);

      if (Object.keys(payload).length === 0) {
        return res.status(400).json({ error: "NO_CHANGES_PROVIDED" });
      }

      const statusModel =
        configKey === "contacts"
          ? prismaWithContacts.contactStatusConfig
          : prismaWithContacts.taskStatusConfig;
      const existing = await statusModel.findUnique({
        where: { id: recordId },
        select: {
          id: true,
          tenantId: true,
          isSystemDefault: true,
        },
      });

      if (!existing || existing.tenantId !== tenantId) {
        return res.status(404).json({ error: "STATUS_NOT_FOUND" });
      }

      if (existing.isSystemDefault && payload.name) {
        return res
          .status(400)
          .json({ error: "DEFAULT_STATUS_NAME_CANNOT_BE_CHANGED" });
      }

      if (configKey === "contacts" && payload.isActive === false) {
        const referencedAutomation = await findEnabledAutomationReference(
          prismaWithContacts,
          tenantId,
          { kind: "status", id: recordId },
        );
        if (referencedAutomation) {
          return res.status(409).json({
            error: "AUTOMATION_REFERENCE_CONFLICT",
            automation: referencedAutomation,
          });
        }
      }

      const updated = await statusModel.update({
        where: { id: recordId },
        data: {
          name: payload.name?.trim(),
          bgColor: payload.bgColor,
          textColor: payload.textColor,
          sortOrder: payload.sortOrder,
          isActive: payload.isActive,
        },
        select: {
          id: true,
          name: true,
          bgColor: true,
          textColor: true,
          sortOrder: true,
          isActive: true,
          isSystemDefault: true,
        },
      });

      return res.json({ ok: true, status: updated });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  "/:tenantId/status-config/:configKey/:recordId",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, configKey, recordId } =
        TenantStatusConfigRecordPathSchema.parse(req.params);
      await ensureDefaultStatusesForConfigKey(tenantId, configKey);

      const statusModel =
        configKey === "contacts"
          ? prismaWithContacts.contactStatusConfig
          : prismaWithContacts.taskStatusConfig;
      const existing = await statusModel.findUnique({
        where: { id: recordId },
        select: {
          id: true,
          tenantId: true,
          isSystemDefault: true,
        },
      });

      if (!existing || existing.tenantId !== tenantId) {
        return res.status(404).json({ error: "STATUS_NOT_FOUND" });
      }

      if (existing.isSystemDefault) {
        return res.status(409).json({ error: "CANNOT_DELETE_DEFAULT_STATUS" });
      }

      if (configKey === "contacts") {
        const referencedAutomation = await findEnabledAutomationReference(
          prismaWithContacts,
          tenantId,
          { kind: "status", id: recordId },
        );
        if (referencedAutomation) {
          return res.status(409).json({
            error: "AUTOMATION_REFERENCE_CONFLICT",
            automation: referencedAutomation,
          });
        }
      }

      if (configKey === "contacts") {
        const inUseCount = await prismaWithContacts.contact.count({
          where: {
            tenantId,
            statusConfigId: recordId,
          },
        });

        if (inUseCount > 0) {
          return res.status(409).json({
            error: "STATUS_IN_USE",
            details: { contactCount: inUseCount },
          });
        }
      }

      await statusModel.delete({
        where: { id: recordId },
      });

      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

router.get("/:tenantId/services", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);
    const { page, pageSize, search, isActive } = ServicesPaginationQuerySchema.parse(req.query);
    const skip = (page - 1) * pageSize;

    const where = {
      tenantId,
      ...(typeof isActive === "boolean" ? { isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { description: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [total, services] = await prisma.$transaction([
      prismaWithContacts.service.count({ where }),
      prismaWithContacts.service.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          description: true,
          basePriceCents: true,
          currency: true,
          allowPartialPayments: true,
          minimumPartialPaymentCents: true,
          isActive: true,
          sortOrder: true,
          checklistItems: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              label: true,
              description: true,
              isRequired: true,
              sortOrder: true,
            },
          },
          followUpTemplateSteps: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              title: true,
              notesTemplate: true,
              dueDaysFromStart: true,
              sortOrder: true,
            },
          },
          followUpTemplates: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              name: true,
              isPublished: true,
            },
          },
          professionals: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              kind: true,
              userId: true,
              externalProfessionalName: true,
              externalContact: true,
              notes: true,
              sortOrder: true,
              user: {
                select: {
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return res.json({
      ok: true,
      items: services,
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

router.get("/:tenantId/services/options", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);
    const { includeInactive } = ServiceOptionsQuerySchema.parse(req.query);

    const items = await prismaWithContacts.service.findMany({
      where: {
        tenantId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        isActive: true,
        sortOrder: true,
        checklistItems: {
          select: { id: true },
        },
        followUpTemplateSteps: {
          select: { id: true },
        },
        followUpTemplates: {
          select: { id: true },
        },
        professionals: {
          select: { id: true },
        },
      },
    });

    return res.json({
      ok: true,
      items: items.map((item: any) => ({
        id: item.id,
        name: item.name,
        isActive: item.isActive,
        sortOrder: item.sortOrder,
        checklistCount: item.checklistItems.length,
        followUpTemplateStepsCount: item.followUpTemplateSteps.length,
        followUpTemplatesCount: item.followUpTemplates.length,
        professionalsCount: item.professionals.length,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/follow-up-templates", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);
    const { page, pageSize, search, serviceId } = FollowUpTemplatesPaginationQuerySchema.parse(req.query);
    const skip = (page - 1) * pageSize;

    const where = {
      tenantId,
      ...(serviceId ? { serviceId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { service: { name: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };

    const [total, templates] = await prisma.$transaction([
      prismaWithContacts.serviceFollowUpTemplate.count({ where }),
      prismaWithContacts.serviceFollowUpTemplate.findMany({
        where,
        orderBy: [
          { service: { sortOrder: "asc" } },
          { service: { name: "asc" } },
          { sortOrder: "asc" },
          { createdAt: "asc" },
        ],
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          isPublished: true,
          serviceId: true,
          service: {
            select: {
              name: true,
              isActive: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return res.json({
      ok: true,
      items: templates.map((template: any) => ({
        id: template.id,
        name: template.name,
        isPublished: template.isPublished,
        serviceId: template.serviceId,
        serviceName: template.service?.name ?? "",
        serviceIsActive: Boolean(template.service?.isActive),
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

router.get("/:tenantId/service-fit-fields", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);
    const fields = await loadServiceFitCatalog(tenantId);

    return res.json({
      ok: true,
      fields,
    });
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/:tenantId/services/:recordId/follow-up-templates",
  ...readMiddlewares,
  async (req, res, next) => {
    try {
      const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);

      const service = await prismaWithContacts.service.findUnique({
        where: { id: recordId },
        select: { id: true, tenantId: true },
      });
      if (!service || service.tenantId !== tenantId) {
        return res.status(404).json({ error: "SERVICE_NOT_FOUND" });
      }

      const items = await prismaWithContacts.serviceFollowUpTemplate.findMany({
        where: { tenantId, serviceId: recordId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          sortOrder: true,
          isPublished: true,
          publishedAt: true,
          flowNodes: true,
          flowEdges: true,
          steps: {
            select: { id: true },
          },
        },
      });

      return res.json({
        ok: true,
        items: items.map((item: any) => ({
          id: item.id,
          name: item.name,
          sortOrder: item.sortOrder,
          isPublished: item.isPublished,
          publishedAt: item.publishedAt,
          flowNodes: item.flowNodes ?? [],
          flowEdges: item.flowEdges ?? [],
          stepsCount: item.steps.length,
        })),
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/:tenantId/services/:recordId/follow-up-templates",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
      const payload = ServiceFollowUpTemplateSchema.parse(req.body);

      const service = await prismaWithContacts.service.findUnique({
        where: { id: recordId },
        select: { id: true, tenantId: true },
      });
      if (!service || service.tenantId !== tenantId) {
        return res.status(404).json({ error: "SERVICE_NOT_FOUND" });
      }

      const maxSortOrderRecord = await prismaWithContacts.serviceFollowUpTemplate.findFirst({
        where: { tenantId, serviceId: recordId },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      const nextSortOrder = (maxSortOrderRecord?.sortOrder ?? 0) + 10;

      const created = await prismaWithContacts.serviceFollowUpTemplate.create({
        data: {
          tenantId,
          serviceId: recordId,
          name: payload.name.trim(),
          sortOrder: payload.sortOrder ?? nextSortOrder,
          isPublished: payload.isPublished ?? false,
          publishedAt: payload.isPublished ? new Date() : null,
          flowNodes: payload.flowNodes ?? [],
          flowEdges: payload.flowEdges ?? [],
        },
        select: {
          id: true,
          name: true,
          sortOrder: true,
          isPublished: true,
          publishedAt: true,
          flowNodes: true,
          flowEdges: true,
        },
      });

      return res.status(201).json({ ok: true, template: created });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/:tenantId/services/:recordId/follow-up-templates/:templateId",
  ...readMiddlewares,
  async (req, res, next) => {
    try {
      const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
      const templateId = z.string().trim().min(1).parse(req.params.templateId);

      const template = await prismaWithContacts.serviceFollowUpTemplate.findUnique({
        where: { id: templateId },
        select: {
          id: true,
          tenantId: true,
          serviceId: true,
          name: true,
          sortOrder: true,
          isPublished: true,
          publishedAt: true,
          flowNodes: true,
          flowEdges: true,
        },
      });

      if (!template || template.tenantId !== tenantId || template.serviceId !== recordId) {
        return res.status(404).json({ error: "FOLLOW_UP_TEMPLATE_NOT_FOUND" });
      }

      return res.json({
        ok: true,
        template: {
          ...template,
          flowNodes: template.flowNodes ?? [],
          flowEdges: template.flowEdges ?? [],
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/:tenantId/services/:recordId/follow-up-templates/:templateId/execution-logs",
  ...readMiddlewares,
  async (req, res, next) => {
    try {
      const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
      const templateId = z.string().trim().min(1).parse(req.params.templateId);
      const contactServiceId =
        typeof req.query.contactServiceId === "string" && req.query.contactServiceId.trim().length
          ? req.query.contactServiceId.trim()
          : null;
      const search =
        typeof req.query.search === "string" ? req.query.search.trim() : "";
      const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
      const pageSize = Math.min(
        50,
        Math.max(5, Number.parseInt(String(req.query.pageSize ?? "20"), 10) || 20),
      );
      const enrollmentsPage = Math.max(
        1,
        Number.parseInt(String(req.query.enrollmentsPage ?? "1"), 10) || 1,
      );
      const enrollmentsPageSize = Math.min(
        25,
        Math.max(5, Number.parseInt(String(req.query.enrollmentsPageSize ?? "10"), 10) || 10),
      );

      const template = await prismaWithContacts.serviceFollowUpTemplate.findUnique({
        where: { id: templateId },
        select: { id: true, tenantId: true, serviceId: true },
      });

      if (!template || template.tenantId !== tenantId || template.serviceId !== recordId) {
        return res.status(404).json({ error: "FOLLOW_UP_TEMPLATE_NOT_FOUND" });
      }

      const enrollmentWhere = {
        tenantId,
        serviceId: recordId,
        followUpTemplateId: templateId,
        ...(search
          ? {
              OR: [
                { contact: { firstName: { contains: search, mode: "insensitive" as const } } },
                { contact: { middleName: { contains: search, mode: "insensitive" as const } } },
                { contact: { lastName: { contains: search, mode: "insensitive" as const } } },
                { contact: { phoneNumber: { contains: search, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      };

      const [enrollmentsTotalCount, enrollments, totalCount, items] = await Promise.all([
        prismaWithContacts.contactService.count({
          where: enrollmentWhere,
        }),
        prismaWithContacts.contactService.findMany({
          where: enrollmentWhere,
          orderBy: [{ createdAt: "desc" }],
          skip: (enrollmentsPage - 1) * enrollmentsPageSize,
          take: enrollmentsPageSize,
          select: {
            id: true,
            status: true,
            createdAt: true,
            purchasedAt: true,
            startedAt: true,
            completedAt: true,
            contact: {
              select: {
                id: true,
                firstName: true,
                middleName: true,
                lastName: true,
                phoneNumber: true,
              },
            },
            service: {
              select: {
                id: true,
                name: true,
              },
            },
            followUpSteps: {
              orderBy: [{ sortOrder: "asc" }],
              select: {
                id: true,
                title: true,
                status: true,
                sortOrder: true,
                dueAt: true,
              },
            },
            executionLogs: {
              orderBy: [{ createdAt: "desc" }],
              take: 1,
              select: {
                createdAt: true,
                title: true,
              },
            },
          },
        }),
        prismaWithContacts.serviceFollowUpExecutionLog.count({
          where: {
            tenantId,
            templateId,
            ...(contactServiceId ? { contactServiceId } : {}),
          },
        }),
        prismaWithContacts.serviceFollowUpExecutionLog.findMany({
          where: {
            tenantId,
            templateId,
            ...(contactServiceId ? { contactServiceId } : {}),
          },
          orderBy: [{ createdAt: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            eventType: true,
            title: true,
            details: true,
            flowNodeId: true,
            stepId: true,
            payload: true,
            createdAt: true,
            actor: {
              select: {
                id: true,
                name: true,
              },
            },
            contact: {
              select: {
                id: true,
                firstName: true,
                middleName: true,
                lastName: true,
              },
            },
            contactService: {
              select: {
                id: true,
                service: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                followUpSteps: {
                  select: {
                    id: true,
                    title: true,
                  },
                },
              },
            },
          },
        }),
      ]);

      return res.json({
        ok: true,
        enrollments: enrollments.map((item: any) => {
          const activeStep =
            item.followUpSteps.find((step: any) => step.status === "ACTIVE") ??
            item.followUpSteps.find((step: any) => step.status === "POSTPONED") ??
            item.followUpSteps.find((step: any) => step.status === "PENDING") ??
            item.followUpSteps[item.followUpSteps.length - 1] ??
            null;
          const completedCount = item.followUpSteps.filter(
            (step: any) => step.status === "COMPLETED" || step.status === "SKIPPED",
          ).length;

          return {
            id: item.id,
            status: item.status,
            createdAt: item.createdAt,
            purchasedAt: item.purchasedAt,
            startedAt: item.startedAt,
            completedAt: item.completedAt,
            contact: {
              id: item.contact.id,
              name: [item.contact.firstName, item.contact.middleName, item.contact.lastName]
                .filter(Boolean)
                .join(" "),
              phoneNumber: item.contact.phoneNumber ?? null,
            },
            service: item.service,
            currentStep: activeStep
              ? {
                  id: activeStep.id,
                  title: activeStep.title,
                  status: activeStep.status,
                  dueAt: activeStep.dueAt,
                }
              : null,
            completedCount,
            totalCount: item.followUpSteps.length,
            lastExecution: item.executionLogs[0]
              ? {
                  createdAt: item.executionLogs[0].createdAt,
                  title: item.executionLogs[0].title,
                }
              : null,
          };
        }),
        items: items.map((item: any) => ({
          id: item.id,
          eventType: item.eventType,
          title: item.title,
          details: item.details,
          flowNodeId: item.flowNodeId,
          stepId: item.stepId,
          payload: item.payload ?? null,
          createdAt: item.createdAt,
          actor: item.actor,
          contact: {
            id: item.contact.id,
            name: [item.contact.firstName, item.contact.middleName, item.contact.lastName]
              .filter(Boolean)
              .join(" "),
          },
          contactService: {
            id: item.contactService.id,
            service: item.contactService.service,
            steps: item.contactService.followUpSteps,
          },
        })),
        selectedContactServiceId:
          contactServiceId && enrollments.some((item: any) => item.id === contactServiceId)
            ? contactServiceId
            : null,
        search,
        enrollmentsPage,
        enrollmentsPageSize,
        enrollmentsTotalCount,
        enrollmentsTotalPages: Math.max(1, Math.ceil(enrollmentsTotalCount / enrollmentsPageSize)),
        page,
        pageSize,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  "/:tenantId/services/:recordId/follow-up-templates/:templateId",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
      const templateId = z.string().trim().min(1).parse(req.params.templateId);
      const payload = ServiceFollowUpTemplatePatchSchema.parse(req.body);

      if (Object.keys(payload).length === 0) {
        return res.status(400).json({ error: "NO_CHANGES_PROVIDED" });
      }

      const existing = await prismaWithContacts.serviceFollowUpTemplate.findUnique({
        where: { id: templateId },
        select: { id: true, tenantId: true, serviceId: true },
      });
      if (!existing || existing.tenantId !== tenantId || existing.serviceId !== recordId) {
        return res.status(404).json({ error: "FOLLOW_UP_TEMPLATE_NOT_FOUND" });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const prismaTx = tx as any;

        if (payload.steps) {
          await prismaTx.serviceFollowUpTemplateStep.deleteMany({
            where: { tenantId, serviceId: recordId, templateId },
          });
        }

        return prismaTx.serviceFollowUpTemplate.update({
          where: { id: templateId },
          data: {
            ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
            ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
            ...(payload.isPublished !== undefined
              ? {
                  isPublished: payload.isPublished,
                  publishedAt: payload.isPublished ? new Date() : null,
                }
              : {}),
            ...(payload.flowNodes !== undefined ? { flowNodes: payload.flowNodes } : {}),
            ...(payload.flowEdges !== undefined ? { flowEdges: payload.flowEdges } : {}),
            ...(payload.steps
              ? {
                  steps: {
                    create: payload.steps.map((step, index) => ({
                      tenantId,
                      serviceId: recordId,
                      title: step.title.trim(),
                      notesTemplate: step.notesTemplate ?? null,
                      templateNodeId: step.templateNodeId ?? null,
                      dueDaysFromStart: step.dueDaysFromStart,
                      sortOrder: step.sortOrder ?? (index + 1) * 10,
                    })),
                  },
                }
              : {}),
          },
          select: {
            id: true,
            name: true,
            sortOrder: true,
            isPublished: true,
            publishedAt: true,
            flowNodes: true,
            flowEdges: true,
          },
        });
      });

      return res.json({
        ok: true,
        template: {
          ...updated,
          flowNodes: updated.flowNodes ?? [],
          flowEdges: updated.flowEdges ?? [],
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  "/:tenantId/services/:recordId/follow-up-templates/:templateId",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
      const templateId = z.string().trim().min(1).parse(req.params.templateId);

      const existing = await prismaWithContacts.serviceFollowUpTemplate.findUnique({
        where: { id: templateId },
        select: { id: true, tenantId: true, serviceId: true },
      });
      if (!existing || existing.tenantId !== tenantId || existing.serviceId !== recordId) {
        return res.status(404).json({ error: "FOLLOW_UP_TEMPLATE_NOT_FOUND" });
      }

      await prismaWithContacts.serviceFollowUpTemplate.delete({
        where: { id: templateId },
      });

      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

router.get("/:tenantId/service-professionals", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);

    const services = await prismaWithContacts.service.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        professionals: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            kind: true,
            userId: true,
            externalProfessionalName: true,
            user: {
              select: {
                name: true,
                email: true,
                image: true,
              },
            },
          },
        },
      },
    });

    const items = services.flatMap((service: any) =>
      service.professionals.map((professional: any) => ({
        id: professional.id,
        serviceId: service.id,
        serviceName: service.name,
        kind: professional.kind,
        name:
          professional.kind === "INTERNAL_USER"
            ? professional.user?.name?.trim() || professional.user?.email || "Unassigned user"
            : professional.externalProfessionalName?.trim() || "External professional",
      })),
    );

    return res.json({
      ok: true,
      items,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/services/:recordId", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);

    const service = await prismaWithContacts.service.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        description: true,
        fitProfile: true,
        basePriceCents: true,
        currency: true,
        isTaxExempt: true,
        allowPartialPayments: true,
        minimumPartialPaymentCents: true,
        installmentCount: true,
        installmentFrequency: true,
        isActive: true,
        sortOrder: true,
        tenant: {
          select: {
            taxEnabled: true,
            taxLabel: true,
            defaultTaxRateBps: true,
          },
        },
        checklistItems: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            label: true,
            description: true,
            isRequired: true,
            sortOrder: true,
          },
        },
        followUpTemplateSteps: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            title: true,
            notesTemplate: true,
            dueDaysFromStart: true,
            sortOrder: true,
          },
        },
        followUpTemplates: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            name: true,
            sortOrder: true,
            isPublished: true,
            publishedAt: true,
            flowNodes: true,
            flowEdges: true,
          },
        },
        professionals: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            kind: true,
            userId: true,
            externalProfessionalName: true,
            externalContact: true,
            notes: true,
            sortOrder: true,
            user: {
              select: {
                name: true,
                email: true,
                image: true,
              },
            },
          },
        },
      },
    });

    if (!service || service.tenantId !== tenantId) {
      return res.status(404).json({ error: "SERVICE_NOT_FOUND" });
    }

    return res.json({
      ok: true,
      service: {
        id: service.id,
        tenantId: service.tenantId,
        name: service.name,
        description: service.description,
        fitProfile: normalizeServiceFitProfile(service.fitProfile),
        basePriceCents: service.basePriceCents,
        currency: service.currency,
        isTaxExempt: service.isTaxExempt,
        allowPartialPayments: service.allowPartialPayments,
        minimumPartialPaymentCents: service.minimumPartialPaymentCents,
        installmentCount: service.installmentCount,
        installmentFrequency: service.installmentFrequency,
        isActive: service.isActive,
        sortOrder: service.sortOrder,
        checklistItems: service.checklistItems,
        followUpTemplateSteps: service.followUpTemplateSteps,
        followUpTemplates: service.followUpTemplates,
        professionals: service.professionals,
        tenantBilling: {
          taxEnabled: service.tenant.taxEnabled,
          taxLabel: service.tenant.taxLabel,
          defaultTaxRatePercent:
            service.tenant.defaultTaxRateBps !== null &&
            service.tenant.defaultTaxRateBps !== undefined
              ? service.tenant.defaultTaxRateBps / 100
              : null,
        },
        configStatus: {
          overviewComplete:
            service.name.trim().length > 0 &&
            service.basePriceCents >= 0 &&
            service.currency.trim().length === 3 &&
            (!service.allowPartialPayments ||
              (service.minimumPartialPaymentCents !== null &&
                service.installmentCount !== null &&
                service.installmentFrequency !== null)),
          checklistComplete: service.checklistItems.length > 0,
          followUpsComplete:
            service.followUpTemplates.length > 0 ||
            service.followUpTemplateSteps.length > 0,
          professionalsComplete: service.professionals.length > 0,
          isComplete:
            service.name.trim().length > 0 &&
            service.basePriceCents >= 0 &&
            service.currency.trim().length === 3 &&
            (!service.allowPartialPayments ||
              (service.minimumPartialPaymentCents !== null &&
                service.installmentCount !== null &&
                service.installmentFrequency !== null)) &&
            service.checklistItems.length > 0 &&
            (service.followUpTemplates.length > 0 ||
              service.followUpTemplateSteps.length > 0) &&
            service.professionals.length > 0,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:tenantId/services", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = CreateServiceSchema.parse(req.body);
    const normalizedPayload = {
      ...payload,
      currency: payload.currency.trim().toUpperCase(),
      minimumPartialPaymentCents: payload.allowPartialPayments
        ? payload.minimumPartialPaymentCents ?? null
        : null,
    };
    const normalizedName = normalizedPayload.name.trim();

    const duplicate = await findServiceByName(tenantId, normalizedName);
    if (duplicate) {
      return res.status(409).json({ error: "SERVICE_NAME_ALREADY_EXISTS" });
    }

    const professionalValidation = await validateServiceProfessionalsForTenant(
      tenantId,
      payload.professionals,
    );
    if (!professionalValidation.ok) {
      return res.status(400).json({ error: professionalValidation.error });
    }

    let fitProfile = DEFAULT_SERVICE_FIT_PROFILE;
    if (payload.fitProfile) {
      const catalog = await loadServiceFitCatalog(tenantId);
      const validation = validateServiceFitProfile(
        normalizeServiceFitProfile(payload.fitProfile),
        catalog,
      );

      if (!validation.ok) {
        return res.status(400).json({ error: "INVALID_SERVICE_FIT_PROFILE", details: validation.error });
      }

      fitProfile = validation.profile;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        taxEnabled: true,
        defaultTaxRateBps: true,
      },
    });

    if (!tenant) {
      return res.status(404).json({ error: "TENANT_NOT_FOUND" });
    }

    const maxAllowedDepositCents = getServiceTotalWithTaxCents({
      basePriceCents: payload.basePriceCents,
      isTaxExempt: payload.isTaxExempt,
      taxEnabled: tenant.taxEnabled,
      defaultTaxRateBps: tenant.defaultTaxRateBps,
    });

    if (
      payload.allowPartialPayments &&
      normalizedPayload.minimumPartialPaymentCents !== null &&
      normalizedPayload.minimumPartialPaymentCents > maxAllowedDepositCents
    ) {
      return res.status(400).json({ error: "MINIMUM_PARTIAL_EXCEEDS_TOTAL_PRICE" });
    }

    const maxSortOrderRecord = await prismaWithContacts.service.findFirst({
      where: { tenantId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = (maxSortOrderRecord?.sortOrder ?? 0) + 10;

    const created = await prismaWithContacts.service.create({
      data: {
        tenantId,
        name: normalizedName,
        description: normalizedPayload.description ?? null,
        fitProfile,
        basePriceCents: payload.basePriceCents,
        currency: normalizedPayload.currency || "USD",
        isTaxExempt: payload.isTaxExempt,
        allowPartialPayments: payload.allowPartialPayments,
        minimumPartialPaymentCents: normalizedPayload.minimumPartialPaymentCents,
        installmentCount: normalizedPayload.installmentCount ?? null,
        installmentFrequency: normalizedPayload.installmentFrequency ?? null,
        isActive: payload.isActive,
        sortOrder: payload.sortOrder ?? nextSortOrder,
        checklistItems: {
          create: payload.checklistItems.map((item, index) => ({
            label: item.label.trim(),
            description: item.description ?? null,
            isRequired: item.isRequired,
            sortOrder: item.sortOrder ?? (index + 1) * 10,
            tenantId,
          })),
        },
        followUpTemplateSteps: {
          create: payload.followUpTemplateSteps.map((step, index) => ({
            title: step.title.trim(),
            notesTemplate: step.notesTemplate ?? null,
            dueDaysFromStart: step.dueDaysFromStart,
            sortOrder: step.sortOrder ?? (index + 1) * 10,
            tenantId,
          })),
        },
        professionals: {
          create: payload.professionals.map((professional, index) => ({
            kind: professional.kind,
            userId:
              professional.kind === "INTERNAL_USER"
                ? professional.userId ?? null
                : null,
            externalProfessionalName:
              professional.kind === "EXTERNAL"
                ? professional.externalProfessionalName ?? null
                : null,
            externalContact:
              professional.kind === "EXTERNAL"
                ? professional.externalContact ?? null
                : null,
            notes: professional.notes ?? null,
            sortOrder: professional.sortOrder ?? (index + 1) * 10,
            tenantId,
          })),
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        fitProfile: true,
        basePriceCents: true,
        currency: true,
        isTaxExempt: true,
        allowPartialPayments: true,
        minimumPartialPaymentCents: true,
        installmentCount: true,
        installmentFrequency: true,
        isActive: true,
        sortOrder: true,
      },
    });

    return res.status(201).json({
      ok: true,
      service: {
        ...created,
        fitProfile: normalizeServiceFitProfile(created.fitProfile),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:tenantId/services/:recordId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
    const payload = normalizeServicePayload(UpdateServiceSchema.parse(req.body));

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "NO_CHANGES_PROVIDED" });
    }

    const existing = await prismaWithContacts.service.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        tenantId: true,
        basePriceCents: true,
        isTaxExempt: true,
        allowPartialPayments: true,
        tenant: {
          select: {
            taxEnabled: true,
            defaultTaxRateBps: true,
          },
        },
      },
    });

    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "SERVICE_NOT_FOUND" });
    }

    if (payload.name) {
      const duplicate = await findServiceByName(tenantId, payload.name, recordId);
      if (duplicate) {
        return res.status(409).json({ error: "SERVICE_NAME_ALREADY_EXISTS" });
      }
    }

    if (payload.professionals) {
      const professionalValidation = await validateServiceProfessionalsForTenant(
        tenantId,
        payload.professionals,
      );
      if (!professionalValidation.ok) {
        return res.status(400).json({ error: professionalValidation.error });
      }
    }

    let nextFitProfile: z.infer<typeof ServiceFitProfileSchema> | undefined;
    if (payload.fitProfile !== undefined) {
      const catalog = await loadServiceFitCatalog(tenantId);
      const validation = validateServiceFitProfile(
        normalizeServiceFitProfile(payload.fitProfile),
        catalog,
      );

      if (!validation.ok) {
        return res.status(400).json({ error: "INVALID_SERVICE_FIT_PROFILE", details: validation.error });
      }

      nextFitProfile = validation.profile;
    }

    const nextBasePriceCents = payload.basePriceCents ?? existing.basePriceCents;
    const nextIsTaxExempt = payload.isTaxExempt ?? existing.isTaxExempt;
    const nextAllowPartialPayments = payload.allowPartialPayments ?? existing.allowPartialPayments;
    const nextMinimumPartial =
      payload.minimumPartialPaymentCents === undefined
        ? undefined
        : payload.minimumPartialPaymentCents;
    const maxAllowedDepositCents = getServiceTotalWithTaxCents({
      basePriceCents: nextBasePriceCents,
      isTaxExempt: nextIsTaxExempt,
      taxEnabled: existing.tenant.taxEnabled,
      defaultTaxRateBps: existing.tenant.defaultTaxRateBps,
    });

    if (
      nextAllowPartialPayments &&
      nextMinimumPartial !== undefined &&
      nextMinimumPartial !== null &&
      nextMinimumPartial > maxAllowedDepositCents
    ) {
      return res.status(400).json({ error: "MINIMUM_PARTIAL_EXCEEDS_TOTAL_PRICE" });
    }

    if (
      nextAllowPartialPayments &&
      payload.installmentCount !== undefined &&
      payload.installmentCount !== null &&
      payload.installmentCount < 2
    ) {
      return res.status(400).json({ error: "INVALID_INSTALLMENT_COUNT" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const prismaTx = tx as any;

      if (payload.checklistItems) {
        await prismaTx.serviceChecklistItem.deleteMany({
          where: {
            tenantId,
            serviceId: recordId,
          },
        });
      }

      if (payload.followUpTemplateSteps) {
        await prismaTx.serviceFollowUpTemplateStep.deleteMany({
          where: {
            tenantId,
            serviceId: recordId,
          },
        });
      }

      if (payload.professionals) {
        await prismaTx.serviceProfessional.deleteMany({
          where: {
            tenantId,
            serviceId: recordId,
          },
        });
      }

      return prismaTx.service.update({
        where: { id: recordId },
        data: {
          ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
          ...(payload.description !== undefined ? { description: payload.description ?? null } : {}),
          ...(payload.fitProfile !== undefined ? { fitProfile: nextFitProfile } : {}),
          ...(payload.basePriceCents !== undefined
            ? { basePriceCents: payload.basePriceCents }
            : {}),
          ...(payload.currency !== undefined ? { currency: payload.currency } : {}),
          ...(payload.isTaxExempt !== undefined
            ? { isTaxExempt: payload.isTaxExempt }
            : {}),
          ...(payload.allowPartialPayments !== undefined
            ? { allowPartialPayments: payload.allowPartialPayments }
            : {}),
          ...(payload.minimumPartialPaymentCents !== undefined
            ? {
                minimumPartialPaymentCents: nextAllowPartialPayments
                  ? payload.minimumPartialPaymentCents
                  : null,
              }
            : {}),
          ...(payload.installmentCount !== undefined
            ? {
                installmentCount: nextAllowPartialPayments
                  ? payload.installmentCount
                  : null,
              }
            : {}),
          ...(payload.installmentFrequency !== undefined
            ? {
                installmentFrequency: nextAllowPartialPayments
                  ? payload.installmentFrequency
                  : null,
              }
            : {}),
          ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
          ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
          ...(payload.checklistItems
            ? {
                checklistItems: {
                  create: payload.checklistItems.map((item, index) => ({
                    label: item.label.trim(),
                    description: item.description ?? null,
                    isRequired: item.isRequired,
                    sortOrder: item.sortOrder ?? (index + 1) * 10,
                    tenantId,
                  })),
                },
              }
            : {}),
          ...(payload.followUpTemplateSteps
            ? {
                followUpTemplateSteps: {
                  create: payload.followUpTemplateSteps.map((step, index) => ({
                    title: step.title.trim(),
                    notesTemplate: step.notesTemplate ?? null,
                    dueDaysFromStart: step.dueDaysFromStart,
                    sortOrder: step.sortOrder ?? (index + 1) * 10,
                    tenantId,
                  })),
                },
              }
            : {}),
          ...(payload.professionals
            ? {
                professionals: {
                  create: payload.professionals.map((professional, index) => ({
                    kind: professional.kind,
                    userId:
                      professional.kind === "INTERNAL_USER"
                        ? professional.userId ?? null
                        : null,
                    externalProfessionalName:
                      professional.kind === "EXTERNAL"
                        ? professional.externalProfessionalName ?? null
                        : null,
                    externalContact:
                      professional.kind === "EXTERNAL"
                        ? professional.externalContact ?? null
                        : null,
                    notes: professional.notes ?? null,
                    sortOrder: professional.sortOrder ?? (index + 1) * 10,
                    tenantId,
                  })),
                },
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          description: true,
          fitProfile: true,
          basePriceCents: true,
          currency: true,
          isTaxExempt: true,
          allowPartialPayments: true,
          minimumPartialPaymentCents: true,
          installmentCount: true,
          installmentFrequency: true,
          isActive: true,
          sortOrder: true,
        },
      });
    });

    return res.json({
      ok: true,
      service: {
        ...updated,
        fitProfile: normalizeServiceFitProfile(updated.fitProfile),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:tenantId/services/:recordId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);

    const existing = await prismaWithContacts.service.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "SERVICE_NOT_FOUND" });
    }

    await prismaWithContacts.service.delete({
      where: { id: recordId },
    });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/tags", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);

    const tags = await prismaWithContacts.tenantTag.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      ok: true,
      tags,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:tenantId/tags", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = CreateTenantTagSchema.parse(req.body);
    const normalizedName = normalizeTenantTagName(payload.name);

    if (!normalizedName) {
      return res.status(400).json({ error: "INVALID_TAG_NAME" });
    }

    const duplicate = await findTenantTagByName(tenantId, normalizedName);
    if (duplicate) {
      return res.status(409).json({ error: "TAG_NAME_ALREADY_EXISTS" });
    }

    const maxSortOrderRecord = await prismaWithContacts.tenantTag.findFirst({
      where: { tenantId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = (maxSortOrderRecord?.sortOrder ?? 0) + 10;

    const created = await prismaWithContacts.tenantTag.create({
      data: {
        tenantId,
        name: normalizedName,
        bgColor: payload.bgColor,
        textColor: payload.textColor,
        sortOrder: payload.sortOrder ?? nextSortOrder,
      },
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({ ok: true, tag: created });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:tenantId/tags/:recordId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
    const payload = UpdateTenantTagSchema.parse(req.body);

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "NO_CHANGES_PROVIDED" });
    }

    const existing = await prismaWithContacts.tenantTag.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "TAG_NOT_FOUND" });
    }

    if (payload.name) {
      const normalizedName = normalizeTenantTagName(payload.name);
      if (!normalizedName) {
        return res.status(400).json({ error: "INVALID_TAG_NAME" });
      }

      const duplicate = await findTenantTagByName(tenantId, payload.name, recordId);
      if (duplicate) {
        return res.status(409).json({ error: "TAG_NAME_ALREADY_EXISTS" });
      }
    }

    const updated = await prismaWithContacts.tenantTag.update({
      where: { id: recordId },
      data: {
        name: payload.name ? normalizeTenantTagName(payload.name) : undefined,
        bgColor: payload.bgColor,
        textColor: payload.textColor,
        sortOrder: payload.sortOrder,
      },
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({ ok: true, tag: updated });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:tenantId/tags/:recordId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);

    const existing = await prismaWithContacts.tenantTag.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "TAG_NOT_FOUND" });
    }

    const referencedAutomation = await findEnabledAutomationReference(
      prismaWithContacts,
      tenantId,
      { kind: "tag", id: recordId },
    );
    if (referencedAutomation) {
      return res.status(409).json({
        error: "AUTOMATION_REFERENCE_CONFLICT",
        automation: referencedAutomation,
      });
    }

    await prismaWithContacts.tenantTag.delete({
      where: { id: recordId },
    });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/opportunities", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);
    const { page, pageSize } = OpportunitiesPaginationQuerySchema.parse(req.query);
    const skip = (page - 1) * pageSize;

    const [total, pipelines] = await prisma.$transaction([
      prisma.opportunityPipeline.count({
        where: { tenantId },
      }),
      prisma.opportunityPipeline.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        skip,
        take: pageSize,
        select: opportunityPipelineSelect,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return res.json({
      ok: true,
      items: pipelines,
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

router.patch(
  "/:tenantId/opportunities/reorder",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId } = TenantPathSchema.parse(req.params);
      const payload = ReorderOpportunityPipelinesSchema.parse(req.body);

      if (payload.pipelineId === payload.targetPipelineId) {
        return res.json({ ok: true });
      }

      const pipelines = await prismaWithContacts.opportunityPipeline.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
        },
      });

      const pipelineIds = pipelines.map((pipeline: { id: string }) => pipeline.id);
      const sourceIndex = pipelineIds.indexOf(payload.pipelineId);
      const targetIndex = pipelineIds.indexOf(payload.targetPipelineId);

      if (sourceIndex < 0 || targetIndex < 0) {
        return res.status(404).json({ error: "PIPELINE_NOT_FOUND" });
      }

      const reorderedIds = [...pipelineIds];
      const [movedId] = reorderedIds.splice(sourceIndex, 1);
      const targetInsertionIndex = reorderedIds.indexOf(payload.targetPipelineId);
      const insertAt =
        payload.position === "before" ? targetInsertionIndex : targetInsertionIndex + 1;

      reorderedIds.splice(insertAt, 0, movedId);

      await prismaWithContacts.$transaction(
        reorderedIds.map((pipelineId: string, index: number) =>
          prismaWithContacts.opportunityPipeline.update({
            where: {
              tenantId_id: {
                tenantId,
                id: pipelineId,
              },
            },
            data: {
              sortOrder: (index + 1) * 10,
            },
          }),
        ),
      );

      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

router.post("/:tenantId/opportunities", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = UpsertOpportunityPipelineSchema.parse(req.body);
    const normalizedStages = payload.stages.map((stage, index) => ({
      name: normalizeOpportunityStageName(stage.name),
      sortOrder: (index + 1) * 10,
    }));

    const duplicatePipeline = await findOpportunityPipelineByName(tenantId, payload.name);
    if (duplicatePipeline) {
      return res.status(409).json({ error: "PIPELINE_NAME_ALREADY_EXISTS" });
    }

    const maxSortOrderRecord = await prismaWithContacts.opportunityPipeline.findFirst({
      where: { tenantId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = (maxSortOrderRecord?.sortOrder ?? 0) + 10;

    const created = await prismaWithContacts.opportunityPipeline.create({
      data: {
        tenantId,
        name: payload.name,
        color: payload.color,
        sortOrder: nextSortOrder,
        stages: {
          create: normalizedStages.map((stage) => ({
            tenantId,
            name: stage.name,
            sortOrder: stage.sortOrder,
          })),
        },
      },
      select: opportunityPipelineSelect,
    });

    return res.status(201).json({ ok: true, pipeline: created });
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/:tenantId/opportunities/:recordId",
  ...readMiddlewares,
  async (req, res, next) => {
    try {
      const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);

      const pipeline = await prismaWithContacts.opportunityPipeline.findUnique({
        where: {
          tenantId_id: {
            tenantId,
            id: recordId,
          },
        },
        select: opportunityPipelineSelect,
      });

      if (!pipeline) {
        return res.status(404).json({ error: "PIPELINE_NOT_FOUND" });
      }

      return res.json({
        ok: true,
        pipeline: {
          id: pipeline.id,
          name: pipeline.name,
          color: pipeline.color,
          sortOrder: pipeline.sortOrder,
          createdAt: pipeline.createdAt,
          updatedAt: pipeline.updatedAt,
          stages: pipeline.stages,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch("/:tenantId/opportunities/:recordId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
    const payload = UpsertOpportunityPipelineSchema.parse(req.body);
    const normalizedStages = payload.stages.map((stage, index) => ({
      id: stage.id?.trim() || null,
      name: normalizeOpportunityStageName(stage.name),
      sortOrder: (index + 1) * 10,
    }));

    const existing = await prismaWithContacts.opportunityPipeline.findUnique({
      where: {
        tenantId_id: {
          tenantId,
          id: recordId,
        },
      },
      select: {
        id: true,
        stages: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "PIPELINE_NOT_FOUND" });
    }

    const duplicatePipeline = await findOpportunityPipelineByName(
      tenantId,
      payload.name,
      recordId,
    );
    if (duplicatePipeline) {
      return res.status(409).json({ error: "PIPELINE_NAME_ALREADY_EXISTS" });
    }

    const existingStageIds = new Set<string>(
      existing.stages.map((stage: { id: string }) => stage.id),
    );
    const retainedStageIds = normalizedStages
      .map((stage) => stage.id)
      .filter((stageId): stageId is string => Boolean(stageId));
    const unknownStageId = retainedStageIds.find((stageId) => !existingStageIds.has(stageId));

    if (unknownStageId) {
      return res.status(404).json({ error: "PIPELINE_STAGE_NOT_FOUND" });
    }

    const removedStageIds = [...existingStageIds].filter(
      (stageId) => !retainedStageIds.includes(stageId),
    );
    if (removedStageIds.length > 0) {
      const referencedAutomation = await findEnabledAutomationReference(
        prismaWithContacts,
        tenantId,
        { kind: "stage", ids: removedStageIds },
      );
      if (referencedAutomation) {
        return res.status(409).json({
          error: "AUTOMATION_REFERENCE_CONFLICT",
          automation: referencedAutomation,
        });
      }
    }

    const updated = await prismaWithContacts.$transaction(async (tx: any) => {
      await tx.opportunityPipeline.update({
        where: {
          tenantId_id: {
            tenantId,
            id: recordId,
          },
        },
        data: {
          name: payload.name,
          color: payload.color,
        },
      });

      await tx.opportunityPipelineStage.deleteMany({
        where: {
          tenantId,
          pipelineId: recordId,
          ...(retainedStageIds.length > 0
            ? { id: { notIn: retainedStageIds } }
            : {}),
        },
      });

      for (const stage of normalizedStages) {
        if (stage.id) {
          await tx.opportunityPipelineStage.update({
            where: { id: stage.id },
            data: {
              name: stage.name,
              sortOrder: stage.sortOrder,
            },
          });
          continue;
        }

        await tx.opportunityPipelineStage.create({
          data: {
            tenantId,
            pipelineId: recordId,
            name: stage.name,
            sortOrder: stage.sortOrder,
          },
        });
      }

        return tx.opportunityPipeline.findUnique({
        where: {
          tenantId_id: {
            tenantId,
            id: recordId,
          },
        },
        select: opportunityPipelineSelect,
      });
    });

    return res.json({ ok: true, pipeline: updated });
  } catch (error) {
    return next(error);
  }
});

router.delete(
  "/:tenantId/opportunities/:recordId",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);

      const existing = await prismaWithContacts.opportunityPipeline.findUnique({
        where: {
          tenantId_id: {
            tenantId,
            id: recordId,
          },
        },
        select: {
          id: true,
        },
      });

      if (!existing) {
        return res.status(404).json({ error: "PIPELINE_NOT_FOUND" });
      }

      const referencedAutomation = await findEnabledAutomationReference(
        prismaWithContacts,
        tenantId,
        { kind: "pipeline", id: recordId },
      );
      if (referencedAutomation) {
        return res.status(409).json({
          error: "AUTOMATION_REFERENCE_CONFLICT",
          automation: referencedAutomation,
        });
      }

      await prismaWithContacts.opportunityPipeline.delete({
        where: {
          tenantId_id: {
            tenantId,
            id: recordId,
          },
        },
      });

      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

router.get("/:tenantId/custom-fields", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);

    const customFields = await prismaWithContacts.contactCustomField.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: {
        id: true,
        key: true,
        label: true,
        description: true,
        fieldType: true,
        isRequired: true,
        isEncrypted: true,
        isSensitive: true,
        isActive: true,
        options: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      ok: true,
      customFields: customFields.map((field: any) => ({
        ...field,
        options: Array.isArray(field.options) ? field.options : [],
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:tenantId/custom-fields", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = CreateContactCustomFieldSchema.parse(req.body);
    const optionValidation = validateCustomFieldOptions(payload.fieldType, payload.options);

    if (!optionValidation.ok) {
      return res.status(400).json({
        error: optionValidation.error,
        details: optionValidation.details,
      });
    }

    const maxSortOrderRecord = await prismaWithContacts.contactCustomField.findFirst({
      where: { tenantId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = (maxSortOrderRecord?.sortOrder ?? 0) + 10;
    const uniqueKey = await buildUniqueCustomFieldKey(tenantId, payload.label);

    const created = await prismaWithContacts.contactCustomField.create({
      data: {
        tenantId,
        key: uniqueKey,
        label: payload.label.trim(),
        description: payload.description ?? null,
        fieldType: payload.fieldType,
        isRequired: payload.isRequired,
        isEncrypted: payload.isEncrypted,
        isSensitive: payload.isSensitive,
        isActive: payload.isActive,
        options: optionValidation.options,
        sortOrder: nextSortOrder,
      },
      select: {
        id: true,
        key: true,
        label: true,
        description: true,
        fieldType: true,
        isRequired: true,
        isEncrypted: true,
        isSensitive: true,
        isActive: true,
        options: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({
      ok: true,
      customField: {
        ...created,
        options: Array.isArray(created.options) ? created.options : [],
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/:tenantId/custom-fields/:recordId",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
      const payload = UpdateContactCustomFieldSchema.parse(req.body);

      if (Object.keys(payload).length === 0) {
        return res.status(400).json({ error: "NO_CHANGES_PROVIDED" });
      }

      const existing = await prismaWithContacts.contactCustomField.findUnique({
        where: { id: recordId },
        select: {
          id: true,
          tenantId: true,
          label: true,
          fieldType: true,
          isRequired: true,
          isEncrypted: true,
          isSensitive: true,
          isActive: true,
          options: true,
        },
      });

      if (!existing || existing.tenantId !== tenantId) {
        return res.status(404).json({ error: "CUSTOM_FIELD_NOT_FOUND" });
      }

      if (
        (payload.isActive === false && existing.isActive) ||
        (payload.isEncrypted === true && !existing.isEncrypted) ||
        (payload.isSensitive === true && !existing.isSensitive) ||
        (payload.isRequired === true && !existing.isRequired) ||
        (payload.fieldType !== undefined && payload.fieldType !== existing.fieldType) ||
        (payload.options !== undefined &&
          JSON.stringify(payload.options) !==
            JSON.stringify(Array.isArray(existing.options) ? existing.options : []))
      ) {
        const referencedAutomation = await findEnabledAutomationReference(
          prismaWithContacts,
          tenantId,
          { kind: "customField", id: recordId },
        );
        if (referencedAutomation) {
          return res.status(409).json({
            error: "AUTOMATION_REFERENCE_CONFLICT",
            automation: referencedAutomation,
          });
        }
      }

      const nextFieldType = payload.fieldType ?? existing.fieldType;
      const nextOptions = payload.options ?? (Array.isArray(existing.options) ? existing.options : []);
      const optionValidation = validateCustomFieldOptions(nextFieldType, nextOptions);

      if (!optionValidation.ok) {
        return res.status(400).json({
          error: optionValidation.error,
          details: optionValidation.details,
        });
      }

      const nextLabel = payload.label?.trim() ?? existing.label;
      const nextKey =
        nextLabel !== existing.label
          ? await buildUniqueCustomFieldKey(tenantId, nextLabel, recordId)
          : undefined;

      const updated = await prismaWithContacts.contactCustomField.update({
        where: { id: recordId },
        data: {
          key: nextKey,
          label: payload.label?.trim(),
          description: payload.description,
          fieldType: payload.fieldType,
          isRequired: payload.isRequired,
          isEncrypted: payload.isEncrypted,
          isSensitive: payload.isSensitive,
          isActive: payload.isActive,
          options: optionValidation.options,
          sortOrder: payload.sortOrder,
        },
        select: {
          id: true,
          key: true,
          label: true,
          description: true,
          fieldType: true,
          isRequired: true,
          isEncrypted: true,
          isSensitive: true,
          isActive: true,
          options: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({
        ok: true,
        customField: {
          ...updated,
          options: Array.isArray(updated.options) ? updated.options : [],
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  "/:tenantId/custom-fields/:recordId",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);

      const existing = await prismaWithContacts.contactCustomField.findUnique({
        where: { id: recordId },
        select: {
          id: true,
          tenantId: true,
        },
      });

      if (!existing || existing.tenantId !== tenantId) {
        return res.status(404).json({ error: "CUSTOM_FIELD_NOT_FOUND" });
      }

      const referencedAutomation = await findEnabledAutomationReference(
        prismaWithContacts,
        tenantId,
        { kind: "customField", id: recordId },
      );
      if (referencedAutomation) {
        return res.status(409).json({
          error: "AUTOMATION_REFERENCE_CONFLICT",
          automation: referencedAutomation,
        });
      }

      await prismaWithContacts.contactCustomField.delete({
        where: { id: recordId },
      });

      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

router.get("/:tenantId/subscription", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);

    const [subscription, activeMemberCount, totalMemberCount, storageAgg] =
      await prisma.$transaction([
        prisma.tenantSubscription.findUnique({
          where: { tenantId },
          select: {
            planKey: true,
            seatLimit: true,
            status: true,
            currentPeriodEnd: true,
            stripeCustomerId: true,
            stripeSubscriptionId: true,
          },
        }),
        prisma.membership.count({ where: { tenantId, status: "ACTIVE" } }),
        prisma.membership.count({ where: { tenantId } }),
        prisma.file.aggregate({
          where: { tenantId },
          _sum: { size: true },
        }),
      ]);

    if (!subscription) {
      return res.status(404).json({ error: "SUBSCRIPTION_NOT_FOUND" });
    }

    const planDetails = getPlanDetails(subscription.planKey);
    const storageUsedBytes = storageAgg._sum.size ?? 0;

    return res.json({
      ok: true,
      subscription: {
        planKey: subscription.planKey,
        seatLimit: subscription.seatLimit,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        stripeCustomerId: subscription.stripeCustomerId,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        seatUsage: {
          used: activeMemberCount,
          limit: subscription.seatLimit,
          available: Math.max(0, subscription.seatLimit - activeMemberCount),
        },
        storageUsedBytes,
        storageLimitBytes: planDetails.storageBytes,
        aiActionsPerMonth: planDetails.aiActionsPerMonth,
        memberCount: totalMemberCount,
        activeMemberCount,
      },
    });
  } catch (error) {
    return next(error);
  }
});

const handleSectionListNotImplemented = (section: AccountSettingsSection) => (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);
    if (req.method !== "GET") {
      TenantScopedMutationSchema.parse(req.body);
    }

    return res.status(501).json({
      error: "NOT_IMPLEMENTED",
      tenantId,
      section,
      method: req.method,
      scope: "collection",
    });
  } catch (error) {
    return next(error);
  }
};

const handleSectionRecordNotImplemented = (section: AccountSettingsSection) => (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
    if (req.method !== "DELETE") {
      TenantScopedMutationSchema.parse(req.body);
    }

    return res.status(501).json({
      error: "NOT_IMPLEMENTED",
      tenantId,
      section,
      recordId,
      method: req.method,
      scope: "record",
    });
  } catch (error) {
    return next(error);
  }
};

for (const section of ACCOUNT_SETTINGS_SECTIONS) {
  if (
    section !== "users" &&
    section !== "account" &&
    section !== "opportunities" &&
    section !== "status-config" &&
    section !== "tags" &&
    section !== "custom-fields" &&
    section !== "subscription"
  ) {
    router.get(
      "/:tenantId/" + section,
      ...readMiddlewares,
      handleSectionListNotImplemented(section),
    );
  }
  if (
    section === "users" ||
    section === "account" ||
    section === "opportunities" ||
    section === "status-config" ||
    section === "tags" ||
    section === "custom-fields" ||
    section === "subscription"
  ) {
    continue;
  }
  router.post(
    "/:tenantId/" + section,
    ...writeMiddlewares,
    handleSectionListNotImplemented(section),
  );
  router.put(
    "/:tenantId/" + section + "/:recordId",
    ...writeMiddlewares,
    handleSectionRecordNotImplemented(section),
  );
  router.patch(
    "/:tenantId/" + section + "/:recordId",
    ...writeMiddlewares,
    handleSectionRecordNotImplemented(section),
  );
  router.delete(
    "/:tenantId/" + section + "/:recordId",
    ...writeMiddlewares,
    handleSectionRecordNotImplemented(section),
  );
}

export default router;
