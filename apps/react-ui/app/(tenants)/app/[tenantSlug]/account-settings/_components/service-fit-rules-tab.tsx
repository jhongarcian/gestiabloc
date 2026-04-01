"use client"

import { isAxiosError } from "axios"
import { CircleHelp, Loader2, Plus, Search, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

export type ServiceFitFieldOption = {
  value: string
  label: string
}

export type ServiceFitFieldDefinition = {
  source: "core" | "status" | "tags" | "custom" | "derived"
  fieldKey: string
  label: string
  description: string | null
  valueType: "string" | "number" | "date" | "boolean" | "stringArray"
  operators: Array<
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "greater_than"
    | "greater_than_or_equal"
    | "less_than"
    | "less_than_or_equal"
    | "between"
    | "includes_any"
    | "includes_all"
    | "excludes_all"
    | "is_true"
    | "is_false"
    | "is_empty"
    | "is_not_empty"
  >
  options: ServiceFitFieldOption[]
}

export type ServiceFitRuleDraft = {
  id: string
  source: ServiceFitFieldDefinition["source"]
  fieldKey: string
  valueType: ServiceFitFieldDefinition["valueType"]
  operator: ServiceFitFieldDefinition["operators"][number]
  compareValue: unknown
  required: boolean
  requiredGroup: string | null
  requiredBranch: string | null
  weight: number
  label: string | null
  explanation: string | null
}

export type ServiceFitProfileDraft = {
  enabled: boolean
  summary: string
  rules: ServiceFitRuleDraft[]
}

export const EMPTY_SERVICE_FIT_PROFILE: ServiceFitProfileDraft = {
  enabled: false,
  summary: "",
  rules: [],
}

type ContactSearchResult = {
  id: string
  fullName: string
  email: string | null
  phoneNumber: string | null
}

type ContactSearchResponse = {
  ok: boolean
  items: ContactSearchResult[]
}

type FitFieldCatalogResponse = {
  ok: boolean
  fields: ServiceFitFieldDefinition[]
}

type FitPreviewResponse = {
  ok: boolean
  result: {
    eligibilityStatus: "ELIGIBLE" | "NEEDS_INFO" | "NOT_ELIGIBLE"
    fitScore: number
    summary: string
    matchedRules: Array<{ ruleId: string; label: string; reason: string }>
    blockingRules: Array<{ ruleId: string; label: string; reason: string }>
    missingRules: Array<{ ruleId: string; label: string; reason: string }>
  }
}

type ServiceFitRulesTabProps = {
  tenantId: string
  profile?: ServiceFitProfileDraft | null
  onChange: (profile: ServiceFitProfileDraft) => void
}

const OPERATOR_LABELS: Record<ServiceFitRuleDraft["operator"], string> = {
  equals: "Equals",
  not_equals: "Does not equal",
  contains: "Contains",
  not_contains: "Does not contain",
  greater_than: "Greater than",
  greater_than_or_equal: "Greater than or equal",
  less_than: "Less than",
  less_than_or_equal: "Less than or equal",
  between: "Between",
  includes_any: "Includes any",
  includes_all: "Includes all",
  excludes_all: "Excludes all",
  is_true: "Is yes",
  is_false: "Is no",
  is_empty: "Is empty",
  is_not_empty: "Is not empty",
}

const SOURCE_LABELS: Record<ServiceFitFieldDefinition["source"], string> = {
  core: "Core",
  status: "Status",
  tags: "Tags",
  custom: "Custom",
  derived: "Derived",
}

function createDraftId() {
  return `fit-rule-${Date.now()}-${Math.round(Math.random() * 1000)}`
}

function createDefaultBranchName(existingGroups: string[]) {
  let index = 1
  while (existingGroups.includes(`Branch ${index}`)) {
    index += 1
  }
  return `Branch ${index}`
}

function createDefaultRequirementName(existingGroups: string[]) {
  let index = 1
  while (existingGroups.includes(`Requirement ${index}`)) {
    index += 1
  }
  return `Requirement ${index}`
}

function getDefaultCompareValue(field: ServiceFitFieldDefinition) {
  if (field.valueType === "boolean") return null
  if (field.valueType === "stringArray") return field.options[0] ? [field.options[0].value] : []
  if (field.valueType === "number") return ""
  if (field.valueType === "date") return ""
  return field.options[0]?.value ?? ""
}

function getInitialOperator(field: ServiceFitFieldDefinition) {
  return field.operators[0] ?? "equals"
}

function createRuleFromField(field: ServiceFitFieldDefinition): ServiceFitRuleDraft {
  return {
    id: createDraftId(),
    source: field.source,
    fieldKey: field.fieldKey,
    valueType: field.valueType,
    operator: getInitialOperator(field),
    compareValue: getDefaultCompareValue(field),
    required: true,
    requiredGroup: null,
    requiredBranch: null,
    weight: 1,
    label: null,
    explanation: null,
  }
}

function shouldShowCompareValue(rule: ServiceFitRuleDraft) {
  return !["is_true", "is_false", "is_empty", "is_not_empty"].includes(rule.operator)
}

function normalizeRuleForPreview(rule: ServiceFitRuleDraft, field: ServiceFitFieldDefinition | undefined) {
  const compareValue = (() => {
    if (!field) return rule.compareValue
    if (!shouldShowCompareValue(rule)) return null

    if (rule.operator === "between") {
      const current = (rule.compareValue as { min?: unknown; max?: unknown } | null) ?? {}
      return {
        min: typeof current.min === "string" ? current.min : String(current.min ?? ""),
        max: typeof current.max === "string" ? current.max : String(current.max ?? ""),
      }
    }

    if (field.valueType === "stringArray") {
      return Array.isArray(rule.compareValue) ? rule.compareValue : []
    }

    if (typeof rule.compareValue === "string") {
      return rule.compareValue
    }

    return rule.compareValue ?? ""
  })()

  return {
    ...rule,
    compareValue,
    requiredGroup: rule.required ? rule.requiredGroup?.trim() || null : null,
    requiredBranch: rule.required ? rule.requiredBranch?.trim() || null : null,
    weight: rule.required ? 1 : Math.max(1, Math.min(10, Number(rule.weight) || 1)),
    label: rule.label?.trim() || null,
    explanation: rule.explanation?.trim() || null,
  }
}

export function ServiceFitRulesTab({
  tenantId,
  profile,
  onChange,
}: ServiceFitRulesTabProps) {
  const safeProfile = profile ?? EMPTY_SERVICE_FIT_PROFILE
  const [fields, setFields] = useState<ServiceFitFieldDefinition[]>([])
  const [isLoadingFields, setIsLoadingFields] = useState(false)
  const [contactSearchQuery, setContactSearchQuery] = useState("")
  const [contactResults, setContactResults] = useState<ContactSearchResult[]>([])
  const [isSearchingContacts, setIsSearchingContacts] = useState(false)
  const [selectedContact, setSelectedContact] = useState<ContactSearchResult | null>(null)
  const [isRunningPreview, setIsRunningPreview] = useState(false)
  const [previewResult, setPreviewResult] = useState<FitPreviewResponse["result"] | null>(null)

  const fieldOptions = useMemo(
    () =>
      fields.map((field) => ({
        value: `${field.source}:${field.fieldKey}`,
        label: `${SOURCE_LABELS[field.source]} · ${field.label}`,
      })),
    [fields],
  )

  const fieldMap = useMemo(
    () =>
      new Map<string, ServiceFitFieldDefinition>(
        fields.map((field) => [`${field.source}:${field.fieldKey}`, field] as const),
      ),
    [fields],
  )

  const requiredGroupOptions = useMemo(() => {
    const groups = [
      ...new Set(
        safeProfile.rules
          .map((rule) => rule.requiredGroup?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ]
    return groups.sort((a, b) => a.localeCompare(b))
  }, [safeProfile.rules])

  const groupedRequirements = useMemo(() => {
    const groups = new Map<
      string,
      {
        name: string
        branches: Map<
          string,
          {
            name: string
            rules: ServiceFitRuleDraft[]
          }
        >
      }
    >()

    safeProfile.rules.forEach((rule) => {
      if (!rule.required || !(rule.requiredGroup?.trim() || rule.requiredBranch?.trim())) return

      const groupName = rule.requiredBranch?.trim()
        ? rule.requiredGroup?.trim() || createDefaultRequirementName([])
        : "Qualification requirement"
      const branchName = rule.requiredBranch?.trim() || rule.requiredGroup?.trim() || "Branch 1"

      const group = groups.get(groupName) ?? {
        name: groupName,
        branches: new Map(),
      }
      const branch = group.branches.get(branchName) ?? {
        name: branchName,
        rules: [],
      }
      branch.rules.push(rule)
      group.branches.set(branchName, branch)
      groups.set(groupName, group)
    })

    return [...groups.values()]
      .map((group) => ({
        name: group.name,
        branches: [...group.branches.values()].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [safeProfile.rules])

  const qualificationSummary = useMemo(() => {
    const alwaysRequiredRules = safeProfile.rules.filter(
      (rule) => rule.required && !(rule.requiredGroup?.trim() || null),
    )
    const requirementMap = new Map<
      string,
      {
        branchCount: number
        labels: string[]
      }
    >()

    groupedRequirements.forEach((requirement) => {
      const labels = requirement.branches.flatMap((branch) =>
        branch.rules.map((rule) => {
          const field = fieldMap.get(`${rule.source}:${rule.fieldKey}`)
          return rule.label?.trim() || field?.label || "Untitled rule"
        }),
      )
      requirementMap.set(requirement.name, {
        branchCount: requirement.branches.length,
        labels,
      })
    })

    return {
      alwaysRequiredCount: alwaysRequiredRules.length,
      requirementCount: requirementMap.size,
      requirements: [...requirementMap.entries()]
        .map(([name, item]) => ({ name, ...item }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  }, [fieldMap, groupedRequirements, safeProfile.rules])

  const alwaysRequiredRules = useMemo(
    () => safeProfile.rules.filter((rule) => rule.required && !(rule.requiredGroup?.trim() || null)),
    [safeProfile.rules],
  )

  const scoredRules = useMemo(
    () => safeProfile.rules.filter((rule) => !rule.required),
    [safeProfile.rules],
  )

  useEffect(() => {
    let cancelled = false

    const loadFields = async () => {
      setIsLoadingFields(true)

      try {
        const { data } = await api.get<FitFieldCatalogResponse>(
          `/api/account-settings/${encodeURIComponent(tenantId)}/service-fit-fields`,
        )

        if (cancelled) return
        setFields(data.fields ?? [])
      } catch {
        if (cancelled) return
        setFields([])
        toast.error("Could not load service fit fields.")
      } finally {
        if (cancelled) return
        setIsLoadingFields(false)
      }
    }

    void loadFields()

    return () => {
      cancelled = true
    }
  }, [tenantId])

  useEffect(() => {
    if (selectedContact || contactSearchQuery.trim().length < 2) {
      setContactResults([])
      setIsSearchingContacts(false)
      return
    }

    let cancelled = false
    const timeout = window.setTimeout(async () => {
      setIsSearchingContacts(true)

      try {
        const { data } = await api.get<ContactSearchResponse>(
          `/api/contacts/${encodeURIComponent(tenantId)}/search`,
          {
            params: { q: contactSearchQuery.trim() },
          },
        )

        if (cancelled) return
        setContactResults(data.items ?? [])
      } catch {
        if (cancelled) return
        setContactResults([])
      } finally {
        if (cancelled) return
        setIsSearchingContacts(false)
      }
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [contactSearchQuery, selectedContact, tenantId])

  const updateRule = (ruleId: string, updater: (rule: ServiceFitRuleDraft) => ServiceFitRuleDraft) => {
    onChange({
      ...safeProfile,
      rules: safeProfile.rules.map((rule) => (rule.id === ruleId ? updater(rule) : rule)),
    })
  }

  const removeRule = (ruleId: string) => {
    onChange({
      ...safeProfile,
      rules: safeProfile.rules.filter((rule) => rule.id !== ruleId),
    })
  }

  const addRule = (overrides?: Partial<ServiceFitRuleDraft>) => {
    const firstField = fields[0]
    if (!firstField) {
      toast.error("No fields are available for service fit yet.")
      return
    }

    const baseRule = createRuleFromField(firstField)
    onChange({
      ...safeProfile,
      rules: [
        ...safeProfile.rules,
        {
          ...baseRule,
          ...overrides,
          requiredGroup:
            overrides?.required === false
              ? null
              : overrides?.requiredGroup ?? baseRule.requiredGroup,
          requiredBranch:
            overrides?.required === false
              ? null
              : overrides?.requiredBranch ?? baseRule.requiredBranch,
        },
      ],
    })
  }

  const addAlwaysRequiredRule = () => {
    addRule({
      required: true,
      requiredGroup: null,
      requiredBranch: null,
      weight: 1,
    })
  }

  const addQualificationRequirement = () => {
    const requirementName = createDefaultRequirementName(requiredGroupOptions)
    const branchName = createDefaultBranchName([])
    addRule({
      required: true,
      requiredGroup: requirementName,
      requiredBranch: branchName,
      weight: 1,
      label: null,
      explanation: null,
    })
  }

  const addQualificationOption = () => {
    const primaryRequirementName = groupedRequirements[0]?.name
    if (!primaryRequirementName) {
      addQualificationRequirement()
      return
    }

    addBranchToRequirement(primaryRequirementName)
  }

  const addBranchToRequirement = (requirementName: string) => {
    const existingBranches = groupedRequirements
      .find((requirement) => requirement.name === requirementName)
      ?.branches.map((branch) => branch.name) ?? []
    const branchName = createDefaultBranchName(existingBranches)
    addRule({
      required: true,
      requiredGroup: requirementName,
      requiredBranch: branchName,
      weight: 1,
    })
  }

  const addRuleToBranch = (requirementName: string, branchName: string) => {
    addRule({
      required: true,
      requiredGroup: requirementName,
      requiredBranch: branchName,
      weight: 1,
    })
  }

  const addScoredRule = () => {
    addRule({
      required: false,
      requiredGroup: null,
      requiredBranch: null,
      weight: 1,
    })
  }

  const removeRequirement = (requirementName: string) => {
    onChange({
      ...safeProfile,
      rules: safeProfile.rules.filter(
        (rule) => !(rule.required && (rule.requiredGroup?.trim() || "") === requirementName),
      ),
    })
  }

  const removeBranch = (requirementName: string, branchName: string) => {
    onChange({
      ...safeProfile,
      rules: safeProfile.rules.filter(
        (rule) =>
          !(
            rule.required &&
            (rule.requiredGroup?.trim() || "") === requirementName &&
            (rule.requiredBranch?.trim() || "") === branchName
          ),
      ),
    })
  }

  const runPreview = async () => {
    if (!selectedContact) {
      toast.error("Select a contact to preview.")
      return
    }

    setIsRunningPreview(true)
    setPreviewResult(null)

    try {
      const { data } = await api.post<FitPreviewResponse>(
        `/api/services/${encodeURIComponent(tenantId)}/fit-scan/preview`,
        {
          contactId: selectedContact.id,
          fitProfile: {
            enabled: safeProfile.enabled,
            summary: safeProfile.summary,
            rules: safeProfile.rules.map((rule) =>
              normalizeRuleForPreview(
                rule,
                fieldMap.get(`${rule.source}:${rule.fieldKey}`),
              ),
            ),
          },
        },
      )

      setPreviewResult(data.result)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.details || error.response?.data?.error
        toast.error(
          typeof backendError === "string" ? backendError : "Could not run fit preview.",
        )
      } else {
        toast.error("Could not run fit preview.")
      }
    } finally {
      setIsRunningPreview(false)
    }
  }

  const renderRuleEditor = (
    rule: ServiceFitRuleDraft,
    title: string,
    mode: "shared" | "option" | "scored",
  ) => {
    const field = fieldMap.get(`${rule.source}:${rule.fieldKey}`)
    const operatorOptions = field?.operators ?? []
    const compareValue = (rule.compareValue as { min?: unknown; max?: unknown } | null) ?? {}

    return (
      <article key={rule.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="text-xs text-slate-500">
              {field ? `${SOURCE_LABELS[field.source]} field` : "Select a field"}
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            className="cursor-pointer border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
            onClick={() => removeRule(rule.id)}
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="grid gap-2">
            <Label>Field</Label>
            <Select
              value={`${rule.source}:${rule.fieldKey}`}
              onValueChange={(value) => {
                const nextField = fieldMap.get(value)
                if (!nextField) return
                updateRule(rule.id, (current) => ({
                  ...createRuleFromField(nextField),
                  id: current.id,
                  required: current.required,
                  requiredGroup: current.required ? current.requiredGroup : null,
                  requiredBranch: current.required ? current.requiredBranch : null,
                  weight: current.required ? 1 : current.weight,
                  label: current.label,
                  explanation: current.explanation,
                }))
              }}
            >
              <SelectTrigger className="cursor-pointer">
                <SelectValue placeholder="Select a field" />
              </SelectTrigger>
              <SelectContent>
                {fieldOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Operator</Label>
            <Select
              value={rule.operator}
              onValueChange={(value) =>
                updateRule(rule.id, (current) => ({
                  ...current,
                  operator: value as ServiceFitRuleDraft["operator"],
                  compareValue:
                    value === "between"
                      ? { min: "", max: "" }
                      : value === "is_true" ||
                          value === "is_false" ||
                          value === "is_empty" ||
                          value === "is_not_empty"
                        ? null
                        : field
                          ? getDefaultCompareValue(field)
                          : current.compareValue,
                }))
              }
            >
              <SelectTrigger className="cursor-pointer">
                <SelectValue placeholder="Select an operator" />
              </SelectTrigger>
              <SelectContent>
                {operatorOptions.map((operator) => (
                  <SelectItem key={operator} value={operator}>
                    {OPERATOR_LABELS[operator]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Condition label</Label>
            <Input
              value={rule.label ?? ""}
              onChange={(event) =>
                updateRule(rule.id, (current) => ({
                  ...current,
                  label: event.target.value || null,
                }))
              }
              placeholder={field?.label ?? "Condition label"}
            />
          </div>

          <div className="grid gap-2">
            <Label className="flex items-center gap-1.5">
              Admin note
              <CircleHelp className="h-3.5 w-3.5 text-slate-400" />
            </Label>
            <Input
              value={rule.explanation ?? ""}
              onChange={(event) =>
                updateRule(rule.id, (current) => ({
                  ...current,
                  explanation: event.target.value || null,
                }))
              }
              placeholder="Optional note about why this condition matters"
            />
          </div>

          {shouldShowCompareValue(rule) ? (
            <div className="grid gap-2 lg:col-span-2">
              <Label>Compare value</Label>
              {rule.operator === "between" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    type={field?.valueType === "number" ? "number" : field?.valueType === "date" ? "date" : "text"}
                    value={typeof compareValue.min === "string" ? compareValue.min : String(compareValue.min ?? "")}
                    onChange={(event) =>
                      updateRule(rule.id, (current) => ({
                        ...current,
                        compareValue: {
                          ...(current.compareValue as { min?: unknown; max?: unknown } | null),
                          min: event.target.value,
                        },
                      }))
                    }
                    placeholder="Minimum"
                  />
                  <Input
                    type={field?.valueType === "number" ? "number" : field?.valueType === "date" ? "date" : "text"}
                    value={typeof compareValue.max === "string" ? compareValue.max : String(compareValue.max ?? "")}
                    onChange={(event) =>
                      updateRule(rule.id, (current) => ({
                        ...current,
                        compareValue: {
                          ...(current.compareValue as { min?: unknown; max?: unknown } | null),
                          max: event.target.value,
                        },
                      }))
                    }
                    placeholder="Maximum"
                  />
                </div>
              ) : field?.valueType === "stringArray" ? (
                <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                  {field.options.map((option) => {
                    const selectedValues = Array.isArray(rule.compareValue) ? rule.compareValue : []
                    const checked = selectedValues.includes(option.value)

                    return (
                      <label key={option.value} className="inline-flex items-center gap-2 text-sm text-slate-700">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(nextChecked) =>
                            updateRule(rule.id, (current) => {
                              const currentValues = Array.isArray(current.compareValue)
                                ? current.compareValue
                                : []
                              const nextValues = nextChecked === true
                                ? [...currentValues, option.value]
                                : currentValues.filter((value) => value !== option.value)

                              return {
                                ...current,
                                compareValue: [...new Set(nextValues)],
                              }
                            })
                          }
                        />
                        {option.label}
                      </label>
                    )
                  })}
                </div>
              ) : field?.options.length ? (
                <Select
                  value={typeof rule.compareValue === "string" ? rule.compareValue : ""}
                  onValueChange={(value) =>
                    updateRule(rule.id, (current) => ({
                      ...current,
                      compareValue: value,
                    }))
                  }
                >
                  <SelectTrigger className="cursor-pointer">
                    <SelectValue placeholder="Select a value" />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={field?.valueType === "number" ? "number" : field?.valueType === "date" ? "date" : "text"}
                  value={typeof rule.compareValue === "string" ? rule.compareValue : String(rule.compareValue ?? "")}
                  onChange={(event) =>
                    updateRule(rule.id, (current) => ({
                      ...current,
                      compareValue: event.target.value,
                    }))
                  }
                  placeholder="Comparison value"
                />
              )}
            </div>
          ) : null}

          <div className="rounded-2xl border border-slate-200 bg-white p-3 lg:col-span-2">
            {mode === "scored" ? (
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p className="text-sm text-slate-700">
                  This condition helps rank the service but does not block qualification.
                </p>

                <div className="grid gap-2">
                  <Label>Score weight</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={String(rule.weight)}
                    onChange={(event) =>
                      updateRule(rule.id, (current) => ({
                        ...current,
                        weight: Math.max(1, Math.min(10, Number(event.target.value) || 1)),
                      }))
                    }
                    className="w-24"
                  />
                </div>
              </div>
            ) : mode === "shared" ? (
              <p className="text-sm text-slate-600">
                This condition must be true for every qualifying contact.
              </p>
            ) : (
              <p className="text-sm text-slate-600">
                This condition is part of the current option. All conditions in the same option must
                match together.
              </p>
            )}
          </div>
        </div>

        {field?.description ? (
          <p className="mt-3 text-xs text-slate-500">{field.description}</p>
        ) : null}
      </article>
    )
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[20px] border border-slate-200 bg-white p-5">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-slate-900">Qualification Rules</h3>
          <p className="text-sm text-slate-500">
            Define who can qualify for this service. Required conditions decide eligibility, scored
            conditions only affect ranking.
          </p>
        </div>

        <div className="mt-4 grid gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <Checkbox
              checked={safeProfile.enabled}
              onCheckedChange={(checked) =>
                onChange({
                  ...safeProfile,
                  enabled: checked === true,
                })
              }
            />
            Enable service fit recommendations
          </label>

          <div className="grid gap-2">
            <Label htmlFor="service-fit-summary">Ideal candidate / intake notes</Label>
            <Textarea
              id="service-fit-summary"
              rows={4}
              value={safeProfile.summary}
              onChange={(event) =>
                onChange({
                  ...safeProfile,
                  summary: event.target.value,
                })
              }
              placeholder="Describe who benefits most from this service and what intake signals matter."
            />
            <p className="text-xs text-slate-500">
              Write this the way a teammate would explain qualification to a user. Include who
              qualifies, common exceptions, and what missing information usually blocks a decision.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-[20px] border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-slate-900">Qualification Builder</h3>
            <p className="text-sm text-slate-500">
              Combine core fields, status, tags, derived age, and active non-sensitive custom fields.
            </p>
            <p className="text-sm text-slate-500">
              Use shared conditions for anything every contact must meet. Use qualification rules
              when there are different ways someone can qualify.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer border-slate-300"
              onClick={addAlwaysRequiredRule}
              disabled={isLoadingFields}
            >
              <Plus className="h-4 w-4" />
              Add shared condition
            </Button>
            <Button
              type="button"
              className="cursor-pointer bg-blue-950 text-white hover:bg-blue-900"
              onClick={addQualificationRequirement}
              disabled={isLoadingFields}
            >
              <Plus className="h-4 w-4" />
              Add qualification rule
            </Button>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer border-slate-300"
              onClick={addScoredRule}
              disabled={isLoadingFields}
            >
              <Plus className="h-4 w-4" />
              Add scored condition
            </Button>
          </div>
        </div>

        {isLoadingFields ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
            Loading available fields...
          </div>
        ) : safeProfile.rules.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            No fit rules yet. Add a rule to start screening contacts for this service.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-sky-950">How Matching Works</p>
                <p className="text-sm text-sky-900">
                  A contact qualifies when all shared conditions pass and at least one qualification
                  option matches.
                </p>
                <p className="text-xs text-sky-800">
                  Shared conditions AND (Option 1 OR Option 2)
                </p>
                {groupedRequirements.length > 1 ? (
                  <p className="text-xs text-amber-800">
                    This service currently uses advanced logic with multiple rule groups. Those
                    extra groups are still combined with AND.
                  </p>
                ) : null}
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,220px)_1fr]">
                <div className="rounded-2xl border border-sky-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
                    Shared conditions
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">
                    {qualificationSummary.alwaysRequiredCount}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    These must be true for every qualifying contact.
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {qualificationSummary.requirements.length ? (
                    qualificationSummary.requirements.map((requirement, index) => (
                      <div
                        key={requirement.name}
                        className="rounded-2xl border border-sky-200 bg-white p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-900">Rule {index + 1}</p>
                          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800">
                            {requirement.branchCount} option{requirement.branchCount === 1 ? "" : "s"}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {requirement.branchCount > 1
                            ? "At least one option below must match."
                            : "This rule has one required option."}
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          {requirement.labels.join(" and ")}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-sky-200 bg-white p-3 text-sm text-slate-600 md:col-span-2">
                      No qualification rules yet. Add one when a service has more than one way to
                      qualify.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Shared conditions</h4>
                  <p className="text-sm text-slate-500">
                    These conditions must be true for everyone who qualifies.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="cursor-pointer border-slate-300"
                  onClick={addAlwaysRequiredRule}
                  disabled={isLoadingFields}
                >
                  <Plus className="h-4 w-4" />
                  Add condition
                </Button>
              </div>

              {alwaysRequiredRules.length ? (
                <div className="space-y-4">
                  {alwaysRequiredRules.map((rule, index) =>
                    renderRuleEditor(rule, `Shared condition ${index + 1}`, "shared"),
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                  No always-required conditions yet.
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Qualification options</h4>
                  <p className="text-sm text-slate-500">
                    Use this when there are different ways a contact can qualify. If any option
                    below matches, the contact passes this part of the rule.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="cursor-pointer bg-blue-950 text-white hover:bg-blue-900"
                    onClick={addQualificationOption}
                    disabled={isLoadingFields}
                  >
                    <Plus className="h-4 w-4" />
                    Add OR option
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="cursor-pointer border-slate-300"
                    onClick={addQualificationRequirement}
                    disabled={isLoadingFields}
                  >
                    <Plus className="h-4 w-4" />
                    Add advanced AND rule
                  </Button>
                </div>
              </div>

              {groupedRequirements.length ? (
                <div className="space-y-4">
                  {groupedRequirements.map((requirement, requirementIndex) => (
                    <div
                      key={requirement.name}
                        className="rounded-[20px] border border-sky-200 bg-sky-50/60 p-4"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="grid flex-1 gap-1">
                          <p className="text-sm font-semibold text-slate-900">
                            {groupedRequirements.length === 1
                              ? "Qualification options"
                              : `Advanced AND rule ${requirementIndex + 1}`}
                          </p>
                          <p className="text-sm text-slate-600">
                            {groupedRequirements.length === 1
                              ? "If any one option below matches, this service can qualify."
                              : "This advanced rule also has to match. Any one option below can satisfy it."}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="cursor-pointer border-slate-300 bg-white"
                            onClick={() => addBranchToRequirement(requirement.name)}
                            disabled={isLoadingFields}
                          >
                            <Plus className="h-4 w-4" />
                            Add OR option
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="cursor-pointer border-rose-200 bg-white text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                            onClick={() => removeRequirement(requirement.name)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove rule
                          </Button>
                        </div>
                      </div>

                      <div className="mt-4 space-y-4">
                        {requirement.branches.map((branch, branchIndex) => (
                          <div key={`${requirement.name}:${branch.name}`} className="space-y-4">
                            {branchIndex > 0 ? (
                              <div className="flex items-center justify-center">
                                <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                                  OR
                                </span>
                              </div>
                            ) : null}

                            <div className="rounded-2xl border border-sky-200 bg-white/80 p-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div className="grid flex-1 gap-1">
                                <p className="text-sm font-semibold text-slate-900">
                                  Option {branchIndex + 1}
                                </p>
                                <p className="text-sm text-slate-600">
                                  All conditions in this option must match together.
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="cursor-pointer border-slate-300 bg-white"
                                  onClick={() => addRuleToBranch(requirement.name, branch.name)}
                                  disabled={isLoadingFields}
                                >
                                  <Plus className="h-4 w-4" />
                                  Add AND condition
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="cursor-pointer border-rose-200 bg-white text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                                  onClick={() => removeBranch(requirement.name, branch.name)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Remove option
                                </Button>
                              </div>
                            </div>

                            <div className="mt-4 space-y-4">
                              {branch.rules.map((rule, index) => (
                                <div key={rule.id} className="space-y-4">
                                  {index > 0 ? (
                                    <div className="flex items-center justify-center">
                                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                                        AND
                                      </span>
                                    </div>
                                  ) : null}
                                  {renderRuleEditor(rule, `Condition ${index + 1}`, "option")}
                                </div>
                              ))}
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="cursor-pointer border-slate-300 bg-white"
                                  onClick={() => addRuleToBranch(requirement.name, branch.name)}
                                  disabled={isLoadingFields}
                                >
                                  <Plus className="h-4 w-4" />
                                  Add AND condition
                                </Button>
                              </div>
                            </div>
                          </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                  No qualification options yet. Add an OR option to define one way someone can
                  qualify for this service.
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Scored conditions</h4>
                  <p className="text-sm text-slate-500">
                    These conditions help rank services but never block qualification.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="cursor-pointer border-slate-300"
                  onClick={addScoredRule}
                  disabled={isLoadingFields}
                >
                  <Plus className="h-4 w-4" />
                  Add scored condition
                </Button>
              </div>

              {scoredRules.length ? (
                <div className="space-y-4">
                  {scoredRules.map((rule, index) =>
                    renderRuleEditor(rule, `Scored condition ${index + 1}`, "scored"),
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                  No scored conditions yet.
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-[20px] border border-slate-200 bg-white p-5">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-slate-900">Preview Contact Fit</h3>
          <p className="text-sm text-slate-500">
            Search for a contact and run the current rule draft before saving.
          </p>
        </div>

        <div className="mt-4 grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="service-fit-contact-search">Contact</Label>
            {selectedContact ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {selectedContact.fullName}
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {selectedContact.email || selectedContact.phoneNumber || "No email or phone"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => {
                    setSelectedContact(null)
                    setPreviewResult(null)
                    setContactSearchQuery("")
                  }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="grid gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="service-fit-contact-search"
                    value={contactSearchQuery}
                    onChange={(event) => setContactSearchQuery(event.target.value)}
                    placeholder="Search contacts by name, email, or phone"
                    className="pl-9"
                  />
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50">
                  {contactSearchQuery.trim().length < 2 ? (
                    <p className="px-4 py-3 text-sm text-slate-500">
                      Type at least 2 characters to search contacts.
                    </p>
                  ) : isSearchingContacts ? (
                    <p className="px-4 py-3 text-sm text-slate-500">Searching contacts...</p>
                  ) : contactResults.length ? (
                    <div className="divide-y divide-slate-200">
                      {contactResults.map((contact) => (
                        <button
                          key={contact.id}
                          type="button"
                          className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white"
                          onClick={() => {
                            setSelectedContact(contact)
                            setContactResults([])
                            setContactSearchQuery("")
                          }}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {contact.fullName}
                            </p>
                            <p className="truncate text-sm text-slate-500">
                              {contact.email || contact.phoneNumber || "No email or phone"}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="px-4 py-3 text-sm text-slate-500">No contacts found.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              className="cursor-pointer bg-blue-950 text-white hover:bg-blue-900"
              onClick={runPreview}
              disabled={isRunningPreview || !selectedContact}
            >
              {isRunningPreview ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isRunningPreview ? "Running preview..." : "Run preview"}
            </Button>
          </div>

          {previewResult ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Preview result</p>
                  <p className="text-sm text-slate-500">
                    {previewResult.summary || "No fit summary provided."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold",
                      previewResult.eligibilityStatus === "ELIGIBLE" &&
                        "bg-emerald-100 text-emerald-700",
                      previewResult.eligibilityStatus === "NEEDS_INFO" &&
                        "bg-amber-100 text-amber-700",
                      previewResult.eligibilityStatus === "NOT_ELIGIBLE" &&
                        "bg-rose-100 text-rose-700",
                    )}
                  >
                    {previewResult.eligibilityStatus.toLowerCase().replace(/_/g, " ")}
                  </span>
                  <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                    Score {previewResult.fitScore}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="rounded-2xl border border-emerald-200 bg-white p-4">
                  <p className="text-sm font-semibold text-emerald-700">Matched</p>
                  <div className="mt-2 space-y-2">
                    {previewResult.matchedRules.length ? (
                      previewResult.matchedRules.map((rule) => (
                        <p key={rule.ruleId} className="text-sm text-slate-700">
                          {rule.reason}
                        </p>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">No matched rules yet.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-rose-200 bg-white p-4">
                  <p className="text-sm font-semibold text-rose-700">Blocking</p>
                  <div className="mt-2 space-y-2">
                    {previewResult.blockingRules.length ? (
                      previewResult.blockingRules.map((rule) => (
                        <p key={rule.ruleId} className="text-sm text-slate-700">
                          {rule.reason}
                        </p>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">No blocking rules.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-white p-4">
                  <p className="text-sm font-semibold text-amber-700">Missing info</p>
                  <div className="mt-2 space-y-2">
                    {previewResult.missingRules.length ? (
                      previewResult.missingRules.map((rule) => (
                        <p key={rule.ruleId} className="text-sm text-slate-700">
                          {rule.reason}
                        </p>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">No missing information detected.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
