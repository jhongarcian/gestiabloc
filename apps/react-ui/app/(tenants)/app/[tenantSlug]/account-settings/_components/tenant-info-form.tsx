"use client"

import type { AccountProfileResponse } from "@/lib/account-profile"
import { AccountProfileForm } from "./account-profile-form"
import { useAccountProfile } from "./use-account-profile"

export function TenantInfoForm({
  tenantId,
  tenantSlug,
  initialProfile,
}: {
  tenantId: string
  tenantSlug: string
  initialProfile: AccountProfileResponse["tenant"] | null
}) {
  const controller = useAccountProfile(tenantId, initialProfile, "account")
  return (
    <AccountProfileForm
      controller={controller}
      relatedHref={`/app/${tenantSlug}/account-settings/ai/company-info`}
    />
  )
}
