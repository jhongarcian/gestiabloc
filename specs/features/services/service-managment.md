# Service Management Feature Spec

## 1. Scope

This spec documents the service experience that is currently implemented for:

- `/app/{slug}/services`
- `/app/{slug}/contacts/{contactId}/services`
- `/app/{slug}/contacts/{contactId}/services/{contactServiceId}`

This spec is intentionally limited to what users see in those routes and the APIs that power them.

It does not describe the admin configuration screens under Account Settings except where those screens supply data to the service purchase flow.

## 2. Core Product Idea

The current product has three different service-related concepts:

### A. Tenant services registry

Route:

- `/app/{slug}/services`

Backed by:

- `TenantLinkedEntity`

Purpose:

- Maintain reusable tenant-owned linked entities for services
- These records are mainly used for linking tasks and tenant operational references

Important note:

- This route is not a detail page for the admin-configured `Service` catalog
- It is a tenant-scoped registry view for service-linked entities only
- Products must not appear in this route
- Only active services should appear in this route

### B. Admin-configured service catalog

Not shown directly on `/app/{slug}/services`.

Backed by:

- `Service`
- `ServiceChecklistItem`
- `ServiceFollowUpTemplate`
- `ServiceFollowUpTemplateStep`

Purpose:

- Define the real services that can be purchased for a contact
- Store pricing, checklist requirements, partial payment rules, and follow-up templates

This catalog is consumed from the contact service purchase flow.

### C. Contact service enrollments

Routes:

- `/app/{slug}/contacts/{contactId}/services`
- `/app/{slug}/contacts/{contactId}/services/{contactServiceId}`

Backed by:

- `ContactService`
- `ContactServiceChecklistItem`
- `ContactServicePayment`
- `ContactServiceFollowUpStep`
- `ContactServiceNote`

Purpose:

- Represent a purchased service for a specific contact
- Track payment progress, checklist completion, enrolled follow-up steps, notes, and status

## 3. Route Map

### `/app/{slug}/services`

User-facing purpose:

- View tenant-level linked services

Current UI includes:

- Header with summary count
- Search input
- Table
- Pagination
- Create dialog
- Edit dialog
- Delete action

There is no standalone route today for:

- `/app/{slug}/services/{id}`

### `/app/{slug}/contacts/{contactId}/services`

User-facing purpose:

- View all service enrollments for a single contact
- Purchase a new service for that contact
- Review balance, spending, progress, and current enrollment status

Current UI includes:

- Summary cards
- Balance and status charts
- Enrolled services table
- Purchase service dialog
- Row click navigation into one enrolled service

### `/app/{slug}/contacts/{contactId}/services/{contactServiceId}`

User-facing purpose:

- View one purchased service enrollment in detail
- Manage the lifecycle of the enrollment

Current UI includes:

- Enrollment header
- Status chip
- Delete action
- Financial summary cards
- Checklist tracking
- Payments section
- Follow-up step section
- Service notes section
- Service history timeline

## 4. Tenant Data Boundaries

All service-related data in this spec is tenant scoped.

Current tenant isolation rules:

- `/app/{slug}/services` resolves tenant context from the current user membership for `{slug}`
- Backend linked-entity queries are filtered by `tenantId`
- Contact service routes use the tenant resolved from the contact context
- `ContactService`, payments, notes, checklist items, and follow-up steps are always fetched by `tenantId`
- Admin service options used in the purchase modal are fetched only for the current tenant
- Follow-up template choices in the purchase modal are fetched only for the selected tenant service

In practice:

- A user only sees linked entities, service options, enrollments, and nested service records belonging to their current tenant
- Cross-tenant reads and writes are blocked by tenant-scoped queries

## 5. `/app/{slug}/services` Experience

### Data source

Backend endpoint:

- `GET /api/services-products/{tenantId}`

Backed by:

- `TenantLinkedEntity`

Supported query behavior:

- Pagination
- Search by `name`
- Only `type = SERVICE`
- Only `isActive = true`

### Table columns

Current columns:

- `Name`
- `Cost`
- `Min Partial Payment`
- `Has Checklist`
- `# of Professionals`
- `# Template Available`

### Column details

#### Service Name

- Display the name of the service

#### Cost

- Display the service cost

#### Minimum Partial Payment

- Display the minimum partial payment amount allowed for the service

#### Has Checklist

- Display whether the service includes a checklist
- This may be shown as a boolean badge, chip, or icon

#### Professionals

- Display the professionals related to the service
- Professionals should be shown using chips
- The UI should show the number of professionals associated with the service
- If names are shown, they should be rendered as chips

#### Templates Available

- Display the number of templates associated with the service

---

## 6. Create Service Transaction Flow

The services page must include a button that allows the user to create a service transaction.

### Button behavior

- A primary action button should be visible on the services page
- The button should open a flow, modal, or form that allows the user to create a service-related transaction

### Transaction flow requirements

When creating a transaction, the user must be able to:

- Pick a service
- Pick a contact related to that service purchase
- Create a transaction representing that purchase
- Select a follow-up template for the service

