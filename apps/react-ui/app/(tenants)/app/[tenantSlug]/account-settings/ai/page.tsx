import { redirect } from "next/navigation"

export default async function AiPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/app/${tenantSlug}/account-settings/ai/skills`)
}
