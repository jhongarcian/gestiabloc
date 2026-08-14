"use client"

import { isAxiosError } from "axios"
import { Loader2, Target } from "lucide-react"
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type PipelineOption = {
  id: string
  name: string
  color: string
  sortOrder: number
  stageCount: number
  opportunityCount: number
}

type PipelineListResponse = {
  ok: boolean
  items: PipelineOption[]
}

type ContactSearchItem = {
  id: string
  fullName: string
  phoneNumber: string | null
  email: string | null
}

type ContactSearchResponse = {
  ok: boolean
  items: ContactSearchItem[]
}

type ContactOpportunityResponse = {
  ok: boolean
  items: Array<{
    id: string
    pipelineId: string
    stageId: string
    valueCents: number
    result: "OPEN" | "WON" | "LOST"
    closedAt: string | null
    updatedAt: string
    pipeline: {
      id: string
      name: string
      color: string
    }
    stage: {
      id: string
      name: string
      sortOrder: number
    }
  }>
}

type CreatedOpportunity = {
  id: string
  tenantId: string
  contactId: string
  pipelineId: string
  stageId: string
  valueCents: number
  result: "OPEN" | "WON" | "LOST"
  closedAt: string | null
  createdAt: string
  updatedAt: string
  contact: {
    id: string
    fullName: string
    email: string | null
    phoneNumber: string | null
  }
  assignedTo: {
    userId: string
    name: string
    email: string
    image: string | null
  } | null
}

type CreateOpportunityResponse = {
  ok: boolean
  opportunity: CreatedOpportunity
  stage: {
    id: string
    name: string
  }
  automation?: {
    matchedCount: number
    executedCount: number
  }
}

type AddContactOpportunityDialogProps = {
  tenantId: string
  trigger?: ReactNode
  triggerLabel?: string
  triggerTooltip?: string | null
  triggerClassName?: string
  iconOnly?: boolean
  initialContact?: ContactSearchItem | null
  lockContact?: boolean
  initialPipelineId?: string | null
  lockPipeline?: boolean
  onCreated?: (opportunity: CreatedOpportunity) => Promise<void> | void
}

type OpportunityFormErrors = {
  contact?: string
  pipeline?: string
  value?: string
}

