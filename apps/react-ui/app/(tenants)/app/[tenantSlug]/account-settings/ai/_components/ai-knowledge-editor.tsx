"use client"
import Link from "next/link"

import { useRef, useState, type FormEvent } from "react"
import { Check, ChevronDown, FileText, Link2, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  createDraftId,
  isSourceUrl,
  type AiKnowledgeDraft,
} from "../_lib/demo-data"
import {
  AiEmpty,
  AiPageHeader,
  AiPanel,
  AiSelect,
  DraftButton,
  INPUT_CLASS,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SkillBreadcrumbs,
  TEXTAREA_CLASS,
} from "./ai-ui"
import { useAiSkill } from "./ai-workspace"

export function AiKnowledgeEditor({ skillId }: { skillId: string }) {
  const { skill, updateSkill, basePath } = useAiSkill(skillId)
  const fileInput = useRef<HTMLInputElement>(null)
  const [linkDraft, setLinkDraft] = useState({ id: "", label: "", url: "" })
  const [linkError, setLinkError] = useState("")
  const knowledge = skill.knowledge
  const updateKnowledge = (changes: Partial<AiKnowledgeDraft>) =>
    updateSkill(skillId, (current) => ({
      ...current,
      knowledge: { ...current.knowledge, ...changes },
    }))

  const saveLink = (event: FormEvent) => {
    event.preventDefault()
    const url = linkDraft.url.trim()
    if (!isSourceUrl(url)) {
      setLinkError("Enter a complete http:// or https:// URL.")
      return
    }
    const link = {
      id: linkDraft.id || createDraftId(),
      label: linkDraft.label.trim() || new URL(url).hostname,
      url,
    }
    updateKnowledge({
      links: linkDraft.id
        ? knowledge.links.map((item) =>
            item.id === linkDraft.id ? link : item,
          )
        : [...knowledge.links, link],
    })
    setLinkDraft({ id: "", label: "", url: "" })
    setLinkError("")
  }

  return (
    <>
      <SkillBreadcrumbs skill={skill} section="knowledge-base" />
      <AiPageHeader
        title="Knowledge Base"
        eyebrow={skill.name}
        description="Give your helper a clear description and trusted service information."
        actions={
          <DraftButton
            draftKey={`${skillId}/knowledge-base`}
            value={knowledge}
          />
        }
      />
      <AiPanel
        title="Description"
        description="One description that explains what this skill covers."
      >
        <Field>
          <FieldLabel htmlFor="skill-description">Skill description</FieldLabel>
          <Textarea
            id="skill-description"
            value={knowledge.description}
            onChange={(event) =>
              updateKnowledge({ description: event.target.value })
            }
            className={TEXTAREA_CLASS}
          />
        </Field>
      </AiPanel>

      <AiPanel
        title="Source links"
        description="Add one source at a time. Links are listed for this preview and are not fetched."
      >
        <div className="flex flex-col gap-4">
          {knowledge.links.map((source) => (
            <div
              key={source.id}
              className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center"
            >
              <Link2
                className="hidden size-4 shrink-0 text-slate-400 sm:block"
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="break-words text-sm font-medium text-slate-900">
                  {source.label}
                </p>
                <p className="break-all text-xs text-slate-500">{source.url}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className={SECONDARY_BUTTON}
                  aria-label={`Edit ${source.label}`}
                  onClick={() => {
                    setLinkDraft(source)
                    setLinkError("")
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  className={SECONDARY_BUTTON}
                  aria-label={`Remove ${source.label}`}
                  onClick={() => {
                    updateKnowledge({
                      links: knowledge.links.filter(
                        (item) => item.id !== source.id,
                      ),
                    })
                    if (linkDraft.id === source.id)
                      setLinkDraft({ id: "", label: "", url: "" })
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          {!knowledge.links.length ? (
            <AiEmpty
              title="No source links yet"
              description="Add a trusted page or service guide below."
            />
          ) : null}
          <Separator />
          <form noValidate onSubmit={saveLink} className="flex flex-col gap-4">
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="source-label">
                  Source name{" "}
                  <span className="text-xs font-normal text-slate-500">
                    Optional
                  </span>
                </FieldLabel>
                <Input
                  id="source-label"
                  className={INPUT_CLASS}
                  value={linkDraft.label}
                  onChange={(event) =>
                    setLinkDraft((current) => ({
                      ...current,
                      label: event.target.value,
                    }))
                  }
                  placeholder="Coverage guide"
                />
              </Field>
              <Field data-invalid={Boolean(linkError)}>
                <FieldLabel htmlFor="source-url">Source URL</FieldLabel>
                <Input
                  id="source-url"
                  type="url"
                  className={INPUT_CLASS}
                  value={linkDraft.url}
                  onChange={(event) => {
                    setLinkDraft((current) => ({
                      ...current,
                      url: event.target.value,
                    }))
                    setLinkError("")
                  }}
                  aria-invalid={Boolean(linkError)}
                  aria-describedby={linkError ? "source-url-error" : undefined}
                  placeholder="https://example.com/guide"
                />
                {linkError ? (
                  <FieldError id="source-url-error">{linkError}</FieldError>
                ) : null}
              </Field>
            </FieldGroup>
            <div className="flex flex-wrap justify-end gap-2">
              {linkDraft.id ? (
                <Button
                  type="button"
                  variant="outline"
                  className={SECONDARY_BUTTON}
                  onClick={() => {
                    setLinkDraft({ id: "", label: "", url: "" })
                    setLinkError("")
                  }}
                >
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" variant="ghost" className={PRIMARY_BUTTON}>
                {linkDraft.id ? "Update link" : "Add link"}
              </Button>
            </div>
          </form>
        </div>
      </AiPanel>

      <AiPanel
        title="Files"
        description="Choose files individually. Files stay on your device and are not uploaded or processed."
        actions={
          <Button
            variant="outline"
            className={SECONDARY_BUTTON}
            onClick={() => fileInput.current?.click()}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add file
          </Button>
        }
      >
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          aria-label="Choose one knowledge source file"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file)
              updateKnowledge({
                files: [
                  ...knowledge.files,
                  {
                    id: createDraftId(),
                    name: file.name,
                    size: file.size,
                    type: file.type,
                  },
                ],
              })
            event.target.value = ""
          }}
        />
        <div className="flex flex-col gap-3">
          {knowledge.files.map((file) => (
            <div
              key={file.id}
              className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-slate-200 p-4"
            >
              <FileText
                className="size-5 shrink-0 text-slate-400"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="break-all text-sm font-medium text-slate-900">
                  {file.name}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {file.size < 1024
                    ? `${file.size} bytes`
                    : file.size < 1048576
                      ? `${(file.size / 1024).toFixed(1)} KB`
                      : `${(file.size / 1048576).toFixed(1)} MB`}{" "}
                  · Selected locally
                </p>
              </div>
              <Button
                variant="outline"
                className={SECONDARY_BUTTON}
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  updateKnowledge({
                    files: knowledge.files.filter(
                      (item) => item.id !== file.id,
                    ),
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}
          {!knowledge.files.length ? (
            <AiEmpty
              title="No files selected"
              description="Add a service document to see how individual file sources will appear."
            />
          ) : null}
        </div>
      </AiPanel>

      <AiPanel
        title="Linked service notes"
        description="Read-only information from current service configuration, including inherited pricing and checklist items."
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Overview</h3>
              <Badge variant="outline">Linked · read-only</Badge>
              <Link
                className="rounded text-xs font-medium text-blue-700 underline focus-visible:outline-2"
                href={`${basePath.slice(0, -3)}/services/${skill.notes.sources.overview}`}
              >
                Open source service
              </Link>
            </div>
            <p className="text-sm leading-6 text-slate-600">
              {skill.notes.overview}
            </p>
          </div>
          <Separator />
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Pricing</h3>
              <Badge variant="outline">Linked · read-only</Badge>
              <Link
                className="rounded text-xs font-medium text-blue-700 underline focus-visible:outline-2"
                href={`${basePath.slice(0, -3)}/services/${skill.notes.sources.pricing}`}
              >
                Open source pricing
              </Link>
            </div>
            <p className="text-sm leading-6 text-slate-600">
              {skill.notes.pricing}
            </p>
          </div>
          <Separator />
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Checklist
              </h3>
              <Badge variant="outline">Linked · read-only</Badge>
              <Link
                className="rounded text-xs font-medium text-blue-700 underline focus-visible:outline-2"
                href={`${basePath.slice(0, -3)}/services/${skill.notes.sources.checklist}`}
              >
                Open source checklist
              </Link>
            </div>
            <ul className="flex flex-col gap-2">
              {skill.notes.checklist.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2 text-sm text-slate-600"
                >
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-slate-400"
                    aria-hidden="true"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            {!skill.notes.checklist.length ? (
              <p className="text-sm text-slate-500">
                No checklist items have been saved.
              </p>
            ) : null}
          </div>
        </div>
      </AiPanel>

      {skill.knowledgeProfile.pricingNotes ||
      skill.knowledgeProfile.workflowNotes ? (
        <AiPanel
          title="Existing service guidance"
          description="Saved notes are preserved as read-only content while knowledge editing remains a preview."
        >
          <div className="flex flex-col gap-4 text-sm text-slate-600">
            {skill.knowledgeProfile.pricingNotes ? (
              <div>
                <h3 className="mb-1 font-semibold text-slate-900">
                  Pricing guidance
                </h3>
                <p className="whitespace-pre-wrap break-words">
                  {skill.knowledgeProfile.pricingNotes}
                </p>
              </div>
            ) : null}
            {skill.knowledgeProfile.workflowNotes ? (
              <div>
                <h3 className="mb-1 font-semibold text-slate-900">
                  Workflow guidance
                </h3>
                <p className="whitespace-pre-wrap break-words">
                  {skill.knowledgeProfile.workflowNotes}
                </p>
              </div>
            ) : null}
          </div>
        </AiPanel>
      ) : null}

      <details className="group rounded-[22px] border border-slate-200 bg-white p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md text-sm font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700 [&::-webkit-details-marker]:hidden">
          Advanced guidance and verification
          <ChevronDown
            className="size-4 transition group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <FieldGroup className="mt-5 gap-4">
          <Field>
            <FieldLabel htmlFor="knowledge-guidance">
              Service guidance
            </FieldLabel>
            <AiSelect
              id="knowledge-guidance"
              label="Service guidance"
              value={knowledge.adapter}
              options={[
                { value: "NONE", label: "General service guidance" },
                {
                  value: "IMMIGRATION_USCIS",
                  label: "USCIS immigration guidance",
                },
              ]}
              onChange={(adapter) =>
                updateKnowledge({
                  adapter: adapter as AiKnowledgeDraft["adapter"],
                })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="verification-mode">
              Source verification
            </FieldLabel>
            <AiSelect
              id="verification-mode"
              label="Source verification"
              value={knowledge.verification.mode}
              options={[
                { value: "NONE", label: "No additional verification" },
                { value: "WEB_SOURCES", label: "Web sources" },
                { value: "INTERNAL_KB", label: "Internal knowledge base" },
                { value: "EXTERNAL_API", label: "Connected service" },
                { value: "MANUAL_CONFIRMATION", label: "Team confirmation" },
              ]}
              onChange={(mode) =>
                updateKnowledge({
                  verification: {
                    ...knowledge.verification,
                    mode: mode as AiKnowledgeDraft["verification"]["mode"],
                  },
                })
              }
            />
            <FieldDescription>
              Preview settings only. No sources are checked or connections made.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="verification-keywords">
              Trigger keywords
            </FieldLabel>
            <Textarea
              id="verification-keywords"
              className={TEXTAREA_CLASS}
              value={knowledge.verification.triggerKeywords.join("\n")}
              onChange={(event) =>
                updateKnowledge({
                  verification: {
                    ...knowledge.verification,
                    triggerKeywords: event.target.value.split("\n"),
                  },
                })
              }
            />
            <FieldDescription>One keyword or phrase per line.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="verification-instructions">
              Verification guidance
            </FieldLabel>
            <Textarea
              id="verification-instructions"
              className={TEXTAREA_CLASS}
              value={knowledge.verification.guidance}
              onChange={(event) =>
                updateKnowledge({
                  verification: {
                    ...knowledge.verification,
                    guidance: event.target.value,
                  },
                })
              }
            />
            <FieldDescription>
              The source links above provide the reference list for this
              preview.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </details>
      <div className="flex justify-end">
        <DraftButton draftKey={`${skillId}/knowledge-base`} value={knowledge} />
      </div>
    </>
  )
}
