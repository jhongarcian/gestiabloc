import { z } from "zod"

const heightPattern = /^([0-9])\s*(?:ft|feet|foot|f|')\s*([0-9]|1[01])\s*(?:in|inches|inch|i|")$/i
const weightPattern = /^([0-9]{1,4})(?:\s*(?:lb|lbs|pound|pounds))?$/i

export const contactHeightSchema = z.string().trim().max(60).regex(
  heightPattern,
  "Enter whole-number feet (0–9) and inches (0–11), for example 5 ft 2 in.",
).refine((value) => {
  const match = heightPattern.exec(value)
  return match !== null && Number(match[1]) * 12 + Number(match[2]) > 0
}, "Height must be greater than zero.").transform((value) => {
  const match = heightPattern.exec(value)!
  return `${Number(match[1])} ft ${Number(match[2])} in`
})

export const contactWeightSchema = z.string().trim().max(60).regex(
  weightPattern,
  "Enter whole-number pounds from 1 to 9999, for example 260.",
).refine((value) => {
  const match = weightPattern.exec(value)
  return match !== null && Number(match[1]) > 0
}, "Weight must be greater than zero.").transform((value) => {
  const match = weightPattern.exec(value)!
  return `${Number(match[1])} lb`
})

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value

export const optionalContactHeightSchema = z.preprocess(
  emptyToNull,
  contactHeightSchema.nullable().optional(),
)
export const optionalContactWeightSchema = z.preprocess(
  emptyToNull,
  contactWeightSchema.nullable().optional(),
)
