export type HeightInput = { feet: string; inches: string; legacyValue: string | null }
export type WeightInput = { pounds: string; legacyValue: string | null }
type MeasurementUpdate = { value: string | null | undefined; error: string | null }

export function readHeightInput(value: string | null): HeightInput {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) return { feet: "", inches: "", legacyValue: null }
  const match = /^([0-9])\s*(?:ft|feet|foot|f|')\s*([0-9]|1[01])\s*(?:in|inches|inch|i|")$/i.exec(trimmed)
  if (match && Number(match[1]) * 12 + Number(match[2]) > 0) {
    return { feet: String(Number(match[1])), inches: String(Number(match[2])), legacyValue: null }
  }
  // Never guess the units or silently erase a measurement stored by the old text inputs.
  return { feet: "", inches: "", legacyValue: trimmed }
}

export function readWeightInput(value: string | null): WeightInput {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) return { pounds: "", legacyValue: null }
  const match = /^([0-9]{1,4})(?:\s*(?:lb|lbs|pound|pounds))?$/i.exec(trimmed)
  if (match && Number(match[1]) > 0) {
    return { pounds: String(Number(match[1])), legacyValue: null }
  }
  return { pounds: "", legacyValue: trimmed }
}

export function prepareHeightUpdate(initialValue: string | null, input: HeightInput): MeasurementUpdate {
  const initial = readHeightInput(initialValue)
  if (input.feet === initial.feet && input.inches === initial.inches && input.legacyValue === initial.legacyValue) {
    return { value: undefined, error: null }
  }
  if (input.legacyValue !== null) {
    return { value: undefined, error: "Enter height using feet and inches." }
  }
  if (input.feet === "" && input.inches === "") return { value: null, error: null }
  if (!/^[0-9]$/.test(input.feet) || !/^(?:[0-9]|1[01])$/.test(input.inches)) {
    return { value: undefined, error: "Enter both feet (0–9) and inches (0–11), or clear both." }
  }
  if (Number(input.feet) * 12 + Number(input.inches) === 0) {
    return { value: undefined, error: "Height must be greater than zero." }
  }
  return { value: `${Number(input.feet)} ft ${Number(input.inches)} in`, error: null }
}

export function prepareWeightUpdate(initialValue: string | null, input: WeightInput): MeasurementUpdate {
  const initial = readWeightInput(initialValue)
  if (input.pounds === initial.pounds && input.legacyValue === initial.legacyValue) {
    return { value: undefined, error: null }
  }
  if (input.legacyValue !== null) {
    return { value: undefined, error: "Enter weight using pounds." }
  }
  if (input.pounds === "") return { value: null, error: null }
  if (!/^[0-9]{1,4}$/.test(input.pounds) || Number(input.pounds) === 0) {
    return { value: undefined, error: "Enter whole-number pounds from 1 to 9999." }
  }
  return { value: `${Number(input.pounds)} lb`, error: null }
}
