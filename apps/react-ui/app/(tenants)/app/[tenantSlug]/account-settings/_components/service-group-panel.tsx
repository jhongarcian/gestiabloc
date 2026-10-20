"use client"

import Link from "next/link"
import { isAxiosError } from "axios"
import { useRef, useState } from "react"
import { ArrowLeft, FolderTree, Save } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { ServicesConfigPanel } from "./services-config-panel"
import type { ServiceDetailsPanelProps } from "./service-details-panel"

export function ServiceGroupPanel({ tenantId, tenantSlug, service }: ServiceDetailsPanelProps) {
  const [saved, setSaved] = useState({ id: service.id, name: service.name, description: service.description, isActive: service.isActive })
  const [name, setName] = useState(service.name)
  const [description, setDescription] = useState(service.description ?? "")
  const [isActive, setIsActive] = useState(service.isActive)
  const [isSaving, setIsSaving] = useState(false)
  const saving = useRef(false)
  const save = async () => {
    if (saving.current) return
    if (!name.trim()) return toast.error("Enter a service name.")
    saving.current = true
    setIsSaving(true)
    try {
      const { data } = await api.patch<{ service: typeof saved }>(`/api/account-settings/${tenantId}/services/${service.id}`, {
        name: name.trim(), description: description.trim() || null, isActive,
      })
      setSaved(data.service)
      toast.success("Service updated.")
    } catch (error) {
      const code = isAxiosError(error) ? error.response?.data?.error : null
      toast.error(code === "SERVICE_NAME_ALREADY_EXISTS" ? "That name is already used in this account."
        : typeof code === "string" ? code.replace(/_/g, " ") : "Could not save service.")
    } finally { saving.current = false; setIsSaving(false) }
  }
  return <div className="flex flex-col gap-8">
    <div className="flex flex-col gap-4">
      <Link href={`/app/${tenantSlug}/account-settings/services`} className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All services</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><FolderTree className="size-7 text-muted-foreground" /><div><p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Parent service</p><h2 className="mt-1 text-3xl font-semibold tracking-tight">{saved.name}</h2></div></div>
        <Badge variant={saved.isActive ? "secondary" : "outline"}>{saved.isActive ? "Active" : "Inactive"}</Badge>
      </div>
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Organize the offerings in this service. Contacts enroll into one of the sub-services below.</p>
      {!saved.isActive ? <p role="status" className="text-sm text-muted-foreground">This parent service is inactive. New enrollments into its sub-services are paused.</p> : null}
    </div>
    <Card>
      <CardHeader><CardTitle>Service details</CardTitle><CardDescription>Name and availability for this service and its offerings.</CardDescription></CardHeader>
      <CardContent><fieldset disabled={isSaving}><FieldGroup className="grid gap-5 md:grid-cols-2">
        <Field><FieldLabel htmlFor="parent-service-name">Service name</FieldLabel><Input id="parent-service-name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="parent-service-status">Status</FieldLabel><Select value={isActive ? "ACTIVE" : "INACTIVE"} onValueChange={(value) => setIsActive(value === "ACTIVE")} disabled={isSaving}><SelectTrigger id="parent-service-status"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="ACTIVE">Active</SelectItem><SelectItem value="INACTIVE">Inactive</SelectItem></SelectGroup></SelectContent></Select><FieldDescription>Inactive services remain available for existing enrollment history.</FieldDescription></Field>
        <Field className="md:col-span-2"><FieldLabel htmlFor="parent-service-description">Description</FieldLabel><Textarea id="parent-service-description" maxLength={2000} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
      </FieldGroup></fieldset></CardContent>
      <CardFooter className="justify-end"><Button onClick={save} disabled={isSaving}><Save data-icon="inline-start" />{isSaving ? "Saving..." : "Save service"}</Button></CardFooter>
    </Card>
    <ServicesConfigPanel tenantId={tenantId} tenantSlug={tenantSlug} parentService={saved} />
  </div>
}
