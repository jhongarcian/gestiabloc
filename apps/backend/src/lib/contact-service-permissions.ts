export type ContactServicePermissionMembership = {
  role: "TENANT_ADMIN" | "TENANT_USER"
  securityLevel: "LOW" | "MEDIUM" | "MAX"
}

export function canManageContactServices(
  membership: ContactServicePermissionMembership,
) {
  return membership.role === "TENANT_ADMIN" || membership.securityLevel !== "LOW"
}
