import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"

import { CreateTemplateRedirect } from "./_components/create-template-redirect"

export default async function NewFollowUpTemplatePage({
  params,
}: {
  params: Promise<{ tenantSlug: string; serviceId: string }>
}) {
  const { tenantSlug, serviceId } = await params

  let me: MeResponse["user"] | null = null

  try {
    const cookie = (await headers()).get("cookie") ?? ""
    const { data } = await api.get<MeResponse>("/api/auth/me", {
      headers: { cookie },
    })

    me = data?.user ?? null
  } catch {
    redirect("/login")
  }

  if (!me?.memberships?.length) {
    redirect("/login")
  }

  const membership = me.memberships.find((item) => item.tenant?.slug === tenantSlug)

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  return (
    <CreateTemplateRedirect
      tenantId={membership.tenant.id}
      tenantSlug={tenantSlug}
      serviceId={serviceId}
    />
  )
}
