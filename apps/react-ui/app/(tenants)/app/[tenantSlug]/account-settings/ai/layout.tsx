import { AiWorkspace } from "./_components/ai-workspace"
import { api } from "@/lib/api"
import { getTenantMembershipContext } from "../../_lib/tenant-session"
import type { AccountProfileResponse } from "@/lib/account-profile"
import type { AiSkillsResponse } from "./_lib/skills"
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
  let initialCompany: AccountProfileResponse["tenant"] | null = null
  const [helperResult, companyResult, catalogResult] = await Promise.allSettled(
    [
      api.get<AiSettingsResponse>(
        `/api/account-settings/${tenantId}/ai/settings`,
        { headers: { cookie } },
      ),
      api.get<AccountProfileResponse>(
        `/api/account-settings/${tenantId}/account`,
        { headers: { cookie } },
      ),
      api.get<AiSkillsResponse>(`/api/account-settings/${tenantId}/ai/skills`, {
        headers: { cookie },
      }),
    ],
  )
  if (helperResult.status === "fulfilled")
    initialSettings = helperResult.value.data.settings
  if (companyResult.status === "fulfilled")
    initialCompany = companyResult.value.data.tenant
  return (
    <AiWorkspace
      key={tenantSlug}
      tenantSlug={tenantSlug}
      tenantId={tenantId}
      companyName={membership.tenant.name}
      initialSettings={initialSettings}
      initialCompany={initialCompany}
      initialCatalog={
        catalogResult.status === "fulfilled" ? catalogResult.value.data : null
      }
    >
      {children}
    </AiWorkspace>
  )
}
