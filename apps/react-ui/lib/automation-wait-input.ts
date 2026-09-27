export function parseAutomationWaitIntegerDraft(rawValue: string) {
  if (!/^\d*$/.test(rawValue)) return null
  const draft = rawValue.replace(/^0+(?=\d)/, "")
  return {
    draft,
    value: draft ? Number(draft) : Number.NaN,
  }
}
