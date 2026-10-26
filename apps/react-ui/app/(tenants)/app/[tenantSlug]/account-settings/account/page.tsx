import { api } from "@/lib/api"
import type { AccountProfileResponse } from "@/lib/account-profile"
import { getTenantMembershipContext } from "../../_lib/tenant-session"
import { TenantInfoForm } from "../_components/tenant-info-form"

export default async function AccountSettingsAccountPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { cookie, tenantId } = await getTenantMembershipContext(tenantSlug)
  let initialProfile: AccountProfileResponse["tenant"] | null = null
  try {
    initialProfile = (
      await api.get<AccountProfileResponse>(
        `/api/account-settings/${tenantId}/account`,
        { headers: { cookie } },
      )
    ).data.tenant
  } catch {
    /* Render a retry state without editable sample data. */
  }
  return (
    <TenantInfoForm
      key={tenantId}
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      initialProfile={initialProfile}
    />
  )
}
