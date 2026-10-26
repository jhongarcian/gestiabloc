"use client"
import Link from "next/link"

import { Check, ChevronDown, Loader2 } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { type AiKnowledgeDraft } from "../_lib/demo-data"
import {
  AiPageHeader,
  AiPanel,
  AiSelect,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SkillBreadcrumbs,
  TEXTAREA_CLASS,
} from "./ai-ui"
import { useAiSkill } from "./ai-workspace"
import { AiSourceManager } from "./ai-source-manager"
import { knowledgeDirty } from "../_lib/skills"
import { knowledgeValidation } from "../_lib/content"

export function AiKnowledgeEditor({ skillId }: { skillId: string }) {
  const {
    skill,
    updateSkill,
    basePath,
    savingKnowledgeId,
    savingSkillId,
    catalogBusy,
    knowledgeErrors,
    knowledgeConflicts,
    saveKnowledge,
    resolveKnowledgeConflict,
  } = useAiSkill(skillId)
  const knowledge = skill.knowledge
  const busy =
    savingKnowledgeId !== null || savingSkillId !== null || catalogBusy
  const validation = knowledgeValidation(knowledge)
  const conflict = knowledgeConflicts[skillId]
  const saveButton = knowledgeDirty(skill) ? (
    <Button
      className={PRIMARY_BUTTON}
      disabled={
        busy ||
        Boolean(validation) ||
        Boolean(conflict) ||
        Boolean(skill.knowledgeReadOnlyReason)
      }
      onClick={() => void saveKnowledge(skill)}
    >
      {savingKnowledgeId === skillId ? (
        <Loader2
          data-icon="inline-start"
          className="animate-spin"
          aria-hidden="true"
        />
      ) : null}
      {savingKnowledgeId === skillId ? "Saving…" : "Save changes"}
    </Button>
  ) : null
  const updateKnowledge = (changes: Partial<AiKnowledgeDraft>) =>
    updateSkill(skillId, (current) => ({
      ...current,
      knowledge: { ...current.knowledge, ...changes },
    }))

  return (
    <>
      <SkillBreadcrumbs skill={skill} section="knowledge-base" />
      <AiPageHeader
        title="Knowledge Base"
        eyebrow={skill.name}
        description="Give your helper a clear description and trusted service information."
        actions={saveButton}
      />
      {skill.knowledgeReadOnlyReason ? (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertTitle>Saved knowledge needs review</AlertTitle>
          <AlertDescription>{skill.knowledgeReadOnlyReason}</AlertDescription>
        </Alert>
      ) : null}
      {knowledgeErrors[skillId] || validation ? (
        <Alert variant="destructive" className="rounded-2xl" role="alert">
          <AlertTitle>Knowledge was not saved</AlertTitle>
          <AlertDescription>
            {knowledgeErrors[skillId] || validation}
          </AlertDescription>
        </Alert>
      ) : null}
      {conflict ? (
        <Alert className="rounded-2xl border-amber-200 bg-amber-50">
          <AlertTitle>Newer knowledge was saved</AlertTitle>
          <AlertDescription className="gap-3">
            <p>
              Your edits are still in the form. Review the saved description and
              guidance before choosing which version to use.
            </p>
            <details>
              <summary className="cursor-pointer font-medium">
                Review saved knowledge
              </summary>
              <div className="mt-3 flex max-h-64 flex-col gap-3 overflow-auto whitespace-pre-wrap break-words">
                <p>
                  <strong>Description:</strong>{" "}
                  {conflict.skill.knowledgeProfile.overview ||
                    "No description."}
                </p>
                <p>
                  <strong>Pricing guidance:</strong>{" "}
                  {conflict.skill.knowledgeProfile.pricingNotes || "No notes."}
                </p>
                <p>
                  <strong>Operating guidance:</strong>{" "}
                  {conflict.skill.knowledgeProfile.workflowNotes || "No notes."}
                </p>
                <p>
                  <strong>Verification guidance:</strong>{" "}
                  {conflict.skill.verificationProfile.guidance || "No notes."}
                </p>
              </div>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className={SECONDARY_BUTTON}
                onClick={() => resolveKnowledgeConflict(skill, false)}
              >
                Use saved knowledge
              </Button>
              <Button
                variant="outline"
                className={SECONDARY_BUTTON}
                onClick={() => resolveKnowledgeConflict(skill, true)}
              >
                Keep my edits
              </Button>
            </div>
            <p className="text-xs">
              Keeping your edits lets you review and save them again.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      <fieldset
        disabled={busy || Boolean(skill.knowledgeReadOnlyReason)}
        className="flex min-w-0 flex-col gap-4"
        aria-label="Skill knowledge configuration"
      >
        <AiPanel
          title="Description"
          description="One description that explains what this skill covers."
        >
          <Field>
            <FieldLabel htmlFor="skill-description">
              Skill description
            </FieldLabel>
            <Textarea
              id="skill-description"
              value={knowledge.description}
              maxLength={6000}
              onChange={(event) =>
                updateKnowledge({ description: event.target.value })
              }
              className={TEXTAREA_CLASS}
            />
          </Field>
        </AiPanel>
      </fieldset>
      <AiSourceManager skillId={skillId} />
      <fieldset
        disabled={busy || Boolean(skill.knowledgeReadOnlyReason)}
        className="flex min-w-0 flex-col gap-4"
        aria-label="Advanced and linked service knowledge"
      >
        <AiPanel
          title="Linked service notes"
          description="Read-only information from current service configuration, including inherited pricing and checklist items."
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  Overview
                </h3>
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
                <h3 className="text-sm font-semibold text-slate-900">
                  Pricing
                </h3>
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
            description="Review these imported service notes before making changes. Use Advanced guidance to edit them; other legacy content is preserved."
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
              <FieldLabel htmlFor="knowledge-pricing-notes">
                Pricing guidance
              </FieldLabel>
              <Textarea
                id="knowledge-pricing-notes"
                className={TEXTAREA_CLASS}
                maxLength={4000}
                value={knowledge.pricingNotes}
                onChange={(event) =>
                  updateKnowledge({ pricingNotes: event.target.value })
                }
              />
              <FieldDescription>
                Explain saved pricing details without changing the service’s
                base price.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="knowledge-operating-notes">
                Operating guidance
              </FieldLabel>
              <Textarea
                id="knowledge-operating-notes"
                className={TEXTAREA_CLASS}
                maxLength={4000}
                value={knowledge.workflowNotes}
                onChange={(event) =>
                  updateKnowledge({ workflowNotes: event.target.value })
                }
              />
              <FieldDescription>
                Review existing workflow notes and describe how clients should
                prepare.
              </FieldDescription>
            </Field>
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
                Preferences are saved. Test helper uses saved information
                without checking websites or running connections.
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
              <FieldDescription>
                One keyword or phrase per line.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="verification-instructions">
                Verification guidance
              </FieldLabel>
              <Textarea
                id="verification-instructions"
                className={TEXTAREA_CLASS}
                value={knowledge.verification.guidance}
                maxLength={4000}
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
                Save guidance your helper can use when discussing source
                verification. Ready sources supply saved information for Test
                helper.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </details>
      </fieldset>
      <div className="flex justify-end">{saveButton}</div>
    </>
  )
}
