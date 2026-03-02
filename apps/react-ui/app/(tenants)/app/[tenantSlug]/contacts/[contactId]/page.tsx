import { redirect } from "next/navigation"

export default async function ContactDetailsIndexPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
}) {
  const { tenantSlug, contactId } = await params

  redirect(`/app/${tenantSlug}/contacts/${contactId}/overview`)
}
