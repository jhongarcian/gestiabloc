"use client"

import { isAxiosError } from "axios"
import { ArrowRight, CheckCircle2, Loader2, Workflow } from "lucide-react"
import Link from "next/link"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import {
  ACTIVE_AUTOMATION_PROCESS_STATUSES,
  automationProcessPercent,
  type AutomationProcess,
} from "../../_lib/automation-processes"
import { ProcessStatusBadge } from "../../automation-processes/_components/process-status-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type SelectedContact = { id: string; name: string }
type AutomationOption = { id: string; name: string; actionCount: number }
type DialogPhase = "configure" | "uploading" | "progress"

type AddContactsToAutomationDialogProps = {
  tenantId: string
  tenantSlug: string
  contacts: SelectedContact[]
  iconOnly?: boolean
  disabled?: boolean
  triggerClassName?: string
  onQueued?: () => void | Promise<void>
  onCompleted?: () => void | Promise<void>
}

const CONTACTS_PER_BATCH = 100

function chunksOfOneHundred(contactIds: string[]) {
  const batches: string[][] = []
  for (let index = 0; index < contactIds.length; index += CONTACTS_PER_BATCH) {
    batches.push(contactIds.slice(index, index + CONTACTS_PER_BATCH))
  }
  return batches
}

export function AddContactsToAutomationDialog({
  tenantId,
  tenantSlug,
  contacts,
  iconOnly = false,
  disabled = false,
  triggerClassName,
  onQueued,
  onCompleted,
}: AddContactsToAutomationDialogProps) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<DialogPhase>("configure")
  const [automations, setAutomations] = useState<AutomationOption[]>([])
  const [automationId, setAutomationId] = useState("")
  const [processName, setProcessName] = useState("")
  const [process, setProcess] = useState<AutomationProcess | null>(null)
  const [isLoadingAutomations, setIsLoadingAutomations] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const completedCallbackProcessId = useRef<string | null>(null)

  const selectedAutomation = useMemo(
    () => automations.find((automation) => automation.id === automationId),
    [automationId, automations],
  )
  const contactCountLabel = `${contacts.length.toLocaleString()} ${
    contacts.length === 1 ? "contact" : "contacts"
  }`
  const canSubmit =
    contacts.length > 0 &&
    Boolean(automationId) &&
    Boolean(processName.trim()) &&
    !isLoadingAutomations &&
    !isSubmitting
  const processIdForPolling = process?.id ?? null
  const processStatusForPolling = process?.status ?? null

  useEffect(() => {
    if (!open || phase !== "configure") return

    let cancelled = false
    const loadAutomations = async () => {
      setIsLoadingAutomations(true)
      setLoadError(null)

      try {
        const { data } = await api.get<{ ok: boolean; items: AutomationOption[] }>(
          `/api/contacts/${encodeURIComponent(tenantId)}/automations`,
        )
        if (!cancelled) setAutomations(data.items ?? [])
      } catch {
        if (!cancelled) {
          setAutomations([])
          setLoadError("Could not load automations. Please try again.")
        }
      } finally {
        if (!cancelled) setIsLoadingAutomations(false)
      }
    }

    void loadAutomations()
    return () => {
      cancelled = true
    }
  }, [open, phase, tenantId])

  useEffect(() => {
    if (
      !open ||
      !processIdForPolling ||
      phase !== "progress" ||
      !processStatusForPolling ||
      !ACTIVE_AUTOMATION_PROCESS_STATUSES.has(processStatusForPolling)
    ) {
      return
    }

    let cancelled = false
    const loadProgress = async () => {
      try {
        const { data } = await api.get<{ process: AutomationProcess }>(
          `/api/automation-processes/${encodeURIComponent(tenantId)}/${encodeURIComponent(processIdForPolling)}`,
        )
        if (cancelled) return

        setProcess(data.process)
        if (
          !ACTIVE_AUTOMATION_PROCESS_STATUSES.has(data.process.status) &&
          completedCallbackProcessId.current !== data.process.id
        ) {
          completedCallbackProcessId.current = data.process.id
          await onCompleted?.()
        }
      } catch {
        // Keep the last known progress visible and try again on the next poll.
      }
    }

    void loadProgress()
    const interval = window.setInterval(() => void loadProgress(), 2_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [
    onCompleted,
    open,
    phase,
    processIdForPolling,
    processStatusForPolling,
    tenantId,
  ])

  const reset = () => {
    setPhase("configure")
    setAutomationId("")
    setProcessName("")
    setProcess(null)
    setLoadError(null)
    setSubmitError(null)
    completedCallbackProcessId.current = null
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedProcessName = processName.trim()
    if (!automationId || !normalizedProcessName || contacts.length === 0) return

    const contactIds = [...new Set(contacts.map((contact) => contact.id))]
    const batches = chunksOfOneHundred(contactIds)
    let createdProcessId: string | null = null

    setIsSubmitting(true)
    setSubmitError(null)
    setPhase("uploading")

    try {
      const createResponse = await api.post<{ process: AutomationProcess }>(
        `/api/automation-processes/${encodeURIComponent(tenantId)}`,
        {
          automationId,
          processName: normalizedProcessName,
          expectedContactCount: contactIds.length,
        },
      )
      createdProcessId = createResponse.data.process.id
      setProcess(createResponse.data.process)

      let uploadedContacts = 0
      for (let index = 0; index < batches.length; index += 1) {
        const batch = batches[index]
        await api.post(
          `/api/automation-processes/${encodeURIComponent(tenantId)}/${encodeURIComponent(createdProcessId)}/batches`,
          { batchNumber: index + 1, contactIds: batch },
        )
        uploadedContacts += batch.length
        setProcess((current) =>
          current
            ? {
                ...current,
                totalContacts: uploadedContacts,
                totalBatches: index + 1,
              }
            : current,
        )
      }

      const startResponse = await api.post<{ process: AutomationProcess }>(
        `/api/automation-processes/${encodeURIComponent(tenantId)}/${encodeURIComponent(createdProcessId)}/start`,
      )
      setProcess(startResponse.data.process)
      setPhase("progress")
      toast.success(`${contactIds.length.toLocaleString()} contacts queued for automation.`)
      await onQueued?.()
    } catch (error) {
      if (createdProcessId) {
        await api.post(
          `/api/automation-processes/${encodeURIComponent(tenantId)}/${encodeURIComponent(createdProcessId)}/fail`,
        ).catch(() => undefined)
      }

      const backendMessage = isAxiosError(error)
        ? error.response?.data?.message
        : undefined
      const message =
        typeof backendMessage === "string"
          ? backendMessage
          : "Could not queue the automation process. Please try again."
      setSubmitError(message)
      setPhase("configure")
      setProcess(null)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const trigger = iconOnly ? (
    <Button
      type="button"
      size="icon"
      disabled={disabled}
      aria-label="Add contact to automation"
      className={cn(
        "h-8 w-8 cursor-pointer rounded-full border border-white/70 bg-blue-950 text-white shadow-sm backdrop-blur transition hover:bg-blue-900",
        triggerClassName,
      )}
    >
      <Workflow className="size-4" aria-hidden="true" />
    </Button>
  ) : (
    <Button
      type="button"
      size="sm"
      disabled={disabled}
      className={cn(
        "h-9 cursor-pointer rounded-full bg-blue-950 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-900",
        triggerClassName,
      )}
    >
      <Workflow data-icon="inline-start" aria-hidden="true" />
      <span className="hidden sm:inline">Add to automation</span>
      <span className="sm:hidden">Automate</span>
    </Button>
  )

  const progressValue = process ? automationProcessPercent(process) : 0
  const isTerminal = process
    ? !ACTIVE_AUTOMATION_PROCESS_STATUSES.has(process.status)
    : false

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && (isSubmitting || phase === "uploading")) return
        setOpen(nextOpen)
        if (!nextOpen) reset()
      }}
    >
      {iconOnly ? (
        <TooltipProvider delayDuration={120}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>{trigger}</DialogTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>Add to automation</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      )}

      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[28px] border-slate-200 bg-white p-0 shadow-2xl sm:max-w-lg [&>button]:cursor-pointer">
        <DialogHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
          <div aria-hidden="true" className="pointer-events-none absolute -right-12 -bottom-20 size-48 rounded-full bg-blue-300/30 blur-3xl" />
          <div className="relative pr-10">
            <p className="mb-1.5 text-xs font-semibold text-blue-700">
              {process
                ? `${process.expectedContacts.toLocaleString()} contacts`
                : `${contactCountLabel} selected`}
            </p>
            <DialogTitle className="text-xl font-semibold text-slate-950 sm:text-2xl">
              {phase === "configure"
                ? "Add to automation"
                : phase === "uploading"
                  ? "Preparing the process"
                  : process?.processName ?? "Automation progress"}
            </DialogTitle>
            <DialogDescription className="mt-2 max-w-md leading-6 text-slate-600">
              {phase === "configure"
                ? "Choose an automation and name this process so it is easy to recognize later."
                : phase === "uploading"
                  ? "Contacts are being safely prepared in batches of 100. Keep this window open for this step."
                  : "You can close this window at any time. The work will continue in the background."}
            </DialogDescription>
          </div>
        </DialogHeader>

        {phase === "configure" ? (
          <form className="min-h-0 overflow-y-auto overscroll-contain" onSubmit={handleSubmit}>
            <FieldGroup className="gap-5 px-6 py-6 sm:px-7">
              <Field data-invalid={Boolean(loadError)}>
                <FieldLabel htmlFor="contact-automation-picker">Automation</FieldLabel>
                <Select
                  value={automationId}
                  onValueChange={setAutomationId}
                  disabled={isLoadingAutomations || automations.length === 0}
                >
                  <SelectTrigger id="contact-automation-picker" className="h-11 w-full rounded-xl" aria-invalid={Boolean(loadError)}>
                    <SelectValue placeholder={isLoadingAutomations ? "Loading automations..." : "Choose an automation"} />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {automations.map((automation) => (
                        <SelectItem key={automation.id} value={automation.id}>
                          {automation.name} · {automation.actionCount} {automation.actionCount === 1 ? "action" : "actions"}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {isLoadingAutomations ? (
                  <FieldDescription className="flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Loading available automations
                  </FieldDescription>
                ) : automations.length === 0 && !loadError ? (
                  <FieldDescription>No enabled automations are available. Enable one in account settings first.</FieldDescription>
                ) : (
                  <FieldDescription>
                    {selectedAutomation
                      ? `${selectedAutomation.actionCount} actions will run for every contact, 100 contacts at a time.`
                      : "The automation actions will be applied to every selected contact."}
                  </FieldDescription>
                )}
                <FieldError>{loadError}</FieldError>
              </Field>

              <Field data-invalid={Boolean(submitError)}>
                <FieldLabel htmlFor="contact-automation-process-name">Process name</FieldLabel>
                <Input
                  id="contact-automation-process-name"
                  value={processName}
                  maxLength={120}
                  required
                  autoComplete="off"
                  placeholder="For example, September renewal outreach"
                  className="h-11 rounded-xl"
                  aria-invalid={Boolean(submitError)}
                  onChange={(event) => {
                    setProcessName(event.target.value)
                    if (submitError) setSubmitError(null)
                  }}
                />
                <FieldDescription>This name identifies this run in the process history.</FieldDescription>
                <FieldError>{submitError}</FieldError>
              </Field>
            </FieldGroup>

            <DialogFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:px-7">
              <Button type="button" variant="outline" disabled={isSubmitting} className="cursor-pointer rounded-full" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit} className="cursor-pointer rounded-full bg-blue-950 hover:bg-blue-900">
                <Workflow data-icon="inline-start" aria-hidden="true" />
                Start process
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="min-h-0 overflow-y-auto px-6 py-6 sm:px-7">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">
                    {phase === "uploading" ? "Uploading contact batches" : process?.automationName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {phase === "uploading"
                      ? `${process?.totalContacts.toLocaleString() ?? 0} of ${process?.expectedContacts.toLocaleString() ?? contacts.length.toLocaleString()} prepared`
                      : `${process?.processedContacts.toLocaleString() ?? 0} of ${process?.expectedContacts.toLocaleString() ?? 0} processed`}
                  </p>
                </div>
                {phase === "uploading" || !process ? (
                  <Loader2 className="size-5 animate-spin text-blue-700" aria-label="Preparing contacts" />
                ) : (
                  <ProcessStatusBadge status={process.status} />
                )}
              </div>

              <Progress value={progressValue} className="mt-5 h-2.5 bg-blue-100 [&_[data-slot=progress-indicator]]:bg-blue-700" aria-label={`${progressValue}% complete`} />
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-white px-2 py-3">
                  <p className="text-lg font-semibold text-slate-950">{process?.succeededContacts.toLocaleString() ?? 0}</p>
                  <p className="text-[11px] text-slate-500">Completed</p>
                </div>
                <div className="rounded-xl bg-white px-2 py-3">
                  <p className="text-lg font-semibold text-slate-950">{process?.failedContacts.toLocaleString() ?? 0}</p>
                  <p className="text-[11px] text-slate-500">Errors</p>
                </div>
                <div className="rounded-xl bg-white px-2 py-3">
                  <p className="text-lg font-semibold text-slate-950">{progressValue}%</p>
                  <p className="text-[11px] text-slate-500">Progress</p>
                </div>
              </div>
            </div>

            {isTerminal ? (
              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold">The process has finished.</p>
                  <p className="mt-1 text-xs leading-5 text-emerald-800">Open the details to review completed contacts and any errors.</p>
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className="cursor-pointer rounded-full" onClick={() => setOpen(false)} disabled={phase === "uploading"}>
                Close
              </Button>
              {process ? (
                <Button asChild className="cursor-pointer rounded-full bg-blue-950 hover:bg-blue-900">
                  <Link href={`/app/${tenantSlug}/automation-processes/${process.id}`}>
                    View process <ArrowRight data-icon="inline-end" aria-hidden="true" />
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
