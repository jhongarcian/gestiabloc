"use client"

import { createContext, useContext, useMemo, useState } from "react"

import {
  type OnboardingProfilePayload,
  type OnboardingResponse,
  type OnboardingStateAction,
  updateOnboardingProfile,
  updateOnboardingState,
  updateOnboardingWorkflow,
} from "@/lib/api"

type OnboardingContextValue = {
  data: OnboardingResponse
  tenantId: string
  tenantSlug: string
  adminName: string
  isMutating: boolean
  saveProfile: (payload: OnboardingProfilePayload) => Promise<void>
  saveWorkflow: (payload: {
    pipelineId: string
    name: string
    stages: Array<{ id: string; name: string }>
  }) => Promise<void>
  changeState: (action: OnboardingStateAction) => Promise<void>
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null)

export function OnboardingProvider({
  initialData,
  tenantSlug,
  adminName,
  children,
}: {
  initialData: OnboardingResponse
  tenantSlug: string
  adminName: string
  children: React.ReactNode
}) {
  const [data, setData] = useState(initialData)
  const [pendingMutations, setPendingMutations] = useState(0)
  const tenantId = data.profile.id

  const runMutation = async <T,>(mutation: () => Promise<T>) => {
    setPendingMutations((count) => count + 1)
    try {
      return await mutation()
    } finally {
      setPendingMutations((count) => Math.max(0, count - 1))
    }
  }

  const value = useMemo<OnboardingContextValue>(
    () => ({
      data,
      tenantId,
      tenantSlug,
      adminName,
      isMutating: pendingMutations > 0,
      saveProfile: async (payload) => {
        const response = await runMutation(() =>
          updateOnboardingProfile(tenantId, payload),
        )
        setData((current) => ({ ...current, profile: response.profile }))
      },
      saveWorkflow: async (payload) => {
        const response = await runMutation(() =>
          updateOnboardingWorkflow(tenantId, payload),
        )
        setData((current) => ({
          ...current,
          defaults: { ...current.defaults, pipeline: response.pipeline },
        }))
      },
      changeState: async (action) => {
        const response = await runMutation(() =>
          updateOnboardingState(tenantId, action),
        )
        setData((current) => ({
          ...current,
          onboarding: response.onboarding,
        }))
      },
    }),
    [adminName, data, pendingMutations, tenantId, tenantSlug],
  )

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  const value = useContext(OnboardingContext)
  if (!value) {
    throw new Error("useOnboarding must be used inside OnboardingProvider")
  }
  return value
}
