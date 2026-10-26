"use client"

import { useState } from "react"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DateTimeInput } from "@/components/ui/date-time-input"
import { parseDateInput } from "@/components/ui/date-input"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type {
  ServiceFitFieldDefinition,
  ServiceFitRuleDraft,
} from "../../_components/service-fit-rules-tab"
import { qualificationDirty, type AiQualification } from "../_lib/skills"
import {
  branchKey,
  conditionError,
  newCondition,
  optionDescription,
  qualificationErrors,
  qualificationGroups,
  renameOption,
  renameRequirement,
  requirementDescription,
  ruleKey,
  setOptionDescription,
  setRequirementDescription,
  uniqueRuleName,
} from "../_lib/qualification"
import {
  AiEmpty,
  AiPageHeader,
  AiPanel,
  AiSelect,
  INPUT_CLASS,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SkillBreadcrumbs,
  TEXTAREA_CLASS,
} from "./ai-ui"
import { useAiSkill } from "./ai-workspace"

const OPERATORS: Record<ServiceFitRuleDraft["operator"], string> = {
  equals: "Equals",
  not_equals: "Does not equal",
  contains: "Contains",
  not_contains: "Does not contain",
  greater_than: "Greater than",
  greater_than_or_equal: "Is at least",
  less_than: "Less than",
  less_than_or_equal: "Is at most",
  between: "Is between",
  includes_any: "Includes any",
  includes_all: "Includes all",
  excludes_all: "Excludes all",
  is_true: "Is yes",
  is_false: "Is no",
  is_empty: "Is missing",
  is_not_empty: "Is provided",
}
const noValue = new Set(["is_true", "is_false", "is_empty", "is_not_empty"])

function EditableName({
  name,
  label,
  id,
  names,
  onCommit,
}: {
  name: string
  label: string
  id: string
  names: string[]
  onCommit: (name: string) => void
}) {
  const [value, setValue] = useState(name)
  function commit() {
    const next = value.trim()
    if (
      !next ||
      names.some(
        (item) =>
          ruleKey(item) !== ruleKey(name) && ruleKey(item) === ruleKey(next),
      )
    ) {
      toast.error("Use a nonempty, unique name.")
      setValue(name)
      return
    }
    if (next !== name) onCommit(next)
  }
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        className={INPUT_CLASS}
        maxLength={120}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
      />
    </Field>
  )
}

