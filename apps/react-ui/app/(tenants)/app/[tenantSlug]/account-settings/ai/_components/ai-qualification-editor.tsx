"use client"

import { Plus } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import type { ServiceFitRuleDraft } from "../../_components/service-fit-rules-tab"
import {
  createCondition,
  createDraftId,
  SAMPLE_FIELD_CATALOG,
  type AiQualificationDraft,
  type AiRequirement,
  type AiRuleOption,
} from "../_lib/demo-data"
import {
  AiEmpty,
  AiPageHeader,
  AiPanel,
  AiSelect,
  DraftButton,
  INPUT_CLASS,
  SECONDARY_BUTTON,
  SkillBreadcrumbs,
  TEXTAREA_CLASS,
} from "./ai-ui"
import { useAiSkill } from "./ai-workspace"

const operatorLabels: Record<string, string> = {
  greater_than_or_equal: "Is at least",
  less_than_or_equal: "Is at most",
  equals: "Equals",
  not_equals: "Does not equal",
  between: "Is between",
  contains: "Contains",
  is_not_empty: "Is provided",
  is_empty: "Is missing",
  is_true: "Is yes",
  is_false: "Is no",
}
const noValueOperators = new Set([
  "is_true",
  "is_false",
  "is_empty",
  "is_not_empty",
])

function validCondition(rule: ServiceFitRuleDraft) {
  if (noValueOperators.has(rule.operator)) return true
  if (rule.operator === "between") {
    const range = rule.compareValue as { min?: string; max?: string } | null
    return (
      range?.min !== undefined &&
      range?.max !== undefined &&
      String(range.min).trim() !== "" &&
      String(range.max).trim() !== "" &&
      Number.isFinite(Number(range.min)) &&
      Number.isFinite(Number(range.max)) &&
      Number(range.min) <= Number(range.max)
    )
  }
  const value = String(rule.compareValue ?? "").trim()
  return (
    Boolean(value) &&
    (rule.valueType !== "number" || Number.isFinite(Number(value)))
  )
}

function ConditionEditor({
  condition,
  onChange,
  onRemove,
}: {
  condition: ServiceFitRuleDraft
  onChange: (rule: ServiceFitRuleDraft) => void
  onRemove: () => void
}) {
  const field =
    SAMPLE_FIELD_CATALOG.find((item) => item.fieldKey === condition.fieldKey) ??
    SAMPLE_FIELD_CATALOG[0]
  const range = (
    condition.operator === "between" ? condition.compareValue : {}
  ) as { min?: string; max?: string }
  const valid = validCondition(condition)
  const id = condition.id
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <FieldGroup className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${id}-field`}>Contact field</FieldLabel>
          <AiSelect
            id={`${id}-field`}
            label="Contact field"
            value={condition.fieldKey}
            options={SAMPLE_FIELD_CATALOG.map((item) => ({
              value: item.fieldKey,
              label: item.label,
            }))}
            onChange={(key) => {
              const next = SAMPLE_FIELD_CATALOG.find(
                (item) => item.fieldKey === key,
              )
              if (next)
                onChange({
                  ...createCondition(
                    id,
                    condition.requiredGroup ?? "",
                    condition.requiredBranch ?? "",
                    next,
                  ),
                  compareValue:
                    next.valueType === "boolean"
                      ? null
                      : (next.options[0]?.value ?? ""),
                })
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-operator`}>Condition</FieldLabel>
          <AiSelect
            id={`${id}-operator`}
            label="Condition"
            value={condition.operator}
            options={field.operators.map((operator) => ({
              value: operator,
              label: operatorLabels[operator] ?? operator,
            }))}
            onChange={(operator) =>
              onChange({
                ...condition,
                operator: operator as ServiceFitRuleDraft["operator"],
                compareValue:
                  operator === "between"
                    ? { min: "", max: "" }
                    : noValueOperators.has(operator)
                      ? null
                      : (field.options[0]?.value ?? ""),
              })
            }
          />
        </Field>
        {!noValueOperators.has(condition.operator) ? (
          condition.operator === "between" ? (
            <>
              <Field data-invalid={!valid}>
                <FieldLabel htmlFor={`${id}-min`}>Minimum</FieldLabel>
                <Input
                  id={`${id}-min`}
                  type="number"
                  className={INPUT_CLASS}
                  value={range?.min ?? ""}
                  aria-invalid={!valid}
                  aria-describedby={!valid ? `${id}-error` : undefined}
                  onChange={(event) =>
                    onChange({
                      ...condition,
                      compareValue: { ...range, min: event.target.value },
                    })
                  }
                />
              </Field>
              <Field data-invalid={!valid}>
                <FieldLabel htmlFor={`${id}-max`}>Maximum</FieldLabel>
                <Input
                  id={`${id}-max`}
                  type="number"
                  className={INPUT_CLASS}
                  value={range?.max ?? ""}
                  aria-invalid={!valid}
                  aria-describedby={!valid ? `${id}-error` : undefined}
                  onChange={(event) =>
                    onChange({
                      ...condition,
                      compareValue: { ...range, max: event.target.value },
                    })
                  }
                />
              </Field>
            </>
          ) : (
            <Field data-invalid={!valid} className="sm:col-span-2">
              <FieldLabel htmlFor={`${id}-value`}>Value</FieldLabel>
              {field.options.length ? (
                <AiSelect
                  id={`${id}-value`}
                  label="Condition value"
                  value={String(condition.compareValue ?? "")}
                  options={field.options}
                  onChange={(compareValue) =>
                    onChange({ ...condition, compareValue })
                  }
                />
              ) : (
                <Input
                  id={`${id}-value`}
                  type={field.valueType === "number" ? "number" : "text"}
                  className={INPUT_CLASS}
                  value={String(condition.compareValue ?? "")}
                  aria-invalid={!valid}
                  aria-describedby={!valid ? `${id}-error` : undefined}
                  onChange={(event) =>
                    onChange({ ...condition, compareValue: event.target.value })
                  }
                />
              )}
            </Field>
          )
        ) : null}
      </FieldGroup>
      {!valid ? (
        <FieldError id={`${id}-error`}>
          {condition.operator === "between"
            ? "Enter a minimum and maximum with the minimum at or below the maximum."
            : "Enter a valid comparison value."}
        </FieldError>
      ) : null}
      <div className="flex justify-end">
        <Button
          variant="outline"
          className={SECONDARY_BUTTON}
          onClick={onRemove}
          aria-label={`Remove ${field.label} condition`}
        >
          Remove condition
        </Button>
      </div>
    </div>
  )
}

