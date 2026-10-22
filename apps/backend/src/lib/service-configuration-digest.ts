import { createHash } from "node:crypto"

export function configurationDigest(value: unknown): string {
  const canonical = (item: any): any => item instanceof Date ? item.toISOString()
    : Array.isArray(item) ? item.map(canonical)
    : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}