export function AddContactOpportunityDialog({
  tenantId,
  trigger,
  triggerLabel = "Add opportunity",
  triggerTooltip = null,
  triggerClassName,
  iconOnly = false,
  initialContact = null,
  lockContact = false,
  initialPipelineId = null,
  lockPipeline = false,
  onCreated,
}: AddContactOpportunityDialogProps) {
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingPipelines, setIsLoadingPipelines] = useState(false)
  const [pipelineOptions, setPipelineOptions] = useState<PipelineOption[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState(initialPipelineId ?? "")
  const [contactQuery, setContactQuery] = useState(initialContact?.fullName ?? "")
  const [debouncedContactQuery, setDebouncedContactQuery] = useState("")
  const [selectedContact, setSelectedContact] = useState<ContactSearchItem | null>(initialContact)
  const [contactResults, setContactResults] = useState<ContactSearchItem[]>([])
  const [isSearchingContacts, setIsSearchingContacts] = useState(false)
  const [valueInput, setValueInput] = useState("")
  const [disabledPipelineIds, setDisabledPipelineIds] = useState<string[]>([])
  const [formErrors, setFormErrors] = useState<OpportunityFormErrors>({})
  const isSelectingContactRef = useRef(false)
  const triggerNode = trigger ?? (
    <Button
      type="button"
      variant={iconOnly ? "outline" : "default"}
      aria-label={iconOnly ? (triggerTooltip ?? triggerLabel) : undefined}
      className={cn(
        "cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90",
        iconOnly && "rounded-full p-0",
        triggerClassName,
      )}
    >
      {iconOnly ? <Target className="h-4 w-4" /> : triggerLabel}
    </Button>
  )

  const selectedPipeline = useMemo(
    () => pipelineOptions.find((item) => item.id === selectedPipelineId) ?? null,
    [pipelineOptions, selectedPipelineId],
  )

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedContactQuery(contactQuery.trim())
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [contactQuery])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    void (async () => {
      setIsLoadingPipelines(true)

      try {
        const { data } = await api.get<PipelineListResponse>(`/api/opportunities/${tenantId}/pipelines`)

        if (cancelled) return

        setPipelineOptions(data.items)

        if (lockPipeline && initialPipelineId) {
          setSelectedPipelineId(initialPipelineId)
        } else {
          setSelectedPipelineId((current) => current || data.items[0]?.id || "")
        }
      } catch {
        if (cancelled) return
        toast.error("Could not load opportunity pipelines.")
      } finally {
        if (!cancelled) {
          setIsLoadingPipelines(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [initialPipelineId, lockPipeline, open, tenantId])

  useEffect(() => {
    if (!open || initialContact?.id == null) return

    let cancelled = false
    void (async () => {
      try {
        const { data } = await api.get<ContactOpportunityResponse>(
          `/api/opportunities/${tenantId}/contact/${initialContact.id}`,
        )

        if (!cancelled) {
          setDisabledPipelineIds(data.items.map((item) => item.pipelineId))
        }
      } catch {
        if (!cancelled) {
          setDisabledPipelineIds([])
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [initialContact?.id, open, tenantId])

  useEffect(() => {
    if (!open || lockPipeline || pipelineOptions.length === 0) return

    setSelectedPipelineId((current) => {
      if (current && !disabledPipelineIds.includes(current)) {
        return current
      }

      return pipelineOptions.find((pipeline) => !disabledPipelineIds.includes(pipeline.id))?.id ?? current
    })
  }, [disabledPipelineIds, lockPipeline, open, pipelineOptions])

  useEffect(() => {
    if (!open || lockContact) return

    const query = debouncedContactQuery

    if (selectedContact && query === selectedContact.fullName) {
      return
    }

    if (query.length < 2) {
      setContactResults([])
      setIsSearchingContacts(false)
      return
    }

    let cancelled = false

    void (async () => {
      setIsSearchingContacts(true)

      try {
        const { data } = await api.get<ContactSearchResponse>(`/api/contacts/${tenantId}/search`, {
          params: { q: query },
        })

        if (!cancelled) {
          setContactResults(data.items)
        }
      } catch {
        if (!cancelled) {
          setContactResults([])
        }
      } finally {
        if (!cancelled) {
          setIsSearchingContacts(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debouncedContactQuery, lockContact, open, selectedContact, tenantId])

  const parseValueCents = (value: string) => {
    const normalized = value.trim()
    if (!normalized) return 0

    const sanitized = normalized.replace(/[$,\s]/g, "")
    if (!/^\d+(\.\d{1,2})?$/.test(sanitized)) {
      return null
    }

    const parsed = Number(sanitized)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null
    }

    return Math.round(parsed * 100)
  }

  const reset = () => {
    setSelectedPipelineId(initialPipelineId ?? "")
    setContactQuery(initialContact?.fullName ?? "")
    setDebouncedContactQuery("")
    setSelectedContact(initialContact)
    setContactResults([])
    setValueInput("")
    setDisabledPipelineIds([])
    setFormErrors({})
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors: OpportunityFormErrors = {}
    const contactId = selectedContact?.id

    if (!contactId) {
      nextErrors.contact = "Select a contact."
    }

    if (!selectedPipelineId) {
      nextErrors.pipeline = "Select a pipeline."
    }

    const valueCents = parseValueCents(valueInput)
    if (valueCents === null) {
      nextErrors.value = "Enter a valid value using up to two decimal places."
    }

    if (!contactId || !selectedPipelineId || valueCents === null) {
      setFormErrors(nextErrors)
      return
    }

    setFormErrors({})
    setIsSubmitting(true)

    try {
      const { data } = await api.post<CreateOpportunityResponse>(`/api/opportunities/${tenantId}`, {
        contactId,
        pipelineId: selectedPipelineId,
        valueCents,
      })

      toast.success(
        (data.automation?.executedCount ?? 0) > 0
          ? `Opportunity added and ${data.automation!.executedCount} automation${data.automation!.executedCount === 1 ? "" : "s"} ran.`
          : "Opportunity added.",
      )
      setOpen(false)
      reset()
      await onCreated?.(data.opportunity)
    } catch (error) {
      const backendError = isAxiosError(error)
        ? error.response?.data?.error
        : undefined

      if (backendError === "OPPORTUNITY_ALREADY_EXISTS") {
        setFormErrors({
          pipeline: "This contact is already enrolled in that pipeline.",
        })
      } else {
        const backendMessage = isAxiosError(error) ? error.response?.data?.message : undefined
        toast.error(typeof backendMessage === "string" ? backendMessage : "Could not add opportunity.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isSubmitting) return
        setOpen(nextOpen)
        if (!nextOpen) {
          reset()
        }
      }}
    >
      {triggerTooltip ? (
        <TooltipProvider delayDuration={120}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>{triggerNode}</DialogTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              {triggerTooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <DialogTrigger asChild>{triggerNode}</DialogTrigger>
      )}
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[28px] border-slate-200 bg-white p-0 shadow-2xl sm:max-w-2xl [&>button]:cursor-pointer">
        <DialogHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -bottom-20 size-48 rounded-full bg-blue-300/30 blur-3xl"
          />
          <div className="relative pr-10">
            <div className="flex max-w-xl min-w-0 flex-col gap-1.5">
              <p className="text-xs font-semibold text-blue-700">Sales pipeline</p>
              <DialogTitle className="text-xl font-semibold text-slate-950 sm:text-2xl">
                Add opportunity
              </DialogTitle>
              <DialogDescription className="max-w-xl text-sm leading-6 text-slate-600">
                {lockContact
                  ? "Add this contact to the right pipeline so your team can track the next steps and value."
                  : "Enroll a contact in the right pipeline so your team can track the next steps and value."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="contents">
          <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
            <div className="flex flex-col gap-7">
              {!lockContact ? (
                <FieldGroup className="gap-5">
                  <Field
                    data-invalid={Boolean(formErrors.contact)}
                    data-disabled={isSubmitting}
                    className="gap-2"
                  >
                    <FieldLabel
                      htmlFor="add-opportunity-contact"
                      className="text-slate-800"
                    >
                      Contact
                    </FieldLabel>
                    <div className="min-h-11 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 shadow-none focus-within:border-blue-400 focus-within:ring-3 focus-within:ring-blue-100">
                      <Command
                        shouldFilter={false}
                        className="rounded-xl bg-transparent [&_[data-slot=command-input-wrapper]]:h-11 [&_[data-slot=command-list]]:border-t"
                      >
                        <CommandInput
                          id="add-opportunity-contact"
                          value={contactQuery}
                          disabled={isSubmitting}
                          aria-invalid={Boolean(formErrors.contact)}
                          onValueChange={(value) => {
                            setContactQuery(value)
                            setFormErrors((current) => ({
                              ...current,
                              contact: undefined,
                            }))

                            if (
                              !isSelectingContactRef.current &&
                              selectedContact &&
                              value !== selectedContact.fullName
                            ) {
                              setSelectedContact(null)
                            }
                          }}
                          placeholder="Search by name, email, or phone"
                        />
                        {contactQuery.trim().length >= 2 && !selectedContact ? (
                          <CommandList>
                            <CommandEmpty>
                              {isSearchingContacts
                                ? "Searching contacts..."
                                : "No contacts found."}
                            </CommandEmpty>
                            <CommandGroup>
                              {contactResults.map((contact) => (
                                <CommandItem
                                  key={contact.id}
                                  value={contact.id}
                                  disabled={isSubmitting}
                                  onSelect={() => {
                                    isSelectingContactRef.current = true
                                    setSelectedContact(contact)
                                    setContactQuery(contact.fullName)
                                    setDebouncedContactQuery(contact.fullName)
                                    setContactResults([])
                                    setFormErrors((current) => ({
                                      ...current,
                                      contact: undefined,
                                    }))
                                    window.setTimeout(() => {
                                      isSelectingContactRef.current = false
                                    }, 0)
                                  }}
                                >
                                  <div className="flex min-w-0 flex-col gap-0.5">
                                    <span className="truncate font-medium">
                                      {contact.fullName}
                                    </span>
                                    <span className="truncate text-xs text-slate-500">
                                      {contact.email ??
                                        contact.phoneNumber ??
                                        "No contact details"}
                                    </span>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        ) : null}
                      </Command>
                    </div>
                    <FieldDescription className="text-xs">
                      Choose the person this opportunity belongs to.
                    </FieldDescription>
                    <FieldError>{formErrors.contact}</FieldError>
                  </Field>
                </FieldGroup>
              ) : null}

              <section
                className={cn(
                  "flex flex-col gap-4",
                  !lockContact && "border-t border-slate-200 pt-6",
                )}
              >
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold text-slate-950">Opportunity details</h3>
                  <p className="text-sm text-slate-500">
                    Choose where the opportunity starts and record its expected value.
                  </p>
                </div>

                <FieldGroup className="gap-5">
                  <Field
                    data-invalid={Boolean(formErrors.pipeline)}
                    data-disabled={isSubmitting || isLoadingPipelines}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="add-opportunity-pipeline" className="text-slate-800">
                      Pipeline
                    </FieldLabel>
                    {lockPipeline ? (
                      <div className="flex h-11 items-center rounded-xl border border-slate-200 bg-slate-50/60 px-4">
                        <p className="truncate text-sm font-medium text-slate-950">
                          {selectedPipeline?.name ??
                            (isLoadingPipelines ? "Loading pipeline..." : "Pipeline unavailable")}
                        </p>
                      </div>
                    ) : (
                      <Select
                        value={selectedPipelineId}
                        onValueChange={(value) => {
                          setSelectedPipelineId(value)
                          setFormErrors((current) => ({
                            ...current,
                            pipeline: undefined,
                          }))
                        }}
                        disabled={isSubmitting || isLoadingPipelines}
                      >
                        <SelectTrigger
                          id="add-opportunity-pipeline"
                          aria-invalid={Boolean(formErrors.pipeline)}
                          className="h-11 w-full rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100 data-[size=default]:h-11"
                        >
                          <SelectValue
                            placeholder={
                              isLoadingPipelines
                                ? "Loading pipelines..."
                                : "Select pipeline"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {pipelineOptions.map((pipeline) => {
                              const disabled = disabledPipelineIds.includes(pipeline.id)

                              return (
                                <SelectItem
                                  key={pipeline.id}
                                  value={pipeline.id}
                                  disabled={disabled}
                                >
                                  {pipeline.name}
                                  {disabled ? " (Already added)" : ""}
                                </SelectItem>
                              )
                            })}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                    <FieldDescription className="text-xs">
                      New opportunities begin in the first stage.
                    </FieldDescription>
                    <FieldError>{formErrors.pipeline}</FieldError>
                  </Field>

                  <Field
                    data-invalid={Boolean(formErrors.value)}
                    data-disabled={isSubmitting}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="add-opportunity-value" className="text-slate-800">
                      Value <span className="font-normal text-slate-500">(optional)</span>
                    </FieldLabel>
                    <Input
                      id="add-opportunity-value"
                      value={valueInput}
                      onChange={(event) => {
                        setValueInput(event.target.value)
                        setFormErrors((current) => ({
                          ...current,
                          value: undefined,
                        }))
                      }}
                      disabled={isSubmitting}
                      aria-invalid={Boolean(formErrors.value)}
                      placeholder="$0.00"
                      inputMode="decimal"
                      autoComplete="off"
                      className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                    />
                    <FieldDescription className="text-xs">
                      Expected amount in USD. Blank saves as $0.
                    </FieldDescription>
                    <FieldError>{formErrors.value}</FieldError>
                  </Field>
                </FieldGroup>
              </section>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:items-center sm:px-7">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="min-w-36 bg-blue-950 text-white shadow-sm hover:bg-blue-900"
              disabled={
                isSubmitting ||
                isLoadingPipelines ||
                (lockContact && !selectedContact) ||
                disabledPipelineIds.includes(selectedPipelineId)
              }
            >
              {isSubmitting ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : null}
              {isSubmitting ? "Creating..." : "Add opportunity"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
