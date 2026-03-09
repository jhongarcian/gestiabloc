"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import { Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"

type FollowUpStep = {
  id: string
  title: string
  dueAt: string | null
  completedAt: string | null
  sortOrder: number
}

type ContactServiceItem = {
  id: string
  service: {
    id: string
    name: string
  }
  followUpSteps: FollowUpStep[]
}

type ContactServicesResponse = {
  ok: boolean
  items: ContactServiceItem[]
}

type FlattenedStep = FollowUpStep & {
  contactServiceId: string
  serviceName: string
}

type ContactFollowUpsPanelProps = {
  tenantId: string
  contactId: string
}

const toInputDateTime = (value: string | null) => {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const offset = date.getTimezoneOffset() * 60_000
  const local = new Date(date.getTime() - offset)
  return local.toISOString().slice(0, 16)
}

const fromInputDateTime = (value: string) => {
  if (!value.trim()) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function ContactFollowUpsPanel({ tenantId, contactId }: ContactFollowUpsPanelProps) {
  const [services, setServices] = useState<ContactServiceItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const [createContactServiceId, setCreateContactServiceId] = useState("")
  const [createTitle, setCreateTitle] = useState("")
  const [createDueAt, setCreateDueAt] = useState("")
  const [createNotes, setCreateNotes] = useState("")

  const [selectedStep, setSelectedStep] = useState<FlattenedStep | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editDueAt, setEditDueAt] = useState("")
  const [editSortOrder, setEditSortOrder] = useState("")
  const [editNotes, setEditNotes] = useState("")
  const [editCompleted, setEditCompleted] = useState(false)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data } = await api.get<ContactServicesResponse>(`/api/services/${tenantId}/contact-services`, {
        params: {
          page: 1,
          pageSize: 25,
          contactId,
        },
      })
      setServices(data.items)
    } catch {
      setServices([])
      toast.error("Could not load follow-up records.")
    } finally {
      setIsLoading(false)
    }
  }, [tenantId, contactId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const rows = useMemo<FlattenedStep[]>(() => {
    return services.flatMap((service) =>
      (service.followUpSteps ?? []).map((step) => ({
        ...step,
        contactServiceId: service.id,
        serviceName: service.service.name,
      })),
    )
  }, [services])

  const openEdit = (row: FlattenedStep) => {
    setSelectedStep(row)
    setEditTitle(row.title)
    setEditDueAt(toInputDateTime(row.dueAt))
    setEditSortOrder(String(row.sortOrder))
    setEditNotes("")
    setEditCompleted(Boolean(row.completedAt))
    setIsEditOpen(true)
  }

  const onCreate = async () => {
    if (!createContactServiceId) {
      toast.error("Select an enrolled service.")
      return
    }
    if (!createTitle.trim()) {
      toast.error("Title is required.")
      return
    }

    setIsSaving(true)
    try {
      await api.post(`/api/services/${tenantId}/contact-services/${createContactServiceId}/follow-up-steps`, {
        title: createTitle.trim(),
        ...(fromInputDateTime(createDueAt) ? { dueAt: fromInputDateTime(createDueAt) } : {}),
        ...(createNotes.trim() ? { notesTemplate: createNotes.trim() } : {}),
      })
      toast.success("Follow-up created.")
      setCreateContactServiceId("")
      setCreateTitle("")
      setCreateDueAt("")
      setCreateNotes("")
      setIsCreateOpen(false)
      await loadData()
    } catch {
      toast.error("Could not create follow-up.")
    } finally {
      setIsSaving(false)
    }
  }

  const onUpdate = async () => {
    if (!selectedStep) return
    if (!editTitle.trim()) {
      toast.error("Title is required.")
      return
    }

    setIsSaving(true)
    try {
      await api.patch(
        `/api/services/${tenantId}/contact-services/${selectedStep.contactServiceId}/follow-up-steps/${selectedStep.id}`,
        {
          title: editTitle.trim(),
          dueAt: fromInputDateTime(editDueAt),
          sortOrder: Number.parseInt(editSortOrder || "0", 10) || 0,
          note: editNotes.trim() || null,
          completedAt: editCompleted ? new Date().toISOString() : null,
        },
      )
      toast.success("Follow-up updated.")
      setIsEditOpen(false)
      setSelectedStep(null)
      await loadData()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(typeof backendError === "string" ? backendError.replace(/_/g, " ") : "Could not update follow-up.")
      } else {
        toast.error("Could not update follow-up.")
      }
    } finally {
      setIsSaving(false)
    }
  }

  const onDelete = async () => {
    if (!selectedStep) return

    setIsDeleting(true)
    try {
      await api.delete(
        `/api/services/${tenantId}/contact-services/${selectedStep.contactServiceId}/follow-up-steps/${selectedStep.id}`,
      )
      toast.success("Follow-up deleted.")
      setIsEditOpen(false)
      setSelectedStep(null)
      await loadData()
    } catch {
      toast.error("Could not delete follow-up.")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Contact Follow-Ups</p>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Follow-up records</h1>
              <p className="text-sm text-slate-600">Track, edit, and complete follow-up steps after service purchase enrollment.</p>
            </div>
          </div>
          <Button type="button" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Add follow-up
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Step</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Order</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-slate-500">Loading follow-ups...</TableCell>
              </TableRow>
            ) : rows.length ? (
              rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => openEdit(row)}>
                  <TableCell className="font-medium text-slate-900">{row.title}</TableCell>
                  <TableCell>{row.serviceName}</TableCell>
                  <TableCell>{row.dueAt ? new Date(row.dueAt).toLocaleString() : "—"}</TableCell>
                  <TableCell>{row.completedAt ? "Completed" : "Pending"}</TableCell>
                  <TableCell>{row.sortOrder}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-slate-500">No follow-up steps enrolled yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add follow-up step</DialogTitle>
            <DialogDescription>Create a follow-up step under an enrolled service.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label>Enrolled service</Label>
              <Select value={createContactServiceId} onValueChange={setCreateContactServiceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select enrolled service" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((service) => (
                    <SelectItem key={service.id} value={service.id} className="cursor-pointer">
                      {service.service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Title</Label>
              <Input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Due date</Label>
              <Input type="datetime-local" value={createDueAt} onChange={(event) => setCreateDueAt(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Notes template</Label>
              <Textarea value={createNotes} onChange={(event) => setCreateNotes(event.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button type="button" onClick={() => void onCreate()} disabled={isSaving}>{isSaving ? "Saving..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={(open) => {
        setIsEditOpen(open)
        if (!open) setSelectedStep(null)
      }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit follow-up step</DialogTitle>
            <DialogDescription>Update or remove this follow-up step.</DialogDescription>
          </DialogHeader>
          {selectedStep ? (
            <div className="grid gap-4 py-1">
              <div className="grid gap-2">
                <Label>Title</Label>
                <Input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Due date</Label>
                <Input type="datetime-local" value={editDueAt} onChange={(event) => setEditDueAt(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Sort order</Label>
                <Input value={editSortOrder} onChange={(event) => setEditSortOrder(event.target.value)} inputMode="numeric" />
              </div>
              <div className="grid gap-2">
                <Label>Note</Label>
                <Textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} rows={3} />
              </div>
              <div className="grid gap-2">
                <Label>Completion</Label>
                <Select
                  value={editCompleted ? "completed" : "pending"}
                  onValueChange={(value) => setEditCompleted(value === "completed")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending" className="cursor-pointer">Pending</SelectItem>
                    <SelectItem value="completed" className="cursor-pointer">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex items-center justify-between">
            <Button type="button" variant="destructive" onClick={() => void onDelete()} disabled={isDeleting || isSaving}>
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)} disabled={isSaving}>Cancel</Button>
              <Button type="button" onClick={() => void onUpdate()} disabled={isSaving}>{isSaving ? "Saving..." : "Save"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
