export const ACCOUNT_SETTINGS_TABS = [
  { key: "account", label: "Account" },
  { key: "users", label: "Users" },
  { key: "services", label: "Services" },
  { key: "professionals", label: "Professionals" },
  { key: "follow-ups", label: "Follow Ups" },
  { key: "status-config", label: "Status Config" },
  { key: "tags", label: "Tags" },
  { key: "features", label: "Features" },
  { key: "subscription", label: "Subscription" },
  { key: "custom-fields", label: "Custom Fields" },
] as const

export type AccountSettingsSection = (typeof ACCOUNT_SETTINGS_TABS)[number]["key"]

export const ACCOUNT_SETTINGS_SECTIONS = new Set<AccountSettingsSection>(
  ACCOUNT_SETTINGS_TABS.map((item) => item.key),
)

export const ACCOUNT_SETTINGS_COPY: Record<AccountSettingsSection, string> = {
  "account": "Manage tenant profile details and contact information.",
  users: "Manage tenant users and access levels.",
  services: "Manage service catalog options for your tenant.",
  professionals: "Manage professionals and assignment settings.",
  "follow-ups": "Configure automated and manual follow-up workflows.",
  "status-config": "Configure status labels and lifecycle behavior.",
  tags: "Create and organize reusable tenant tags.",
  features: "Control tenant feature flags and module access.",
  subscription: "Review and manage subscription details.",
  "custom-fields": "Define custom fields for tenant records.",
}
