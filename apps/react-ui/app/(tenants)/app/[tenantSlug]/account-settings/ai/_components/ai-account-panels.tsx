"use client"

import { AccountProfileForm } from "../../_components/account-profile-form"
import { useAiWorkspace } from "./ai-workspace"

export function AiCompanyInfo() {
  const { companyProfile, basePath } = useAiWorkspace()
  return (
    <AccountProfileForm
      controller={companyProfile}
      relatedHref={`${basePath.slice(0, -3)}/account`}
    />
  )
}

export { AiSettings } from "./ai-helper-settings-panel"
