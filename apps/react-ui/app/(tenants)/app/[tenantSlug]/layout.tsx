import { redirect } from "next/navigation"
import { TenantShell } from "./_components/tenant-shell"
import { getTenantMembershipContext } from "./_lib/tenant-session"

export default async function TenantLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}>) {
  const { tenantSlug: slug } = await params
  const { user, membership } = await getTenantMembershipContext(slug)
  const role = membership?.role ?? null

  if (!membership?.tenant?.slug) {
    redirect("/login")
  }

  if (!slug || slug !== membership.tenant.slug) {
    redirect(`/app/${membership.tenant.slug}`)
  }

  return (
    <TenantShell
      tenantSlug={slug}
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        image: user.image ?? null,
        platformRole: user.platformRole ?? null,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        memberships: user.memberships ?? [],
      }}
    >
      {children}
    </TenantShell>
  )
}
