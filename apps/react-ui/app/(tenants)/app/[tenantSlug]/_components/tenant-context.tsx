"use client"

import { createContext, useContext } from "react"

export type TenantUser = {
  id: string
  name: string
  email: string
  image?: string | null
  platformRole?: string | null
  emailVerified: boolean
  createdAt?: string
  updatedAt?: string
  memberships?: Array<{
    role: string
    status: string
    tenant: { id: string; slug: string; name: string }
  }>
}

const TenantUserContext = createContext<TenantUser | null>(null)

export function TenantUserProvider({
  user,
  children,
}: {
  user: TenantUser
  children: React.ReactNode
}) {
  return (
    <TenantUserContext.Provider value={user}>
      {children}
    </TenantUserContext.Provider>
  )
}

export function useTenantUser() {
  return useContext(TenantUserContext)
}
