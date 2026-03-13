"use client"

import { isAxiosError } from "axios"
import { Check, ChevronDown, Loader2, UserRound, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type AssigneeOption = {
  value: string
  label: string
  email: string
  image: string | null
}

type ContactHeaderAssigneeProps = {
  tenantId: string
  contactId: string
  initialAssignedTo: {
    userId: string
    name: string
    email: string
    image: string | null
  } | null
  assigneeOptions: AssigneeOption[]
}

function getInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

export function ContactHeaderAssignee({
  tenantId,
  contactId,
  initialAssignedTo,
  assigneeOptions,
}: ContactHeaderAssigneeProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [assignedTo, setAssignedTo] = useState(initialAssignedTo)

  useEffect(() => {
    setAssignedTo(initialAssignedTo)
  }, [initialAssignedTo])

  const selectedValue = assignedTo?.userId ?? "__unassigned__"
  const updateAssignee = async (nextAssignee: AssigneeOption | null) => {
    setIsSaving(true)

    try {
      await api.patch(`/api/contacts/${tenantId}/${contactId}/assignee`, {
        assignedToUserId: nextAssignee?.value ?? null,
      })

      setAssignedTo(
        nextAssignee
          ? {
              userId: nextAssignee.value,
              name: nextAssignee.label,
              email: nextAssignee.email,
              image: nextAssignee.image,
            }
          : null,
      )
      setOpen(false)
      toast.success(nextAssignee ? "Assignee updated." : "Contact unassigned.")
      router.refresh()
    } catch (error) {
      if (isAxiosError(error) && error.response?.data?.error === "INVALID_ASSIGNEE") {
        toast.error("That user is not available to assign.")
      } else {
        toast.error("Could not update assignee.")
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-8 max-w-[220px] cursor-pointer rounded-full border border-white/70 bg-white/60 px-2 py-1 shadow-sm backdrop-blur hover:bg-white/80"
        >
          {assignedTo ? (
            <div className="flex min-w-0 max-w-full items-center gap-2">
              <Avatar className="h-5 w-5 shrink-0">
                <AvatarImage
                  src={assignedTo.image ?? undefined}
                  alt={assignedTo.name}
                />
                <AvatarFallback className="bg-blue-950 text-[10px] font-semibold text-white">
                  {getInitials(assignedTo.name)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-xs font-medium text-slate-700">
                {assignedTo.name}
              </span>
            </div>
          ) : (
            <div className="flex min-w-0 max-w-full items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <UserRound className="h-3.5 w-3.5" />
              </span>
              <span className="truncate text-xs font-medium text-slate-600">
                Unassigned
              </span>
            </div>
          )}
          {isSaving ? (
            <Loader2 className="ml-1 h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" />
          ) : (
            <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[320px] p-0">
        <Command>
          <CommandInput placeholder="Assign contact to..." />
          <CommandList>
            <CommandEmpty>No users found.</CommandEmpty>
            <CommandItem
              onSelect={() => {
                if (isSaving || !assignedTo) return
                void updateAssignee(null)
              }}
              className="cursor-pointer gap-3 px-3 py-3"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <UserRound className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">Unassigned</p>
                <p className="truncate text-xs text-slate-500">
                  Remove the current owner from this contact.
                </p>
              </div>
              {selectedValue === "__unassigned__" ? (
                <Check className="h-4 w-4 text-blue-950" />
              ) : null}
            </CommandItem>

            {assigneeOptions.map((assignee) => (
              <CommandItem
                key={assignee.value}
                onSelect={() => {
                  if (isSaving || selectedValue === assignee.value) return
                  void updateAssignee(assignee)
                }}
                className="cursor-pointer gap-3 px-3 py-3"
              >
                <Avatar className="h-9 w-9">
                  <AvatarImage src={assignee.image ?? undefined} alt={assignee.label} />
                  <AvatarFallback className="bg-blue-950 text-xs font-semibold text-white">
                    {getInitials(assignee.label)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{assignee.label}</p>
                  <p className="truncate text-xs text-slate-500">{assignee.email}</p>
                </div>
                <Check
                  className={cn(
                    "h-4 w-4 text-blue-950",
                    selectedValue === assignee.value ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>
            ))}
          </CommandList>
        </Command>

        {assignedTo ? (
          <div className="border-t border-slate-200 p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full cursor-pointer justify-start text-slate-600 hover:text-slate-950"
              onClick={() => void updateAssignee(null)}
              disabled={isSaving}
            >
              <X className="h-4 w-4" />
              Unassign contact
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
