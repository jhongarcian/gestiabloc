# Calendar Appointments

Base router: `/api/appointments/:tenantId`

Primary implementation:

- [appointments.routes.ts](gestiabloc/apps/backend/src/routes/appointments.routes.ts)

## Endpoints

### `GET /api/appointments/{tenantId}/meta`

Returns:

- booking settings used by the appointment sheet
- enabled calendar users
- reusable calendar groups
- active services

Used by:

- calendar toolbar filters
- create-appointment sheet assignee and service inputs

### `GET /api/appointments/{tenantId}/slots`

Query params:

- `assignedToUserId`
- `date` in `YYYY-MM-DD`

Returns the slot grid for one assignee on one local calendar day.

Important rules:

- assignee must be active and calendar-enabled
- slots are advisory UI data only
- slot availability respects:
  - account availability
  - user availability
  - blocked periods
  - interval and duration rules
  - daily limits
  - slot capacity
  - pre/post buffers

### `GET /api/appointments/{tenantId}`

Query params:

- `view`: `month | week | day | list`
- `filterMode`: `users | groups`
- `assignedToUserId`
- `assignedToUserIds` as comma-separated IDs
- `groupIds` as comma-separated IDs
- `contactId`
- `serviceId`
- `from`
- `to`

Filtering behavior:

- `users` mode supports one or many users
- `groups` mode supports one or many groups
- user and group filters cannot be mixed in the same request
- all filter IDs must belong to the account
- selected groups are expanded to active, calendar-enabled members only

Response includes:

- appointment items
- resolved filter state
- selected range
- empty-state copy

### `POST /api/appointments/{tenantId}/availability`

Checks availability for:

- one assignee
- one requested start/end range

Response includes:

- `available`
- `reasons`
- open windows
- conflict appointments
- conflict blocks

This is useful for UI feedback, but it is not the final booking guarantee.

### `POST /api/appointments/{tenantId}`

Creates an appointment atomically.

Request fields:

- `contactId`
- `serviceId?`
- `assignedToUserId`
- `title?`
- `notes?`
- `startAt`
- `endAt`
- `isAllDay?`

Booking guarantees:

- account membership required
- contact/service/assignee must belong to the account
- atomic booking transaction prevents race-condition double booking
- losing concurrent requests return `409 APPOINTMENT_TIME_UNAVAILABLE`

### `PATCH /api/appointments/{tenantId}/{appointmentId}`

Updates one appointment scoped to the account.

Supports:

- edit and reschedule changes
- status workflow updates

Allowed status values:

- `SCHEDULED`
- `CONFIRMED`
- `SHOW`
- `NO_SHOW`
- `CANCELED`

## Status workflow

The intended appointment lifecycle is:

- `SCHEDULED`
- `CONFIRMED`
- `SHOW` or `NO_SHOW`
- `CANCELED` can happen before completion of the appointment lifecycle

This allows the staff user to:

- schedule a new appointment
- confirm the appointment
- mark whether the contact showed up
- cancel when needed

## Error notes

Common errors:

- `TENANT_ACCESS_DENIED`
- `ASSIGNEE_NOT_FOUND`
- `CONTACT_NOT_FOUND`
- `SERVICE_NOT_FOUND`
- `CALENDAR_FILTER_USER_NOT_FOUND`
- `CALENDAR_FILTER_GROUP_NOT_FOUND`
- `CALENDAR_FILTER_CONTACT_NOT_FOUND`
- `CALENDAR_FILTER_SERVICE_NOT_FOUND`
- `APPOINTMENT_TIME_UNAVAILABLE`

## UX contract

When create or reschedule returns `409 APPOINTMENT_TIME_UNAVAILABLE`:

- keep the selected contact, service, assignee, notes, and date
- clear only the invalid slot
- re-fetch slots
- prompt the user to choose another time
