import { createHash } from "node:crypto"
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`
  return JSON.stringify(value) ?? "null"
}
export function aiProfileRevision(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}
