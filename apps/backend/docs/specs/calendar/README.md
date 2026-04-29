# Calendar API Specs

This folder documents the calendar endpoints that back:

- the tenant calendar route
- the create-appointment flow
- tenant admin calendar configuration

Files:

- [appointments.md](/Users/jhongarcian/coding/gestiabloc/apps/backend/docs/specs/calendar/appointments.md)
- [account-settings-calendar.md](/Users/jhongarcian/coding/gestiabloc/apps/backend/docs/specs/calendar/account-settings-calendar.md)

Implementation references:

- [appointments.routes.ts](/Users/jhongarcian/coding/gestiabloc/apps/backend/src/routes/appointments.routes.ts)
- [account-settings.routes.ts](/Users/jhongarcian/coding/gestiabloc/apps/backend/src/routes/account-settings.routes.ts)
- [openapi.yml](/Users/jhongarcian/coding/gestiabloc/apps/backend/docs/openapi.yml)

Security and validation rules:

- All calendar endpoints require authenticated tenant membership or tenant-admin access, depending on the route.
- Calendar admin routes enforce same-origin checks for mutations.
- Tenant-scoped IDs are validated before queries are executed.
- Calendar filtering is mode-exclusive:
  - `users` mode accepts user filters only
  - `groups` mode accepts group filters only
- Group membership is limited to active, calendar-enabled staff.
- Atomic appointment creation is the source of truth for booking conflicts.
