"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { isAxiosError } from "axios"
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus } from "lucide-react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { ServiceSectionInheritance, type ServiceSectionMode } from "./service-section-inheritance"

export type ServiceStepItem = {
  id: string
  title: string
  instructions: string | null
  completionDuration: number
  completionUnit: "MINUTES" | "HOURS" | "DAYS"
  sortOrder: number
  automations?: Array<{
    serviceOfferingId?: string | null
    serviceOffering?: { name: string } | null
    triggerType: "SERVICE_STEP_ENTERED" | "SERVICE_STEP_COMPLETED"
    id: string
    name: string
    isEnabled: boolean
    _count: { actions: number }
  }>
}
type StepDraft = Omit<ServiceStepItem, "id" | "sortOrder" | "automations"> & { id?: string }
const freshDraft = (): StepDraft => ({
  title: "",
  instructions: "",
  completionDuration: 3,
  completionUnit: "DAYS",
})

function StepRow({
  step,
  index,
  count,
  disabled,
  onEdit,
  onMove,
  tenantSlug,
  serviceId,
  parentServiceId,
}: {
  step: ServiceStepItem
  index: number
  count: number
  disabled: boolean
  tenantSlug: string
  serviceId: string
  parentServiceId: string | null
  onEdit: () => void
  onMove: (to: number) => void
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition } =
    useSortable({ id: step.id, disabled })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex items-start gap-3 rounded-xl border bg-background p-4"
    >
      <Button
        ref={setActivatorNodeRef}
        variant="ghost"
        size="icon"
        disabled={disabled}
        aria-label={`Reorder ${step.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{index + 1}</span>
          <p className="font-medium">{step.title}</p>
          <Badge variant="secondary">
            {step.completionDuration} {step.completionUnit.toLowerCase()}
          </Badge>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
          {step.instructions || "No instructions added."}
        </p>
        {step.automations?.map((automation) => {
          const kind = automation.triggerType === "SERVICE_STEP_COMPLETED" ? "completion" : "entry"
          return (
            <div key={automation.id} className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{automation.isEnabled ? "Published" : "Draft"}</Badge>
              <span className="text-xs text-muted-foreground">
                {automation._count.actions} {kind} actions
              </span>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/app/${tenantSlug}/account-settings/automations/${automation.id}`}>
                  {automation.name} · {kind}
                  {automation.serviceOffering ? ` · ${automation.serviceOffering.name}` : ""}
                </Link>
              </Button>
            </div>
          )
        })}
        <div className="flex flex-wrap gap-2">{["entered", "completed"].map(event => <Button key={event} variant="outline" size="sm" asChild><Link href={`/app/${tenantSlug}/account-settings/automations/new?serviceStepId=${step.id}&serviceGroupId=${parentServiceId ?? serviceId}&stepEvent=${event}${parentServiceId ? `&serviceOfferingId=${serviceId}` : ""}`}>Add {event === "entered" ? "entry" : "completion"} automation</Link></Button>)}</div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled || index === 0}
          aria-label={`Move ${step.title} up`}
          onClick={() => onMove(index - 1)}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled || index === count - 1}
          aria-label={`Move ${step.title} down`}
          onClick={() => onMove(index + 1)}
        >
          <ArrowDown />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={disabled}
          aria-label={`Edit ${step.title}`}
          onClick={onEdit}
        >
          <Pencil />
        </Button>
      </div>
    </li>
  )
}

