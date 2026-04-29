# Roles And Access Configuration

## Scope

This document describes the role and access configuration currently implemented in the codebase. The access model has two layers:

1. Platform-level role on the `User`
2. Tenant-level membership role and security level on the `Membership`

The current product behavior is driven primarily by tenant membership role, membership status, and membership security level.

## Current Enums In The System

### Platform roles

Defined on `User.platformRole`:

- `NONE`
- `SAAS_OWNER`
- `SUPPORT`
- `MARKETING`

Current state:

- Platform roles are persisted and returned by `GET /api/auth/me`.
- They are available in the frontend tenant context and profile view.
- There is no dedicated platform-role management flow in the tenant UI.
- Tenant access control in the current app is not based on platform role.

### Tenant roles

Defined on `Membership.role`:

- `TENANT_ADMIN`
- `TENANT_USER`

Current product labels:

- `TENANT_ADMIN` => `Admin`
- `TENANT_USER` => `User`

### Membership status

Defined on `Membership.status`:

- `ACTIVE`
- `DISABLED`

Current state:

- The app surfaces account status in the users screens.
- Most tenant-scoped routes require the membership to be `ACTIVE`.
- There is no current admin flow to toggle a member between `ACTIVE` and `DISABLED`.

### Security levels

Defined on `Membership.securityLevel`:

- `LOW`
- `MEDIUM`
- `MAX`

Security levels are the practical permission dial used across contacts, services, and other sensitive tenant actions.

## Data Model

Each user can belong to multiple tenants through `Membership`.

`Membership` currently stores:

- `userId`
- `tenantId`
- `role`
- `status`
- `securityLevel`

Important defaults:

- New memberships default to `status = ACTIVE`
- New memberships default to `securityLevel = LOW`
- On signup, the first tenant member is created as:
  - `role = TENANT_ADMIN`
  - `securityLevel = MAX`

## Current Tenant Access Rules

### `TENANT_ADMIN`

An admin is the highest tenant-scoped role currently implemented.

Behavior:

- Can access Account Settings
- Must also have `status = ACTIVE` to access Account Settings
- Is always treated as elevated for tenant management
- Has `MAX` security level in practice
- Cannot be downgraded below `MAX` security level

Configuration constraints:

- When a tenant is created, the bootstrap member is `TENANT_ADMIN` with `MAX`
- When creating a member, admins can choose role `TENANT_ADMIN`
- If `securityLevel` is omitted for a new admin, backend defaults it to `MAX`
- The UI also auto-sets security level to `MAX` when `Admin` is selected
- Updating an admin to a non-`MAX` level is rejected with `TENANT_ADMIN_SECURITY_LEVEL_FIXED`
- Deleting the last active tenant admin is rejected with `LAST_TENANT_ADMIN`

### `TENANT_USER`

This is the standard tenant member role.

Behavior:

- Cannot access Account Settings
- Must rely on `securityLevel` for sensitive-data capabilities
- Uses the selected membership `securityLevel` as the main access modifier

Configuration defaults:

- New tenant users default to `LOW` security if no level is provided
- The create-user UI starts with `role = TENANT_USER` and `securityLevel = LOW`

## Security Level Behavior

### `LOW`

Current behavior:

- Has basic tenant membership access when status is `ACTIVE`
- Cannot manage service-related sensitive actions that require elevated access
- Cannot manage linked entities where the app requires more than low access
- Cannot manage contact tags where elevated access is required
- Cannot request access to sensitive custom-field values

### `MEDIUM`

Current behavior:

- Can do everything `LOW` can do
- Can manage contact services and linked entities where the rule is `securityLevel !== LOW`
- Can manage contact tags where the rule is `securityLevel !== LOW`
- Can request access to sensitive custom-field values
- Cannot approve sensitive custom-field access requests
- Does not automatically read sensitive custom-field values without an active grant

### `MAX`

Current behavior:

- Can do everything `MEDIUM` can do
- Can approve sensitive custom-field access requests
- Can read sensitive custom-field values without needing a grant
- Aligns with the highest non-admin security tier currently used in live business logic

## Sensitive Custom Field Access Configuration

Sensitive custom fields use a specific approval model:

- `TENANT_ADMIN` can approve access
- `MAX` security members can approve access
- `MEDIUM` non-admin members can request access
- `LOW` members cannot request access
- `MAX` and `TENANT_ADMIN` can read sensitive values directly
- `MEDIUM` can read sensitive values only with an active grant

This is the clearest place where the security-level model is currently differentiated in business logic.

Note:

- A reusable `requireTenantSecurityLevel` middleware exists in the backend, but it is not currently wired into the active route layer.

## Member Management Configuration

Current tenant-admin user management behavior:

- Users are created from Account Settings > Users
- Creation requires:
  - `name`
  - `email`
  - `password`
  - `role`
  - optional `securityLevel`
- Password rules:
  - minimum 8 characters
  - at least 1 letter
  - at least 1 number
  - at least 1 symbol
- User creation is blocked when the tenant seat limit is reached
- Created members are immediately stored with `status = ACTIVE`
- Verification email is sent after creation

Current editable fields after creation:

- Name
- Email
- Security level
- Avatar

Not currently configurable through the existing tenant UI/API flows:

- Changing tenant role after creation
- Disabling a member
- Changing platform role from tenant settings

## Account Settings Access

Account Settings is currently restricted to members where:

- `role = TENANT_ADMIN`
- `status = ACTIVE`

Configured sections currently present in Account Settings:

- `account`
- `users`
- `services`
- `professionals`
- `follow-ups`
- `status-config`
- `tags`
- `features`
- `subscription`
- `custom-fields`

## Practical Summary

The current live authorization model is:

- Tenant role decides whether a member is an admin or a standard user
- Membership status decides whether the member is allowed to act at all
- Security level decides how much sensitive tenant data and elevated tenant functionality a non-admin can access

In practice:

- `TENANT_ADMIN` = full tenant administration, fixed at `MAX`
- `TENANT_USER + LOW` = basic tenant access
- `TENANT_USER + MEDIUM` = elevated operational access plus request-based sensitive field access
- `TENANT_USER + MAX` = elevated operational access plus direct sensitive-field access and approval authority
