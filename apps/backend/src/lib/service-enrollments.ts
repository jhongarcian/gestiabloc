import { z } from "zod"

export const CONTACT_SERVICE_ENROLLMENT_STATUSES = [
  "IN_PROGRESS",
  "PENDING_PAYMENT",
  "COMPLETED",
  "CANCELED",
] as const

export const ContactServiceEnrollmentStatusSchema = z.enum(
  CONTACT_SERVICE_ENROLLMENT_STATUSES,
)

const OptionalBooleanQuerySchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value
    const normalized = value.trim().toLowerCase()
    return normalized.length ? normalized : undefined
  },
  z.enum(["true", "false"]).transform((value) => value === "true").optional(),
)

const EnrollmentStatusesQuerySchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value

    const statuses = [
      ...new Set(
        value
          .split(",")
          .map((status) => status.trim())
          .filter(Boolean),
      ),
    ]

    return statuses.length ? statuses : undefined
  },
  z
    .array(ContactServiceEnrollmentStatusSchema)
    .max(CONTACT_SERVICE_ENROLLMENT_STATUSES.length)
    .optional(),
)

export const ServiceEnrollmentsListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine((value) => value === 10 || value === 25, {
        message: "pageSize must be 10 or 25",
      })
      .default(10),
    search: z.string().trim().max(200).optional(),
    statuses: EnrollmentStatusesQuerySchema,
    serviceId: z.string().trim().min(1).optional(),
    followUpTemplateId: z.string().trim().min(1).optional(),
    withoutTemplate: OptionalBooleanQuerySchema,
    assignedToUserId: z.string().trim().min(1).optional(),
    unassigned: OptionalBooleanQuerySchema,
  })
  .superRefine((value, context) => {
    if (value.followUpTemplateId && value.withoutTemplate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["withoutTemplate"],
        message: "withoutTemplate cannot be combined with followUpTemplateId",
      })
    }

    if (value.assignedToUserId && value.unassigned) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unassigned"],
        message: "unassigned cannot be combined with assignedToUserId",
      })
    }
  })

export type ServiceEnrollmentsListQuery = z.infer<
  typeof ServiceEnrollmentsListQuerySchema
>

export function getServiceEnrollmentContactName(contact: {
  firstName?: string | null
  middleName?: string | null
  lastName?: string | null
}) {
  return [contact.firstName, contact.middleName, contact.lastName]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ") || "Unnamed contact"
}

export function getLatestServiceEnrollmentActivityAt(
  timestamps: Array<Date | null | undefined>,
) {
  const available = timestamps.filter(
    (timestamp): timestamp is Date => timestamp instanceof Date,
  )

  if (!available.length) return null

  return new Date(Math.max(...available.map((timestamp) => timestamp.getTime())))
}