export function ServiceStepsPanel({
  tenantId,
  tenantSlug,
  serviceId,
  parentService,
  initialMode,
  initialSteps,
  onSaved,
}: {
  tenantId: string
  tenantSlug: string
  serviceId: string
  parentService: { id: string; name: string } | null
  initialMode: ServiceSectionMode
  initialSteps: ServiceStepItem[]
  onSaved: (steps: ServiceStepItem[]) => void
}) {
  const [steps, setSteps] = useState(initialSteps)
  const [mode, setMode] = useState(initialMode)
  const [draft, setDraft] = useState<StepDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  useEffect(() => {
    const refresh = async () => {
      try {
        const { data } = await api.get<{ service: { steps: ServiceStepItem[] } }>(`/api/account-settings/${tenantId}/services/${serviceId}`)
        if (saving.current) return
        setSteps(current => current.map(step => ({ ...step, automations: data.service.steps.find(item => item.id === step.id)?.automations ?? step.automations })))
      } catch { /* Keep the saved summary if a background refresh fails. */ }
    }
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [tenantId, serviceId])
  const inherited = !!parentService && mode === "INHERIT"
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const persist = async (payload: { steps?: StepDraft[]; stepsMode?: ServiceSectionMode }) => {
    if (saving.current) return false
    saving.current = true
    setBusy(true)
    try {
      const { data } = await api.patch<{
        service: { steps: ServiceStepItem[]; stepsMode: ServiceSectionMode }
      }>(`/api/account-settings/${tenantId}/services/${serviceId}`, {
        ...payload,
        ...(payload.steps
          ? {
              steps: payload.steps.map((step) => ({
                ...(step.id ? { id: step.id } : {}),
                title: step.title,
                instructions: step.instructions,
                completionDuration: step.completionDuration,
                completionUnit: step.completionUnit,
              })),
            }
          : {}),
      })
      setSteps(data.service.steps)
      setMode(data.service.stepsMode)
      onSaved(data.service.steps)
      toast.success(
        payload.stepsMode === "INHERIT"
          ? "Parent steps restored."
          : payload.stepsMode
            ? "Steps customized."
            : "Steps saved.",
      )
      return true
    } catch (error) {
      const code = isAxiosError(error) ? error.response?.data?.error : null
      toast.error(typeof code === "string" ? code.replace(/_/g, " ") : "Could not save steps.")
      return false
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const move = (from: number, to: number) => {
    if (inherited || busy || from < 0 || to < 0 || to >= steps.length) return
    void persist({ steps: arrayMove(steps, from, to) })
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    move(
      steps.findIndex((step) => step.id === active.id),
      steps.findIndex((step) => step.id === over.id),
    )
  }
  const saveDraft = async () => {
    if (
      !draft ||
      !draft.title.trim() ||
      !Number.isInteger(draft.completionDuration) ||
      draft.completionDuration <= 0
    ) {
      toast.error("Enter a step name and a positive whole-number completion timeframe.")
      return
    }
    const minutes =
      draft.completionDuration * { MINUTES: 1, HOURS: 60, DAYS: 1440 }[draft.completionUnit]
    if (minutes > 5_256_000) {
      toast.error("Completion timeframe must be ten years or less.")
      return
    }
    const next = draft.id
      ? steps.map((step) => (step.id === draft.id ? draft : step))
      : [...steps, draft]
    if (await persist({ steps: next })) setDraft(null)
  }
  return (
    <div className="flex flex-col gap-4">
      {parentService ? (
        <ServiceSectionInheritance
          section="Steps"
          mode={mode}
          parentName={parentService.name}
          parentHref={`/app/${tenantSlug}/account-settings/services/${parentService.id}`}
          disabled={busy}
          onChange={(next) => void persist({ stepsMode: next })}
        />
      ) : null}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <CardTitle>Steps</CardTitle>
            <CardDescription>
              Arrange the work and set how long each step should take after it becomes current.
              Changes apply to new enrollments.
            </CardDescription>
          </div>
          <Button
            disabled={busy || inherited || steps.length >= 100}
            onClick={() => setDraft(freshDraft())}
          >
            <Plus data-icon="inline-start" />
            Add step
          </Button>
        </CardHeader>
        <CardContent>
          {steps.length ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={steps.map((step) => step.id)}
                strategy={verticalListSortingStrategy}
              >
                <ol className="flex flex-col gap-3">
                  {steps.map((step, index) => (
                    <StepRow
                      key={step.id}
                      step={{
                        ...step,
                        automations: parentService
                          ? step.automations?.filter(
                              (automation) =>
                                !automation.serviceOfferingId ||
                                automation.serviceOfferingId === serviceId,
                            )
                          : step.automations,
                      }}
                      index={index}
                      count={steps.length}
                      tenantSlug={tenantSlug}
                serviceId={serviceId}
                parentServiceId={parentService?.id ?? null}
                      disabled={busy || inherited}
                      onEdit={() => setDraft({ ...step })}
                      onMove={(to) => move(index, to)}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No steps yet. Add the first step to define this service’s workflow.
            </p>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !saving.current) setDraft(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit step" : "Add step"}</DialogTitle>
            <DialogDescription>
              The completion timeframe starts when this step is entered.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <fieldset disabled={busy}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="service-step-title">Step name</FieldLabel>
                  <Input
                    id="service-step-title"
                    maxLength={200}
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="service-step-instructions">Instructions</FieldLabel>
                  <Textarea
                    id="service-step-instructions"
                    rows={4}
                    maxLength={10000}
                    value={draft.instructions ?? ""}
                    onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                  />
                </Field>
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="service-step-duration">Completion timeframe</FieldLabel>
                    <Input
                      id="service-step-duration"
                      type="number"
                      min={1}
                      step={1}
                      value={draft.completionDuration || ""}
                      onChange={(event) =>
                        setDraft({ ...draft, completionDuration: Number(event.target.value) })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="service-step-unit">Time unit</FieldLabel>
                    <Select
                      disabled={busy}
                      value={draft.completionUnit}
                      onValueChange={(value) =>
                        setDraft({ ...draft, completionUnit: value as StepDraft["completionUnit"] })
                      }
                    >
                      <SelectTrigger id="service-step-unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="MINUTES">Minutes</SelectItem>
                          <SelectItem value="HOURS">Hours</SelectItem>
                          <SelectItem value="DAYS">Days</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
              </FieldGroup>
            </fieldset>
          ) : null}
          <DialogFooter className="sm:justify-between">
            {draft?.id ? (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  if (await persist({ steps: steps.filter((step) => step.id !== draft.id) }))
                    setDraft(null)
                }}
              >
                Remove step
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void saveDraft()}>
                {busy ? "Saving..." : "Save step"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
