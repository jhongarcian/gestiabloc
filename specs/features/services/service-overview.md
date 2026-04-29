# Service Overview Feature Spec

## 1. Scope

This spec documents the user-facing service detail experience for:

- `/app/{slug}/services/{serviceId}`

This spec is focused only on the service detail route that all tenant users can access after selecting a service.

It should describe:

- how a user opens one service and sees its details
- how pricing, taxes, payment rules, professionals, checklist coverage, and follow-up templates are presented
- how the create transaction flow behaves when launched from a preselected service

This spec does not describe:

- the admin configuration experience under `/app/{slug}/account-settings/services/*`
- contact service enrollment detail routes after a transaction is created

## 2. Core Product Idea

The services area should not feel like an admin backdoor.

For regular tenant users, `/app/{slug}/services` is the place to:

- browse the service catalog
- understand what each service includes
- quickly decide whether the service fits the contact need
- open the detailed overview for the selected service

The service detail page should behave like a sales and operations overview:

- easy to scan
- visually polished
- informative without feeling technical
- focused on what matters to the user before enrollment

## 3. Main Routes

### Service overview detail

Route:

- `/app/{slug}/services/{serviceId}`

Purpose:

- show the full user-facing overview of one service
- present pricing and billing rules clearly
- show tax behavior
- show who can deliver the service
- show follow-up template availability
- show checklist expectations
- let the user start a transaction with this service already selected

## 4. Entry Rule

This spec assumes the user arrives here after selecting a service from `/app/{slug}/services`.

Current entry behavior:

- the services registry table links each service row to `/app/{slug}/services/{serviceId}`
- the user-facing services list no longer routes to account settings

The list route itself is not the implementation target of this spec, except for the fact that it is the primary entry point into this detail page.

## 5. Data Model

The service overview detail is backed by the admin-configured `Service` catalog.

Primary entities:

- `Service`
- `ServiceChecklistItem`
- `ServiceFollowUpTemplate`
- `ServiceProfessional`
- tenant billing settings from account configuration

The detail page is a read-oriented projection of the configured service.

It is not an admin editing surface.

### Current read endpoint

The detail page is currently backed by:

- `GET /api/services/{tenantId}/catalog/{serviceId}`

This endpoint is intended for normal tenant users with active membership.

Current response shape includes:

- service identity and description
- base price and currency
- tax exemption and tenant billing defaults
- partial payment settings
- checklist items
- published follow-up templates
- professionals

Important optimization rule:

- follow-up templates are returned with counts only, not full flow graphs
  - `flowNodeCount`
  - `flowEdgeCount`
- professionals are returned without admin-only notes

## 6. Detail Page Goal

The service detail page should answer these questions immediately:

- What is this service?
- How much does it cost?
- Can it be paid in parts?
- Does tax apply?
- What professionals can handle it?
- What follow-up paths exist for it?
- What checklist items are usually required?
- Can I create a transaction right now?

The page should help a user confidently move from browsing to action.

## 7. Layout Structure

The page should follow the product’s existing white-card, blue-accent visual direction.

Current structure:

1. header hero
2. summary cards
3. overview content blocks
4. supporting detail sections
5. strong transaction call to action

The page should feel rich but not overwhelming.

## 8. Header Hero

The top section should include:

- service name
- service description
- active availability state
- quick price summary
- primary action: `Create transaction`
- back action to `/app/{slug}/services`

Current header behavior:

- soft branded background
- strong title
- concise support copy
- dark right-side CTA panel
- `Create transaction` action in the hero

There is also a secondary bottom-of-page CTA section that opens the same dialog instance.

Optional secondary actions:

- back to services
- copy/share link if desired later

## 9. Summary Cards

Directly below the header, show compact scan cards.

Current cards:

- `Price`
- `Payment`
- `Tax`
- `Professionals`
- `Follow-Up Templates`
- `Checklist`

### Card content expectations

#### Price

