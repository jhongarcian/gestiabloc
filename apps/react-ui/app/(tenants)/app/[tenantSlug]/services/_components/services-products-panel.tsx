"use client"

import { isAxiosError } from "axios"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { api } from "@/lib/api"

type LinkedEntityType = "SERVICE" | "PRODUCT"

type LinkedEntityItem = {
  id: string
  name: string
  type: LinkedEntityType
  isActive: boolean
  sortOrder: number
}

type LinkedEntitiesResponse = {
  ok: boolean
  items: LinkedEntityItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type ServicesProductsPanelProps = {
  tenantId: string
}

type CreateEditDialogProps = {
  tenantId: string
  mode: "create" | "edit"
  item?: LinkedEntityItem
  onSaved: () => Promise<void> | void
}

const PAGE_SIZE_OPTIONS = [10, 25] as const
const ALL_TYPES = "ALL"

function typeLabel(type: LinkedEntityType) {
  return type === "SERVICE" ? "Service" : "Product"
}

function CreateEditDialog({ tenantId, mode, item, onSaved }: CreateEditDialogProps) {
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [name, setName] = useState(item?.name ?? "")
  const [type, setType] = useState<LinkedEntityType>(item?.type ?? "SERVICE")
  const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? 0))
  const [isActive, setIsActive] = useState(item?.isActive ?? true)

  const resetForm = useCallback(() => {
    setName(item?.name ?? "")
    setType(item?.type ?? "SERVICE")
    setSortOrder(String(item?.sortOrder ?? 0))
    setIsActive(item?.isActive ?? true)
  }, [item])

  const onSubmit = async () => {
    if (!name.trim()) {
      toast.error("Name is required.")
      return
    }

    const parsedSortOrder = Number.parseInt(sortOrder, 10)
    if (!Number.isFinite(parsedSortOrder) || parsedSortOrder < 0) {
      toast.error("Sort order must be 0 or greater.")
      return
    }

    setIsSubmitting(true)
    try {
      if (mode === "create") {
        await api.post(`/api/services-products/${tenantId}`, {
          name: name.trim(),
          type,
          sortOrder: parsedSortOrder,
          isActive,
        })
      } else {
        await api.patch(`/api/services-products/${tenantId}/${item?.id}`, {
          name: name.trim(),
          type,
          sortOrder: parsedSortOrder,
          isActive,
        })
      }

      toast.success(mode === "create" ? "Item created." : "Item updated.")
      setOpen(false)
      resetForm()
      await onSaved()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (backendError === "UNIQUE_CONSTRAINT") {
          toast.error("A record with this name and type already exists.")
        } else {
          toast.error(typeof backendError === "string" ? backendError.replace(/_/g, " ") : "Could not save item.")
        }
      } else {
        toast.error("Could not save item.")
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
        if (!nextOpen) resetForm()
      }}
    >
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button type="button">Add service/product</Button>
        ) : (
          <Button type="button" variant="outline" size="sm">
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create item" : "Edit item"}</DialogTitle>
          <DialogDescription>
            Maintain reusable services and products for task linking.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-linked-name`}>Name</Label>
            <Input
              id={`${mode}-linked-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Initial consultation"
              disabled={isSubmitting}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${mode}-linked-type`}>Type</Label>
              <Select
                value={type}
                onValueChange={(value) => setType(value as LinkedEntityType)}
                disabled={isSubmitting}
              >
                <SelectTrigger id={`${mode}-linked-type`}>
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SERVICE">Service</SelectItem>
                  <SelectItem value="PRODUCT">Product</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`${mode}-linked-sort-order`}>Sort order</Label>
              <Input
                id={`${mode}-linked-sort-order`}
                type="number"
                min={0}
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id={`${mode}-linked-active`}
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked === true)}
              disabled={isSubmitting}
            />
            <Label htmlFor={`${mode}-linked-active`} className="text-sm">
              Active
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ServicesProductsPanel({ tenantId }: ServicesProductsPanelProps) {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<typeof ALL_TYPES | LinkedEntityType>(ALL_TYPES)
  const [isActiveFilter, setIsActiveFilter] = useState<"ALL" | "true" | "false">("ALL")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<LinkedEntitiesResponse | null>(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(1)
    }, 350)

    return () => window.clearTimeout(timeout)
  }, [query])

  const loadItems = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data: response } = await api.get<LinkedEntitiesResponse>(
        `/api/services-products/${tenantId}`,
        {
          params: {
            page,
            pageSize,
            search: debouncedQuery || undefined,
            type: typeFilter === ALL_TYPES ? undefined : typeFilter,
            isActive: isActiveFilter === "ALL" ? undefined : isActiveFilter,
          },
        },
      )

      setData(response)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not load services/products.",
        )
      } else {
        setErrorMessage("Could not load services/products.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [tenantId, page, pageSize, debouncedQuery, typeFilter, isActiveFilter])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const items = data?.items ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages

  const summaryLabel = useMemo(() => {
    if (!total) return "No records found"
    const start = (page - 1) * pageSize + 1
    const end = start + items.length - 1
    return `Showing ${start}-${end} of ${total}`
  }, [page, pageSize, items.length, total])

  const handleDelete = async (entityId: string) => {
    const confirmed = window.confirm("Delete this item?")
    if (!confirmed) return

    try {
      await api.delete(`/api/services-products/${tenantId}/${entityId}`)
      toast.success("Item deleted.")
      await loadItems()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(typeof backendError === "string" ? backendError.replace(/_/g, " ") : "Could not delete item.")
      } else {
        toast.error("Could not delete item.")
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 rounded-xl bg-white p-3 md:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <h2 className="text-lg font-semibold text-slate-900">Services & Products</h2>
          <p className="text-sm text-slate-500">{summaryLabel}</p>
        </div>

        <CreateEditDialog tenantId={tenantId} mode="create" onSaved={loadItems} />
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_160px_auto]">
        <Input
          placeholder="Search by name"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(1)
          }}
        />
        <Select
          value={typeFilter}
          onValueChange={(value) => {
            setTypeFilter(value as typeof ALL_TYPES | LinkedEntityType)
            setPage(1)
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>All Types</SelectItem>
            <SelectItem value="SERVICE">Services</SelectItem>
            <SelectItem value="PRODUCT">Products</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={isActiveFilter}
          onValueChange={(value) => {
            setIsActiveFilter(value as "ALL" | "true" | "false")
            setPage(1)
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setQuery("")
            setDebouncedQuery("")
            setTypeFilter(ALL_TYPES)
            setIsActiveFilter("ALL")
            setPage(1)
          }}
        >
          Clear Filters
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-200">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table className="[&_td]:py-2 [&_th]:h-8">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-56 text-xs">Name</TableHead>
                <TableHead className="min-w-28 text-xs">Type</TableHead>
                <TableHead className="min-w-28 text-xs">Status</TableHead>
                <TableHead className="min-w-20 text-xs">Order</TableHead>
                <TableHead className="min-w-36 text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : errorMessage ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-rose-600">
                    {errorMessage}
                  </TableCell>
                </TableRow>
              ) : items.length ? (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-slate-900">{item.name}</TableCell>
                    <TableCell>{typeLabel(item.type)}</TableCell>
                    <TableCell>
                      <span
                        className={
                          item.isActive
                            ? "text-xs font-semibold text-emerald-700"
                            : "text-xs font-semibold text-slate-500"
                        }
                      >
                        {item.isActive ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell className="text-slate-700">{item.sortOrder}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <CreateEditDialog
                          tenantId={tenantId}
                          mode="edit"
                          item={item}
                          onSaved={loadItems}
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            void handleDelete(item.id)
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                    No services/products yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">{summaryLabel}</p>
          <div className="flex items-center gap-2">
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value) as (typeof PAGE_SIZE_OPTIONS)[number])
                setPage(1)
              }}
            >
              <SelectTrigger className="h-8 w-[96px]">
                <SelectValue placeholder="Rows" />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option} rows
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => current - 1)}
              disabled={!canGoPrevious}
            >
              Previous
            </Button>
            <span className="text-xs text-slate-500">
              Page {page} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => current + 1)}
              disabled={!canGoNext}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
