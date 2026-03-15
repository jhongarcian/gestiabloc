import { redirect } from "next/navigation"

export default async function AccountSettingsIndexPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/app/${tenantSlug}/account-settings/account`)
}
