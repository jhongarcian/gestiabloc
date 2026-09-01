"use client"

import { usePathname, useSearchParams } from "next/navigation"

import type { ServiceEnrollmentView } from "@/lib/routes"
import { ContactServiceDetailsPanel } from "./contact-service-details-panel"

type ServiceEnrollmentWorkspaceProps = {
  tenantId: string
  tenantSlug: string
  contactServiceId: string
  membershipSecurityLevel: "LOW" | "MEDIUM" | "MAX"
}

export function ServiceEnrollmentWorkspace({
  tenantId,
  tenantSlug,
  contactServiceId,
  membershipSecurityLevel,
}: ServiceEnrollmentWorkspaceProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeSegment = pathname.split("/").filter(Boolean).at(-1)
  const activeView: ServiceEnrollmentView =
    activeSegment === "payments" || activeSegment === "notes" ? activeSegment : "overview"

  return (
    <ContactServiceDetailsPanel
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      contactServiceId={contactServiceId}
      membershipSecurityLevel={membershipSecurityLevel}
      activeView={activeView}
      returnTo={searchParams.get("returnTo")}
    />
  )
}
