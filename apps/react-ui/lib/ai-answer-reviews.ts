export const AI_REVIEW_REASONS = {
  MISSING_KNOWLEDGE: "Missing saved information",
  OUT_OF_SCOPE: "Outside the assistant’s scope",
  POLICY_EXCEPTION: "Policy exception needs review",
  AGENCY_HELP: "Agency assistance needed",
  ASSISTANT_UNAVAILABLE: "Conversational reply unavailable",
  OTHER: "More information or agency review needed",
} as const
export type AiReviewReason = keyof typeof AI_REVIEW_REASONS
export const aiReviewReasonLabel = (reason?: string) => AI_REVIEW_REASONS[reason as AiReviewReason] ?? AI_REVIEW_REASONS.OTHER
export type AiAnswerReview = {
  id: string; channel: "TEST" | "CONTACT_ASSISTANT"; createdAt: string; reason: AiReviewReason
  reviewedAt: string | null; revision: number; expiresAt: string
}
export type AiAnswerReviewDetail = AiAnswerReview & { details: { question: string; answer: string; contactId?: string; serviceName?: string; sourceLabels: string[] } }
export type AiAnswerReviewList = {
  items: (AiAnswerReview & { questionPreview: string | null; detailsAvailable: boolean })[]
  nextCursor: string | null; counts: { open: number; reviewed: number; unavailable: number }
  captureAvailable: boolean; retentionDays: number
}
