"use client"

import { isAxiosError } from "axios"
import { Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/lib/api"

type DeleteTaskDialogProps = {
  tenantId: string
  tenantSlug: string
  taskId: string
  taskName: string
}

export function DeleteTaskDialog({
  tenantId,
  tenantSlug,
  taskId,
  taskName,
}: DeleteTaskDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDeleteTask = async () => {
    setIsDeleting(true)

    try {
      await api.delete(`/api/tasks/${tenantId}/${taskId}`)
      toast.success("Task deleted.")
      setOpen(false)
      router.push(`/app/${tenantSlug}/tasks`)
      router.refresh()
    } catch (error) {
      if (isAxiosError(error) && error.response?.data?.error === "TASK_NOT_FOUND") {
        toast.error("This task no longer exists.")
        router.push(`/app/${tenantSlug}/tasks`)
        return
      }

      toast.error("Could not delete task.")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={120}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                type="button"
                size="icon"
                aria-label="Delete task"
                className="h-8 w-8 cursor-pointer rounded-full border border-white/70 bg-blue-950 text-white shadow-sm backdrop-blur transition hover:bg-blue-900"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            Delete task
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Task</DialogTitle>
          <DialogDescription>
            This will permanently delete <span className="font-medium text-slate-900">{taskName}</span>
            {" "}and its reminders.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleDeleteTask()}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