### Business context

Services are treated as products or services that can be purchased by contacts.

Because of this:

- A purchased service should be linked to a contact
- A purchased service should generate or register a transaction
- A service may have multiple follow-up templates
- Once the service is purchased, the user must choose one of the available follow-up templates

### Follow-up template rules

- Each service can have multiple follow-up templates
- Only templates related to the selected service should be available for selection
- If no templates exist, the UI should handle this clearly
- The selected follow-up template should be attached to the created transaction or post-purchase workflow

---

### UX notes

- Search is debounced at `350ms`
- Pagination supports `10` or `25` rows
- Only active services should be listed
- Products should never be listed
- Empty state should describe missing active services
- This screen is editable in-place; rows are not clickable and do not navigate to a detail screen

## 6. Contact Service Enrollment List

### Route

- `/app/{slug}/contacts/{contactId}/services`

### Data source

Backend endpoint:

- `GET /api/services/{tenantId}/contact-services?contactId={contactId}`

Returned data per enrollment includes:

- enrollment id
- service status
- total price
- paid amount
- remaining amount
- currency
- notes
- selected follow-up template
- enrolled checklist items
- enrolled follow-up steps
- service summary fields

### List page behavior

The page currently shows:

- total enrolled services
- total completed services
- current spending
- remaining balance
- balance chart
- service status mix chart
- services table with row navigation

Current table columns:

- `Service`
- `Status`
- `Total`
- `Paid`
- `Remaining`
- `Progress`

Progress is calculated from enrolled follow-up steps:

- completed = `COMPLETED` or `SKIPPED`, or steps with `completedAt`
- remaining = total minus completed

### Purchase service flow

The purchase modal is opened from this page.

The modal uses:

- `GET /api/account-settings/{tenantId}/services/options`
- `GET /api/account-settings/{tenantId}/services/{serviceId}`
- `GET /api/account-settings/{tenantId}/services/{serviceId}/follow-up-templates`

The modal currently allows the user to:

- choose a service from the admin-configured service catalog
- optionally choose a published follow-up template for that service
- review billing rules
- review checklist requirements
- choose payment mode: `FULL`, `PARTIAL`, or `LATER`
- optionally enter notes

Current purchase behavior:

- selected service must belong to the tenant
- selected contact must belong to the tenant
- selected follow-up template must be a published template for that service
- if no template is selected, the backend uses the first published template if one exists
- if a specific template is selected but has no enrollment steps, the request fails
- enrollment `totalPriceCents` is derived from `Service.basePriceCents`
- partial payment is rejected if the service does not allow partial payments
- initial payment cannot exceed the total service amount
- service notes are sanitized before storage
- the new `ContactService` is created with status `IN_PROGRESS`
- checklist items are copied from the service definition into `ContactServiceChecklistItem`
- follow-up steps are enrolled from the selected published template, or from the service fallback template steps
- the first enrolled step starts as `ACTIVE`; later steps start as `PENDING`

## 7. Contact Service Details Experience

### Route

- `/app/{slug}/contacts/{contactId}/services/{contactServiceId}`

### Data source

Backend endpoint:

- `GET /api/services/{tenantId}/contact-services/{contactServiceId}`

The details screen currently shows:

- service name and description
- selected follow-up template name
- total, paid, and remaining balance
- checklist items and completion state
- payments history
- follow-up steps with current timing/status
- service notes
- activity history

### Checklist behavior

Checklist entries are contact-service-specific copies of service checklist requirements.

Current behavior:

- checklist items are displayed in service sort order
- each item can be marked received or unreceived
- required checklist items are visibly labeled
- checklist updates call:
  - `PATCH /api/services/{tenantId}/contact-services/{contactServiceId}/checklist-items/{checklistItemId}`

### Payments behavior

Payments are specific to one `ContactService`.

Current behavior:

- show payment list sorted by most recent
- show method, note, and recorder when available
- support add payment
- support edit payment
- support delete payment
- backend blocks payments that would exceed the total service amount

Payment endpoints:

- `POST /api/services/{tenantId}/contact-services/{contactServiceId}/payments`
- `PATCH /api/services/{tenantId}/contact-services/{contactServiceId}/payments/{paymentId}`
- `DELETE /api/services/{tenantId}/contact-services/{contactServiceId}/payments/{paymentId}`

### Enrollment status behavior

Enrollment statuses:

- `PENDING`
- `IN_PROGRESS`
- `COMPLETED`
- `CANCELED`

Current behavior:

- status can be changed from the detail view
- `COMPLETED` sets `completedAt`
- `CANCELED` sets `canceledAt`
- other statuses clear completion/cancel timestamps

Endpoint:

- `PATCH /api/services/{tenantId}/contact-services/{contactServiceId}`

### Follow-up step behavior

Step statuses:

- `PENDING`
- `ACTIVE`
- `COMPLETED`
- `SKIPPED`
- `POSTPONED`

Current behavior:

