import axios from "axios"
import type { PlanKey } from "@/lib/subscription-plans"

const baseURL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"

export const api = axios.create({
  baseURL,
  withCredentials: true,
  // Avoid proxy-from-env (uses deprecated url.parse in Node 20+)
  proxy: false,
})

export type TenantSignupPayload = {
  tenantName: string
  planKey: PlanKey
  paidNow?: boolean
  adminName: string
  adminEmail: string
  adminPassword: string
}

export async function tenantSignup(payload: TenantSignupPayload) {
  const { data } = await api.post("/api/auth/tenant/signup", payload)
  return data
}

export async function verifyEmail(token: string) {
  const { data } = await api.get("/api/auth/verify-email", {
    params: { token },
  })
  return data
}

export type LoginPayload = {
  email: string
  password: string
}

export type LoginResponse = {
  ok: boolean
  requiresOtp: boolean
  challengeToken?: string
}

export async function login(payload: LoginPayload): Promise<LoginResponse> {
  const { data } = await api.post("/api/auth/login", payload)
  return data
}

export async function verifyOtp(payload: {
  challengeToken: string
  code: string
}) {
  const { data } = await api.post("/api/auth/otp/verify", payload)
  return data
}

export async function forgotPassword(email: string) {
  const { data } = await api.post("/api/auth/forgot-password", { email })
  return data
}

export async function resetPassword(payload: {
  token: string
  newPassword: string
}) {
  const { data } = await api.post("/api/auth/reset-password", payload)
  return data
}

export type MeResponse = {
  ok: boolean
  user: {
    id: string
    email: string
    name: string
    image?: string | null
    platformRole: string
    emailVerified: boolean
    lastLoginAt?: string | null
    createdAt?: string
    updatedAt?: string
    memberships: Array<{
      role: string
      status: string
      securityLevel: "LOW" | "MEDIUM" | "MAX"
      tenant: {
        id: string
        slug: string
        name: string
        timezone?: string | null
        onboardingStatus?: TenantOnboardingStatus
        onboardingCurrentStep?: OnboardingStep
      }
    }>
  }
}

export type TenantOnboardingStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "SKIPPED"
  | "COMPLETED"

export type OnboardingStep =
  | "welcome"
  | "business-profile"
  | "workflow"
  | "ready"

export type OnboardingStatusRecord = {
  id: string
  name: string
  bgColor: string
  textColor: string
  sortOrder: number
  isActive: boolean
  isSystemDefault: boolean
}

export type OnboardingPipeline = {
  id: string
  name: string
  color: string
  sortOrder: number
  stages: Array<{ id: string; name: string; sortOrder: number }>
}

export type OnboardingResponse = {
  ok: boolean
  onboarding: {
    status: TenantOnboardingStatus
    currentStep: OnboardingStep
    startedAt: string | null
    skippedAt: string | null
    completedAt: string | null
    checklistDismissedAt: string | null
  }
  profile: {
    id: string
    slug: string
    name: string
    email: string | null
    phone: string | null
    website: string | null
    addressLine1: string | null
    addressLine2: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    country: string | null
    timezone: string | null
  }
  defaults: {
    contactStatuses: OnboardingStatusRecord[]
    taskStatuses: OnboardingStatusRecord[]
    pipeline: OnboardingPipeline
  }
  readiness: {
    serviceCount: number
    memberCount: number
  }
}

export async function getOnboarding(
  tenantId: string,
  cookie?: string,
): Promise<OnboardingResponse> {
  const { data } = await api.get(`/api/onboarding/${tenantId}`, {
    ...(cookie ? { headers: { cookie } } : {}),
  })
  return data
}

export type OnboardingProfilePayload = Omit<
  OnboardingResponse["profile"],
  "id" | "slug"
>

export async function updateOnboardingProfile(
  tenantId: string,
  payload: OnboardingProfilePayload,
) {
  const { data } = await api.patch(
    `/api/onboarding/${tenantId}/profile`,
    payload,
  )
  return data as { ok: boolean; profile: OnboardingResponse["profile"] }
}

export async function updateOnboardingWorkflow(
  tenantId: string,
  payload: {
    pipelineId: string
    name: string
    stages: Array<{ id: string; name: string }>
  },
) {
  const { data } = await api.patch(
    `/api/onboarding/${tenantId}/workflow`,
    payload,
  )
  return data as { ok: boolean; pipeline: OnboardingPipeline }
}

export type OnboardingStateAction =
  | { action: "start" }
  | { action: "advance"; step: OnboardingStep }
  | { action: "skip" }
  | { action: "resume" }
  | { action: "complete" }
  | { action: "dismissChecklist" }

export async function updateOnboardingState(
  tenantId: string,
  payload: OnboardingStateAction,
) {
  const { data } = await api.patch(
    `/api/onboarding/${tenantId}/state`,
    payload,
  )
  return data as Pick<OnboardingResponse, "ok" | "onboarding">
}

export async function getMe(): Promise<MeResponse> {
  const { data } = await api.get("/api/auth/me")
  return data
}

export type SubscriptionResponse = {
  ok: boolean
  subscription: {
    planKey: PlanKey
    seatLimit: number
    status: "NONE" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED"
    currentPeriodEnd: string | null
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    seatUsage: {
      used: number
      limit: number
      available: number
    }
    storageUsedBytes: number
    storageLimitBytes: number
    aiActionsPerMonth: number
    memberCount: number
    activeMemberCount: number
  }
}

export async function getTenantSubscription(
  tenantId: string,
  cookie: string,
): Promise<SubscriptionResponse> {
  const { data } = await api.get(
    `/api/account-settings/${tenantId}/subscription`,
    { headers: { cookie } },
  )
  return data
}
