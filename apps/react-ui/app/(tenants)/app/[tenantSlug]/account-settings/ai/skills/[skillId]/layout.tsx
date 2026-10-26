import { notFound } from "next/navigation"
import { isAxiosError } from "axios"
import { api } from "@/lib/api"
import { getTenantMembershipContext } from "../../../../_lib/tenant-session"
import { AiSkillRouteProvider } from "../../_components/ai-workspace"
import { AiSkillLoadError } from "../../_components/ai-skill-load-error"
import type { AiSkillResponse } from "../../_lib/skills"

export default async function AiSkillLayout({
  params,
  children,
}: {
  params: Promise<{ tenantSlug: string; skillId: string }>
  children: React.ReactNode
}) {
  const { tenantSlug, skillId } = await params
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      skillId,
    )
  )
    notFound()
  const { tenantId, cookie } = await getTenantMembershipContext(tenantSlug)
  let detail: AiSkillResponse | null = null
  let missing = false
  try {
    detail = (
      await api.get<AiSkillResponse>(
        `/api/account-settings/${tenantId}/ai/skills/${skillId}`,
        { headers: { cookie } },
      )
    ).data
  } catch (error) {
    missing = isAxiosError(error) && error.response?.status === 404
  }
  if (missing) notFound()
  if (!detail) return <AiSkillLoadError />
  return <AiSkillRouteProvider detail={detail}>{children}</AiSkillRouteProvider>
}
