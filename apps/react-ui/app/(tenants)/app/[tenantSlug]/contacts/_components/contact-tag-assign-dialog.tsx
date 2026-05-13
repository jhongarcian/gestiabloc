"use client"

import { type ReactNode, useEffect, useState } from "react"
import { isAxiosError } from "axios"
import { Search } from "lucide-react"
import { toast } from "sonner"

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
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { api } from "@/lib/api"

type ContactTag = {
  id: string
  name: string
  bgColor: string
  textColor: string
  sortOrder: number
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

type ContactTagAssignDialogProps = {
  tenantId: string
  contactId: string
  canManageTags: boolean
  trigger: ReactNode
  onAssigned?: () => Promise<void> | void
  presentation?: "dialog" | "drawer"
}

export function ContactTagAssignDialog({
  tenantId,
  contactId,
  canManageTags,
  trigger,
  onAssigned,
  presentation = "dialog",
}: ContactTagAssignDialogProps) {
  const [open, setOpen] = useState(false)
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
    if (!open || !canManageTags) return

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
  }, [canManageTags, contactId, debouncedSearch, open, page, tenantId])

  const handleAssign = async (tag: ContactTag) => {
    setIsBusy(true)

    try {
      await api.post(
        `/api/contacts/${encodeURIComponent(tenantId)}/${encodeURIComponent(contactId)}/tags`,
        { tagId: tag.id },
      )
      toast.success("Tag added to contact.")
      setOpen(false)
      await onAssigned?.()
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

  if (!canManageTags) {
    return null
  }

  const isDrawer = presentation === "drawer"

  const content = (
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
        ) : availableTags.length > 0 ? (
          availableTags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2"
            >
              <span
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                style={{
                  backgroundColor: tag.bgColor,
                  color: tag.textColor,
                }}
              >
                {tag.name}
              </span>
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
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pagination.totalPages || isSearching}
            className="cursor-pointer"
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )

  if (isDrawer) {
    return (
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) {
            setSearchInput("")
            setDebouncedSearch("")
            setPage(1)
            setSearchError(null)
          }
        }}
      >
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="right" className="flex h-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-slate-200 bg-slate-50 px-6 text-left">
            <SheetTitle className="text-xl font-semibold text-slate-950">Add Tag</SheetTitle>
            <SheetDescription>
              Search tenant tags and add one to this contact. Results exclude tags already assigned.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">{content}</div>
          <SheetFooter className="border-t border-slate-200 bg-white px-6 py-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setSearchInput("")
          setDebouncedSearch("")
          setPage(1)
          setSearchError(null)
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Tag</DialogTitle>
          <DialogDescription>
            Search tenant tags and add one to this contact. Results exclude tags already assigned.
          </DialogDescription>
        </DialogHeader>
        {content}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
