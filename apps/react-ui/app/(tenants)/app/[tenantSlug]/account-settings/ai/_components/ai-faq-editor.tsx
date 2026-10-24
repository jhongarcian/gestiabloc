"use client"

import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createDraftId, type AiFaqDraft } from "../_lib/demo-data"
import {
  AiEmpty,
  AiPageHeader,
  AiPanel,
  DraftButton,
  INPUT_CLASS,
  SECONDARY_BUTTON,
  SkillBreadcrumbs,
  TEXTAREA_CLASS,
} from "./ai-ui"
import { useAiSkill } from "./ai-workspace"

export function AiFaqEditor({ skillId }: { skillId: string }) {
  const { skill, updateSkill } = useAiSkill(skillId)
  const updateFaq = (id: string, changes: Partial<AiFaqDraft>) =>
    updateSkill(skillId, (current) => ({
      ...current,
      faqs: current.faqs.map((faq) =>
        faq.id === id ? { ...faq, ...changes } : faq,
      ),
    }))
  const valid = skill.faqs.every(
    (faq) => faq.question.trim() && faq.answer.trim(),
  )
  return (
    <>
      <SkillBreadcrumbs skill={skill} section="faq" />
      <AiPageHeader
        title="FAQ"
        eyebrow={skill.name}
        description="Write the answers your helper can use for common questions."
        actions={
          <>
            <Button
              variant="outline"
              className={SECONDARY_BUTTON}
              onClick={() =>
                updateSkill(skillId, (current) => ({
                  ...current,
                  faqs: [
                    ...current.faqs,
                    { id: createDraftId(), question: "", answer: "" },
                  ],
                }))
              }
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add question
            </Button>
            <DraftButton
              draftKey={`${skillId}/faq`}
              value={skill.faqs}
              valid={valid}
            />
          </>
        }
      />
      {skill.faqs.map((faq, index) => (
        <AiPanel
          key={faq.id}
          title={`Question ${index + 1}`}
          actions={
            <Button
              variant="outline"
              className={SECONDARY_BUTTON}
              aria-label={`Remove question ${index + 1}`}
              onClick={() =>
                updateSkill(skillId, (current) => ({
                  ...current,
                  faqs: current.faqs.filter((item) => item.id !== faq.id),
                }))
              }
            >
              Remove
            </Button>
          }
        >
          <FieldGroup className="gap-4">
            <Field data-invalid={!faq.question.trim()}>
              <FieldLabel htmlFor={`${faq.id}-question`}>Question</FieldLabel>
              <Input
                id={`${faq.id}-question`}
                value={faq.question}
                onChange={(event) =>
                  updateFaq(faq.id, { question: event.target.value })
                }
                className={INPUT_CLASS}
                aria-invalid={!faq.question.trim()}
                aria-describedby={
                  !faq.question.trim() ? `${faq.id}-question-error` : undefined
                }
                placeholder="What do customers ask?"
              />
              {!faq.question.trim() ? (
                <FieldError id={`${faq.id}-question-error`}>
                  Enter a question before saving the draft.
                </FieldError>
              ) : null}
            </Field>
            <Field data-invalid={!faq.answer.trim()}>
              <FieldLabel htmlFor={`${faq.id}-answer`}>Answer</FieldLabel>
              <Textarea
                id={`${faq.id}-answer`}
                value={faq.answer}
                onChange={(event) =>
                  updateFaq(faq.id, { answer: event.target.value })
                }
                className={TEXTAREA_CLASS}
                aria-invalid={!faq.answer.trim()}
                aria-describedby={
                  !faq.answer.trim() ? `${faq.id}-answer-error` : undefined
                }
                placeholder="Add a clear, helpful answer."
              />
              {!faq.answer.trim() ? (
                <FieldError id={`${faq.id}-answer-error`}>
                  Enter an answer before saving the draft.
                </FieldError>
              ) : null}
            </Field>
          </FieldGroup>
        </AiPanel>
      ))}
      {!skill.faqs.length ? (
        <AiEmpty
          title="Start with a common question"
          description="Add a question and an answer to begin building this skill’s FAQ."
        />
      ) : null}
    </>
  )
}
