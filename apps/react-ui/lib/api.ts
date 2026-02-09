import axios from "axios"

const baseURL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"

export const api = axios.create({
  baseURL,
  withCredentials: true,
})

export type TenantSignupPayload = {
  tenantName: string
  planKey: "STARTER" | "PRO" | "BUSINESS"
  paidNow: boolean
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