- only the current active step can have its status changed
- non-active steps are locked for status changes
- step details can be viewed from the UI
- a step can be postponed to a new date/time
- postponing can cascade timing shifts to future pending/active steps
- completing or skipping the active step can advance the workflow
- a step can be turned into a contact note
- a step can be turned into a task
- the screen can add ad-hoc follow-up steps to the enrollment

Endpoints:

- `PATCH /api/services/{tenantId}/contact-services/{contactServiceId}/follow-up-steps/{followUpStepId}`
- `POST /api/services/{tenantId}/contact-services/{contactServiceId}/follow-up-steps`
- `DELETE /api/services/{tenantId}/contact-services/{contactServiceId}/follow-up-steps/{followUpStepId}`

### Service notes behavior

Current behavior:

- service-specific notes are separate from general contact notes
- note title and body are required
- notes are sanitized before storage

Endpoint:

- `POST /api/services/{tenantId}/contact-services/{contactServiceId}/notes`

### Delete behavior

Current behavior:

- the detail page can delete the entire contact service enrollment

Endpoint:

- `DELETE /api/services/{tenantId}/contact-services/{contactServiceId}`

## 8. Security Checks

### Shared baseline checks

All service APIs in this spec require:

- authenticated user
- tenant membership for the target `tenantId`
- membership status `ACTIVE`

If that fails, the backend returns:

- `TENANT_ACCESS_DENIED`

### `/app/{slug}/services` route checks

Frontend route behavior:

- resolves the current tenant from `auth/me`
- redirects out if the user has no membership for the slug

Backend linked-entity rules:

- read list is allowed for any active tenant member
- create, edit, and delete require:
  - `role = TENANT_ADMIN`, or
  - `securityLevel !== LOW`

Write failures return:

- `INSUFFICIENT_PERMISSIONS`

### Contact service read access

Current backend behavior:

- list enrollments is allowed for any active tenant member
- detail view is allowed for any active tenant member

This means `LOW`, `MEDIUM`, `MAX`, and `TENANT_ADMIN` can read enrolled services for contacts in the tenant.

### Contact service mutation access

Current implementation is mixed and should be documented exactly as-is.

Allowed for any active tenant member:

- create contact service enrollment
- add service note
- toggle checklist item received state
- create follow-up step
- update follow-up step
- delete follow-up step

Restricted to `TENANT_ADMIN` or members with `securityLevel !== LOW`:

- add payment
- update payment
- delete payment
- update contact service status
- delete contact service enrollment

Restricted by follow-up-step state, regardless of security level:

- step status cannot be changed unless the step is currently `ACTIVE`
- assigning a step requires the assignee to have an active membership in the same tenant

Current frontend behavior also reflects part of this:

- in the detail screen, low-security users do not get status-change or delete controls
- in the detail screen, low-security users cannot open payment edit flows
- the purchase-service flow is still visible on the contact services list page

Important current nuance:

- low-security users can still create a service enrollment because the backend does not currently guard enrollment creation with `securityLevel`
- low-security users can still add service notes and work with follow-up steps because those endpoints are not currently gated by `canManageContactServices`

## 9. Data Model For What Users See

### `/app/{slug}/services`

Primary record:

- `TenantLinkedEntity`

Fields surfaced in the UI:

- `id`
- `name`
- `sortOrder`

Applied view constraints:

- `type` must be `SERVICE`
- `isActive` must be `true`

### `/app/{slug}/contacts/{contactId}/services`

Primary record:

- `ContactService`

User-visible derived fields:

- service name
- selected template name
- paid amount
- remaining amount
- follow-up completion percentage

Dependent records:

- `ContactServicePayment`
- `ContactServiceChecklistItem`
- `ContactServiceFollowUpStep`

### `/app/{slug}/contacts/{contactId}/services/{contactServiceId}`

Primary record:

- one `ContactService`

Related records shown:

- `Service`
- `ServiceFollowUpTemplate`
- `ContactServicePayment`
- `ContactServiceChecklistItem`
- `ContactServiceFollowUpStep`
- `ContactServiceNote`

## 10. Current Business Rules

- `/app/{slug}/services` manages tenant linked entities, not the admin service catalog
- `/app/{slug}/services` must show services only
- `/app/{slug}/services` must not show products
- `/app/{slug}/services` must show active services only
- service purchase flows use the admin-configured `Service` catalog
- a purchased service always becomes a `ContactService`
- each contact service belongs to exactly one tenant, one contact, and one service
- service enrollments can optionally attach a published follow-up template
- enrolled follow-up steps are copied at purchase time
- payment totals cannot exceed the service total amount
- partial payments are only allowed when the source service allows them
- tenant reads are broadly available to active members
- write access is inconsistent today and depends on the specific endpoint

## 11. Explicit Out Of Scope

This spec does not cover:

- Account Settings service configuration screens
- Service professionals configuration
- Service catalog CRUD in admin settings
- Follow-up template builder internals
- The separate `/app/{slug}/followups` route, even though it reads the same enrollment/follow-up domain
