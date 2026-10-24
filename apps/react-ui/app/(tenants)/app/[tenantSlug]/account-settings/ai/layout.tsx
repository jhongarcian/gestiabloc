import { AiWorkspace } from "./_components/ai-workspace"

export default async function AiLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  return (
    <AiWorkspace key={tenantSlug} tenantSlug={tenantSlug}>
      {children}
    </AiWorkspace>
  )
}
