export type ContactOpportunitySort =
  | "UPDATED_DESC"
  | "UPDATED_ASC"
  | "VALUE_DESC"
  | "VALUE_ASC"
  | "PIPELINE_ASC"

export type ContactOpportunityRecord = {
  id: string
  pipelineId: string
  stageId: string
  valueCents: number
  result: "OPEN" | "WON" | "LOST"
  closedAt: string | null
  updatedAt: string
  pipeline: {
    id: string
    name: string
    color: string
    stages: Array<{
      id: string
      name: string
      sortOrder: number
    }>
  }
  stage: {
    id: string
    name: string
    sortOrder: number
  }
}

export type ContactOpportunitiesResponse = {
  ok: boolean
  items: ContactOpportunityRecord[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  summary: {
    active: number
    assignedPipelineIds: string[]
  }
}

export const CONTACT_OPPORTUNITY_PAGE_SIZES = [10, 25] as const
export const DEFAULT_CONTACT_OPPORTUNITY_SORT: ContactOpportunitySort = "UPDATED_DESC"

export const CONTACT_OPPORTUNITY_SORT_OPTIONS: Array<{
  value: ContactOpportunitySort
  label: string
}> = [
  { value: "UPDATED_DESC", label: "Recently updated" },
  { value: "UPDATED_ASC", label: "Oldest updated" },
  { value: "VALUE_DESC", label: "Highest value" },
  { value: "VALUE_ASC", label: "Lowest value" },
  { value: "PIPELINE_ASC", label: "Pipeline A–Z" },
]

export function parseContactOpportunitySort(
  value: string | null | undefined,
): ContactOpportunitySort {
  return CONTACT_OPPORTUNITY_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as ContactOpportunitySort)
    : DEFAULT_CONTACT_OPPORTUNITY_SORT
}

export function parseContactOpportunityPage(
  value: string | null | undefined,
  fallback = 1,
) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function parseContactOpportunityPageSize(
  value: string | null | undefined,
): (typeof CONTACT_OPPORTUNITY_PAGE_SIZES)[number] {
  return Number(value) === 25 ? 25 : 10
}
