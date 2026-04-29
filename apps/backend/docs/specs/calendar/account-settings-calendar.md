# Account Calendar Settings API

Base router: `/api/account-settings/:tenantId/calendar`

Source:

- [account-settings.routes.ts](/Users/jhongarcian/coding/gestiabloc/apps/backend/src/routes/account-settings.routes.ts)

These routes are tenant-admin only.

## Configuration overview

### `GET /api/account-settings/{tenantId}/calendar`

Returns:

- account timezone
- booking rules
- account weekly availability
- account blocked periods
- staff enablement and colors
- reusable calendar groups

### `PATCH /api/account-settings/{tenantId}/calendar`

Updates:

- account booking rules
- account weekly availability

Booking rules include:

- meeting interval
- meeting duration
- minimum schedule notice
- maximum bookings per day
- maximum bookings per slot
- pre-buffer minutes
- post-buffer minutes
- buffer availability mode

## Staff enablement

### `PATCH /api/account-settings/{tenantId}/calendar/staff`

Updates the calendar staff matrix:

- `userId`
- `enabled`
- `color`

Important behavior:

- disabled staff are removed from reusable calendar groups
- colors are used by the calendar UI when rendering appointments

## Reusable groups

### `POST /api/account-settings/{tenantId}/calendar/groups`

Creates a designated calendar team.

Fields:

- `name`
- `description?`
- `memberUserIds[]`

Rules:

- group names are normalized
- names must be unique within the tenant
- users must be active and calendar-enabled
- a user can belong to multiple groups

### `PATCH /api/account-settings/{tenantId}/calendar/groups/{recordId}`

Updates:

- group name
- description
- members

### `DELETE /api/account-settings/{tenantId}/calendar/groups/{recordId}`

Deletes one reusable group.

## User-specific availability

### `GET /api/account-settings/{tenantId}/calendar/users/{userId}`

Returns one user’s:

- staff identity and color
- weekly availability
- blocked periods

### `PATCH /api/account-settings/{tenantId}/calendar/users/{userId}`

Updates one user’s weekly availability only.

## Account-wide blocks

### `POST /api/account-settings/{tenantId}/calendar/blocks`

Creates an account-wide blocked period.

### `PATCH /api/account-settings/{tenantId}/calendar/blocks/{recordId}`

Updates an account-wide blocked period.

### `DELETE /api/account-settings/{tenantId}/calendar/blocks/{recordId}`

Deletes an account-wide blocked period.

## User-specific blocks

### `POST /api/account-settings/{tenantId}/calendar/users/{userId}/blocks`

Creates a blocked period for one user.

### `DELETE /api/account-settings/{tenantId}/calendar/users/{userId}/blocks/{recordId}`

Deletes a blocked period for one user.

## Security notes

- All mutations enforce same-origin checks.
- All IDs are tenant-scoped before persistence changes are applied.
- Group members are validated against active, calendar-enabled memberships.
- Calendar block mutations verify the expected scope:
  - account blocks must be `TENANT`
  - user blocks must be `USER`
