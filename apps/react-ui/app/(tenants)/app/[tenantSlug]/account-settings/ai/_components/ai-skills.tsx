"use client"

import Link from "next/link"
import { useState } from "react"
import {
  ArrowUpRight,
  BookOpen,
  CheckCheck,
  CircleHelp,
  Layers3,
  Search,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  AiEmpty,
  AiPageHeader,
  SECONDARY_BUTTON,
  SkillBreadcrumbs,
} from "./ai-ui"
import { qualificationGroups } from "../_lib/qualification"
import { useAiSkill, useAiWorkspace } from "./ai-workspace"

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

export function AiSkillsGallery() {
  const {
    basePath,
    draft,
    catalogReady,
    catalogError,
    catalogBusy,
    reloadSkills,
    savingSkillId,
  } = useAiWorkspace()
  const [search, setSearch] = useState("")
  const query = search.trim().toLowerCase()
  const skills = draft.skills.filter((skill) =>
    `${skill.name} ${skill.parentName} ${skill.tagline}`
      .toLowerCase()
      .includes(query),
  )
  const groups = [
    ...new Map(
      skills.map((skill) => [
        skill.parentId,
        {
          id: skill.parentId,
          name: skill.parentName,
          active: skill.parentActive,
        },
      ]),
    ).values(),
  ]

  return (
    <>
      <AiPageHeader
        title="Skills"
        description="Give your helper the knowledge to guide each service conversation."
        actions={
          <>
            <Button asChild variant="outline" className={SECONDARY_BUTTON}>
              <Link href={`${basePath.slice(0, -3)}/services`}>
                Manage services
              </Link>
            </Button>
            <Button
              variant="outline"
              className={SECONDARY_BUTTON}
              disabled={catalogBusy || savingSkillId !== null}
              onClick={() => void reloadSkills()}
            >
              {catalogBusy ? "Refreshing…" : "Refresh services"}
            </Button>
          </>
        }
      >
        <form
          role="search"
          onSubmit={(event) => event.preventDefault()}
          className="relative max-w-xl"
        >
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search skills"
            aria-label="Search skills by sub-service or parent service"
            className="h-11 rounded-xl border-white/80 bg-white/85 pr-14 pl-4 text-sm shadow-sm focus-visible:border-blue-300 focus-visible:ring-blue-100"
          />
          <Button
            type="submit"
            aria-label="Search skills"
            className="absolute inset-y-0 right-0 h-11 w-12 rounded-l-none rounded-r-xl bg-blue-950 text-white shadow-none hover:bg-blue-900"
          >
            <Search aria-hidden="true" />
          </Button>
        </form>
      </AiPageHeader>
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-sm text-slate-500">Your service skills</p>
        <Badge variant="secondary">
          {countLabel(draft.skills.length, "sub-service")}
        </Badge>
      </div>
      {catalogError ? (
        <Alert variant="destructive" className="rounded-2xl" role="alert">
          <AlertTitle>Skills could not be loaded</AlertTitle>
          <AlertDescription>{catalogError}</AlertDescription>
        </Alert>
      ) : null}
      {groups.map((group) => (
        <section
          key={group.id}
          className="flex flex-col gap-3"
          aria-label={group.name}
        >
          <div className="flex flex-wrap items-center gap-2 px-1">
            <h2 className="text-sm font-semibold text-slate-700">
              {group.name}
            </h2>
            {!group.active ? (
              <Badge variant="outline">Inactive parent</Badge>
            ) : null}
          </div>
          <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {skills
              .filter((skill) => skill.parentId === group.id)
              .map((skill) => (
                <Link
                  key={skill.id}
                  href={`${basePath}/skills/${skill.id}`}
                  className="group min-w-0 rounded-[22px] outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
                >
                  <Card className="h-full gap-4 rounded-[22px] border-slate-200 py-5 shadow-none transition motion-safe:hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-sm">
                    <CardHeader className="gap-4 px-5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-950">
                          <Layers3 className="size-5" aria-hidden="true" />
                        </div>
                        <ArrowUpRight
                          className="size-4 text-slate-400 transition group-hover:text-blue-950"
                          aria-hidden="true"
                        />
                      </div>
                      <CardTitle>
                        <h3 className="text-lg text-slate-950">{skill.name}</h3>
                      </CardTitle>
                      <CardDescription>
                        {skill.tagline ||
                          "Manage knowledge and qualification for this sub-service."}
                      </CardDescription>
                      <div className="flex flex-wrap gap-2">
                        <Badge
                          variant={
                            skill.availableToAssistant ? "secondary" : "outline"
                          }
                        >
                          {!skill.isActive
                            ? "Inactive"
                            : !skill.parentActive
                              ? "Parent inactive"
                              : "Active"}
                        </Badge>
                        {!skill.availableToAssistant ? (
                          <span className="text-xs text-slate-500">
                            Excluded from assistant answers
                          </span>
                        ) : null}
                      </div>
                    </CardHeader>
                    <CardContent className="mt-auto px-5">
                      <Separator />
                    </CardContent>
                    <CardFooter className="flex-wrap justify-between gap-2 px-5 text-xs text-slate-500">
                      <span>
                        {countLabel(
                          skill.qualification.rules.length,
                          "condition",
                        )}{" "}
                        ·{" "}
                        {skill.qualification.enabled
                          ? "Qualification enabled"
                          : "Qualification off"}
                      </span>
                      <span className="font-semibold text-blue-950">
                        Open skill →
                      </span>
                    </CardFooter>
                  </Card>
                </Link>
              ))}
          </div>
        </section>
      ))}
      {catalogReady && !catalogError && !skills.length ? (
        <AiEmpty
          title={query ? "No matching skills" : "No sub-services yet"}
          description={
            query
              ? "Try searching for a service name or parent service."
              : "Create a parent service and a sub-service in Manage services to add your first skill."
          }
        />
      ) : null}
    </>
  )
}

