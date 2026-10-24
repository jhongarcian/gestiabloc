"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  SKILL_SECTION_LABELS,
  type AiSkillDraft,
  type SkillSection,
} from "../_lib/demo-data"
import { useAiWorkspace } from "./ai-workspace"

export const PRIMARY_BUTTON =
  "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
export const SECONDARY_BUTTON =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
export const INPUT_CLASS =
  "h-11 rounded-xl border-slate-200 bg-slate-50/60 focus-visible:border-blue-300 focus-visible:ring-blue-100"
export const TEXTAREA_CLASS =
  "min-h-28 rounded-xl border-slate-200 bg-slate-50/60 focus-visible:border-blue-300 focus-visible:ring-blue-100"

export function AiPageHeader({
  title,
  description,
  eyebrow = "AI workspace",
  actions,
  children,
}: {
  title: string
  description: string
  eyebrow?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-xs font-semibold text-blue-700">{eyebrow}</p>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
            <p className="text-sm text-slate-600">{description}</p>
          </div>
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 md:self-center">
            {actions}
          </div>
        ) : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </header>
  )
}

export function AiPanel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card
      className={cn(
        "min-w-0 gap-4 rounded-[22px] border-slate-200 py-5 shadow-none",
        className,
      )}
    >
      <CardHeader className="gap-1 px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <CardTitle>
              <h2 className="text-base">{title}</h2>
            </CardTitle>
            {description ? (
              <CardDescription>{description}</CardDescription>
            ) : null}
          </div>
          {actions}
        </div>
      </CardHeader>
      <CardContent className="min-w-0 px-5">{children}</CardContent>
    </Card>
  )
}

export function AiEmpty({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Empty className="rounded-2xl border border-dashed">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function DraftButton({
  draftKey,
  value,
  valid = true,
}: {
  draftKey: string
  value: unknown
  valid?: boolean
}) {
  const { hasChanges, saveDraft } = useAiWorkspace()
  if (!hasChanges(draftKey, value)) return null
  return (
    <Button
      type="button"
      variant="ghost"
      className={PRIMARY_BUTTON}
      disabled={!valid}
      onClick={() => {
        if (valid) saveDraft(draftKey, value)
      }}
    >
      Save draft
    </Button>
  )
}

export function AiSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: Array<string | { value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        aria-label={label}
        className={cn(INPUT_CLASS, "w-full data-[size=default]:h-11")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((item) => {
            const option =
              typeof item === "string" ? { value: item, label: item } : item
            return (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            )
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function SkillBreadcrumbs({
  skill,
  section,
}: {
  skill: AiSkillDraft
  section?: SkillSection
}) {
  const { basePath } = useAiWorkspace()
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href={`${basePath}/skills`}>Skills</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {section ? (
            <BreadcrumbLink asChild>
              <Link href={`${basePath}/skills/${skill.id}`}>{skill.name}</Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>{skill.name}</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {section ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{SKILL_SECTION_LABELS[section]}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : null}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
