import { encode } from "gpt-tokenizer/encoding/o200k_harmony"
import type { AiModelDefinition } from "./ai-model-catalog.js"

export type AiMessages = Array<{ role: string; content: string }>
export function countAiInput(messages: AiMessages, model?: AiModelDefinition) {
  if (model?.inputEstimator !== "harmony") return Buffer.byteLength(JSON.stringify(messages), "utf8")
  return 32 + messages.reduce((total, message) => total + encode(message.content, { disallowedSpecial: new Set() }).length + encode(message.role).length + 24, 0)
}
