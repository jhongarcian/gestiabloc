"use client"

import { isAxiosError } from "axios"
import { Check, ChevronDown, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

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

type StatusOption = {
  value: string
  label: string
  bgColor: string | null
  textColor: string | null
}

type ContactHeaderStatusProps = {
  tenantId: string
  contactId: string
  initialStatus: {
    label: string
    value: string | null
    bgColor: string | null
    textColor: string | null
  }
  statusOptions: StatusOption[]
}

export function ContactHeaderStatus({
  tenantId,
  contactId,
  initialStatus,
  statusOptions,
}: ContactHeaderStatusProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState(initialStatus)

  useEffect(() => {
    setStatus(initialStatus)
  }, [initialStatus])

  const selectedValue = status.value ?? "__unassigned__"

  const updateStatus = async (nextStatus: StatusOption | null) => {
    setIsSaving(true)

    try {
      await api.patch(`/api/contacts/${tenantId}/${contactId}/status`, {
        statusConfigId: nextStatus?.value ?? null,
      })

      setStatus({
        label: nextStatus?.label ?? "Unassigned",
        value: nextStatus?.value ?? null,
        bgColor: nextStatus?.bgColor ?? null,
        textColor: nextStatus?.textColor ?? null,
      })
      setOpen(false)
      toast.success("Status updated.")
      router.refresh()
    } catch (error) {
      if (isAxiosError(error) && error.response?.data?.error === "INVALID_STATUS_CONFIG") {
        toast.error("That status is not available.")
      } else {
        toast.error("Could not update status.")
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
          className="h-8 max-w-[220px] cursor-pointer rounded-full border border-white/70 bg-white/70 px-2 py-1 shadow-sm backdrop-blur hover:bg-white/90"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-2.5 shrink-0 rounded-full ring-2 ring-white",
              !status.bgColor && "bg-slate-400",
            )}
            style={status.bgColor ? { backgroundColor: status.bgColor } : undefined}
          />
          <span className="truncate text-xs font-medium text-slate-700">
            {status.label}
          </span>
          {isSaving ? (
            <Loader2 className="ml-1 size-3.5 shrink-0 animate-spin text-slate-500" />
          ) : (
            <ChevronDown className="ml-1 size-3.5 shrink-0 text-slate-500" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder="Update status..." />
          <CommandList>
            <CommandEmpty>No statuses found.</CommandEmpty>
            {statusOptions.map((option) => (
              <CommandItem
                key={option.value}
                onSelect={() => {
                  if (isSaving || selectedValue === option.value) return
                  void updateStatus(option)
                }}
                className="cursor-pointer gap-2 px-3 py-2"
              >
                <span
                  className="inline-flex rounded-full px-2 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/5"
                  style={
                    option.bgColor && option.textColor
                      ? {
                          backgroundColor: option.bgColor,
                          color: option.textColor,
                        }
                      : undefined
                  }
                >
                  {option.label}
                </span>
                <span className="min-w-0 flex-1" />
                <Check
                  className={cn(
                    "h-4 w-4 text-blue-950",
                    selectedValue === option.value ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
