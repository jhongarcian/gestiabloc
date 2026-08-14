"use client"

import { useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import { ChevronDown, Loader2, Plus, Search, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"

type ContactTag = {
  id: string
  name: string
  bgColor: string
  textColor: string
  sortOrder: number
}

type ContactTagsSectionProps = {
  tenantId: string
  contactId: string
  initialTags: ContactTag[]
  canManageTags: boolean
  variant?: "sidebar" | "card"
}

type SearchResponse = {
  ok: boolean
  items: ContactTag[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  query: string
}

function sortTags(tags: ContactTag[]) {
  return [...tags].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

export function ContactTagsSection({
  tenantId,
  contactId,
  initialTags,
  canManageTags,
  variant = "sidebar",
}: ContactTagsSectionProps) {
  const [assignedTags, setAssignedTags] = useState<ContactTag[]>(sortTags(initialTags))
  const [open, setOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [assigningTagId, setAssigningTagId] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [availableTags, setAvailableTags] = useState<ContactTag[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  })

  useEffect(() => {
    setAssignedTags(sortTags(initialTags))
  }, [initialTags])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(searchInput)
      setPage(1)
    }, 300)

    return () => window.clearTimeout(timeout)
  }, [searchInput])

  useEffect(() => {
    if (!open) return

    let isCancelled = false

    const load = async () => {
      setIsSearching(true)
      setSearchError(null)

      try {
        const { data } = await api.get<SearchResponse>(
          `/api/contacts/${encodeURIComponent(tenantId)}/${encodeURIComponent(contactId)}/tags/search`,
          {
            params: {
              q: debouncedSearch,
              page,
              pageSize: 10,
            },
          },
        )

        if (isCancelled) return
        setAvailableTags(data.items)
        setPagination(data.pagination)
      } catch (error) {
        if (isCancelled) return

        const backendError = isAxiosError(error)
          ? error.response?.data?.error
          : undefined
        setSearchError(
          typeof backendError === "string"
            ? backendError.replace(/[_-]+/g, " ").toLowerCase()
            : "Could not load tags.",
        )
      } finally {
        if (!isCancelled) {
          setIsSearching(false)
        }
      }
    }

    void load()

    return () => {
      isCancelled = true
    }
  }, [contactId, debouncedSearch, open, page, tenantId])

  const assignedIds = useMemo(
    () => new Set(assignedTags.map((tag) => tag.id)),
    [assignedTags],
  )

  const handleAssign = async (tag: ContactTag) => {
    if (assignedIds.has(tag.id)) {
      toast.error("This contact already has that tag.")
      return
    }

    setIsBusy(true)
    setAssigningTagId(tag.id)

    try {
      await api.post(
        `/api/contacts/${encodeURIComponent(tenantId)}/${encodeURIComponent(contactId)}/tags`,
        { tagId: tag.id },
      )
      setAssignedTags((prev) => sortTags([...prev, tag]))
      setAvailableTags((prev) => prev.filter((item) => item.id !== tag.id))
      setPagination((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }))
      toast.success("Tag added to contact.")
    } catch (error) {
      const backendError = isAxiosError(error)
        ? error.response?.data?.error
        : undefined
      const message =
        backendError === "CONTACT_TAG_ALREADY_EXISTS"
          ? "This contact already has that tag."
          : "Could not add tag."
      toast.error(message)
    } finally {
      setIsBusy(false)
      setAssigningTagId(null)
    }
  }

  const handleRemove = async (tagId: string) => {
    setIsBusy(true)

    try {
      await api.delete(
        `/api/contacts/${encodeURIComponent(tenantId)}/${encodeURIComponent(contactId)}/tags/${encodeURIComponent(tagId)}`,
      )
      setAssignedTags((prev) => prev.filter((tag) => tag.id !== tagId))
      toast.success("Tag removed from contact.")
    } catch {
      toast.error("Could not remove tag.")
    } finally {
      setIsBusy(false)
    }
  }

  const triggerAdd = () => {
    setOpen(true)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isBusy) return

    setOpen(nextOpen)
    if (!nextOpen) {
      setSearchInput("")
      setDebouncedSearch("")
      setPage(1)
      setSearchError(null)
    }
  }

  const tagsContent = assignedTags.length ? (
    <div className="flex flex-wrap gap-2">
      {assignedTags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{
            backgroundColor: tag.bgColor,
            color: tag.textColor,
          }}
        >
          {tag.name}
          {canManageTags ? (
            <button
              type="button"
              className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-black/10 transition hover:bg-black/20"
              aria-label={`Remove ${tag.name}`}
              disabled={isBusy}
              onClick={() => void handleRemove(tag.id)}
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  ) : (
    <p className="text-sm leading-6 text-slate-500">No tags assigned yet.</p>
  )

  return (
    <>
      {variant === "card" ? (
        <section className="space-y-4 rounded-xl border border-slate-100 p-4 md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Tags</h3>
                <span className="rounded-full border border-slate-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-950">
                  {assignedTags.length}
                </span>
              </div>
              <p className="text-sm text-slate-500">
                Contact labels currently assigned to this record.
              </p>
            </div>

            {canManageTags ? (
              <Button
                type="button"
                size="sm"
                disabled={isBusy}
                className="cursor-pointer rounded-xl bg-blue-950 text-white shadow-sm hover:bg-blue-900"
                onClick={triggerAdd}
              >
                <Plus data-icon="inline-start" />
                Add tag
              </Button>
            ) : null}
          </div>

          {tagsContent}
        </section>
      ) : (
        <details className="group rounded-lg py-1">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-50">
            <span className="flex items-center gap-2">
              <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
              Tags
              <span className="rounded-full border border-slate-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-950">
                {assignedTags.length}
              </span>
            </span>
            {canManageTags ? (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={isBusy}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  triggerAdd()
                }}
                className="cursor-pointer rounded-full border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
                aria-label="Add tag"
              >
                <Plus />
              </Button>
            ) : null}
          </summary>

          <div className="mt-1 space-y-3 pl-8">{tagsContent}</div>
        </details>
      )}

      {canManageTags ? (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[28px] border-slate-200 bg-white p-0 shadow-2xl sm:max-w-xl [&>button]:cursor-pointer">
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
                <div className="flex min-w-0 flex-col gap-1.5">
                  <p className="text-xs font-semibold text-blue-700">Contact details</p>
                  <DialogTitle className="text-xl font-semibold text-slate-950 sm:text-2xl">
                    Add a tag
                  </DialogTitle>
                  <DialogDescription className="max-w-md text-sm leading-6 text-slate-600">
                    Find a tenant tag and attach it to this contact for easier organization.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
              <FieldGroup className="gap-6">
                <Field data-disabled={isBusy} className="gap-2">
                  <FieldLabel htmlFor="contact-tag-search" className="text-slate-800">
                    Search tags
                  </FieldLabel>
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="contact-tag-search"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      placeholder="Enter a tag name"
                      disabled={isBusy}
                      autoComplete="off"
                      className="h-11 rounded-xl border-slate-200 bg-slate-50/60 pr-4 pl-10 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                    />
                  </div>
                  <FieldDescription className="text-xs">
                    Tags already assigned to this contact are hidden from the results.
                  </FieldDescription>
                </Field>

                <section
                  className="flex flex-col gap-3 border-t border-slate-200 pt-5"
                  aria-labelledby="available-tags-heading"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <h3
                        id="available-tags-heading"
                        className="text-sm font-semibold text-slate-900"
                      >
                        Available tags
                      </h3>
                      <p className="text-xs text-slate-500">
                        Choose a tag to add it immediately.
                      </p>
                    </div>
                    {!isSearching && !searchError ? (
                      <Badge variant="secondary" className="bg-blue-50 text-blue-950">
                        {pagination.total} {pagination.total === 1 ? "result" : "results"}
                      </Badge>
                    ) : null}
                  </div>

                  <div
                    className="min-h-[168px] overflow-hidden rounded-2xl border border-slate-200 bg-white"
                    aria-busy={isSearching}
                    aria-live="polite"
                  >
                    {isSearching ? (
                      <div className="flex flex-col" aria-label="Loading tags">
                        {[0, 1, 2].map((item) => (
                          <div
                            key={item}
                            className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0"
                          >
                            <Skeleton className="h-6 w-28 rounded-full" />
                            <Skeleton className="h-8 w-14 rounded-lg" />
                          </div>
                        ))}
                      </div>
                    ) : searchError ? (
                      <p
                        className="flex min-h-[166px] items-center justify-center px-4 py-8 text-center text-sm text-rose-700"
                        role="alert"
                      >
                        {searchError}
                      </p>
                    ) : availableTags.length ? (
                      availableTags.map((tag) => (
                        <div
                          key={tag.id}
                          className="flex min-h-14 items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0"
                        >
                          <Badge
                            variant="outline"
                            className="max-w-[70%] truncate border-transparent px-2.5 py-1 text-xs font-semibold"
                            style={{
                              backgroundColor: tag.bgColor,
                              color: tag.textColor,
                            }}
                          >
                            {tag.name}
                          </Badge>
                          <Button
                            type="button"
                            size="sm"
                            disabled={isBusy}
                            className="min-w-20 cursor-pointer rounded-lg bg-blue-950 text-white shadow-sm hover:bg-blue-900"
                            onClick={() => void handleAssign(tag)}
                          >
                            {assigningTagId === tag.id ? (
                              <Loader2 data-icon="inline-start" className="animate-spin" />
                            ) : (
                              <Plus data-icon="inline-start" />
                            )}
                            {assigningTagId === tag.id ? "Adding..." : "Add"}
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p className="flex min-h-[166px] items-center justify-center px-4 py-8 text-center text-sm text-slate-500">
                        No matching tags available.
                      </p>
                    )}
                  </div>
                </section>
              </FieldGroup>
            </div>

            <DialogFooter className="flex-col gap-3 border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:flex-row sm:items-center sm:px-7">
              <span className="text-xs text-slate-500 sm:mr-auto">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || isSearching || isBusy}
                  className="cursor-pointer rounded-lg"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages || isSearching || isBusy}
                  className="cursor-pointer rounded-lg"
                  onClick={() => setPage((prev) => prev + 1)}
                >
                  Next
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  className="cursor-pointer rounded-lg"
                  onClick={() => handleOpenChange(false)}
                >
                  Close
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