function ComparisonValue({
  id,
  value,
  field,
  invalid,
  onChange,
}: {
  id: string
  value: unknown
  field?: ServiceFitFieldDefinition
  invalid: boolean
  onChange: (value: unknown) => void
}) {
  if (field?.valueType === "date") {
    const raw = String(value ?? "")
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
    const date = match ? `${match[2]}/${match[3]}/${match[1]}` : raw
    return (
      <DateTimeInput
        id={id}
        value={{ date, time: "" }}
        hideTime
        layout="joined"
        ariaInvalid={invalid}
        onValueChange={(next) => {
          const parsed = parseDateInput(next.date)
          onChange(
            parsed
              ? `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`
              : next.date,
          )
        }}
      />
    )
  }
  return (
    <Input
      id={id}
      type={field?.valueType === "number" ? "number" : "text"}
      className={INPUT_CLASS}
      aria-invalid={invalid}
      aria-describedby={invalid ? `${id.split("-value")[0]}-error` : undefined}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function ConditionEditor({
  rule,
  fields,
  onChange,
  onRemove,
}: {
  rule: ServiceFitRuleDraft
  fields: ServiceFitFieldDefinition[]
  onChange: (rule: ServiceFitRuleDraft) => void
  onRemove: () => void
}) {
  const field = fields.find(
    (item) => item.source === rule.source && item.fieldKey === rule.fieldKey,
  )
  const error = conditionError(rule, fields)
  const id = `condition-${rule.id}`
  const range = (rule.compareValue ?? {}) as { min?: unknown; max?: unknown }
  const selected = Array.isArray(rule.compareValue)
    ? rule.compareValue.filter(
        (item): item is string => typeof item === "string",
      )
    : []
  const arrayOptions = [
    ...(field?.options ?? []),
    ...selected
      .filter(
        (value) => !field?.options.some((option) => option.value === value),
      )
      .map((value) => ({ value, label: `${value} (saved, unavailable)` })),
  ]
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Badge variant="outline">
          {rule.required
            ? ruleKey(rule.requiredGroup)
              ? "AND condition"
              : "Shared required condition"
            : "Scored condition"}
        </Badge>
        <Button
          type="button"
          variant="outline"
          className={SECONDARY_BUTTON}
          onClick={onRemove}
          aria-label={`Remove ${rule.label || field?.label || "saved"} condition`}
        >
          Remove condition
        </Button>
      </div>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Condition name</FieldLabel>
          <Input
            id={`${id}-name`}
            className={INPUT_CLASS}
            maxLength={160}
            value={rule.label ?? ""}
            onChange={(event) =>
              onChange({ ...rule, label: event.target.value || null })
            }
            placeholder={field?.label ?? "Condition name"}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-description`}>
            Condition description
          </FieldLabel>
          <Input
            id={`${id}-description`}
            className={INPUT_CLASS}
            maxLength={300}
            value={rule.explanation ?? ""}
            onChange={(event) =>
              onChange({ ...rule, explanation: event.target.value || null })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-field`}>Field</FieldLabel>
          <AiSelect
            id={`${id}-field`}
            label="Condition field"
            value={`${rule.source}:${rule.fieldKey}`}
            options={[
              ...(!field
                ? [
                    {
                      value: `${rule.source}:${rule.fieldKey}`,
                      label: `${rule.fieldKey} (saved, unavailable)`,
                    },
                  ]
                : []),
              ...fields.map((item) => ({
                value: `${item.source}:${item.fieldKey}`,
                label: `${item.label} · ${item.source}`,
              })),
            ]}
            onChange={(value) => {
              const next = fields.find(
                (item) => `${item.source}:${item.fieldKey}` === value,
              )
              if (next) {
                const condition = newCondition(next, rule.required)
                onChange({
                  ...rule,
                  source: condition.source,
                  fieldKey: condition.fieldKey,
                  valueType: condition.valueType,
                  operator: condition.operator,
                  compareValue: condition.compareValue,
                })
              }
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-operator`}>Operator</FieldLabel>
          <AiSelect
            id={`${id}-operator`}
            label="Condition operator"
            value={rule.operator}
            options={[
              ...new Set([...(field?.operators ?? []), rule.operator]),
            ].map((value) => ({ value, label: OPERATORS[value] }))}
            onChange={(operator) =>
              onChange({
                ...rule,
                operator: operator as ServiceFitRuleDraft["operator"],
                compareValue: noValue.has(operator)
                  ? null
                  : operator === "between"
                    ? { min: "", max: "" }
                    : rule.valueType === "stringArray"
                      ? []
                      : "",
              })
            }
          />
        </Field>
        {!noValue.has(rule.operator) ? (
          rule.operator === "between" ? (
            <>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor={`${id}-value-min`}>Minimum</FieldLabel>
                <ComparisonValue
                  id={`${id}-value-min`}
                  value={range.min}
                  field={field}
                  invalid={Boolean(error)}
                  onChange={(min) =>
                    onChange({ ...rule, compareValue: { ...range, min } })
                  }
                />
              </Field>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor={`${id}-value-max`}>Maximum</FieldLabel>
                <ComparisonValue
                  id={`${id}-value-max`}
                  value={range.max}
                  field={field}
                  invalid={Boolean(error)}
                  onChange={(max) =>
                    onChange({ ...rule, compareValue: { ...range, max } })
                  }
                />
              </Field>
            </>
          ) : (
            <Field className="sm:col-span-2" data-invalid={Boolean(error)}>
              <FieldLabel htmlFor={`${id}-value`}>Comparison value</FieldLabel>
              {field?.valueType === "stringArray" ? (
                <div
                  id={`${id}-value`}
                  className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3"
                  role="group"
                  aria-label="Comparison values"
                >
                  {arrayOptions.map((option, index) => (
                    <Field key={option.value} orientation="horizontal">
                      <Checkbox
                        id={`${id}-choice-${index}`}
                        checked={selected.includes(option.value)}
                        onCheckedChange={(checked) =>
                          onChange({
                            ...rule,
                            compareValue: checked
                              ? [...new Set([...selected, option.value])]
                              : selected.filter(
                                  (value) => value !== option.value,
                                ),
                          })
                        }
                      />
                      <FieldLabel htmlFor={`${id}-choice-${index}`}>
                        {option.label}
                      </FieldLabel>
                    </Field>
                  ))}
                  {!arrayOptions.length ? (
                    <p className="text-xs text-slate-500">
                      No choices are available in this field.
                    </p>
                  ) : null}
                </div>
              ) : field?.options.length ? (
                <AiSelect
                  id={`${id}-value`}
                  label="Comparison value"
                  value={String(rule.compareValue ?? "") || "__choose__"}
                  options={[
                    { value: "__choose__", label: "Choose a value" },
                    ...(!field.options.some(
                      (item) => item.value === rule.compareValue,
                    ) && rule.compareValue
                      ? [
                          {
                            value: String(rule.compareValue),
                            label: `${String(rule.compareValue)} (saved, unavailable)`,
                          },
                        ]
                      : []),
                    ...field.options,
                  ]}
                  onChange={(value) =>
                    onChange({
                      ...rule,
                      compareValue: value === "__choose__" ? "" : value,
                    })
                  }
                />
              ) : (
                <ComparisonValue
                  id={`${id}-value`}
                  value={rule.compareValue}
                  field={field}
                  invalid={Boolean(error)}
                  onChange={(compareValue) =>
                    onChange({ ...rule, compareValue })
                  }
                />
              )}
            </Field>
          )
        ) : null}
        {!rule.required ? (
          <Field>
            <FieldLabel htmlFor={`${id}-weight`}>Score weight</FieldLabel>
            <Input
              id={`${id}-weight`}
              type="number"
              min={1}
              max={10}
              step={1}
              className={INPUT_CLASS}
              value={rule.weight}
              onChange={(event) =>
                onChange({
                  ...rule,
                  weight: Math.min(
                    10,
                    Math.max(1, Math.round(Number(event.target.value) || 1)),
                  ),
                })
              }
            />
            <FieldDescription>
              Weights affect ranking, without blocking qualification.
            </FieldDescription>
          </Field>
        ) : null}
      </FieldGroup>
      {error ? (
        <FieldError id={`${id}-error`} className="mt-3">
          {error}
        </FieldError>
      ) : null}
    </div>
  )
}

export function AiQualificationEditor({ skillId }: { skillId: string }) {
  const {
    skill,
    fieldCatalog,
    updateSkill,
    savingSkillId,
    savingKnowledgeId,
    catalogBusy,
    saveQualification,
    skillErrors,
    skillConflicts,
    resolveQualificationConflict,
  } = useAiSkill(skillId)
  const value = skill.qualification
  const groups = qualificationGroups(value)
  const errors = qualificationErrors(value, fieldCatalog)
  const conflict = skillConflicts[skillId]
  const busy =
    savingSkillId !== null || savingKnowledgeId !== null || catalogBusy
  const disabled = busy || Boolean(skill.qualificationReadOnlyReason)
  const update = (qualification: AiQualification) =>
    updateSkill(skillId, (current) => ({ ...current, qualification }))
  const updateRule = (rule: ServiceFitRuleDraft) =>
    update({
      ...value,
      rules: value.rules.map((item) => (item.id === rule.id ? rule : item)),
    })
  const removeRule = (id: string) =>
    update({ ...value, rules: value.rules.filter((item) => item.id !== id) })
  const addRule = (
    required: boolean,
    group: string | null = null,
    option: string | null = null,
  ) => {
    if (fieldCatalog[0])
      update({
        ...value,
        rules: [
          ...value.rules,
          newCondition(fieldCatalog[0], required, group, option),
        ],
      })
  }
  const saveButton = qualificationDirty(skill) ? (
    <Button
      type="button"
      className={PRIMARY_BUTTON}
      disabled={disabled || Boolean(conflict) || Object.keys(errors).length > 0}
      onClick={() => void saveQualification(skill)}
    >
      {savingSkillId === skillId ? (
        <Loader2
          data-icon="inline-start"
          className="animate-spin"
          aria-hidden="true"
        />
      ) : null}
      {savingSkillId === skillId ? "Saving…" : "Save changes"}
    </Button>
  ) : null
  const condition = (rule: ServiceFitRuleDraft) => (
    <ConditionEditor
      key={rule.id}
      rule={rule}
      fields={fieldCatalog}
      onChange={updateRule}
      onRemove={() => removeRule(rule.id)}
    />
  )
  return (
    <>
      <SkillBreadcrumbs skill={skill} section="qualification-rules" />
      <AiPageHeader
        title="Qualification Rules"
        eyebrow={skill.name}
        description="Define eligibility requirements and optional scoring conditions."
        actions={saveButton}
      />
      {!skill.availableToAssistant ? (
        <Alert className="rounded-2xl">
          <AlertTitle>Inactive service</AlertTitle>
          <AlertDescription>
            You can manage these rules here. This skill is excluded from
            assistant answers and fit scans while it or its parent service is
            inactive.
          </AlertDescription>
        </Alert>
      ) : null}
      {skill.qualificationReadOnlyReason ? (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertTitle>Saved profile needs review</AlertTitle>
          <AlertDescription>
            {skill.qualificationReadOnlyReason}
          </AlertDescription>
        </Alert>
      ) : null}
      {skillErrors[skillId] ? (
        <Alert variant="destructive" className="rounded-2xl" role="alert">
          <AlertTitle>Rules were not saved</AlertTitle>
          <AlertDescription>{skillErrors[skillId]}</AlertDescription>
        </Alert>
      ) : null}
      {conflict ? (
        <Alert className="rounded-2xl border-amber-200 bg-amber-50">
          <AlertTitle>Newer service information was saved</AlertTitle>
          <AlertDescription className="gap-3">
            <p>
              Your rules are still in the form. The saved version has{" "}
              {conflict.skill.qualification.rules.length} conditions, with
              qualification{" "}
              {conflict.skill.qualification.enabled ? "enabled" : "disabled"}.
            </p>
            <p className="max-h-28 overflow-auto whitespace-pre-wrap break-words">
              {conflict.skill.qualification.summary ||
                "No saved qualification summary."}
            </p>
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Review saved rules
              </summary>
              <ul className="mt-2 max-h-64 space-y-3 overflow-auto rounded-xl bg-white p-3 text-sm">
                {conflict.skill.qualification.rules.map((rule) => {
                  const field = conflict.fields.find(
                    (item) =>
                      item.source === rule.source &&
                      item.fieldKey === rule.fieldKey,
                  )
                  const comparison =
                    rule.operator === "between" &&
                    rule.compareValue &&
                    typeof rule.compareValue === "object" &&
                    !Array.isArray(rule.compareValue)
                      ? `${String((rule.compareValue as { min?: unknown }).min)} – ${String((rule.compareValue as { max?: unknown }).max)}`
                      : (Array.isArray(rule.compareValue)
                          ? rule.compareValue
                          : [rule.compareValue]
                        )
                          .filter((value) => value !== null)
                          .map(
                            (value) =>
                              field?.options.find(
                                (item) => item.value === value,
                              )?.label ?? String(value),
                          )
                          .join(", ")
                  return (
                    <li key={rule.id} className="flex flex-col gap-1">
                      <span className="font-medium">
                        {rule.label || field?.label || rule.fieldKey}:{" "}
                        {OPERATORS[rule.operator]}
                        {comparison ? ` ${comparison}` : ""}
                      </span>
                      <span className="text-xs">
                        {rule.required
                          ? [
                              rule.requiredGroup || "Shared required",
                              rule.requiredBranch,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : `Optional · weight ${rule.weight}`}
                      </span>
                      {rule.explanation ? (
                        <span className="text-xs">{rule.explanation}</span>
                      ) : null}
                    </li>
                  )
                })}
                {!conflict.skill.qualification.rules.length ? (
                  <li>No saved conditions.</li>
                ) : null}
              </ul>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className={SECONDARY_BUTTON}
                onClick={() => resolveQualificationConflict(skill, false)}
              >
                Use saved rules
              </Button>
              <Button
                type="button"
                variant="outline"
                className={SECONDARY_BUTTON}
                onClick={() => resolveQualificationConflict(skill, true)}
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
        disabled={disabled}
        className="flex min-w-0 flex-col gap-4"
        aria-label="Qualification configuration"
      >
        <AiPanel
          title="Qualification guidance"
          description="Shared conditions and all requirements must pass. Within each requirement, any option may pass; every condition in that option must match."
        >
          <FieldGroup className="gap-5">
            <Field orientation="horizontal">
              <Checkbox
                id="qualification-enabled"
                checked={value.enabled}
                onCheckedChange={(checked) =>
                  update({ ...value, enabled: checked === true })
                }
              />
              <FieldLabel htmlFor="qualification-enabled">
                Enable qualification for this skill
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel htmlFor="qualification-summary">
                Ideal candidate / intake notes
              </FieldLabel>
              <Textarea
                id="qualification-summary"
                className={TEXTAREA_CLASS}
                maxLength={2000}
                value={value.summary}
                onChange={(event) =>
                  update({ ...value, summary: event.target.value })
                }
              />
            </Field>
          </FieldGroup>
        </AiPanel>
        <AiPanel
          title="Shared required conditions"
          description="These conditions must match for every qualifying contact."
          actions={
            <Button
              type="button"
              variant="outline"
              className={SECONDARY_BUTTON}
              onClick={() => addRule(true)}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add shared condition
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            {value.rules
              .filter((rule) => rule.required && !ruleKey(rule.requiredGroup))
              .map(condition)}
            {!value.rules.some(
              (rule) => rule.required && !ruleKey(rule.requiredGroup),
            ) ? (
              <p className="text-sm text-slate-500">No shared conditions.</p>
            ) : null}
          </div>
        </AiPanel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <h2 className="text-base font-semibold text-slate-950">
            Requirements and options
          </h2>
          <Button
            type="button"
            variant="outline"
            className={SECONDARY_BUTTON}
            onClick={() => {
              if (!fieldCatalog[0]) return
              const name = uniqueRuleName(
                groups.map((group) => group.name),
                "Requirement",
              )
              update(
                setRequirementDescription(
                  {
                    ...value,
                    rules: [
                      ...value.rules,
                      newCondition(fieldCatalog[0], true, name, "Option 1"),
                    ],
                  },
                  name,
                  "",
                ),
              )
            }}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add requirement
          </Button>
        </div>
        {groups.map((group) => (
          <AiPanel
            key={group.rules[0].id}
            title={group.name}
            description="Any option below may satisfy this requirement."
            actions={
              <Button
                type="button"
                variant="outline"
                className={SECONDARY_BUTTON}
                onClick={() =>
                  update({
                    ...value,
                    rules: value.rules.filter(
                      (rule) =>
                        !(
                          rule.required &&
                          ruleKey(rule.requiredGroup) === ruleKey(group.name)
                        ),
                    ),
                    requirementMetadata: value.requirementMetadata.filter(
                      (item) => ruleKey(item.name) !== ruleKey(group.name),
                    ),
                    optionMetadata: value.optionMetadata.filter(
                      (item) =>
                        ruleKey(item.requirementName) !== ruleKey(group.name),
                    ),
                  })
                }
              >
                Remove requirement
              </Button>
            }
          >
            <div className="flex flex-col gap-5">
              <EditableName
                key={group.name}
                id={`requirement-${group.rules[0].id}`}
                label="Requirement name"
                name={group.name}
                names={groups.map((item) => item.name)}
                onCommit={(name) =>
                  update(renameRequirement(value, group.name, name))
                }
              />
              <Field>
                <FieldLabel
                  htmlFor={`requirement-description-${group.rules[0].id}`}
                >
                  Requirement description
                </FieldLabel>
                <Textarea
                  id={`requirement-description-${group.rules[0].id}`}
                  className={TEXTAREA_CLASS}
                  maxLength={2000}
                  value={requirementDescription(value, group.name)}
                  onChange={(event) =>
                    update(
                      setRequirementDescription(
                        value,
                        group.name,
                        event.target.value,
                      ),
                    )
                  }
                />
              </Field>
              {group.options.map((option, index) => (
                <div
                  key={option.rules[0].id}
                  className="flex min-w-0 flex-col gap-4 rounded-2xl border border-blue-100 bg-blue-50/30 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant="outline">
                      {index ? "OR · " : ""}Option {index + 1}
                    </Badge>
                    <Button
                      type="button"
                      variant="outline"
                      className={SECONDARY_BUTTON}
                      onClick={() =>
                        update({
                          ...value,
                          rules: value.rules.filter(
                            (rule) =>
                              !(
                                rule.required &&
                                ruleKey(rule.requiredGroup) ===
                                  ruleKey(group.name) &&
                                branchKey(rule) === ruleKey(option.name)
                              ),
                          ),
                          optionMetadata: value.optionMetadata.filter(
                            (item) =>
                              !(
                                ruleKey(item.requirementName) ===
                                  ruleKey(group.name) &&
                                ruleKey(item.optionName) ===
                                  ruleKey(option.name)
                              ),
                          ),
                        })
                      }
                    >
                      Remove option
                    </Button>
                  </div>
                  <EditableName
                    key={option.name}
                    id={`option-${option.rules[0].id}`}
                    label="Option name"
                    name={option.name}
                    names={group.options.map((item) => item.name)}
                    onCommit={(name) =>
                      update(renameOption(value, group.name, option.name, name))
                    }
                  />
                  <Field>
                    <FieldLabel
                      htmlFor={`option-description-${option.rules[0].id}`}
                    >
                      Option description
                    </FieldLabel>
                    <Textarea
                      id={`option-description-${option.rules[0].id}`}
                      className={TEXTAREA_CLASS}
                      maxLength={2000}
                      value={optionDescription(value, group.name, option.name)}
                      onChange={(event) =>
                        update(
                          setOptionDescription(
                            value,
                            group.name,
                            option.name,
                            event.target.value,
                          ),
                        )
                      }
                    />
                  </Field>
                  {option.rules.map(condition)}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      className={SECONDARY_BUTTON}
                      onClick={() => addRule(true, group.name, option.name)}
                    >
                      Add AND condition
                    </Button>
                  </div>
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  className={SECONDARY_BUTTON}
                  onClick={() =>
                    addRule(
                      true,
                      group.name,
                      uniqueRuleName(
                        group.options.map((item) => item.name),
                        "Option",
                      ),
                    )
                  }
                >
                  Add alternative option
                </Button>
              </div>
            </div>
          </AiPanel>
        ))}
        {!groups.length ? (
          <AiEmpty
            title="No grouped requirements"
            description="Add a requirement when more than one option can qualify a contact."
          />
        ) : null}
        <AiPanel
          title="Scored conditions"
          description="Optional conditions affect fit scores without deciding eligibility."
          actions={
            <Button
              type="button"
              variant="outline"
              className={SECONDARY_BUTTON}
              onClick={() => addRule(false)}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add scored condition
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            {value.rules.filter((rule) => !rule.required).map(condition)}
            {!value.rules.some((rule) => !rule.required) ? (
              <p className="text-sm text-slate-500">No scored conditions.</p>
            ) : null}
          </div>
        </AiPanel>
      </fieldset>
      <div className="flex justify-end">{saveButton}</div>
    </>
  )
}
