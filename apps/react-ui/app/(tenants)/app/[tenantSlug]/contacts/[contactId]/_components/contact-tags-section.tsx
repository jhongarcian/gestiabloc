"use client"

import { useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import { ChevronDown, Plus, Search, X } from "lucide-react"
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
}: ContactTagsSectionProps) {
  const [assignedTags, setAssignedTags] = useState<ContactTag[]>(sortTags(initialTags))
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
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
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(searchInput)
      setPage(1)
    }, 300)

    return () => window.clearTimeout(timeout)
  }, [searchInput])

  useEffect(() => {
    if (!isDialogOpen) return

    let isCancelled = false

    const load = async () => {
      setIsSearching(true)
      setSearchError(null)

      try {
        const { data } = await api.get<SearchResponse>(
          `/api/contacts/${tenantId}/${contactId}/tags/search`,
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
  }, [contactId, debouncedSearch, isDialogOpen, page, tenantId])

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

    try {
      await api.post(`/api/contacts/${tenantId}/${contactId}/tags`, { tagId: tag.id })
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
    }
  }

  const handleRemove = async (tagId: string) => {
    setIsBusy(true)

    try {
      await api.delete(`/api/contacts/${tenantId}/${contactId}/tags/${tagId}`)
      setAssignedTags((prev) => prev.filter((tag) => tag.id !== tagId))
      toast.success("Tag removed from contact.")
    } catch {
      toast.error("Could not remove tag.")
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <details className="group rounded-lg py-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-50">
        <span className="flex items-center gap-2">
          <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
          Tags
        </span>
        <span className="text-xs text-slate-500">
          {assignedTags.length} assigned
        </span>
      </summary>

      <div className="mt-1 space-y-3 pl-8">
        {assignedTags.length ? (
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
                <button
                  type="button"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/10 transition hover:bg-black/20"
                  aria-label={`Remove ${tag.name}`}
                  disabled={isBusy}
                  onClick={() => void handleRemove(tag.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm leading-6 text-slate-500">No tags assigned yet.</p>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          onClick={() => setIsDialogOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Add Tag
        </Button>
      </div>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open)
          if (!open) {
            setSearchInput("")
            setDebouncedSearch("")
            setPage(1)
            setSearchError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Tag</DialogTitle>
            <DialogDescription>
              Search tenant tags and add one to this contact. Results are paginated and
              already-assigned tags are excluded.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search tags"
                className="pl-9"
              />
            </div>

            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
              {isSearching ? (
                <p className="px-2 py-4 text-sm text-slate-500">Loading tags...</p>
              ) : searchError ? (
                <p className="px-2 py-4 text-sm text-rose-600">{searchError}</p>
              ) : availableTags.length ? (
                availableTags.map((tag) => (
                  <div
                    key={tag.id}
                    className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={{
                          backgroundColor: tag.bgColor,
                          color: tag.textColor,
                        }}
                      >
                        {tag.name}
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isBusy}
                      className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
                      onClick={() => void handleAssign(tag)}
                    >
                      Add
                    </Button>
                  </div>
                ))
              ) : (
                <p className="px-2 py-4 text-sm text-slate-500">
                  No matching tags available.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || isSearching}
                  className="cursor-pointer"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages || isSearching}
                  className="cursor-pointer"
                  onClick={() => setPage((prev) => prev + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={() => setIsDialogOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </details>
  )
}
