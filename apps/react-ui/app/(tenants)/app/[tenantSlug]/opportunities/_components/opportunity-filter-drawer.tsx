"use client"

import { useState } from "react"
import { format } from "date-fns"
import { CalendarIcon, Filter, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

export type FilterOption = {
  id: string
  name: string
  bgColor?: string | null
  textColor?: string | null
}

export type AssigneeOption = {
  userId: string
  name: string
  email: string
  image: string | null
}

export type CustomFieldOption = {
  id: string
  key: string
  label: string
  fieldType: string
  options: string[]
}

export type CustomFieldFilter = {
  fieldId: string
  type: "text" | "number" | "currency" | "date" | "select" | "multi_select" | "checkbox"
  text?: string
  min?: number
  max?: number
  dateFrom?: string
  dateTo?: string
  values?: string[]
  checked?: boolean
}

export type OpportunityFilters = {
  tagIds: string[]
  statusConfigIds: string[]
  assignedToUserIds: string[]
  customFieldFilters: CustomFieldFilter[]
}

type OpportunityFilterDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tagOptions: FilterOption[]
  statusOptions: FilterOption[]
  assigneeOptions: AssigneeOption[]
  customFieldOptions: CustomFieldOption[]
  currentFilters: OpportunityFilters
  onApply: (filters: OpportunityFilters) => void
}

