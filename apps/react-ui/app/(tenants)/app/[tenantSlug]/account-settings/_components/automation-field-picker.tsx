"use client"

import { useRef, useState } from "react"
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ChevronsUpDown,
  ListChecks,
  Plus,
  UserRound,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type AutomationFieldPickerOption = {
  value: string
  label: string
  searchText?: string
}

type FieldCategory = "CONTACT" | "CUSTOM_FIELD"

type AutomationFieldPickerProps = {
  value?: string
  contactFields: AutomationFieldPickerOption[]
  customFields: AutomationFieldPickerOption[]
  onValueChange: (value: string) => void
  ariaLabel: string
  mode?: "select" | "add"
  disabled?: boolean
}

const SELECT_TRIGGER_CLASS =
  "h-8 w-full cursor-pointer justify-between rounded-full border-slate-200 bg-white px-3 text-sm font-normal text-slate-700 shadow-sm hover:bg-white hover:text-slate-950"

const SECONDARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

function categoryForValue(value?: string): FieldCategory | null {
  if (value?.startsWith("contact:")) return "CONTACT"
  if (value?.startsWith("custom:")) return "CUSTOM_FIELD"
  return null
}

export function AutomationFieldPicker({
  value,
  contactFields,
  customFields,
  onValueChange,
  ariaLabel,
  mode = "select",
  disabled = false,
}: AutomationFieldPickerProps) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<FieldCategory | null>(null)
  const contactCategoryRef = useRef<HTMLButtonElement>(null)
  const customCategoryRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selectedOption = [...contactFields, ...customFields].find((option) => option.value === value)
  const activeFields = category === "CONTACT" ? contactFields : customFields
  const categoryLabel = category === "CONTACT" ? "Contact fields" : "Custom fields"

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) setCategory(categoryForValue(value))
  }

  const selectField = (fieldValue: string) => {
    onValueChange(fieldValue)
    setOpen(false)
  }

  const selectCategory = (nextCategory: FieldCategory) => {
    setCategory(nextCategory)
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }

  const showCategories = () => {
    setCategory(null)
    requestAnimationFrame(() => {
      const target = contactFields.length > 0 ? contactCategoryRef.current : customCategoryRef.current
      target?.focus()
    })
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        {mode === "add" ? (
          <Button
            type="button"
            variant="outline"
            className={cn(SECONDARY_BUTTON_CLASS, "w-full")}
            disabled={disabled}
            aria-label={ariaLabel}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add field
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            className={SELECT_TRIGGER_CLASS}
            disabled={disabled}
          >
            <span className="min-w-0 truncate">{selectedOption?.label ?? "Select field"}</span>
            <ChevronsUpDown className="shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-1.5"
        onOpenAutoFocus={(event) => {
          if (!categoryForValue(value)) return
          event.preventDefault()
          requestAnimationFrame(() => searchInputRef.current?.focus())
        }}
      >
        {category === null ? (
          <div className="space-y-1" role="group" aria-label="Field category">
            <Button
              ref={contactCategoryRef}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start rounded-lg px-2.5 py-2 text-left"
              disabled={contactFields.length === 0}
              onClick={() => selectCategory("CONTACT")}
            >
              <UserRound className="text-slate-500" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-800">Contact fields</span>
                <span className="block text-xs font-normal text-slate-500">
                  {contactFields.length} available
                </span>
              </span>
              <ChevronRight className="text-slate-400" aria-hidden="true" />
            </Button>
            <Button
              ref={customCategoryRef}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start rounded-lg px-2.5 py-2 text-left"
              disabled={customFields.length === 0}
              onClick={() => selectCategory("CUSTOM_FIELD")}
            >
              <ListChecks className="text-slate-500" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-800">Custom fields</span>
                <span className="block text-xs font-normal text-slate-500">
                  {customFields.length} available
                </span>
              </span>
              <ChevronRight className="text-slate-400" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-200 p-2">
              <Button
                type="button"
                variant="outline"
                className="size-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white p-0 text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-950"
                aria-label="Back to field categories"
                onClick={showCategories}
              >
                <ArrowLeft aria-hidden="true" />
              </Button>
              <span className="min-w-0 truncate text-sm font-semibold text-slate-800">
                {categoryLabel}
              </span>
            </div>
            <Command key={category}>
              <CommandInput
                ref={searchInputRef}
                placeholder={`Search ${categoryLabel.toLocaleLowerCase()}`}
              />
              <CommandList className="max-h-56">
                <CommandEmpty>No fields found.</CommandEmpty>
                <CommandGroup>
                  {activeFields.map((field) => (
                    <CommandItem
                      key={field.value}
                      value={`${field.label} ${field.searchText ?? ""}`}
                      onSelect={() => selectField(field.value)}
                    >
                      <Check
                        className={cn("size-4", value === field.value ? "opacity-100" : "opacity-0")}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{field.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