export function AiQualificationEditor({ skillId }: { skillId: string }) {
  const { skill, updateSkill } = useAiSkill(skillId)
  const qualification = skill.qualification
  const update = (changes: Partial<AiQualificationDraft>) =>
    updateSkill(skillId, (current) => ({
      ...current,
      qualification: { ...current.qualification, ...changes },
    }))
  const updateRequirement = (
    id: string,
    change: (requirement: AiRequirement) => AiRequirement,
  ) =>
    update({
      requirements: qualification.requirements.map((requirement) =>
        requirement.id === id ? change(requirement) : requirement,
      ),
    })
  const updateOption = (
    requirementId: string,
    optionId: string,
    change: (option: AiRuleOption) => AiRuleOption,
  ) =>
    updateRequirement(requirementId, (requirement) => ({
      ...requirement,
      options: requirement.options.map((option) =>
        option.id === optionId ? change(option) : option,
      ),
    }))
  const valid = qualification.requirements.every(
    (requirement) =>
      requirement.name.trim() &&
      requirement.options.length &&
      requirement.options.every(
        (option) =>
          option.name.trim() &&
          option.conditions.length &&
          option.conditions.every(validCondition),
      ),
  )
  const newOption = (requirementId: string, index: number): AiRuleOption => {
    const id = createDraftId()
    return {
      id,
      name: `Option ${index}`,
      conditions: [createCondition(createDraftId(), requirementId, id)],
    }
  }
  return (
    <>
      <SkillBreadcrumbs skill={skill} section="qualification-rules" />
      <AiPageHeader
        title="Qualification Rules"
        eyebrow={skill.name}
        description="Organize the requirements that help your team understand service readiness."
        actions={
          <DraftButton
            draftKey={`${skillId}/qualification-rules`}
            value={qualification}
            valid={valid}
          />
        }
      />
      <AiPanel
        title="Qualification guidance"
        description="All requirements must be met. Any option can satisfy a requirement; every condition in that option must match."
      >
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="qualification-enabled">
              Qualification rules
            </FieldLabel>
            <AiSelect
              id="qualification-enabled"
              label="Qualification rules"
              value={qualification.enabled ? "enabled" : "disabled"}
              options={[
                { value: "enabled", label: "Enabled in preview" },
                { value: "disabled", label: "Disabled in preview" },
              ]}
              onChange={(value) => update({ enabled: value === "enabled" })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="qualification-summary">
              Summary for your helper
            </FieldLabel>
            <Textarea
              id="qualification-summary"
              className={TEXTAREA_CLASS}
              value={qualification.summary}
              onChange={(event) => update({ summary: event.target.value })}
            />
            <FieldDescription>
              This editor uses sample fields. No contacts are searched or
              evaluated.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </AiPanel>
      {qualification.requirements.map((requirement, requirementIndex) => (
        <AiPanel
          key={requirement.id}
          title={`Requirement ${requirementIndex + 1}`}
          actions={
            <Button
              variant="outline"
              className={SECONDARY_BUTTON}
              aria-label={`Remove requirement ${requirementIndex + 1}`}
              onClick={() =>
                update({
                  requirements: qualification.requirements.filter(
                    (item) => item.id !== requirement.id,
                  ),
                })
              }
            >
              Remove requirement
            </Button>
          }
        >
          <div className="flex flex-col gap-5">
            <Field data-invalid={!requirement.name.trim()}>
              <FieldLabel htmlFor={`${requirement.id}-name`}>
                Requirement name
              </FieldLabel>
              <Input
                id={`${requirement.id}-name`}
                className={INPUT_CLASS}
                value={requirement.name}
                aria-invalid={!requirement.name.trim()}
                aria-describedby={
                  !requirement.name.trim()
                    ? `${requirement.id}-error`
                    : undefined
                }
                onChange={(event) =>
                  updateRequirement(requirement.id, (current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
              {!requirement.name.trim() ? (
                <FieldError id={`${requirement.id}-error`}>
                  Enter a requirement name.
                </FieldError>
              ) : null}
            </Field>
            {requirement.options.map((option, optionIndex) => (
              <div key={option.id} className="flex flex-col gap-4">
                {optionIndex > 0 ? (
                  <div className="flex justify-center">
                    <Badge variant="secondary">Or</Badge>
                  </div>
                ) : null}
                <section
                  className="flex min-w-0 flex-col gap-4 rounded-2xl bg-slate-50 p-4"
                  aria-label={`Option ${optionIndex + 1}`}
                >
                  <Field data-invalid={!option.name.trim()}>
                    <FieldLabel htmlFor={`${option.id}-name`}>
                      Option name
                    </FieldLabel>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        id={`${option.id}-name`}
                        className={`${INPUT_CLASS} min-w-0 flex-1`}
                        value={option.name}
                        aria-invalid={!option.name.trim()}
                        aria-describedby={
                          !option.name.trim() ? `${option.id}-error` : undefined
                        }
                        onChange={(event) =>
                          updateOption(
                            requirement.id,
                            option.id,
                            (current) => ({
                              ...current,
                              name: event.target.value,
                            }),
                          )
                        }
                      />
                      <Button
                        variant="outline"
                        className={SECONDARY_BUTTON}
                        aria-label={`Remove option ${optionIndex + 1} from requirement ${requirementIndex + 1}`}
                        onClick={() =>
                          updateRequirement(requirement.id, (current) => ({
                            ...current,
                            options: current.options.filter(
                              (item) => item.id !== option.id,
                            ),
                          }))
                        }
                      >
                        Remove option
                      </Button>
                    </div>
                    {!option.name.trim() ? (
                      <FieldError id={`${option.id}-error`}>
                        Enter an option name.
                      </FieldError>
                    ) : null}
                  </Field>
                  {option.conditions.map((condition, index) => (
                    <div key={condition.id} className="flex flex-col gap-3">
                      {index > 0 ? (
                        <p className="text-center text-xs font-semibold text-slate-500">
                          And
                        </p>
                      ) : null}
                      <ConditionEditor
                        condition={condition}
                        onChange={(next) =>
                          updateOption(
                            requirement.id,
                            option.id,
                            (current) => ({
                              ...current,
                              conditions: current.conditions.map((item) =>
                                item.id === condition.id ? next : item,
                              ),
                            }),
                          )
                        }
                        onRemove={() =>
                          updateOption(
                            requirement.id,
                            option.id,
                            (current) => ({
                              ...current,
                              conditions: current.conditions.filter(
                                (item) => item.id !== condition.id,
                              ),
                            }),
                          )
                        }
                      />
                    </div>
                  ))}
                  {!option.conditions.length ? (
                    <FieldError>
                      Add at least one condition to this option.
                    </FieldError>
                  ) : null}
                  <Button
                    variant="outline"
                    className={`${SECONDARY_BUTTON} self-start`}
                    onClick={() =>
                      updateOption(requirement.id, option.id, (current) => ({
                        ...current,
                        conditions: [
                          ...current.conditions,
                          createCondition(
                            createDraftId(),
                            requirement.id,
                            option.id,
                          ),
                        ],
                      }))
                    }
                  >
                    <Plus data-icon="inline-start" aria-hidden="true" />
                    Add condition
                  </Button>
                </section>
              </div>
            ))}
            {!requirement.options.length ? (
              <FieldError>
                Add at least one option to this requirement.
              </FieldError>
            ) : null}
            <Button
              variant="outline"
              className={`${SECONDARY_BUTTON} self-start`}
              onClick={() =>
                updateRequirement(requirement.id, (current) => ({
                  ...current,
                  options: [
                    ...current.options,
                    newOption(requirement.id, current.options.length + 1),
                  ],
                }))
              }
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add option
            </Button>
          </div>
        </AiPanel>
      ))}
      {!qualification.requirements.length ? (
        <AiEmpty
          title="No requirements yet"
          description="Add a requirement, then define its options and conditions."
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          className={SECONDARY_BUTTON}
          onClick={() => {
            const id = createDraftId()
            update({
              requirements: [
                ...qualification.requirements,
                {
                  id,
                  name: `Requirement ${qualification.requirements.length + 1}`,
                  options: [newOption(id, 1)],
                },
              ],
            })
          }}
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add requirement
        </Button>
        <DraftButton
          draftKey={`${skillId}/qualification-rules`}
          value={qualification}
          valid={valid}
        />
      </div>
    </>
  )
}
