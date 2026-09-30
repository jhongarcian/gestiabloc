import { z } from "zod"

// Node keys are persisted workflow identifiers. New keys are UUIDs, but older
// saved actions can retain another stable string identifier.
export const AutomationNodeKeySchema = z.string().trim().min(1).max(200)

