import { z } from "zod"

export const assignedServiceProfessionalIdSchema = z.string().trim().min(1).nullable().optional()

type ServiceProfessional = {
  id: string
  externalProfessionalName?: string | null
  externalContact?: string | null
  user?: { name?: string | null; email?: string | null } | null
}

const professionalLabel = (professional: ServiceProfessional | null) =>
  professional?.externalProfessionalName?.trim() ||
  professional?.user?.name?.trim() ||
  professional?.user?.email?.trim() ||
  professional?.externalContact?.trim() ||
  "Unassigned"

export function resolveServiceProfessionalChange({
  assignedProfessionalId,
  previousProfessional,
  professionals,
}: {
  assignedProfessionalId: string | null | undefined
  previousProfessional: ServiceProfessional | null
  // Callers must load options through the tenant-scoped enrollment's service.
  professionals: ServiceProfessional[]
}) {
  if (assignedProfessionalId === undefined) return { valid: true, activity: null } as const

  const professional = professionals.find((option) => option.id === assignedProfessionalId) ?? null
  if (assignedProfessionalId !== null && !professional) return { valid: false } as const
  if (assignedProfessionalId === (previousProfessional?.id ?? null)) {
    return { valid: true, activity: null } as const
  }

  return {
    valid: true,
    activity: {
      previousProfessionalId: previousProfessional?.id ?? null,
      previousProfessionalName: professionalLabel(previousProfessional),
      professionalId: professional?.id ?? null,
      professionalName: professionalLabel(professional),
    },
  } as const
}
