"use client"

import { isAxiosError } from "axios"
import { CalendarClock, CalendarX2, Clock3, LoaderCircle, Trash2, UserRound } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DateTimeInput } from "@/components/ui/date-time-input"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import {
  type DateTimeDraft,
  dateTimeDraftToUtcIso,
  formatDateTimeForDisplay,
  formatUtcIsoToDateTimeDraft,
  isDateTimeDraftComplete,
} from "@/lib/date-time"

type CalendarConfigPanelProps = {
  tenantId: string
  tenantSlug: string
}

type WeeklyAvailabilityItem = {
  dayOfWeek: number
  enabled: boolean
  startTime: string
  endTime: string
}

type CalendarBlockItem = {
  id: string
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  isAllDay: boolean
  createdAt: string
  updatedAt: string
}

type CalendarStaffMember = {
  id: string
  label: string
  email: string
  image: string | null
  role: string
  enabled: boolean
  color: string | null
}

type CalendarStaffGroup = {
  id: string
  name: string
  description: string | null
  members: Array<{
    userId: string
    label: string
    email: string
    image: string | null
    color: string | null
  }>
}

type CalendarBookingRules = {
  meetingIntervalMinutes: 15 | 30 | 45 | 60 | 120
  meetingDurationMinutes: 15 | 30 | 45 | 60 | 120
  minimumScheduleNoticeMinutes: number
  maximumBookingsPerDay: number | null
  maximumBookingsPerSlot: number
  preBufferMinutes: number
  postBufferMinutes: number
  bufferAvailabilityMode: "BUSY" | "UNAVAILABLE"
}

type CalendarConfigResponse = {
  ok: boolean
  timezone: string | null
  bookingRules: CalendarBookingRules
  weeklyAvailability: WeeklyAvailabilityItem[]
  blocks: CalendarBlockItem[]
  staff: CalendarStaffMember[]
  groups: CalendarStaffGroup[]
}

type UserCalendarResponse = {
  ok: boolean
  user: CalendarStaffMember
  weeklyAvailability: WeeklyAvailabilityItem[]
  blocks: CalendarBlockItem[]
}

const DAYS = [
  { dayOfWeek: 1, label: "Monday" },
  { dayOfWeek: 2, label: "Tuesday" },
  { dayOfWeek: 3, label: "Wednesday" },
  { dayOfWeek: 4, label: "Thursday" },
  { dayOfWeek: 5, label: "Friday" },
  { dayOfWeek: 6, label: "Saturday" },
  { dayOfWeek: 0, label: "Sunday" },
] as const

const SLOT_OPTIONS = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
] as const

const BUFFER_MODE_OPTIONS = [
  {
    value: "BUSY" as const,
    label: "Keep Busy",
    description: "Buffer time behaves like occupied time around the appointment.",
  },
  {
    value: "UNAVAILABLE" as const,
    label: "Mark Unavailable",
    description: "Buffer time is treated as fully unavailable around the appointment.",
  },
] as const

const DEFAULT_START_TIME = "09:00"
const DEFAULT_END_TIME = "17:00"
const STAFF_COLOR_PALETTE = [
  "#1d4ed8",
  "#0f766e",
  "#7c3aed",
  "#c2410c",
  "#be123c",
  "#15803d",
  "#1e40af",
  "#4338ca",
] as const

function normalizeCalendarConfigResponse(
  data: Partial<CalendarConfigResponse> | null | undefined,
): CalendarConfigResponse {
  return {
    ok: data?.ok ?? true,
    timezone: data?.timezone ?? null,
    bookingRules: {
      meetingIntervalMinutes: data?.bookingRules?.meetingIntervalMinutes ?? 30,
      meetingDurationMinutes: data?.bookingRules?.meetingDurationMinutes ?? 30,
      minimumScheduleNoticeMinutes: data?.bookingRules?.minimumScheduleNoticeMinutes ?? 0,
      maximumBookingsPerDay: data?.bookingRules?.maximumBookingsPerDay ?? null,
      maximumBookingsPerSlot: data?.bookingRules?.maximumBookingsPerSlot ?? 1,
      preBufferMinutes: data?.bookingRules?.preBufferMinutes ?? 0,
      postBufferMinutes: data?.bookingRules?.postBufferMinutes ?? 0,
      bufferAvailabilityMode: data?.bookingRules?.bufferAvailabilityMode ?? "BUSY",
    },
    weeklyAvailability: Array.isArray(data?.weeklyAvailability) ? data.weeklyAvailability : [],
    blocks: Array.isArray(data?.blocks) ? data.blocks : [],
    staff: Array.isArray(data?.staff) ? data.staff : [],
    groups: Array.isArray(data?.groups) ? data.groups : [],
  }
}

function normalizeUserCalendarResponse(
  data: Partial<UserCalendarResponse> | null | undefined,
): UserCalendarResponse {
  return {
    ok: data?.ok ?? true,
    user: data?.user ?? {
      id: "",
      label: "",
      email: "",
      image: null,
      role: "",
      enabled: false,
      color: null,
    },
    weeklyAvailability: Array.isArray(data?.weeklyAvailability) ? data.weeklyAvailability : [],
    blocks: Array.isArray(data?.blocks) ? data.blocks : [],
  }
}

function buildDefaultWeeklyAvailability() {
  return DAYS.map(({ dayOfWeek }) => ({
    dayOfWeek,
    enabled: dayOfWeek >= 1 && dayOfWeek <= 5,
    startTime: DEFAULT_START_TIME,
    endTime: DEFAULT_END_TIME,
  }))
}