- base price
- total with tax when applicable

#### Payment

- `Full payment only` or
- `Minimum deposit + installment plan`

#### Tax

- `No tax`
- `Tax exempt`
- or the applied tenant tax label and rate

#### Professionals

- number of available professionals
- quick visual preview using the same avatar stack pattern already used in the services table

#### Follow-Up Templates

- number of available templates

#### Checklist

- number of checklist items
- optional required vs optional count when available

## 10. Overview Content Blocks

The body should be composed of clear content blocks, not one dense table.

Current sections:

- `About this service`
- `Pricing & Payment`
- `Professionals`
- `Follow-Up Templates`
- `Checklist`

The blocks should stack cleanly on mobile and form a more editorial layout on desktop.

## 11. About This Service

This section should present:

- service name
- service description
- whether the service is active

Behavior:

- description should be fully readable here
- this is the main narrative area for the service

This section should be easy to skim first before the user moves into billing or operations details.

## 12. Pricing & Payment Section

This section should make the payment rules extremely clear.

### Required fields to show

- base price
- whether partial payments are allowed
- minimum deposit
- number of installments
- installment frequency
- whether the user can still pay full amount at any time

### Display rules

If partial payments are not allowed:

- show `Full payment only`

If partial payments are allowed:

- show `Minimum deposit`
- show `Number of installments`
- show `Frequency`
- show a plain-language summary such as:
  - `Pay at least $20 today, then 4 monthly installments`

### Current visual treatment

The section currently uses structured read-only cards with:

- label/value groups
- payment summary copy
- tax summary copy
- estimated total including tax

## 13. Tax Section

Tax handling must reflect tenant billing settings and service tax exemption.

### Display rules

If tenant taxes are disabled:

- show `No taxes apply to this account`

If tenant taxes are enabled and the service is tax exempt:

- show `This service is tax exempt`

If tenant taxes are enabled and the service is taxable:

- show:
  - tax label
  - tax percentage
  - calculated tax amount based on current service price
  - total including tax

The language should be explicit and easy to understand.

The user should not have to infer whether tax is included.

## 14. Professionals Section

This section should show the people who can deliver the service.

### Required display behavior

- show internal and external professionals together
- use the same internal/external avatar treatment already established in the services table
- allow internal users to show their image when available
- show initials fallback when needed

### Recommended layout

- avatar stack or avatar grid in the section header
- table or list below for full details

Recommended fields:

- professional name
- type: internal or external
- external contact when available

Current implementation uses:

- avatar stack in the section header
- read-only table below
- internal users with image or initials fallback
- external professionals with initials fallback
- internal blue / external orange tone treatment

The section should communicate confidence and staffing coverage.

## 15. Follow-Up Templates Section

This section should show the available follow-up paths that can be selected for the service.

### Required display behavior

- show how many templates are available
- show template names
- show enough metadata to help the user choose later during transaction creation

Recommended fields:

- template name
- number of nodes
- number of connections

Current implementation uses a simple overview table with:

- numbered rows
- template name
- `flowNodeCount`
- `flowEdgeCount`

This page does not need the full builder.

It should be a readable overview only.

## 16. Checklist Section

This section should show the expected checklist items for the service.

### Required display behavior

- show checklist items in display order
- show whether each item is required or optional
- show brief descriptions when available

Recommended presentation:

- numbered list or polished table/list cards
- required/optional badges
- compact summary like `3 required · 2 optional`

Current implementation uses checklist cards with:

- numbered order chips
- required / optional badge
- description when available
- empty state copy when no checklist items exist

The goal is to answer:

- what will be needed for this service
- how demanding the setup is before or during enrollment

## 17. Create Transaction From Service Detail

The service detail page must include a primary `Create transaction` action.

Launching from the detail page means the service is already known.

The flow should therefore be shorter than the generic `/services` dialog.

This detail-page dialog should reuse the same overall create-transaction interaction pattern already implemented in the services area.

