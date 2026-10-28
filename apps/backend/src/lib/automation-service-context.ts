import { z } from "zod"

// These are immutable identifiers, not live foreign keys: audit history must survive deletion.
export const AutomationServiceContextSchema = z
  .object({
    contactServiceId: z.uuid(),
    serviceId: z.uuid(),
    contactServiceStepId: z.uuid().nullable(),
    serviceStepId: z.uuid().nullable(),
    serviceStepOccurrenceId: z.uuid().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      Boolean(value.contactServiceStepId) !== Boolean(value.serviceStepId) ||
      (value.serviceStepOccurrenceId && !value.contactServiceStepId)
    ) {
      context.addIssue({
        code: "custom",
        message: "A step occurrence requires its saved enrollment step and source step.",
      })
    }
  })

export type AutomationServiceContext = z.infer<typeof AutomationServiceContextSchema>

export class AutomationServiceContextError extends Error {
  code = "INVALID_SERVICE_CONTEXT"
  constructor() {
    super("The automation service context does not belong to this contact and enrollment.")
  }
}

export function readAutomationServiceContext(value: unknown): AutomationServiceContext | null {
  const parsed = AutomationServiceContextSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// Omit the column for ordinary automations and older rows. Never infer an enrollment from a contact.
export function automationServiceContextData(source: { serviceContext?: unknown }) {
  const serviceContext = readAutomationServiceContext(source.serviceContext)
  return serviceContext ? { serviceContext } : {}
}

export async function resolveAutomationServiceContextTx(
  tx: any,
  params: {
    tenantId: string
    contactId: string
    contactServiceId: string
    contactServiceStepId?: string | null
    serviceStepOccurrenceId?: string | null
  },
): Promise<AutomationServiceContext> {
  const enrollment = await tx.contactService.findFirst({
    where: { tenantId: params.tenantId, contactId: params.contactId, id: params.contactServiceId },
    select: { id: true, serviceId: true },
  })
  if (!enrollment || (params.serviceStepOccurrenceId && !params.contactServiceStepId)) {
    throw new AutomationServiceContextError()
  }
  const step = params.contactServiceStepId
    ? await tx.contactServiceStep.findFirst({
        where: {
          tenantId: params.tenantId,
          contactServiceId: enrollment.id,
          id: params.contactServiceStepId,
        },
        select: { id: true, sourceStepId: true },
      })
    : null
  if (params.contactServiceStepId && !step) throw new AutomationServiceContextError()
  if (params.serviceStepOccurrenceId) {
    const occurrence = await tx.serviceStepOccurrence.findFirst({
      where: {
        tenantId: params.tenantId,
        contactServiceId: enrollment.id,
        stepId: step.id,
        id: params.serviceStepOccurrenceId,
      },
      select: { id: true },
    })
    if (!occurrence) throw new AutomationServiceContextError()
  }
  return AutomationServiceContextSchema.parse({
    contactServiceId: enrollment.id,
    serviceId: enrollment.serviceId,
    contactServiceStepId: step?.id ?? null,
    serviceStepId: step?.sourceStepId ?? null,
    serviceStepOccurrenceId: params.serviceStepOccurrenceId ?? null,
  })
}

export async function validateAutomationServiceContextTx(
  tx: any,
  params: { tenantId: string; contactId: string | null; serviceContext?: unknown },
): Promise<AutomationServiceContext | null> {
  if (params.serviceContext === null || params.serviceContext === undefined) return null
  const context = readAutomationServiceContext(params.serviceContext)
  if (!context || !params.contactId) throw new AutomationServiceContextError()
  const resolved = await resolveAutomationServiceContextTx(tx, {
    ...context,
    tenantId: params.tenantId,
    contactId: params.contactId,
  })
  if (
    resolved.serviceId !== context.serviceId ||
    resolved.serviceStepId !== context.serviceStepId
  ) {
    throw new AutomationServiceContextError()
  }
  return resolved
}

export function assertAutomationServiceContextRetry(
  existing: { tenantId: string; contactId: string | null; serviceContext?: unknown },
  event: { tenantId: string; contactId: string | null; serviceContext?: unknown },
) {
  if (existing.serviceContext == null && event.serviceContext == null) return
  const left = readAutomationServiceContext(existing.serviceContext)
  const right = readAutomationServiceContext(event.serviceContext)
  if (
    existing.tenantId !== event.tenantId ||
    existing.contactId !== event.contactId ||
    !left ||
    !right ||
    JSON.stringify(left) !== JSON.stringify(right)
  ) {
    throw new AutomationServiceContextError()
  }
}
