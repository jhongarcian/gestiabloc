import { AiWorkspace } from "./_components/ai-workspace"
import { api } from "@/lib/api"
import { getTenantMembershipContext } from "../../_lib/tenant-session"
import type {
  AiHelperSettings,
  AiSettingsResponse,
} from "./_lib/helper-settings"

export default async function AiLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { cookie, tenantId, membership } =
    await getTenantMembershipContext(tenantSlug)
  let initialSettings: AiHelperSettings | null = null
  try {
    const { data } = await api.get<AiSettingsResponse>(
      `/api/account-settings/${tenantId}/ai/settings`,
      { headers: { cookie } },
    )
    initialSettings = data.settings
  } catch {
    // Keep the workspace available with a retry state, never editable demo settings.
  }
  return (
    <AiWorkspace
      key={tenantSlug}
      tenantSlug={tenantSlug}
      tenantId={tenantId}
      companyName={membership.tenant.name}
      initialSettings={initialSettings}
    >
      {children}
    </AiWorkspace>
  )
}