export function OpportunityFilterDrawer({
  open,
  onOpenChange,
  tagOptions,
  statusOptions,
  assigneeOptions,
  customFieldOptions,
  currentFilters,
  onApply,
}: OpportunityFilterDrawerProps) {
  const [draftTagIds, setDraftTagIds] = useState<string[]>([])
  const [draftStatusConfigIds, setDraftStatusConfigIds] = useState<string[]>([])
  const [draftAssignedToUserIds, setDraftAssignedToUserIds] = useState<string[]>([])
  const [draftCustomFieldFilters, setDraftCustomFieldFilters] = useState<CustomFieldFilter[]>([])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && !open) {
      setDraftTagIds(currentFilters.tagIds)
      setDraftStatusConfigIds(currentFilters.statusConfigIds)
      setDraftAssignedToUserIds(currentFilters.assignedToUserIds)
      setDraftCustomFieldFilters(
        currentFilters.customFieldFilters.filter((f) => {
          if (f.type === "text") return Boolean(f.text)
          if (f.type === "number" || f.type === "currency")
            return f.min !== undefined || f.max !== undefined
          if (f.type === "date") return Boolean(f.dateFrom || f.dateTo)
          if (f.type === "select" || f.type === "multi_select")
            return Boolean(f.values && f.values.length > 0)
          if (f.type === "checkbox") return f.checked !== undefined
          return false
        }),
      )
    }
    onOpenChange(nextOpen)
  }

  const handleClear = () => {
    setDraftTagIds([])
    setDraftStatusConfigIds([])
    setDraftAssignedToUserIds([])
    setDraftCustomFieldFilters([])
  }

  const handleApply = () => {
    onApply({
      tagIds: [...new Set(draftTagIds)],
      statusConfigIds: [...new Set(draftStatusConfigIds)],
      assignedToUserIds: [...new Set(draftAssignedToUserIds)],
      customFieldFilters: draftCustomFieldFilters,
    })
    onOpenChange(false)
  }

  const toggleTag = (tagId: string) => {
    setDraftTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    )
  }

  const toggleStatus = (statusId: string) => {
    setDraftStatusConfigIds((prev) =>
      prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
    )
  }

  const toggleAssignee = (userId: string) => {
    setDraftAssignedToUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }

  const updateCustomFieldFilter = (fieldId: string, filter: CustomFieldFilter) => {
    setDraftCustomFieldFilters((prev) => {
      const existing = prev.findIndex((f) => f.fieldId === fieldId)
      if (existing >= 0) {
        const next = [...prev]
        next[existing] = filter
        return next
      }
      return [...prev, filter]
    })
  }

  const removeCustomFieldFilter = (fieldId: string) => {
    setDraftCustomFieldFilters((prev) => prev.filter((f) => f.fieldId !== fieldId))
  }

  const activeFilterCount =
    currentFilters.tagIds.length +
    currentFilters.statusConfigIds.length +
    currentFilters.assignedToUserIds.length +
    currentFilters.customFieldFilters.filter((f) => {
      if (f.type === "text") return Boolean(f.text)
      if (f.type === "number" || f.type === "currency") return f.min !== undefined || f.max !== undefined
      if (f.type === "date") return Boolean(f.dateFrom || f.dateTo)
      if (f.type === "select" || f.type === "multi_select") return Boolean(f.values && f.values.length > 0)
      if (f.type === "checkbox") return f.checked !== undefined
      return false
    }).length

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            Filter opportunities by tags, status, assignee, and custom fields.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          {/* Status Filters */}
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-slate-900">Contact Status</Label>
              <p className="text-xs text-slate-500">
                Show opportunities for contacts with any selected status.
              </p>
            </div>

            {statusOptions.length ? (
              <div className="space-y-2">
                {statusOptions.map((option) => {
                  const checked = draftStatusConfigIds.includes(option.id)
                  return (
                    <label
                      key={option.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-slate-50"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleStatus(option.id)}
                      />
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={
                          option.bgColor && option.textColor
                            ? { backgroundColor: option.bgColor, color: option.textColor }
                            : undefined
                        }
                      >
                        {option.name}
                      </span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No status filters available.</p>
            )}
          </section>

          {/* Tag Filters */}
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-slate-900">Tags</Label>
              <p className="text-xs text-slate-500">
                Show opportunities for contacts with any selected tag.
              </p>
            </div>

            {tagOptions.length ? (
              <div className="space-y-2">
                {tagOptions.map((option) => {
                  const checked = draftTagIds.includes(option.id)
                  return (
                    <label
                      key={option.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-slate-50"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleTag(option.id)}
                      />
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={
                          option.bgColor && option.textColor
                            ? { backgroundColor: option.bgColor, color: option.textColor }
                            : undefined
                        }
                      >
                        {option.name}
                      </span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No tag filters available.</p>
            )}
          </section>

          {/* Assignee Filters */}
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-slate-900">Assigned To</Label>
              <p className="text-xs text-slate-500">
                Show opportunities assigned to any selected user.
              </p>
            </div>

            {assigneeOptions.length ? (
              <div className="space-y-2">
                {assigneeOptions.map((option) => {
                  const checked = draftAssignedToUserIds.includes(option.userId)
                  return (
                    <label
                      key={option.userId}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-slate-50"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleAssignee(option.userId)}
                      />
                      <span className="text-sm text-slate-700">{option.name}</span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No assignee filters available.</p>
            )}
          </section>

          {/* Custom Field Filters */}
          {customFieldOptions.length > 0 && (
            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="space-y-1">
                <Label className="text-sm font-semibold text-slate-900">Custom Fields</Label>
                <p className="text-xs text-slate-500">
                  Filter by custom field values on contacts.
                </p>
              </div>

              <div className="space-y-4">
                {customFieldOptions.map((field) => {
                  const existingFilter = draftCustomFieldFilters.find(
                    (f) => f.fieldId === field.id,
                  )
                  const hasActiveFilter = Boolean(existingFilter)

                  return (
                    <div key={field.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium text-slate-700">
                          {field.label}
                        </Label>
                        {hasActiveFilter && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-slate-400 hover:text-slate-600"
                            onClick={() => removeCustomFieldFilter(field.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>

                      {/* Text, Textarea, Phone, Number fields */}
                      {(field.fieldType === "TEXT" ||
                        field.fieldType === "TEXTAREA" ||
                        field.fieldType === "PHONE") && (
                        <Input
                          value={existingFilter?.text ?? ""}
                          onChange={(e) =>
                            updateCustomFieldFilter(field.id, {
                              fieldId: field.id,
                              type: "text",
                              text: e.target.value || undefined,
                            })
                          }
                          placeholder={`Filter by ${field.label.toLowerCase()}...`}
                          className="h-9 text-sm"
                        />
                      )}

                      {/* Number field */}
                      {field.fieldType === "NUMBER" && (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            value={existingFilter?.min ?? ""}
                            onChange={(e) =>
                              updateCustomFieldFilter(field.id, {
                                fieldId: field.id,
                                type: "number",
                                min: e.target.value ? Number(e.target.value) : undefined,
                                max: existingFilter?.max,
                              })
                            }
                            placeholder="Min"
                            className="h-9 text-sm"
                          />
                          <span className="text-xs text-slate-400">to</span>
                          <Input
                            type="number"
                            value={existingFilter?.max ?? ""}
                            onChange={(e) =>
                              updateCustomFieldFilter(field.id, {
                                fieldId: field.id,
                                type: "number",
                                min: existingFilter?.min,
                                max: e.target.value ? Number(e.target.value) : undefined,
                              })
                            }
                            placeholder="Max"
                            className="h-9 text-sm"
                          />
                        </div>
                      )}

                      {/* Currency field */}
                      {field.fieldType === "CURRENCY" && (
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                              $
                            </span>
                            <Input
                              type="number"
                              value={existingFilter?.min ?? ""}
                              onChange={(e) =>
                                updateCustomFieldFilter(field.id, {
                                  fieldId: field.id,
                                  type: "currency",
                                  min: e.target.value ? Number(e.target.value) : undefined,
                                  max: existingFilter?.max,
                                })
                              }
                              placeholder="Min"
                              className="h-9 pl-7 text-sm"
                            />
                          </div>
                          <span className="text-xs text-slate-400">to</span>
                          <div className="relative flex-1">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                              $
                            </span>
                            <Input
                              type="number"
                              value={existingFilter?.max ?? ""}
                              onChange={(e) =>
                                updateCustomFieldFilter(field.id, {
                                  fieldId: field.id,
                                  type: "currency",
                                  min: existingFilter?.min,
                                  max: e.target.value ? Number(e.target.value) : undefined,
                                })
                              }
                              placeholder="Max"
                              className="h-9 pl-7 text-sm"
                            />
                          </div>
                        </div>
                      )}

                      {/* Date field */}
                      {field.fieldType === "DATE" && (
                        <div className="flex items-center gap-2">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                className={cn(
                                  "h-9 flex-1 justify-start text-left text-sm font-normal",
                                  !existingFilter?.dateFrom && "text-slate-400",
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {existingFilter?.dateFrom
                                  ? format(new Date(existingFilter.dateFrom), "MMM d, yyyy")
                                  : "From date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={
                                  existingFilter?.dateFrom
                                    ? new Date(existingFilter.dateFrom)
                                    : undefined
                                }
                                onSelect={(date) =>
                                  updateCustomFieldFilter(field.id, {
                                    fieldId: field.id,
                                    type: "date",
                                    dateFrom: date ? format(date, "yyyy-MM-dd") : undefined,
                                    dateTo: existingFilter?.dateTo,
                                  })
                                }
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <span className="text-xs text-slate-400">to</span>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                className={cn(
                                  "h-9 flex-1 justify-start text-left text-sm font-normal",
                                  !existingFilter?.dateTo && "text-slate-400",
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {existingFilter?.dateTo
                                  ? format(new Date(existingFilter.dateTo), "MMM d, yyyy")
                                  : "To date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={
                                  existingFilter?.dateTo
                                    ? new Date(existingFilter.dateTo)
                                    : undefined
                                }
                                onSelect={(date) =>
                                  updateCustomFieldFilter(field.id, {
                                    fieldId: field.id,
                                    type: "date",
                                    dateFrom: existingFilter?.dateFrom,
                                    dateTo: date ? format(date, "yyyy-MM-dd") : undefined,
                                  })
                                }
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      )}

                      {/* Select field */}
                      {field.fieldType === "SELECT" && (
                        <Select
                          value={existingFilter?.values?.[0] ?? ""}
                          onValueChange={(value) =>
                            updateCustomFieldFilter(field.id, {
                              fieldId: field.id,
                              type: "select",
                              values: value ? [value] : undefined,
                            })
                          }
                        >
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue placeholder="Select an option..." />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {/* Radio field */}
                      {field.fieldType === "RADIO" && (
                        <Select
                          value={existingFilter?.values?.[0] ?? ""}
                          onValueChange={(value) =>
                            updateCustomFieldFilter(field.id, {
                              fieldId: field.id,
                              type: "select",
                              values: value ? [value] : undefined,
                            })
                          }
                        >
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue placeholder="Select an option..." />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {/* Multi-select field */}
                      {field.fieldType === "MULTI_SELECT" && (
                        <div className="space-y-2">
                          {field.options.map((option) => {
                            const checked =
                              existingFilter?.values?.includes(option) ?? false
                            return (
                              <label
                                key={option}
                                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-slate-50"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(nextChecked) => {
                                    const currentValues = existingFilter?.values ?? []
                                    const nextValues = nextChecked
                                      ? [...currentValues, option]
                                      : currentValues.filter((v) => v !== option)
                                    updateCustomFieldFilter(field.id, {
                                      fieldId: field.id,
                                      type: "multi_select",
                                      values: nextValues.length > 0 ? nextValues : undefined,
                                    })
                                  }}
                                />
                                <span className="text-sm text-slate-700">{option}</span>
                              </label>
                            )
                          })}
                        </div>
                      )}

                      {/* Checkbox field */}
                      {field.fieldType === "CHECKBOX" && (
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={existingFilter?.checked ?? false}
                            onCheckedChange={(checked) =>
                              updateCustomFieldFilter(field.id, {
                                fieldId: field.id,
                                type: "checkbox",
                                checked: checked === true ? true : undefined,
                              })
                            }
                          />
                          <span className="text-sm text-slate-700">Enabled</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </div>

        <SheetFooter className="border-t border-slate-200 px-4 py-4">
          <div className="flex w-full items-center justify-between">
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={handleClear}
            >
              Clear All
            </Button>
            <div className="flex items-center gap-2">
              {activeFilterCount > 0 && (
                <Badge className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-900">
                  {activeFilterCount} active
                </Badge>
              )}
              <Button
                type="button"
                className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
                onClick={handleApply}
              >
                Apply Filters
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function FilterButton({
  activeFilterCount,
  onClick,
}: {
  activeFilterCount: number
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={`h-12 cursor-pointer rounded-2xl px-4 transition-all ${
        activeFilterCount > 0
          ? "border-blue-300 bg-blue-50 text-blue-950 hover:bg-blue-100 hover:text-blue-950"
          : "border-blue-200 bg-white text-blue-950 hover:bg-blue-50 hover:text-blue-950"
      }`}
      onClick={onClick}
    >
      <Filter className="h-4 w-4" />
      Filters
      {activeFilterCount > 0 && (
        <Badge className="ml-1.5 h-5 min-w-5 rounded-full bg-blue-950 px-1.5 text-[11px] font-semibold text-white">
          {activeFilterCount}
        </Badge>
      )}
    </Button>
  )
}
