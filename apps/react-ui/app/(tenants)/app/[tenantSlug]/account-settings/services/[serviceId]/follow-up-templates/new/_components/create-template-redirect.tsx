"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { isAxiosError } from "axios"
import { toast } from "sonner"

import { api } from "@/lib/api"

type CreateTemplateRedirectProps = {
  tenantId: string
  tenantSlug: string
  serviceId: string
}

export function CreateTemplateRedirect({
  tenantId,
  tenantSlug,
  serviceId,
}: CreateTemplateRedirectProps) {
  const router = useRouter()
  const hasStarted = useRef(false)

  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true

    const run = async () => {
      try {
        const { data } = await api.post(
          `/api/account-settings/${tenantId}/services/${serviceId}/follow-up-templates`,
          {
            name: `Template ${new Date().toLocaleDateString("en-US")}`,
            flowNodes: [],
            flowEdges: [],
          },
        )

        const templateId = data?.template?.id as string | undefined
        if (!templateId) {
          throw new Error("TEMPLATE_CREATE_FAILED")
        }

        router.replace(
          `/app/${tenantSlug}/account-settings/services/${serviceId}/follow-up-templates/${templateId}`,
        )
      } catch (error) {
        if (isAxiosError(error)) {
          const backendError = error.response?.data?.error
          toast.error(
            typeof backendError === "string"
              ? backendError.replace(/_/g, " ")
              : "Could not create follow-up template.",
          )
        } else {
          toast.error("Could not create follow-up template.")
        }

        router.replace(`/app/${tenantSlug}/account-settings/services/${serviceId}`)
      }
    }

    void run()
  }, [router, serviceId, tenantId, tenantSlug])

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-5 text-sm text-slate-500">
      Creating follow-up template...
    </div>
  )
}