function buildBackendErrorMessage(error: unknown, fallback: string) {
  if (!isAxiosError(error)) return fallback
  const backendError = error.response?.data?.error
  return typeof backendError === "string"
    ? backendError.replace(/_/g, " ")
    : fallback
}

function coerceNullablePositiveInteger(value: string) {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return null

  return Math.round(parsed)
}

function WeeklyAvailabilityEditor({
  value,
  onChange,
  description,
}: {
  value: WeeklyAvailabilityItem[]
  onChange: (dayOfWeek: number, patch: Partial<WeeklyAvailabilityItem>) => void
  description: (enabled: boolean) => string
}) {
  return (
    <div className="grid gap-3">
      {DAYS.map((day) => {
        const item = value.find((entry) => entry.dayOfWeek === day.dayOfWeek)
        if (!item) return null

        return (
          <div
            key={day.dayOfWeek}
            className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-[160px_minmax(0,1fr)_160px_160px]"
          >
            <div className="flex items-center gap-3">
              <Checkbox
                checked={item.enabled}
                onCheckedChange={(checked) =>
                  onChange(day.dayOfWeek, { enabled: Boolean(checked) })
                }
              />
              <span className="font-medium text-slate-900">{day.label}</span>
            </div>

            <p className="flex items-center text-sm text-slate-500">
              {description(item.enabled)}
            </p>

            <div className="space-y-1">
              <Label htmlFor={`calendar-start-${day.dayOfWeek}`}>Start</Label>
              <Input
                id={`calendar-start-${day.dayOfWeek}`}
                type="time"
                value={item.startTime}
                disabled={!item.enabled}
                onChange={(event) =>
                  onChange(day.dayOfWeek, { startTime: event.target.value })
                }
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor={`calendar-end-${day.dayOfWeek}`}>End</Label>
              <Input
                id={`calendar-end-${day.dayOfWeek}`}
                type="time"
                value={item.endTime}
                disabled={!item.enabled}
                onChange={(event) =>
                  onChange(day.dayOfWeek, { endTime: event.target.value })
                }
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BlockList({
  blocks,
  timezone,
  emptyTitle,
  emptyDescription,
  deletingBlockId,
  onDelete,
}: {
  blocks: CalendarBlockItem[]
  timezone: string | null
  emptyTitle: string
  emptyDescription: string
  deletingBlockId: string | null
  onDelete: (blockId: string) => void
}) {
  if (blocks.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <p className="font-medium text-slate-900">{emptyTitle}</p>
        <p className="mt-1 text-sm text-slate-500">{emptyDescription}</p>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {blocks.map((block) => (
        <article
          key={block.id}
          className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CalendarX2 className="h-4 w-4 text-slate-500" />
                <h4 className="font-semibold text-slate-950">{block.title}</h4>
              </div>
              <p className="text-sm text-slate-600">
                {formatDateTimeForDisplay(block.startsAt, timezone)} to{" "}
                {formatDateTimeForDisplay(block.endsAt, timezone)}
              </p>
              {block.description ? (
                <p className="text-sm leading-6 text-slate-500">{block.description}</p>
              ) : null}
            </div>

            <Button
              type="button"
              variant="outline"
              disabled={deletingBlockId === block.id}
              onClick={() => onDelete(block.id)}
              className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {deletingBlockId === block.id ? "Removing..." : "Remove"}
            </Button>
          </div>
        </article>
      ))}
    </div>
  )
}

export function CalendarConfigPanel({
  tenantId,
  tenantSlug,
}: CalendarConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<"staff" | "availability" | "booking-rules">("staff")
  const [timezone, setTimezone] = useState<string | null>(null)
  const [bookingRules, setBookingRules] = useState<CalendarBookingRules>({
    meetingIntervalMinutes: 30,
    meetingDurationMinutes: 30,
    minimumScheduleNoticeMinutes: 0,
    maximumBookingsPerDay: null,
    maximumBookingsPerSlot: 1,
    preBufferMinutes: 0,
    postBufferMinutes: 0,
    bufferAvailabilityMode: "BUSY",
  })
  const [weeklyAvailability, setWeeklyAvailability] = useState<WeeklyAvailabilityItem[]>(
    buildDefaultWeeklyAvailability(),
  )
  const [blocks, setBlocks] = useState<CalendarBlockItem[]>([])
  const [staffMembers, setStaffMembers] = useState<CalendarStaffMember[]>([])
  const [staffGroups, setStaffGroups] = useState<CalendarStaffGroup[]>([])
  const [staffSearch, setStaffSearch] = useState("")
  const [selectedUserId, setSelectedUserId] = useState("")
  const [selectedUser, setSelectedUser] = useState<CalendarStaffMember | null>(null)
  const [userWeeklyAvailability, setUserWeeklyAvailability] = useState<WeeklyAvailabilityItem[]>(
    buildDefaultWeeklyAvailability(),
  )
  const [userBlocks, setUserBlocks] = useState<CalendarBlockItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingUserSchedule, setIsLoadingUserSchedule] = useState(false)
  const [isSavingAccountSettings, setIsSavingAccountSettings] = useState(false)
  const [isSavingStaff, setIsSavingStaff] = useState(false)
  const [isSavingUserSchedule, setIsSavingUserSchedule] = useState(false)
  const [isAccountBlockDialogOpen, setIsAccountBlockDialogOpen] = useState(false)
  const [isUserBlockDialogOpen, setIsUserBlockDialogOpen] = useState(false)
  const [isCreatingAccountBlock, setIsCreatingAccountBlock] = useState(false)
  const [isCreatingUserBlock, setIsCreatingUserBlock] = useState(false)
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState("")
  const [groupDescription, setGroupDescription] = useState("")
  const [groupMemberUserIds, setGroupMemberUserIds] = useState<string[]>([])
  const [isSavingGroup, setIsSavingGroup] = useState(false)
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null)
  const [deletingAccountBlockId, setDeletingAccountBlockId] = useState<string | null>(null)
  const [deletingUserBlockId, setDeletingUserBlockId] = useState<string | null>(null)

  const [accountBlockTitle, setAccountBlockTitle] = useState("")
  const [accountBlockDescription, setAccountBlockDescription] = useState("")
  const [accountBlockStartInput, setAccountBlockStartInput] = useState<DateTimeDraft>({
    date: "",
    time: "",
  })
  const [accountBlockEndInput, setAccountBlockEndInput] = useState<DateTimeDraft>({
    date: "",
    time: "",
  })

  const [userBlockTitle, setUserBlockTitle] = useState("")
  const [userBlockDescription, setUserBlockDescription] = useState("")
  const [userBlockStartInput, setUserBlockStartInput] = useState<DateTimeDraft>({
    date: "",
    time: "",
  })
  const [userBlockEndInput, setUserBlockEndInput] = useState<DateTimeDraft>({
    date: "",
    time: "",
  })

  const resetAccountBlockForm = useCallback(() => {
    setAccountBlockTitle("")
    setAccountBlockDescription("")
    setAccountBlockStartInput(formatUtcIsoToDateTimeDraft(new Date().toISOString(), timezone))
    setAccountBlockEndInput(
      formatUtcIsoToDateTimeDraft(new Date(Date.now() + 60 * 60 * 1000).toISOString(), timezone),
    )
  }, [timezone])

  const resetUserBlockForm = useCallback(() => {
    setUserBlockTitle("")
    setUserBlockDescription("")
    setUserBlockStartInput(formatUtcIsoToDateTimeDraft(new Date().toISOString(), timezone))
    setUserBlockEndInput(
      formatUtcIsoToDateTimeDraft(new Date(Date.now() + 60 * 60 * 1000).toISOString(), timezone),
    )
  }, [timezone])

  const resetGroupForm = useCallback(() => {
    setEditingGroupId(null)
    setGroupName("")
    setGroupDescription("")
    setGroupMemberUserIds([])
  }, [])

  const enabledStaffMembers = useMemo(
    () => staffMembers.filter((staffMember) => staffMember.enabled),
    [staffMembers],
  )

  const filteredStaffMembers = useMemo(() => {
    const query = staffSearch.trim().toLowerCase()
    if (!query) return staffMembers

    return staffMembers.filter((staffMember) =>
      `${staffMember.label} ${staffMember.email}`.toLowerCase().includes(query),
    )
  }, [staffMembers, staffSearch])

  const scheduleSummary = useMemo(() => {
    const activeDays = weeklyAvailability.filter((item) => item.enabled)
    if (activeDays.length === 0) {
      return "No account hours configured."
    }

    return `${activeDays.length} active day${activeDays.length === 1 ? "" : "s"} each week`
  }, [weeklyAvailability])

  const loadConfig = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await api.get<CalendarConfigResponse>(`/api/account-settings/${tenantId}/calendar`)
      const data = normalizeCalendarConfigResponse(response.data)

      setTimezone(data.timezone ?? null)
      setBookingRules(data.bookingRules)
      setWeeklyAvailability(
        DAYS.map(({ dayOfWeek }) => {
          const item = data.weeklyAvailability.find((entry) => entry.dayOfWeek === dayOfWeek)
          return (
            item ?? {
              dayOfWeek,
              enabled: false,
              startTime: DEFAULT_START_TIME,
              endTime: DEFAULT_END_TIME,
            }
          )
        }),
      )
      setBlocks(data.blocks)
      setStaffMembers(data.staff)
      setStaffGroups(data.groups)
      setSelectedUserId((current) => {
        const nextDefault =
          data.staff.find((item) => item.enabled)?.id ?? data.staff[0]?.id ?? ""

        return current && data.staff.some((item) => item.id === current && item.enabled)
          ? current
          : nextDefault
      })
    } catch {
      toast.error("Could not load calendar configuration.")
    } finally {
      setIsLoading(false)
    }
  }, [tenantId])

  const loadUserSchedule = useCallback(async () => {
    if (!selectedUserId) {
      setSelectedUser(null)
      setUserWeeklyAvailability(buildDefaultWeeklyAvailability())
      setUserBlocks([])
      return
    }

    setIsLoadingUserSchedule(true)
    try {
      const response = await api.get<UserCalendarResponse>(
        `/api/account-settings/${tenantId}/calendar/users/${selectedUserId}`,
      )
      const data = normalizeUserCalendarResponse(response.data)

      setSelectedUser(data.user)
      setUserWeeklyAvailability(
        DAYS.map(({ dayOfWeek }) => {
          const item = data.weeklyAvailability.find((entry) => entry.dayOfWeek === dayOfWeek)
          return (
            item ?? {
              dayOfWeek,
              enabled: false,
              startTime: DEFAULT_START_TIME,
              endTime: DEFAULT_END_TIME,
            }
          )
        }),
      )
      setUserBlocks(data.blocks)
    } catch {
      toast.error("Could not load the selected staff availability.")
    } finally {
      setIsLoadingUserSchedule(false)
    }
  }, [selectedUserId, tenantId])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  useEffect(() => {
    void loadUserSchedule()
  }, [loadUserSchedule])

  useEffect(() => {
    if (isAccountBlockDialogOpen) {
      resetAccountBlockForm()
    }
  }, [isAccountBlockDialogOpen, resetAccountBlockForm])

  useEffect(() => {
    if (isUserBlockDialogOpen) {
      resetUserBlockForm()
    }
  }, [isUserBlockDialogOpen, resetUserBlockForm])

  useEffect(() => {
    if (!isGroupDialogOpen) {
      resetGroupForm()
    }
  }, [isGroupDialogOpen, resetGroupForm])

  useEffect(() => {
    if (enabledStaffMembers.length === 0) {
      setSelectedUserId("")
      return
    }

    if (!enabledStaffMembers.some((item) => item.id === selectedUserId)) {
      setSelectedUserId(enabledStaffMembers[0].id)
    }
  }, [enabledStaffMembers, selectedUserId])

  const updateAccountDay = (dayOfWeek: number, patch: Partial<WeeklyAvailabilityItem>) => {
    setWeeklyAvailability((current) =>
      current.map((item) => (item.dayOfWeek === dayOfWeek ? { ...item, ...patch } : item)),
    )
  }

  const updateUserDay = (dayOfWeek: number, patch: Partial<WeeklyAvailabilityItem>) => {
    setUserWeeklyAvailability((current) =>
      current.map((item) => (item.dayOfWeek === dayOfWeek ? { ...item, ...patch } : item)),
    )
  }

  const updateStaffMember = (userId: string, patch: Partial<CalendarStaffMember>) => {
    setStaffMembers((current) =>
      current.map((item, index) => {
        if (item.id !== userId) return item

        const next = { ...item, ...patch }
        if (patch.enabled === true && !next.color) {
          next.color = STAFF_COLOR_PALETTE[index % STAFF_COLOR_PALETTE.length]
        }
        if (patch.enabled === false) {
          next.color = null
        }
        return next
      }),
    )
  }

  const openCreateGroupDialog = () => {
    resetGroupForm()
    setIsGroupDialogOpen(true)
  }

  const openEditGroupDialog = (group: CalendarStaffGroup) => {
    setEditingGroupId(group.id)
    setGroupName(group.name)
    setGroupDescription(group.description ?? "")
    setGroupMemberUserIds(group.members.map((member) => member.userId))
    setIsGroupDialogOpen(true)
  }

  const toggleGroupMember = (userId: string, checked: boolean) => {
    setGroupMemberUserIds((current) =>
      checked ? [...current, userId] : current.filter((value) => value !== userId),
    )
  }

  const onSaveStaff = async () => {
    setIsSavingStaff(true)
    try {
      await api.patch(`/api/account-settings/${tenantId}/calendar/staff`, {
        staff: staffMembers.map((item) => ({
          userId: item.id,
          enabled: item.enabled,
          color: item.enabled ? item.color ?? STAFF_COLOR_PALETTE[0] : null,
        })),
      })
      toast.success("Calendar staff updated.")
      await loadConfig()
    } catch (error) {
      toast.error(buildBackendErrorMessage(error, "Could not save calendar staff."))
    } finally {
      setIsSavingStaff(false)
    }
  }

  const onSaveGroup = async () => {
    if (!groupName.trim()) {
      toast.error("Group name is required.")
      return
    }

    setIsSavingGroup(true)
    try {
      if (editingGroupId) {
        await api.patch(`/api/account-settings/${tenantId}/calendar/groups/${editingGroupId}`, {
          name: groupName.trim(),
          description: groupDescription.trim() || null,
          memberUserIds: groupMemberUserIds,
        })
        toast.success("Calendar group updated.")
      } else {
        await api.post(`/api/account-settings/${tenantId}/calendar/groups`, {
          name: groupName.trim(),
          description: groupDescription.trim() || null,
          memberUserIds: groupMemberUserIds,
        })
        toast.success("Calendar group created.")
      }

      setIsGroupDialogOpen(false)
      await loadConfig()
    } catch (error) {
      toast.error(buildBackendErrorMessage(error, "Could not save calendar group."))
    } finally {
      setIsSavingGroup(false)
    }
  }

  const onDeleteGroup = async (groupId: string) => {
    setDeletingGroupId(groupId)
    try {
      await api.delete(`/api/account-settings/${tenantId}/calendar/groups/${groupId}`)
      toast.success("Calendar group removed.")
      await loadConfig()
    } catch (error) {
      toast.error(buildBackendErrorMessage(error, "Could not remove calendar group."))
    } finally {
      setDeletingGroupId(null)
    }
  }

  const onSaveAccountSettings = async (successMessage: string) => {
    setIsSavingAccountSettings(true)
    try {
      await api.patch(`/api/account-settings/${tenantId}/calendar`, {
        bookingRules,
        weeklyAvailability,
      })
      toast.success(successMessage)
      await loadConfig()
    } catch (error) {
      toast.error(buildBackendErrorMessage(error, "Could not save calendar settings."))
    } finally {
      setIsSavingAccountSettings(false)
    }
  }

  const onSaveUserSchedule = async () => {
    if (!selectedUserId) return

    setIsSavingUserSchedule(true)
    try {
      await api.patch(`/api/account-settings/${tenantId}/calendar/users/${selectedUserId}`, {
        weeklyAvailability: userWeeklyAvailability,
      })
      toast.success("Staff availability updated.")
      await loadUserSchedule()
    } catch (error) {
      toast.error(buildBackendErrorMessage(error, "Could not save staff availability."))
    } finally {
      setIsSavingUserSchedule(false)
    }
  }

  const onCreateAccountBlock = async () => {
    const startsAt = isDateTimeDraftComplete(accountBlockStartInput)
      ? dateTimeDraftToUtcIso(accountBlockStartInput, timezone)
      : null
    const endsAt = isDateTimeDraftComplete(accountBlockEndInput)
      ? dateTimeDraftToUtcIso(accountBlockEndInput, timezone)
      : null

    if (!accountBlockTitle.trim()) {
      toast.error("Block title is required.")
      return
    }

    if (!startsAt || !endsAt) {
      toast.error("Valid start and end date/time are required.")
      return
    }

    setIsCreatingAccountBlock(true)
    try {
      await api.post(`/api/account-settings/${tenantId}/calendar/blocks`, {
        title: accountBlockTitle.trim(),
        description: accountBlockDescription.trim() || null,
        startsAt,
        endsAt,
      })
      toast.success("Account blocked period added.")
      setIsAccountBlockDialogOpen(false)
      await loadConfig()
    } catch (error) {
      toast.error(buildBackendErrorMessage(error, "Could not add blocked period."))
    } finally {
      setIsCreatingAccountBlock(false)
    }
  }

  const onCreateUserBlock = async () => {
    if (!selectedUserId) return

    const startsAt = isDateTimeDraftComplete(userBlockStartInput)
      ? dateTimeDraftToUtcIso(userBlockStartInput, timezone)
      : null
    const endsAt = isDateTimeDraftComplete(userBlockEndInput)
      ? dateTimeDraftToUtcIso(userBlockEndInput, timezone)
      : null

    if (!userBlockTitle.trim()) {
      toast.error("Block title is required.")
      return
    }

    if (!startsAt || !endsAt) {
      toast.error("Valid start and end date/time are required.")
      return
    }

    setIsCreatingUserBlock(true)
    try {
      await api.post(`/api/account-settings/${tenantId}/calendar/users/${selectedUserId}/blocks`, {
        title: userBlockTitle.trim(),
        description: userBlockDescription.trim() || null,
        startsAt,
        endsAt,
      })
      toast.success("Staff blocked period added.")
      setIsUserBlockDialogOpen(false)
      await loadUserSchedule()
    } catch (error) {
      toast.error(buildBackendErrorMessage(error, "Could not add blocked period."))
    } finally {
      setIsCreatingUserBlock(false)
    }
  }

  const onDeleteAccountBlock = async (blockId: string) => {
    setDeletingAccountBlockId(blockId)
    try {
      await api.delete(`/api/account-settings/${tenantId}/calendar/blocks/${blockId}`)
      toast.success("Blocked period removed.")
      await loadConfig()
    } catch (error) {
      toast.error(buildBackendErrorMessage(error, "Could not remove blocked period."))
    } finally {
      setDeletingAccountBlockId(null)
    }
  }

  const onDeleteUserBlock = async (blockId: string) => {
    if (!selectedUserId) return

    setDeletingUserBlockId(blockId)
    try {
      await api.delete(`/api/account-settings/${tenantId}/calendar/users/${selectedUserId}/blocks/${blockId}`)
      toast.success("Blocked period removed.")
      await loadUserSchedule()
    } catch (error) {
      toast.error(buildBackendErrorMessage(error, "Could not remove blocked period."))
    } finally {
      setDeletingUserBlockId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-[24px] border border-slate-200 bg-slate-50">
        <div className="flex items-center gap-3 text-slate-600">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          <span>Loading calendar configuration...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_46%,#fff7ed_100%)]">
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.3fr)_360px] lg:p-7">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                Calendar Admin
              </p>
              <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-slate-950">
                Manage how {tenantSlug} schedules appointments.
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                Choose which staff members appear on the calendar, define their availability, and control the booking rules used by the appointment flow.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge
                variant="secondary"
                className="rounded-full border border-white/70 bg-white/85 px-3 py-1 text-slate-700"
              >
                <Clock3 className="mr-1.5 h-3.5 w-3.5" />
                {timezone?.trim() || "System timezone"}
              </Badge>
              <Badge
                variant="secondary"
                className="rounded-full border border-white/70 bg-white/85 px-3 py-1 text-slate-700"
              >
                <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
                {scheduleSummary}
              </Badge>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Enabled Staff
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                {enabledStaffMembers.length}
              </p>
            </div>
            <div className="rounded-[24px] border border-slate-300/60 bg-slate-950 p-4 text-white shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/90">
                Booking Cadence
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-tight">
                {SLOT_OPTIONS.find((item) => Number(item.value) === bookingRules.meetingIntervalMinutes)?.label ?? `${bookingRules.meetingIntervalMinutes} min`}
              </p>
              <p className="mt-2 text-xs text-slate-300">
                Duration {SLOT_OPTIONS.find((item) => Number(item.value) === bookingRules.meetingDurationMinutes)?.label ?? `${bookingRules.meetingDurationMinutes} min`}
              </p>
            </div>
          </div>
        </div>
      </section>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "staff" | "availability" | "booking-rules")}
        className="space-y-5"
      >
        <div className="overflow-x-auto">
          <TabsList className="inline-flex h-auto min-w-max items-center gap-2 rounded-none bg-transparent p-0">
            {[
              { value: "staff", label: "Staff" },
              { value: "availability", label: "Availability" },
              { value: "booking-rules", label: "Booking Rules" },
            ].map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="inline-flex h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-slate-600 shadow-none transition hover:bg-blue-900/10 hover:text-slate-900 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-none md:text-sm"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="staff" className="mt-0">
          <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-slate-950">
                  Calendar staff
                </h3>
                <p className="text-sm text-slate-600">
                  Search team members, choose who can appear on the calendar, and assign the color used for their appointments.
                </p>
              </div>
              <Button
                type="button"
                onClick={onSaveStaff}
                disabled={isSavingStaff}
                className="bg-slate-950 text-white hover:bg-slate-800"
              >
                {isSavingStaff ? "Saving..." : "Save staff"}
              </Button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="max-w-md">
                <Label htmlFor="calendar-staff-search">Search staff</Label>
                <Input
                  id="calendar-staff-search"
                  placeholder="Search by name or email..."
                  value={staffSearch}
                  onChange={(event) => setStaffSearch(event.target.value)}
                  className="mt-2"
                />
              </div>

              <div className="grid gap-3">
                {filteredStaffMembers.length > 0 ? (
                  filteredStaffMembers.map((staffMember, index) => (
                    <article
                      key={staffMember.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-12 w-12 items-center justify-center rounded-full text-white"
                            style={{ backgroundColor: staffMember.color ?? STAFF_COLOR_PALETTE[index % STAFF_COLOR_PALETTE.length] }}
                          >
                            <UserRound className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-950">{staffMember.label}</p>
                            <p className="text-sm text-slate-500">{staffMember.email}</p>
                          </div>
                        </div>

                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                            <Checkbox
                              checked={staffMember.enabled}
                              onCheckedChange={(checked) =>
                                updateStaffMember(staffMember.id, { enabled: Boolean(checked) })
                              }
                            />
                            <span className="text-sm font-medium text-slate-800">
                              Available on calendar
                            </span>
                          </label>

                          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                            <span className="text-sm font-medium text-slate-800">Color</span>
                            <input
                              type="color"
                              value={staffMember.color ?? STAFF_COLOR_PALETTE[index % STAFF_COLOR_PALETTE.length]}
                              disabled={!staffMember.enabled}
                              onChange={(event) =>
                                updateStaffMember(staffMember.id, { color: event.target.value })
                              }
                              className="h-9 w-11 cursor-pointer rounded border border-slate-200 bg-transparent p-1 disabled:cursor-not-allowed disabled:opacity-40"
                            />
                            <span className="text-xs text-slate-500">
                              {staffMember.enabled
                                ? staffMember.color ?? STAFF_COLOR_PALETTE[index % STAFF_COLOR_PALETTE.length]
                                : "Disabled"}
                            </span>
                          </label>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                    <p className="font-medium text-slate-900">No staff members matched that search.</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Try a different name or email.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="mt-5 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-slate-950">
                  Designated teams
                </h3>
                <p className="text-sm text-slate-600">
                  Create reusable calendar groups, assign a name and description, and choose which enabled staff belong to each team.
                </p>
              </div>

              <Dialog open={isGroupDialogOpen} onOpenChange={setIsGroupDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    onClick={openCreateGroupDialog}
                    className="bg-slate-950 text-white hover:bg-slate-800"
                  >
                    Create group
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>
                      {editingGroupId ? "Edit calendar group" : "Create calendar group"}
                    </DialogTitle>
                    <DialogDescription>
                      Groups can be used in the calendar filters, and one staff member can belong to multiple groups.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-4 py-2">
                    <div className="space-y-2">
                      <Label htmlFor="calendar-group-name">Group name</Label>
                      <Input
                        id="calendar-group-name"
                        value={groupName}
                        onChange={(event) => setGroupName(event.target.value)}
                        placeholder="Front desk team"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="calendar-group-description">Description</Label>
                      <Textarea
                        id="calendar-group-description"
                        rows={3}
                        value={groupDescription}
                        onChange={(event) => setGroupDescription(event.target.value)}
                        placeholder="Optional note about how this team is used."
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label>Group members</Label>
                        <p className="text-xs text-slate-500">
                          Only enabled calendar staff can be added to groups.
                        </p>
                      </div>
                      <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                        {enabledStaffMembers.length > 0 ? (
                          enabledStaffMembers.map((staffMember) => {
                            const checked = groupMemberUserIds.includes(staffMember.id)

                            return (
                              <label
                                key={staffMember.id}
                                className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(nextChecked) =>
                                    toggleGroupMember(staffMember.id, Boolean(nextChecked))
                                  }
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-slate-900">
                                    {staffMember.label}
                                  </p>
                                  <p className="truncate text-xs text-slate-500">
                                    {staffMember.email}
                                  </p>
                                </div>
                              </label>
                            )
                          })
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-center">
                            <p className="font-medium text-slate-900">No enabled staff available.</p>
                            <p className="mt-1 text-sm text-slate-500">
                              Enable staff members above before creating groups.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsGroupDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="button" onClick={onSaveGroup} disabled={isSavingGroup}>
                      {isSavingGroup
                        ? "Saving..."
                        : editingGroupId
                          ? "Save group"
                          : "Create group"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <div className="mt-5 grid gap-3">
              {staffGroups.length > 0 ? (
                staffGroups.map((group) => (
                  <article
                    key={group.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div>
                          <p className="font-semibold text-slate-950">{group.name}</p>
                          {group.description ? (
                            <p className="mt-1 text-sm text-slate-500">{group.description}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {group.members.length > 0 ? (
                            group.members.map((member) => (
                              <Badge
                                key={`${group.id}-${member.userId}`}
                                variant="secondary"
                                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700"
                              >
                                {member.label}
                              </Badge>
                            ))
                          ) : (
                            <Badge
                              variant="secondary"
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-500"
                            >
                              No members yet
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={() => openEditGroupDialog(group)}>
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={deletingGroupId === group.id}
                          onClick={() => void onDeleteGroup(group.id)}
                          className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                        >
                          {deletingGroupId === group.id ? "Removing..." : "Remove"}
                        </Button>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <p className="font-medium text-slate-900">No designated teams created yet.</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Create groups to filter the calendar by reusable teams of staff members.
                  </p>
                </div>
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="availability" className="mt-0 space-y-5">
          <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-slate-950">
                  Account availability
                </h3>
                <p className="text-sm text-slate-600">
                  Define the shared business hours and account-wide blocked periods used before staff-level overrides.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void onSaveAccountSettings("Account availability updated.")}
                disabled={isSavingAccountSettings}
                className="bg-slate-950 text-white hover:bg-slate-800"
              >
                {isSavingAccountSettings ? "Saving..." : "Save account availability"}
              </Button>
            </div>

            <div className="mt-5">
              <WeeklyAvailabilityEditor
                value={weeklyAvailability}
                onChange={updateAccountDay}
                description={(enabled) =>
                  enabled
                    ? "Appointments can be scheduled during these account hours."
                    : "This day is closed for account-wide scheduling."
                }
              />
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-slate-950">
                  Account blocked periods
                </h3>
                <p className="text-sm text-slate-600">
                  Block the whole calendar for holidays, closures, or special unavailable windows.
                </p>
              </div>

              <Dialog open={isAccountBlockDialogOpen} onOpenChange={setIsAccountBlockDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-slate-950 text-white hover:bg-slate-800">
                    Add account block
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Add account blocked period</DialogTitle>
                    <DialogDescription>
                      Prevent new appointments for the entire calendar during the selected window.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-4 py-2">
                    <div className="space-y-2">
                      <Label htmlFor="calendar-account-block-title">Title</Label>
                      <Input
                        id="calendar-account-block-title"
                        value={accountBlockTitle}
                        onChange={(event) => setAccountBlockTitle(event.target.value)}
                        placeholder="Office closed"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="calendar-account-block-description">Description</Label>
                      <Textarea
                        id="calendar-account-block-description"
                        rows={4}
                        value={accountBlockDescription}
                        onChange={(event) => setAccountBlockDescription(event.target.value)}
                        placeholder="Optional note for admins."
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Start</Label>
                        <DateTimeInput
                          value={accountBlockStartInput}
                          onValueChange={setAccountBlockStartInput}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>End</Label>
                        <DateTimeInput
                          value={accountBlockEndInput}
                          onValueChange={setAccountBlockEndInput}
                        />
                      </div>
                    </div>
                  </div>

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsAccountBlockDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="button" onClick={onCreateAccountBlock} disabled={isCreatingAccountBlock}>
                      {isCreatingAccountBlock ? "Adding..." : "Add block"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <div className="mt-5">
              <BlockList
                blocks={blocks}
                timezone={timezone}
                emptyTitle="No account blocks configured."
                emptyDescription="Use account blocks for holidays, office closures, or shared unavailable windows."
                deletingBlockId={deletingAccountBlockId}
                onDelete={(blockId) => void onDeleteAccountBlock(blockId)}
              />
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-slate-950">
                  Staff availability
                </h3>
                <p className="text-sm text-slate-600">
                  Choose a staff member and customize the days, hours, and blocked periods that apply to that person.
                </p>
              </div>
              <div className="w-full max-w-sm space-y-2">
                <Label>Staff member</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a staff member" />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledStaffMembers.map((staffMember) => (
                      <SelectItem key={staffMember.id} value={staffMember.id}>
                        {staffMember.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {enabledStaffMembers.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <p className="font-medium text-slate-900">No calendar staff enabled yet.</p>
                <p className="mt-1 text-sm text-slate-500">
                  Enable staff members in the Staff tab before configuring their availability.
                </p>
              </div>
            ) : isLoadingUserSchedule ? (
              <div className="mt-5 flex min-h-[220px] items-center justify-center rounded-[24px] border border-slate-200 bg-slate-50">
                <div className="flex items-center gap-3 text-slate-600">
                  <LoaderCircle className="h-5 w-5 animate-spin" />
                  <span>Loading staff availability...</span>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-5">
                <div className="flex flex-col gap-3 rounded-[20px] border border-slate-200 bg-slate-50/70 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: selectedUser?.color ?? "#1d4ed8" }}
                    >
                      <UserRound className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-950">
                        {selectedUser?.label ?? "Selected staff member"}
                      </p>
                      <p className="text-sm text-slate-500">
                        {selectedUser?.email ?? "Loading details..."}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Dialog open={isUserBlockDialogOpen} onOpenChange={setIsUserBlockDialogOpen}>
                      <DialogTrigger asChild>
                        <Button type="button" variant="outline">
                          Add staff block
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Add staff blocked period</DialogTitle>
                          <DialogDescription>
                            Block time for this staff member without affecting the whole calendar.
                          </DialogDescription>
                        </DialogHeader>

                        <div className="grid gap-4 py-2">
                          <div className="space-y-2">
                            <Label htmlFor="user-calendar-block-title">Title</Label>
                            <Input
                              id="user-calendar-block-title"
                              value={userBlockTitle}
                              onChange={(event) => setUserBlockTitle(event.target.value)}
                              placeholder="Vacation"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="user-calendar-block-description">Description</Label>
                            <Textarea
                              id="user-calendar-block-description"
                              rows={4}
                              value={userBlockDescription}
                              onChange={(event) => setUserBlockDescription(event.target.value)}
                              placeholder="Optional note for admins."
                            />
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label>Start</Label>
                              <DateTimeInput
                                value={userBlockStartInput}
                                onValueChange={setUserBlockStartInput}
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>End</Label>
                              <DateTimeInput
                                value={userBlockEndInput}
                                onValueChange={setUserBlockEndInput}
                              />
                            </div>
                          </div>
                        </div>

                        <DialogFooter>
                          <Button type="button" variant="outline" onClick={() => setIsUserBlockDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button type="button" onClick={onCreateUserBlock} disabled={isCreatingUserBlock}>
                            {isCreatingUserBlock ? "Adding..." : "Add block"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>

                    <Button
                      type="button"
                      onClick={onSaveUserSchedule}
                      disabled={isSavingUserSchedule}
                      className="bg-slate-950 text-white hover:bg-slate-800"
                    >
                      {isSavingUserSchedule ? "Saving..." : "Save staff availability"}
                    </Button>
                  </div>
                </div>

                <WeeklyAvailabilityEditor
                  value={userWeeklyAvailability}
                  onChange={updateUserDay}
                  description={(enabled) =>
                    enabled
                      ? "This staff member can receive appointments on this day."
                      : "This staff member is unavailable on this day."
                  }
                />

                <BlockList
                  blocks={userBlocks}
                  timezone={timezone}
                  emptyTitle="No staff blocks configured."
                  emptyDescription="Add personal time off, lunches, or unavailable windows for this staff member."
                  deletingBlockId={deletingUserBlockId}
                  onDelete={(blockId) => void onDeleteUserBlock(blockId)}
                />
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="booking-rules" className="mt-0">
          <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-slate-950">
                  Booking rules
                </h3>
                <p className="text-sm text-slate-600">
                  Control the cadence, duration, notice windows, booking limits, and buffer behavior used when generating appointment slots.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void onSaveAccountSettings("Booking rules updated.")}
                disabled={isSavingAccountSettings}
                className="bg-slate-950 text-white hover:bg-slate-800"
              >
                {isSavingAccountSettings ? "Saving..." : "Save booking rules"}
              </Button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-2">
                <Label>Meeting interval</Label>
                <Select
                  value={String(bookingRules.meetingIntervalMinutes)}
                  onValueChange={(value) =>
                    setBookingRules((current) => ({
                      ...current,
                      meetingIntervalMinutes: Number(value) as CalendarBookingRules["meetingIntervalMinutes"],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select meeting interval" />
                  </SelectTrigger>
                  <SelectContent>
                    {SLOT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Meeting duration</Label>
                <Select
                  value={String(bookingRules.meetingDurationMinutes)}
                  onValueChange={(value) =>
                    setBookingRules((current) => ({
                      ...current,
                      meetingDurationMinutes: Number(value) as CalendarBookingRules["meetingDurationMinutes"],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select meeting duration" />
                  </SelectTrigger>
                  <SelectContent>
                    {SLOT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="calendar-minimum-notice">Minimum schedule notice (minutes)</Label>
                <Input
                  id="calendar-minimum-notice"
                  type="number"
                  min={0}
                  value={String(bookingRules.minimumScheduleNoticeMinutes)}
                  onChange={(event) =>
                    setBookingRules((current) => ({
                      ...current,
                      minimumScheduleNoticeMinutes: Math.max(0, Number(event.target.value || 0)),
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="calendar-max-per-day">Maximum bookings per day</Label>
                <Input
                  id="calendar-max-per-day"
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={bookingRules.maximumBookingsPerDay?.toString() ?? ""}
                  onChange={(event) =>
                    setBookingRules((current) => ({
                      ...current,
                      maximumBookingsPerDay: coerceNullablePositiveInteger(event.target.value),
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="calendar-max-per-slot">Maximum bookings per slot</Label>
                <Input
                  id="calendar-max-per-slot"
                  type="number"
                  min={1}
                  value={String(bookingRules.maximumBookingsPerSlot)}
                  onChange={(event) =>
                    setBookingRules((current) => ({
                      ...current,
                      maximumBookingsPerSlot: Math.max(1, Number(event.target.value || 1)),
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Buffer mode</Label>
                <Select
                  value={bookingRules.bufferAvailabilityMode}
                  onValueChange={(value) =>
                    setBookingRules((current) => ({
                      ...current,
                      bufferAvailabilityMode: value as CalendarBookingRules["bufferAvailabilityMode"],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select buffer mode" />
                  </SelectTrigger>
                  <SelectContent>
                    {BUFFER_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  {BUFFER_MODE_OPTIONS.find((option) => option.value === bookingRules.bufferAvailabilityMode)?.description}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="calendar-pre-buffer">Pre-buffer (minutes)</Label>
                <Input
                  id="calendar-pre-buffer"
                  type="number"
                  min={0}
                  value={String(bookingRules.preBufferMinutes)}
                  onChange={(event) =>
                    setBookingRules((current) => ({
                      ...current,
                      preBufferMinutes: Math.max(0, Number(event.target.value || 0)),
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="calendar-post-buffer">Post-buffer (minutes)</Label>
                <Input
                  id="calendar-post-buffer"
                  type="number"
                  min={0}
                  value={String(bookingRules.postBufferMinutes)}
                  onChange={(event) =>
                    setBookingRules((current) => ({
                      ...current,
                      postBufferMinutes: Math.max(0, Number(event.target.value || 0)),
                    }))
                  }
                />
              </div>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}
