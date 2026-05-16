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
      tenant: { id: string; slug: string; name: string; timezone?: string | null }
    }>
  }
}

export async function getMe(): Promise<MeResponse> {
  const { data } = await api.get("/api/auth/me")
  return data
}
