"use client"

import { Check, ChevronDown } from "lucide-react"
import { useMemo, useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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

export const UNASSIGNED_TASK_VALUE = "__UNASSIGNED__"

export type TaskAssigneeOption = {
  value: string
  label: string
  email?: string
  image?: string | null
}

type TaskAssigneeInputProps = {
  id: string
  value: string
  onValueChange: (value: string) => void
  options: TaskAssigneeOption[]
  disabled?: boolean
  ariaInvalid?: boolean
}

function getInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

  return initials || "?"
}

export function TaskAssigneeInput({
  id,
  value,
  onValueChange,
  options,
  disabled = false,
  ariaInvalid = false,
}: TaskAssigneeInputProps) {
  const [open, setOpen] = useState(false)
  const selectedAssignee = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )

  const selectValue = (nextValue: string) => {
    onValueChange(nextValue)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-expanded={open}
          className="h-11 w-full justify-between rounded-xl border-blue-100 bg-white px-3 shadow-none hover:bg-white focus-visible:border-blue-400 focus-visible:ring-blue-100"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Avatar size="sm" className="ring-2 ring-blue-50">
              {selectedAssignee?.image ? (
                <AvatarImage
                  src={selectedAssignee.image}
                  alt={`${selectedAssignee.label} profile photo`}
                />
              ) : null}
              <AvatarFallback className="bg-blue-950 font-semibold text-white">
                {selectedAssignee ? getInitials(selectedAssignee.label) : "—"}
              </AvatarFallback>
            </Avatar>
            <span className="truncate font-medium text-slate-800">
              {selectedAssignee?.label ?? "Not assigned"}
            </span>
          </span>
          <ChevronDown data-icon="inline-end" className="ml-auto text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder="Search team members..." disabled={disabled} />
          <CommandList>
            <CommandEmpty>No team members found.</CommandEmpty>
            <CommandGroup heading="Assignment">
              <CommandItem
                value="Not assigned unassigned"
                onSelect={() => selectValue(UNASSIGNED_TASK_VALUE)}
                className="cursor-pointer gap-3 py-2.5"
              >
                <Avatar size="sm">
                  <AvatarFallback className="bg-slate-100 font-semibold text-slate-500">
                    —
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 font-medium text-slate-700">
                  Not assigned
                </span>
                <Check
                  className={cn(
                    value === UNASSIGNED_TASK_VALUE
                      ? "text-blue-800 opacity-100"
                      : "opacity-0",
                  )}
                />
              </CommandItem>

              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.email ?? ""} ${option.value}`}
                  onSelect={() => selectValue(option.value)}
                  className="cursor-pointer gap-3 py-2.5"
                >
                  <Avatar size="sm" className="ring-2 ring-blue-50">
                    {option.image ? (
                      <AvatarImage
                        src={option.image}
                        alt={`${option.label} profile photo`}
                      />
                    ) : null}
                    <AvatarFallback className="bg-blue-950 font-semibold text-white">
                      {getInitials(option.label)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-slate-900">
                      {option.label}
                    </span>
                    {option.email ? (
                      <span className="truncate text-xs text-slate-500">
                        {option.email}
                      </span>
                    ) : null}
                  </span>
                  <Check
                    className={cn(
                      value === option.value
                        ? "text-blue-800 opacity-100"
                        : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
