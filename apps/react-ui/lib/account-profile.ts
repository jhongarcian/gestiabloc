export const COMPANY_FIELDS = [
  "name",
  "description",
  "website",
  "email",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "country",
] as const
export const ACCOUNT_FIELDS = [
  ...COMPANY_FIELDS,
  "timezone",
  "taxEnabled",
  "taxLabel",
  "defaultTaxRatePercent",
] as const
export type CompanyField = (typeof COMPANY_FIELDS)[number]
export type AccountField = (typeof ACCOUNT_FIELDS)[number]
export type AccountProfileDraft = Record<
  Exclude<AccountField, "taxEnabled">,
  string
> & { taxEnabled: boolean }
export type AccountProfile = Record<
  Exclude<AccountField, "taxEnabled" | "name" | "defaultTaxRatePercent">,
  string | null
> & {
  id: string
  name: string
  revision: number
  taxEnabled: boolean
  defaultTaxRatePercent: number | null
  emailVerified: boolean
  createdAt: string
  updatedAt: string
}
export type AccountProfileResponse = { ok: boolean; tenant: AccountProfile }
export type ProfileScope = "company" | "account"
export type ProfileErrors = Partial<Record<AccountField, string>>

export function profileDraft(
  profile: AccountProfileResponse["tenant"] | null,
): AccountProfileDraft {
  return {
    name: profile?.name ?? "",
    description: profile?.description ?? "",
    website: profile?.website ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    addressLine1: profile?.addressLine1 ?? "",
    addressLine2: profile?.addressLine2 ?? "",
    city: profile?.city ?? "",
    state: profile?.state ?? "",
    postalCode: profile?.postalCode ?? "",
    country: profile?.country ?? "",
    timezone: profile?.timezone ?? "",
    taxEnabled: profile?.taxEnabled ?? false,
    taxLabel: profile?.taxLabel ?? "",
    defaultTaxRatePercent:
      profile?.defaultTaxRatePercent == null
        ? ""
        : String(profile.defaultTaxRatePercent),
  }
}
export function profileFields(scope: ProfileScope): readonly AccountField[] {
  return scope === "company" ? COMPANY_FIELDS : ACCOUNT_FIELDS
}
export function changedProfileFields(
  draft: AccountProfileDraft,
  saved: AccountProfileDraft,
  scope: ProfileScope,
) {
  return Object.fromEntries(
    profileFields(scope)
      .filter((key) => draft[key] !== saved[key])
      .map((key) => [key, draft[key]]),
  )
}
export function validateProfile(
  draft: AccountProfileDraft,
  scope: ProfileScope,
): ProfileErrors {
  const errors: ProfileErrors = {}
  if (!draft.name.trim()) errors.name = "Enter a company name."
  const limits = {
    name: 120,
    description: 4000,
    email: 255,
    phone: 60,
    website: 255,
    addressLine1: 255,
    addressLine2: 255,
    city: 120,
    state: 120,
    postalCode: 40,
    country: 120,
    timezone: 100,
    taxLabel: 60,
  }
  for (const [key, max] of Object.entries(limits)) {
    if (draft[key as keyof typeof limits].trim().length > max)
      errors[key as keyof typeof limits] =
        `Use ${max.toLocaleString()} characters or fewer.`
  }
  if (
    draft.email.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())
  )
    errors.email = "Enter a valid email address."
  if (draft.website.trim()) {
    try {
      const value = draft.website.trim()
      const url = new URL(
        /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`,
      )
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("invalid website")
    } catch {
      errors.website =
        "Enter a valid http:// or https:// website, such as example.com."
    }
  }
  if (scope === "account") {
    if (draft.timezone)
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: draft.timezone }).format()
      } catch {
        errors.timezone = "Choose a valid timezone."
      }
    const rate = Number(draft.defaultTaxRatePercent)
    if (
      draft.taxEnabled &&
      (!draft.defaultTaxRatePercent.trim() ||
        !Number.isFinite(rate) ||
        rate < 0 ||
        rate > 100)
    )
      errors.defaultTaxRatePercent = "Enter a tax rate from 0 to 100."
  }
  return Object.fromEntries(
    Object.entries(errors).filter(([key]) =>
      profileFields(scope).includes(key as AccountField),
    ),
  )
}

export const PROFILE_LABELS: Record<AccountField, string> = {
  name: "Company name",
  description: "Company description",
  website: "Website",
  email: "Contact email",
  phone: "Phone number",
  addressLine1: "Address line 1",
  addressLine2: "Address line 2",
  city: "City",
  state: "State / Province",
  postalCode: "Postal code",
  country: "Country",
  timezone: "Timezone",
  taxEnabled: "Enable taxes",
  taxLabel: "Tax label",
  defaultTaxRatePercent: "Tax rate (%)",
}
