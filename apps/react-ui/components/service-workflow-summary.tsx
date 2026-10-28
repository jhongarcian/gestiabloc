import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { ServiceStepItem } from "@/app/(tenants)/app/[tenantSlug]/account-settings/_components/service-steps-panel"

export function ServiceWorkflowSummary({ steps, tenantSlug, serviceId, canConfigure = false }: {
  steps: ServiceStepItem[]; tenantSlug: string; serviceId: string; canConfigure?: boolean
}) {
  if (!steps.length) return <Alert><AlertTitle>No steps configured</AlertTitle><AlertDescription>Add the sub-service’s steps before enrolling a contact.{canConfigure ? <Link className="underline" href={`/app/${tenantSlug}/account-settings/services/${serviceId}?tab=steps`}>Configure steps</Link> : null}</AlertDescription></Alert>
  return <div className="flex flex-col gap-3"><p className="text-sm text-muted-foreground">The first step starts when enrollment is created. Each enrollment saves its steps, instructions and automations.</p><ol className="flex flex-col gap-3">{steps.map((step, index) => <li key={step.id} className="flex flex-col gap-2 rounded-lg border p-4">
    <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">{index + 1}.</span><p className="font-medium">{step.title}</p><Badge variant="secondary">{step.completionDuration} {step.completionUnit.toLowerCase()}</Badge></div>
    {step.instructions ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{step.instructions}</p> : null}
    <div className="flex flex-wrap gap-2">{["SERVICE_STEP_ENTERED", "SERVICE_STEP_COMPLETED"].map(type => {
      const workflows = (step.automations ?? []).filter(item => item.triggerType === type)
      return <div key={type} className="flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">{type === "SERVICE_STEP_ENTERED" ? "On entry" : "On completion"}:</span>{workflows.length ? workflows.map(item => <span key={item.id}>{canConfigure ? <Link className="underline" href={`/app/${tenantSlug}/account-settings/automations/${item.id}`}>{item.name}</Link> : item.name} <Badge variant="outline">{item.isEnabled ? "Published" : "Draft"} · {item._count.actions} actions</Badge></span>) : <span className="text-muted-foreground">No automations</span>}</div>
    })}</div>
  </li>)}</ol></div>
}
