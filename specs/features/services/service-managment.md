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
- Create transaction dialog
- Row click navigation into the related service configuration route

Current row navigation target:

- `/app/{slug}/account-settings/services/{serviceId}`

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

- `GET /api/account-settings/{tenantId}/services`

Backed by:

- `Service`
- `ServiceChecklistItem`
- `ServiceFollowUpTemplate`
- `ServiceProfessional`

Supported query behavior:

- Pagination
- Search by `name`
- Only `isActive = true`

### Table columns

Current columns:

- `Name`
- `Cost`
- `Min Partial Payment`
- `Checklists`
- `Professionals`
- `Follow-Up Templates`

### Column details

#### Service Name

- Display only the name of the service
- Do not display the service description in this table cell

#### Cost

- Display the service cost
- The cost cell should stay vertically centered with the rest of the row content

#### Minimum Partial Payment

- Display the minimum partial payment amount allowed for the service
- The value may show `Full only` when partial payments are not allowed
- The cell should stay vertically centered with the rest of the row content

#### Checklists

- Display whether the service includes a checklist
- This may be shown as a boolean badge, chip, or icon
- The badge should stay vertically centered with the rest of the row content

#### Professionals

- Display the professionals related to the service
- Professionals should be shown as overlapping avatars
- A professional may be an internal user or an external named professional
- Internal users should use their avatar image when available
- Internal professional avatars should use a light blue visual treatment
- External professionals should render an initials fallback avatar
- External professional avatars should use a light orange visual treatment
- Hovering an avatar should elevate it visually so the full avatar is visible
- Hovering an avatar should create extra space so adjacent avatars move apart slightly
- Hovering an avatar should show a tooltip with the professional name
- If there are more professionals than visible avatars, the overflow should be represented with a `+n` avatar and tooltip
- The avatar stack should stay vertically centered with the rest of the row content

#### Follow-Up Templates

- Display the number of published follow-up templates associated with the service
- The count should be rendered as a badge/chip rather than plain text
- The badge should stay vertically centered with the rest of the row content

---

## 6. Create Service Transaction Flow

The services page must include a button that allows the user to create a service transaction.

### Button behavior

- A primary action button should be visible on the services page
- The button should open a flow, modal, or form that allows the user to create a service-related transaction

### Transaction flow requirements

The implemented transaction creation flow is a multi-step dialog.

Current step order:

- `Contact`
- `Service`
- `Follow up`
- `Checklist`
- `Payment`

The user must be able to:

- Pick the contact first
- Pick the service second
- Optionally assign a configured service professional to the transaction
- Pick the follow-up template after service selection
- Optionally assign a tenant user to own the enrolled follow-up work
- Review the checklist items that will be created for the contact
- Create a transaction representing that purchase
- Review and confirm payment details at the end of the flow

### Business context

Services are treated as products or services that can be purchased by contacts.

Because of this:

- A purchased service should be linked to a contact
- A purchased service may be assigned to one configured service professional
- A purchased service should generate or register a transaction
- A service may have multiple follow-up templates
- Once the service is purchased, the user must choose one of the available follow-up templates

### Assigned professional rules

- Professional choices should come from the professionals configured on the selected service
- Internal and external professionals may both be assignable
- Assigning a professional during transaction creation is optional
- The selected professional should be stored on the created contact service enrollment
- The field should be phrased as an optional question such as `Assign a professional?`
- The picker should use the same avatar-led popover command interaction style used elsewhere in the product
- The picker trigger should show the selected avatar and name when assigned
- The picker should allow an explicit unassigned state
- Internal professionals should use light blue avatar styling
- External professionals should use light orange avatar styling

### Follow-up template rules

- Each service can have multiple follow-up templates
- Only templates related to the selected service should be available for selection
- If no templates exist, the UI should handle this clearly
- The selected follow-up template should be attached to the created transaction or post-purchase workflow
- Leaving the field on the default option should use the default published template behavior for the service

### Follow-up ownership rules

- The transaction flow should allow the user to choose a tenant user who will be in charge of the enrolled follow-up work
- The follow-up owner is selected in the dedicated `Follow up` step
- Follow-up owner choices should come from active tenant users
- Assigning a follow-up owner during transaction creation is optional
- If selected, the chosen user should be stamped onto the enrolled `ContactServiceFollowUpStep` records as `assignedToUserId`
- If not selected, the enrolled follow-up steps should remain unassigned
- The follow-up owner picker should use the same compact popover-command interaction style used by other assignee pickers in the product

### Detailed step behavior

#### Step 1. Contact

- The dialog begins with contact selection
- The user searches contacts by name, email, or phone
- A selected contact is shown in a compact summary card with a `Change` action
- The user cannot continue until a contact is selected

#### Step 2. Service

- The service step is focused only on choosing what the transaction will start
- The user selects the service first
- Once the service is selected, the dialog loads:
  - service professionals
  - checklist definition
