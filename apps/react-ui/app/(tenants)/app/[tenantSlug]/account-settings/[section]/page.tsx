import { notFound } from "next/navigation"

import {
  ACCOUNT_SETTINGS_COPY,
  ACCOUNT_SETTINGS_SECTIONS,
  ACCOUNT_SETTINGS_TABS,
  type AccountSettingsSection,
} from "../config"

export default async function AccountSettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>
}) {
  const { section } = await params

  if (!ACCOUNT_SETTINGS_SECTIONS.has(section as AccountSettingsSection)) {
    notFound()
  }

  const typedSection = section as AccountSettingsSection
  const tab = ACCOUNT_SETTINGS_TABS.find((item) => item.key === typedSection)

  if (!tab) {
    notFound()
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 md:p-6">
      <h2 className="text-lg font-semibold text-slate-900 md:text-xl">{tab.label}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {ACCOUNT_SETTINGS_COPY[typedSection]}
      </p>
      <p className="mt-4 text-xs leading-5 text-slate-500">
        Only tenant admins can access this section and make configuration changes.
      </p>
    </div>
  )
}
