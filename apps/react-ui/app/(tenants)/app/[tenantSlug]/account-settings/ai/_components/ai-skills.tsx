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
import { AiEmpty, AiPageHeader, SkillBreadcrumbs } from "./ai-ui"
import { useAiSkill, useAiWorkspace } from "./ai-workspace"

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

export function AiSkillsGallery() {
  const { basePath, draft } = useAiWorkspace()
  const [search, setSearch] = useState("")
  const query = search.trim().toLowerCase()
  const skills = draft.skills.filter((skill) =>
    `${skill.name} ${skill.parentName} ${skill.tagline}`
      .toLowerCase()
      .includes(query),
  )
  const groups = [...new Set(skills.map((skill) => skill.parentName))]

  return (
    <>
      <AiPageHeader
        title="Skills"
        description="Give your helper the knowledge to guide each service conversation."
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
        <Badge variant="secondary">Sample catalog</Badge>
      </div>
      {groups.map((group) => (
        <section key={group} className="flex flex-col gap-3" aria-label={group}>
          <h2 className="px-1 text-sm font-semibold text-slate-700">{group}</h2>
          <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {skills
              .filter((skill) => skill.parentName === group)
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
                      <CardDescription>{skill.tagline}</CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto px-5">
                      <Separator />
                    </CardContent>
                    <CardFooter className="flex-wrap justify-between gap-2 px-5 text-xs text-slate-500">
                      <span>
                        {countLabel(skill.faqs.length, "FAQ")} ·{" "}
                        {countLabel(
                          skill.knowledge.links.length +
                            skill.knowledge.files.length,
                          "source",
                        )}
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
      {!skills.length ? (
        <AiEmpty
          title="No matching skills"
          description="Try searching for a service name or parent service."
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
      detail: countLabel(skill.faqs.length, "question"),
    },
    {
      key: "knowledge-base",
      title: "Knowledge Base",
      description:
        "Bring service information, trusted sources, and linked notes together.",
      icon: BookOpen,
      detail: `${countLabel(skill.knowledge.links.length, "link")} · ${countLabel(skill.knowledge.files.length, "file")}`,
    },
    {
      key: "qualification-rules",
      title: "Qualification Rules",
      description:
        "Define the requirements and options that guide a service handoff.",
      icon: CheckCheck,
      detail: countLabel(
        skill.qualification.requirements.length,
        "requirement",
      ),
    },
  ]
  return (
    <>
      <SkillBreadcrumbs skill={skill} />
      <AiPageHeader
        title={skill.name}
        description={skill.tagline}
        eyebrow={skill.parentName}
      />
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
