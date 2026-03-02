"use client"

import { isAxiosError } from "axios"
import { ChevronDown, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
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
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type RelationshipType =
  | "FATHER"
  | "MOTHER"
  | "PARENT"
  | "SON"
  | "DAUGHTER"
  | "CHILD"
  | "HUSBAND"
  | "WIFE"
  | "SPOUSE"
  | "PARTNER"
  | "BROTHER"
  | "SISTER"
  | "SIBLING"
  | "GRANDFATHER"
  | "GRANDMOTHER"
  | "GRANDPARENT"
  | "GRANDSON"
  | "GRANDDAUGHTER"
  | "GRANDCHILD"
  | "UNCLE"
  | "AUNT"
  | "AUNT_OR_UNCLE"
  | "NEPHEW"
  | "NIECE"
  | "NIECE_OR_NEPHEW"
  | "COUSIN"
  | "GUARDIAN"
  | "WARD"
  | "CAREGIVER"
  | "DEPENDENT"
  | "FRIEND"
  | "OTHER"

type RelationshipRecord = {
  id: string
  relatedContactId: string
  relationshipType: RelationshipType
  relationshipLabel: string
  relatedContact: {
    id: string
    fullName: string
    phoneNumber: string | null
    email: string | null
  }
}

type SearchResult = {
  id: string
  fullName: string
  phoneNumber: string | null
  email: string | null
}

type ContactRelationshipsSectionProps = {
  tenantId: string
  tenantSlug: string
  contactId: string
  initialRelationships: RelationshipRecord[]
}

const RELATIONSHIP_OPTIONS: Array<{ value: RelationshipType; label: string }> =
  [
    { value: "FATHER", label: "Father" },
    { value: "MOTHER", label: "Mother" },
    { value: "PARENT", label: "Parent" },
    { value: "SON", label: "Son" },
    { value: "DAUGHTER", label: "Daughter" },
    { value: "CHILD", label: "Child" },
    { value: "HUSBAND", label: "Husband" },
    { value: "WIFE", label: "Wife" },
    { value: "SPOUSE", label: "Spouse" },
    { value: "PARTNER", label: "Partner" },
    { value: "BROTHER", label: "Brother" },
    { value: "SISTER", label: "Sister" },
    { value: "SIBLING", label: "Sibling" },
    { value: "GRANDFATHER", label: "Grandfather" },
    { value: "GRANDMOTHER", label: "Grandmother" },
    { value: "GRANDPARENT", label: "Grandparent" },
    { value: "GRANDSON", label: "Grandson" },
    { value: "GRANDDAUGHTER", label: "Granddaughter" },
    { value: "GRANDCHILD", label: "Grandchild" },
    { value: "UNCLE", label: "Uncle" },
    { value: "AUNT", label: "Aunt" },
    { value: "AUNT_OR_UNCLE", label: "Aunt or Uncle" },
    { value: "NEPHEW", label: "Nephew" },
    { value: "NIECE", label: "Niece" },
    { value: "NIECE_OR_NEPHEW", label: "Niece or Nephew" },
    { value: "COUSIN", label: "Cousin" },
    { value: "GUARDIAN", label: "Guardian" },
    { value: "WARD", label: "Ward" },
    { value: "CAREGIVER", label: "Caregiver" },
    { value: "DEPENDENT", label: "Dependent" },
    { value: "FRIEND", label: "Friend" },
    { value: "OTHER", label: "Other" },
  ]

export function ContactRelationshipsSection({
  tenantId,
  tenantSlug,
  contactId,
  initialRelationships,
}: ContactRelationshipsSectionProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [relationshipType, setRelationshipType] =
    useState<RelationshipType>("FATHER")
  const [results, setResults] = useState<SearchResult[]>([])
  const [relationships, setRelationships] = useState(initialRelationships)

  useEffect(() => {
    setRelationships(initialRelationships)
  }, [initialRelationships])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
    }, 350)

    return () => window.clearTimeout(timeout)
  }, [query])

  const relatedContactIds = useMemo(
    () => new Set(relationships.map((item) => item.relatedContactId)),
    [relationships],
  )
  const groupedRelationships = useMemo(() => {
    const groups = new Map<string, RelationshipRecord[]>()

    for (const relationship of relationships) {
      const current = groups.get(relationship.relationshipLabel) ?? []
      current.push(relationship)
      groups.set(relationship.relationshipLabel, current)
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, items]) => ({
        label,
        items: [...items].sort((a, b) =>
          a.relatedContact.fullName.localeCompare(b.relatedContact.fullName),
        ),
      }))
  }, [relationships])
  const selectedRelationshipLabel = useMemo(
    () =>
      RELATIONSHIP_OPTIONS.find((option) => option.value === relationshipType)?.label ??
      "Relationship",
    [relationshipType],
  )

  useEffect(() => {
    if (!open) {
      setResults([])
      return
    }

    if (debouncedQuery.length < 2) {
      setResults([])
      return
    }

    let cancelled = false

    const load = async () => {
      setIsSearching(true)
      try {
        const { data } = await api.get<{ ok: boolean; items: SearchResult[] }>(
          `/api/contacts/${tenantId}/search`,
          {
            params: {
              q: debouncedQuery,
              excludeContactId: contactId,
            },
          },
        )

        if (!cancelled) {
          setResults(data.items)
        }
      } catch {
        if (!cancelled) {
          setResults([])
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [contactId, debouncedQuery, open, tenantId])

  const resetDialog = () => {
    setQuery("")
    setDebouncedQuery("")
    setResults([])
    setRelationshipType("FATHER")
  }

  const handleCreate = async (result: SearchResult) => {
    setIsSaving(true)
    try {
      const { data } = await api.post<{
        ok: boolean
        relationship: RelationshipRecord
      }>(`/api/contacts/${tenantId}/${contactId}/relationships`, {
        relatedContactId: result.id,
        relationshipType,
      })

      setRelationships((current) => [...current, data.relationship])
      toast.success("Relationship added.")
      setOpen(false)
      resetDialog()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (typeof backendError === "string") {
          toast.error(backendError.replace(/_/g, " "))
        } else {
          toast.error("Could not add relationship.")
        }
      } else {
        toast.error("Could not add relationship.")
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (relationshipId: string) => {
    setIsSaving(true)
    try {
      await api.delete(
        `/api/contacts/${tenantId}/${contactId}/relationships/${relationshipId}`,
      )
      setRelationships((current) =>
        current.filter((item) => item.id !== relationshipId),
      )
      toast.success("Relationship removed.")
    } catch {
      toast.error("Could not remove relationship.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <details className="group rounded-lg py-1" open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-50">
          <span className="flex items-center gap-2">
            <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
            Relationship
            <span className="rounded-full border border-slate-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-950">
              {relationships.length}
            </span>
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setOpen(true)
            }}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
            aria-label="Add relationship"
          >
            <Plus className="h-4 w-4" />
          </button>
        </summary>

        {relationships.length > 0 ? (
          <div className="mt-1 space-y-3 pl-2">
            {groupedRelationships.map((group) => (
              <div key={group.label} className="space-y-1.5">
                <div className="flex items-center gap-2 px-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    {group.label}
                  </p>
                  <span className="h-px flex-1 bg-slate-200" />
                </div>

                <div className="space-y-0.5">
                  {group.items.map((relationship) => (
                    <div
                      key={relationship.id}
                      className="flex items-start justify-between gap-3 rounded-lg px-3 py-2 transition hover:bg-slate-50/70"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <Link
                          href={`/app/${tenantSlug}/contacts/${relationship.relatedContact.id}/overview`}
                          className="block truncate text-sm font-medium text-slate-900 hover:text-blue-900"
                        >
                          {relationship.relatedContact.fullName}
                        </Link>
                        <p className="truncate text-xs text-slate-500">
                          {relationship.relatedContact.phoneNumber
                            ? formatPhoneNumber(relationship.relatedContact.phoneNumber)
                            : relationship.relatedContact.email || "No phone or email"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDelete(relationship.id)}
                        disabled={isSaving}
                        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Remove relationship with ${relationship.relatedContact.fullName}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 pl-8 text-sm leading-6 text-slate-500">
            No relationship data configured yet.
          </p>
        )}
      </details>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) {
            resetDialog()
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Add relationship</DialogTitle>
            <DialogDescription>
              Define the relationship first, then find the matching contact by
              name, phone, or email.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="space-y-5">
              <section className="rounded-[22px] border border-slate-200 bg-white p-5">
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    1. Relationship
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-950">
                    Choose how the contacts are connected
                  </h3>
                </div>

                <div className="grid gap-2">
                  <Label>Relationship Type</Label>
                  <Select
                    value={relationshipType}
                    onValueChange={(value: RelationshipType) =>
                      setRelationshipType(value)
                    }
                  >
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RELATIONSHIP_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <section className="rounded-[22px] border border-slate-200 bg-white p-5">
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    2. Search
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-950">
                    Find the related contact
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Search by full name, phone number, or email address.
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="relationship-search">Search Contact</Label>
                  <Input
                    id="relationship-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Start typing a contact name, phone, or email"
                  />
                  <p className="text-xs text-slate-500">
                    Results update after a short debounce once you type at least
                    2 characters.
                  </p>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-2">
                  {debouncedQuery.length < 2 ? (
                    <div className="px-3 py-7 text-center">
                      <p className="text-sm font-medium text-slate-700">
                        Search for a contact to connect
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        No request is sent until the query is at least 2
                        characters.
                      </p>
                    </div>
                  ) : isSearching ? (
                    <p className="px-3 py-7 text-center text-sm text-slate-500">
                      Searching contacts...
                    </p>
                  ) : results.length === 0 ? (
                    <div className="px-3 py-7 text-center">
                      <p className="text-sm font-medium text-slate-700">
                        No contacts matched your search
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Try a different name, phone number, or email.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {results.map((result) => {
                        const alreadyRelated = relatedContactIds.has(result.id)

                        return (
                          <button
                            key={result.id}
                            type="button"
                            disabled={alreadyRelated || isSaving}
                            onClick={() => void handleCreate(result)}
                            className={cn(
                              "flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-transparent bg-white px-3 py-3 text-left transition hover:border-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60",
                            )}
                          >
                            <div className="min-w-0 space-y-1">
                              <p className="truncate text-sm font-medium text-slate-900">
                                {result.fullName}
                              </p>
                              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                                <span>
                                  {result.phoneNumber
                                    ? formatPhoneNumber(result.phoneNumber)
                                    : "No phone"}
                                </span>
                                <span>{result.email || "No email"}</span>
                              </div>
                            </div>
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-1 text-xs font-semibold",
                                alreadyRelated
                                  ? "bg-slate-100 text-slate-500"
                                  : "bg-blue-50 text-blue-900",
                              )}
                            >
                              {alreadyRelated ? "Already linked" : "Add"}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <aside className="space-y-4">
              <section className="rounded-[22px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_45%,#fff7ed_100%)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Selected
                </p>
                <div className="mt-4 rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm">
                  <p className="mt-2 text-lg font-semibold text-slate-950">
                    {selectedRelationshipLabel}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    This link will appear on both contacts.
                  </p>
                </div>
              </section>
            </aside>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
