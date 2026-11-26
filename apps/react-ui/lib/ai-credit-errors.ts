import { isAxiosError } from "axios"
import type { AiActivityTracker } from "./ai-activity-tracking"
const messages: Record<string, string> = {
  AI_PURCHASE_REVIEW_REQUIRED: "A credit purchase needs billing review. Contact your account administrator.",
  AI_CREDITS_EXHAUSTED: "Your account has no AI credits left. Contact your account administrator.",
  BILLING_REQUIRED: "An active paid subscription is required to use AI chat.",
  AI_REQUEST_IN_PROGRESS: "Your previous question is still processing. Try again in a moment.",
  AI_RESPONSE_EXPIRED: "This reply can no longer be recovered. Send the question again to start a new request.",
  AI_REQUEST_CONFLICT: "The question or its context changed. Send it again as a new request.",
  AI_BILLING_UNAVAILABLE: "AI credit tracking is unavailable. Try again shortly.",
  AI_REQUEST_ID_REQUIRED: "Refresh this page before sending another question.",
}
function code(error: unknown): string | undefined {
  if (!isAxiosError(error)) return
  const value = error.response?.data?.error
  return typeof value === "string" ? value : undefined
}
export function aiCreditErrorMessage(error: unknown) { return messages[code(error) ?? ""] }
export function releaseTerminalAiAttempt(tracker: AiActivityTracker, requestId: string, error: unknown) {
  // Preserve IDs after timeouts, disconnects and ambiguous failures: a successful
  // debit may already exist. Only an explicit terminal response allows a new ID.
  if (["AI_RESPONSE_EXPIRED", "AI_REQUEST_CONFLICT"].includes(code(error) ?? "")) tracker.complete(requestId)
}
