"use client"

import Link from "next/link"
import { ListTodo, NotebookPen, ShoppingBag } from "lucide-react"
import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CreateAppointmentDialog } from "../../../calendar/_components/create-appointment-dialog"
import { CreateContactNoteDialog } from "../../_components/create-contact-note-dialog"
import { AddContactOpportunityDialog } from "../../../opportunities/_components/add-contact-opportunity-dialog"
import { CreateTaskDialog } from "../../../tasks/_components/create-task-dialog"
import { ContactHeaderAssignee } from "./contact-header-assignee"
import { ContactHeaderStatus } from "./contact-header-status"

type InitialContact = NonNullable<
  ComponentProps<typeof AddContactOpportunityDialog>["initialContact"]
>

type ContactHeaderActionsProps = {
  tenantId: string
  tenantSlug: string
  contactId: string
  tenantTimezone: string | null
  currentUserId: string
  initialContact: InitialContact
  meetingIntervalMinutes: ComponentProps<
    typeof CreateAppointmentDialog
  >["meetingIntervalMinutes"]
  meetingDurationMinutes: ComponentProps<
    typeof CreateAppointmentDialog
  >["meetingDurationMinutes"]
  calendarServiceOptions: ComponentProps<
    typeof CreateAppointmentDialog
  >["serviceOptions"]
  calendarAssigneeOptions: ComponentProps<
    typeof CreateAppointmentDialog
  >["assigneeOptions"]
  taskStatusOptions: ComponentProps<typeof CreateTaskDialog>["statusOptions"]
  taskAssigneeOptions: NonNullable<
    ComponentProps<typeof CreateTaskDialog>["assigneeOptions"]
  >
  initialStatus: ComponentProps<typeof ContactHeaderStatus>["initialStatus"]
  contactStatusOptions: ComponentProps<
    typeof ContactHeaderStatus
  >["statusOptions"]
  initialAssignedTo: ComponentProps<
    typeof ContactHeaderAssignee
  >["initialAssignedTo"]
  contactAssigneeOptions: ComponentProps<
    typeof ContactHeaderAssignee
  >["assigneeOptions"]
}

export function ContactHeaderActions({
  tenantId,
  tenantSlug,
  contactId,
  tenantTimezone,
  currentUserId,
  initialContact,
  meetingIntervalMinutes,
  meetingDurationMinutes,
  calendarServiceOptions,
  calendarAssigneeOptions,
  taskStatusOptions,
  taskAssigneeOptions,
  initialStatus,
  contactStatusOptions,
  initialAssignedTo,
  contactAssigneeOptions,
}: ContactHeaderActionsProps) {
  return (
    <div className="flex w-full max-w-full shrink-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] xl:w-auto xl:justify-end xl:overflow-visible xl:pb-0 [&::-webkit-scrollbar]:hidden">
      <AddContactOpportunityDialog
        tenantId={tenantId}
        initialContact={initialContact}
        lockContact
        iconOnly
        triggerTooltip="Create opportunity"
        triggerClassName="inline-flex h-8 w-8 items-center justify-center border-white/70 shadow-sm backdrop-blur transition hover:bg-blue-900"
      />
      <CreateAppointmentDialog
        tenantId={tenantId}
        tenantTimezone={tenantTimezone}
        currentUserId={currentUserId}
        initialContact={initialContact}
        lockContact
        meetingIntervalMinutes={meetingIntervalMinutes}
        meetingDurationMinutes={meetingDurationMinutes}
        serviceOptions={calendarServiceOptions}
        assigneeOptions={calendarAssigneeOptions}
        iconOnly
        triggerTooltip="Create appointment"
        triggerClassName="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/70 bg-blue-950 text-white shadow-sm backdrop-blur transition hover:bg-blue-900"
      />
      <CreateTaskDialog
        tenantId={tenantId}
        tenantTimezone={tenantTimezone}
        statusOptions={taskStatusOptions}
        assigneeOptions={taskAssigneeOptions}
        initialContact={initialContact}
        lockContact
        hideContact
        triggerTooltip="Create task"
        trigger={
          <Button
            type="button"
            size="icon"
            aria-label="Create task"
            className="h-8 w-8 cursor-pointer rounded-full border border-white/70 bg-blue-950 text-white shadow-sm backdrop-blur transition hover:bg-blue-900"
          >
            <ListTodo className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <CreateContactNoteDialog
        tenantId={tenantId}
        contactId={contactId}
        presentation="drawer"
        triggerTooltip="Add note"
        trigger={
          <Button
            type="button"
            size="icon"
            aria-label="Add note"
            className="h-8 w-8 cursor-pointer rounded-full border border-white/70 bg-blue-950 text-white shadow-sm backdrop-blur transition hover:bg-blue-900"
          >
            <NotebookPen className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <TooltipProvider delayDuration={120}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              size="icon"
              className="h-8 w-8 cursor-pointer rounded-full border border-white/70 bg-blue-950 text-white shadow-sm backdrop-blur transition hover:bg-blue-900"
            >
              <Link
                href={`/app/${tenantSlug}/contacts/${contactId}/services?create=1`}
                aria-label="Purchase service"
              >
                <ShoppingBag className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            Purchase service
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <ContactHeaderStatus
        tenantId={tenantId}
        contactId={contactId}
        initialStatus={initialStatus}
        statusOptions={contactStatusOptions}
      />
      <ContactHeaderAssignee
        tenantId={tenantId}
        contactId={contactId}
        initialAssignedTo={initialAssignedTo}
        assigneeOptions={contactAssigneeOptions}
      />
    </div>
  )
}