- The user may then:
  - optionally assign a professional
- This step should not include a wide preview panel
- The dialog should remain narrow enough to avoid unnecessary horizontal expansion

Current service step inputs:

- `Service`
- `Professional`

#### Step 3. Follow up

- The follow-up step comes after service selection and before checklist review
- The purpose of this step is to define the workflow that will start after purchase

Current follow-up step inputs:

- `Follow-Up Template`
- `Follow-Up Owner`

Follow-up step rules:

- The follow-up template list is unlocked by the selected service
- The follow-up owner list should come from active tenant users
- The follow-up owner assignment is optional
- The selected follow-up owner should apply to the follow-up steps enrolled for the new contact service
- If no follow-up owner is selected, the enrolled follow-up steps remain unassigned
- The step should clearly communicate that the selected user is the person in charge of the follow-up work created by the transaction

#### Step 4. Checklist

- The checklist has its own step between service selection and payment
- The purpose of this step is to show the checklist requirements that will be created for the contact
- The checklist should be displayed as a table
- The checklist table should remain compact and focused

Current checklist table columns:

- `#`
- `Checklist Item`
- `Requirement`

Checklist step rules:

- Do not show summary cards for total, required, or optional items
- Do not show per-item description or notes columns in the checklist step table
- Required items should be labeled with a visual badge
- Optional items should be labeled with a visual badge
- If the service has no checklist items, the step should clearly communicate that no checklist requirements will be created

#### Step 5. Payment

- Payment is the final confirmation step
- The user chooses payment mode:
  - `FULL`
  - `PARTIAL`
  - `LATER`
- The user reviews service cost
- The user enters partial payment amount when partial payment is chosen
- The user can add notes
- The transaction is created from this final step

---

### UX notes

- Search is debounced at `350ms`
- Pagination supports `10` or `25` rows
- Only active services should be listed
- Products should never be listed
- Empty state should describe missing active services
- Table rows should be clickable and keyboard accessible
- Clicking a row should navigate to `/app/{slug}/account-settings/services/{serviceId}`
- Data cells should remain vertically centered so rows stay aligned even when the professionals column uses avatar stacks
- The transaction dialog should stay within the viewport and use an internal scroll area when step content exceeds the visible height
- The dialog footer should remain reachable without forcing the entire browser page to scroll

### Contact search behavior in the transaction dialog

Backend endpoint:

- `GET /api/contacts/{tenantId}/search`

Current search expectations:

- Search is tenant scoped
- Search is debounced from the client at `350ms`
- Contact search should not rely only on exact literal substring matches
- Multi-part queries should behave like person-name search, not surname-only search

Name-search rules:

- If the user enters multiple name parts such as `Sophie Garcia`, the backend should strongly prefer contacts that match both the first-name side and the last-name side
- Surname-only matches should not survive as candidate results for a multi-part name query when the given-name side does not also match
- Middle-name matches should get more ranking presence
- If the query includes a middle token, a contact whose middle name matches should rank above a contact with the same first and last name but no matching middle name
- Query tokens should be compared across first name, middle name, and last name rather than only as one full raw string
- Small character mistakes should still be tolerated for name matching, including simple transposition mistakes such as `John` vs `Jonh`

Performance intent:

- The backend should narrow candidate rows in the database before applying in-memory ranking
- Multi-token name searches should constrain first-name and last-name structure at the database filter level
- Broad ranking should run only over a small bounded candidate set, not the entire tenant contact list

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
- optionally assign a configured professional from the selected service
- optionally assign a tenant user to own the enrolled follow-up steps
- review billing rules
- review checklist requirements
- choose payment mode: `FULL`, `PARTIAL`, or `LATER`
- optionally enter notes

Current modal flow order:

- contact
- service
- follow up
- checklist
- payment

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
- each item has one fixed operational status:
  - `NOT_RECEIVED` is the default state
  - `INFORMED` means the contact has been informed
  - `MISSING` means the requested item is currently missing
  - `RECEIVED` means the item has been received and is the only status that counts as complete
- entering `RECEIVED` sets `completedAt`; re-selecting `RECEIVED` preserves it; every other status clears it
- required checklist items are visibly labeled
- checklist updates call:
  - `PATCH /api/services/{tenantId}/contact-services/{contactServiceId}/checklist-items/{checklistItemId}`
- the update body accepts `status`; the deprecated `completed` boolean remains temporarily supported and maps to `RECEIVED` or `NOT_RECEIVED`
- clients must send exactly one of `status` or `completed`
- a real status transition and its activity event are saved atomically
- selecting the current status is idempotent and does not create another event
- each transition retains the checklist label snapshot, previous and new statuses, actor, and timestamp
- historical checklist events are returned with the contact-service detail and are removed with the enrollment

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
