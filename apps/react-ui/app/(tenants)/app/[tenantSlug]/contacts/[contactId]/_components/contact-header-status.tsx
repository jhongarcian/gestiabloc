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
  const selectedStatusStyle =
    status.bgColor && status.textColor
      ? {
          backgroundColor: status.bgColor,
          color: status.textColor,
        }
      : {
          backgroundColor: "#F1F5F9",
          color: "#334155",
        }

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
          role="combobox"
          aria-expanded={open}
          aria-label={`Status: ${status.label}. Change status`}
          disabled={isSaving}
          style={selectedStatusStyle}
          className="h-8 max-w-[220px] cursor-pointer rounded-full border border-black/5 px-3 py-1 shadow-sm transition-[filter,box-shadow] hover:brightness-[0.98] focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f1f7ff] disabled:opacity-70"
        >
          <span className="truncate text-xs font-semibold">
            {status.label}
          </span>
          {isSaving ? (
            <Loader2 data-icon="inline-end" className="shrink-0 animate-spin opacity-70" />
          ) : (
            <ChevronDown data-icon="inline-end" className="shrink-0 opacity-70" />
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