export function AiSkillOverview({ skillId }: { skillId: string }) {
  const { skill, basePath } = useAiSkill(skillId)
  const sections = [
    {
      key: "faq",
      title: "FAQ",
      description: "Shape clear answers to the questions your team hears most.",
      icon: CircleHelp,
      detail: skill.knowledgeProfile.faqNotes
        ? "Saved FAQ notes available · editing preview"
        : "Editing preview",
    },
    {
      key: "knowledge-base",
      title: "Knowledge Base",
      description:
        "Bring service information, trusted sources, and linked notes together.",
      icon: BookOpen,
      detail: "Linked service notes · editing preview",
    },
    {
      key: "qualification-rules",
      title: "Qualification Rules",
      description:
        "Define the requirements and options that guide a service handoff.",
      icon: CheckCheck,
      detail: countLabel(
        qualificationGroups(skill.qualification).length,
        "requirement",
      ),
    },
  ]
  return (
    <>
      <SkillBreadcrumbs skill={skill} />
      <AiPageHeader
        title={skill.name}
        description={
          skill.tagline ||
          "Manage this sub-service’s knowledge and qualification rules."
        }
        eyebrow={skill.parentName}
      />
      {!skill.availableToAssistant ? (
        <Alert className="rounded-2xl">
          <AlertTitle>
            {!skill.isActive
              ? "Inactive sub-service"
              : "Inactive parent service"}
          </AlertTitle>
          <AlertDescription>
            This skill remains available for administration. It is excluded from
            assistant answers and fit scans until the sub-service and its parent
            are active.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-3">
        {sections.map(({ key, title, description, icon: Icon, detail }) => (
          <Link
            key={key}
            href={`${basePath}/skills/${skill.id}/${key}`}
            className="group min-w-0 rounded-[22px] outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            <Card className="h-full gap-4 rounded-[22px] border-slate-200 py-5 shadow-none transition hover:border-blue-200 hover:shadow-sm">
              <CardHeader className="gap-4 px-5">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-950">
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <CardTitle>
                  <h2 className="text-base leading-6">{title}</h2>
                </CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto px-5">
                <p className="text-xs text-slate-500">{detail}</p>
              </CardContent>
              <CardFooter className="justify-between px-5 text-sm font-semibold text-blue-950">
                Manage {title === "FAQ" ? "FAQs" : title.toLowerCase()}
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </CardFooter>
            </Card>
          </Link>
        ))}
      </div>
    </>
  )
}