It should feel like the same product flow, not a completely different modal.

### Current step order from service detail

- `Contact`
- `Follow up`
- `Checklist`
- `Payment`

### Behavior changes from the generic services dialog

- the selected service is fixed to the current service detail page
- the dialog should not ask the user to choose a service again
- the service should be visually shown as already selected or tied to the transaction
- the user should choose the contact first
- then choose the follow-up template for this service
- optionally assign a service professional
- optionally choose the follow-up owner
- review checklist items that will be created
- complete payment details

### Dialog parity with the existing services flow

The service detail transaction dialog should keep the same foundational behavior already used in `/app/{slug}/services`:

- same multi-step structure
- same contact search and selection behavior
- same follow-up owner behavior
- same checklist review behavior
- same payment behavior
- same success outcome after transaction creation

### Current step detail

#### Contact

- search contacts by name, email, or phone
- select a single contact before continuing

#### Follow up

- choose a published follow-up template or leave default
- optionally assign a configured service professional
- optionally assign a tenant user as follow-up owner

#### Checklist

- review the checklist items that will be created for the selected contact

#### Payment

- choose `Pay in Full`, `Partial Payment`, or `Pay Later`
- enter partial payment only when partial payments are allowed
- optionally add notes

The difference is only service context:

- service is already selected
- service-specific follow-up templates are already scoped to this service
- service-specific professionals are already scoped to this service
- service pricing, tax, and payment rules are already known from the current page context

### Professional handling

Current behavior:

- if the service has configured professionals, the dialog allows the user to assign one during the `Follow up` step
- the user never needs to reselect the service

## 18. Service Context In Transaction Dialog

Because the dialog is launched from a selected service, the dialog should always remind the user which service is being enrolled.

Recommended context panel:

- service name
- price

Current implementation uses a compact locked service panel in the dialog with:

- service name
- base price

This panel appears near the top of the dialog and reinforces that the service is preselected.

This context should stay visible in a small header or summary block across steps.

The service context should read as locked or preselected, not editable.

## 19. Access Rules

This service detail page is intended for normal tenant users, not only admins.

Expected permissions:

- any user who can access `/app/{slug}/services` can open `/app/{slug}/services/{serviceId}`
- the page is read-only
- account-settings edit controls must not appear here
- the backend route requires active tenant membership

## 20. Design Direction

This page should follow the current product style:

- strong white content cards
- blue as the main interactive accent
- clear spacing and readable section hierarchy
- soft status chips and summary pills
- easy-to-scan content on both desktop and mobile

Avoid:

- admin-style dense form layouts
- raw data dumps
- unclear pricing language
- links into account-settings from the user-facing flow

## 21. Frontend Validation

The transaction dialog on this page currently uses frontend Zod validation in addition to backend validation.

Current validation coverage includes:

- contact is required
- selected follow-up template must belong to the service
- selected professional must belong to the service
- selected follow-up owner must be a valid tenant assignee option
- partial payment is only valid when the service allows it
- partial payment must be greater than zero and not exceed total service price
- partial payment must respect `minimumPartialPaymentCents`
- notes are capped at 4,000 characters

Backend validation remains the source of truth.

## 22. Empty and Edge States

### No professionals

- show that no professionals are currently listed
- do not block viewing the page

### No follow-up templates

- show that no follow-up templates are available
- the transaction flow can still proceed when no published template is available

### No checklist items

- show that no checklist is required or that none is configured

### No taxes

- explicitly say that taxes do not apply

### Tax exempt

- explicitly say that the service is tax exempt

## 23. Success Criteria

This feature is successful when:

- users can open one service and understand it quickly
- pricing and tax behavior are obvious
- operational readiness is visible through professionals, templates, and checklist sections
- users can start a transaction from the selected service without reselecting it
- the page feels polished, readable, and consistent with the rest of the product
- the page loads from a lean public catalog payload rather than full admin configuration data
