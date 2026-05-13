"use client"

import { isAxiosError } from "axios"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"

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
}

type AddContactOpportunityDialogProps = {
  tenantId: string
  trigger: ReactNode
  initialContact?: ContactSearchItem | null
  lockContact?: boolean
  initialPipelineId?: string | null
  lockPipeline?: boolean
  onCreated?: (opportunity: CreatedOpportunity) => Promise<void> | void
}

export function AddContactOpportunityDialog({
  tenantId,
  trigger,
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
  const [formError, setFormError] = useState<string | null>(null)
  const isSelectingContactRef = useRef(false)

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
    setFormError(null)
  }

  const handleSubmit = async () => {
    if (!selectedContact?.id) {
      setFormError("Select a contact.")
      return
    }

    if (!selectedPipelineId) {
      setFormError("Select a pipeline.")
      return
    }

    const valueCents = parseValueCents(valueInput)
    if (valueCents === null) {
      setFormError("Enter a valid value using up to 2 decimal places.")
      return
    }

    setFormError(null)
    setIsSubmitting(true)

    try {
      const { data } = await api.post<CreateOpportunityResponse>(`/api/opportunities/${tenantId}`, {
        contactId: selectedContact.id,
        pipelineId: selectedPipelineId,
        valueCents,
      })

      toast.success("Opportunity added.")
      setOpen(false)
      reset()
      await onCreated?.(data.opportunity)
    } catch (error) {
      const backendError = isAxiosError(error)
        ? error.response?.data?.error
        : undefined

      if (backendError === "OPPORTUNITY_ALREADY_EXISTS") {
        setFormError("This contact is already enrolled in that pipeline.")
      } else {
        toast.error("Could not add opportunity.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen && !isSubmitting) {
          reset()
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add opportunity</DialogTitle>
          <DialogDescription>
            Enroll a contact into a pipeline. New opportunities start in the first stage.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="add-opportunity-pipeline">Pipeline</Label>
            {lockPipeline && selectedPipeline ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-sm font-medium text-slate-950">{selectedPipeline.name}</p>
              </div>
            ) : (
              <Select
                value={selectedPipelineId}
                onValueChange={setSelectedPipelineId}
                disabled={isLoadingPipelines}
              >
                <SelectTrigger id="add-opportunity-pipeline">
                  <SelectValue placeholder={isLoadingPipelines ? "Loading pipelines..." : "Select pipeline"} />
                </SelectTrigger>
                <SelectContent>
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
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="add-opportunity-value">Value (USD)</Label>
            <Input
              id="add-opportunity-value"
              value={valueInput}
              onChange={(event) => {
                setValueInput(event.target.value)
                setFormError(null)
              }}
              placeholder="0.00"
              inputMode="decimal"
              autoComplete="off"
            />
            <p className="text-xs text-slate-500">
              Optional. Leave blank to create the opportunity with a value of $0.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="add-opportunity-contact">Contact</Label>
            {lockContact && selectedContact ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-sm font-medium text-slate-950">{selectedContact.fullName}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedContact.email ?? selectedContact.phoneNumber ?? "No contact details"}
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <Command shouldFilter={false}>
                  <CommandInput
                    id="add-opportunity-contact"
                    value={contactQuery}
                    onValueChange={(value) => {
                      setContactQuery(value)
                      setFormError(null)

                      if (
                        !isSelectingContactRef.current &&
                        selectedContact &&
                        value !== selectedContact.fullName
                      ) {
                        setSelectedContact(null)
                      }
                    }}
                    placeholder="Search contact by name, email, or phone"
                  />
                  {contactQuery.trim().length >= 2 && !selectedContact ? (
                    <CommandList>
                      <CommandEmpty>
                        {isSearchingContacts ? "Searching contacts..." : "No contacts found."}
                      </CommandEmpty>
                      <CommandGroup>
                        {contactResults.map((contact) => (
                          <CommandItem
                            key={contact.id}
                            value={contact.id}
                            onSelect={() => {
                              isSelectingContactRef.current = true
                              setSelectedContact(contact)
                              setContactQuery(contact.fullName)
                              setDebouncedContactQuery(contact.fullName)
                              setContactResults([])
                              setFormError(null)
                              window.setTimeout(() => {
                                isSelectingContactRef.current = false
                              }, 0)
                            }}
                          >
                            <div className="flex flex-col">
                              <span>{contact.fullName}</span>
                              <span className="text-xs text-slate-500">
                                {contact.email ?? contact.phoneNumber ?? "No extra details"}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  ) : null}
                </Command>
              </div>
            )}
          </div>

          {formError ? <p className="text-sm text-rose-600">{formError}</p> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            disabled={isSubmitting}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
            disabled={
              isSubmitting ||
              (!lockContact && !selectedContact) ||
              (!lockPipeline && !selectedPipelineId) ||
              disabledPipelineIds.includes(selectedPipelineId)
            }
            onClick={() => void handleSubmit()}
          >
            Add opportunity
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
