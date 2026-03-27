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

The list route itself is not the implementation target of this spec.

This spec only defines what happens once the user is already on:

- `/app/{slug}/services/{serviceId}`

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

Recommended structure:

1. header hero
2. summary cards
3. overview content blocks
4. supporting detail sections
5. sticky or strongly visible primary action

The page should feel rich but not overwhelming.

## 8. Header Hero

The top section should include:

- service name
- service description
- active availability state
- quick price summary
- primary action: `Create transaction`

Recommended header behavior:

- soft branded background
- strong title
- concise support copy
- prominent primary CTA

Optional secondary actions:

- back to services
- copy/share link if desired later

## 9. Summary Cards

Directly below the header, show compact scan cards.

Recommended cards:

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

Recommended sections:

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

### Visual treatment

This block should use a structured summary layout rather than raw form-like rows.

Recommended:

- label/value pairs
- short helper copy
- one highlighted payment summary card

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

The goal is to answer:

- what will be needed for this service
- how demanding the setup is before or during enrollment

## 17. Create Transaction From Service Detail

The service detail page must include a primary `Create transaction` action.

Launching from the detail page means the service is already known.

The flow should therefore be shorter than the generic `/services` dialog.

This detail-page dialog should reuse the same overall create-transaction interaction pattern already implemented in the services area.

It should feel like the same product flow, not a completely different modal.

### Target step order from service detail

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
- if applicable, choose the follow-up owner
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

The difference is only service context:

- service is already selected
- service-specific follow-up templates are already scoped to this service
- service-specific professionals are already scoped to this service
- service pricing, tax, and payment rules are already known from the current page context

### Professional handling

If the service has configured professionals:

- allow the user to assign one of the available professionals during the flow

This can happen in:

- the contact step, or
- the follow-up step, or
- a compact service-context panel shown throughout the dialog

The important rule is that the user should not need to reselect the service.

## 18. Service Context In Transaction Dialog

Because the dialog is launched from a selected service, the dialog should always remind the user which service is being enrolled.

Recommended context panel:

- service name
- service description summary when helpful
- price
- payment summary
- tax summary
- assigned service professional when selected

This context should stay visible in a small header or summary block across steps.

The service context should read as locked or preselected, not editable.

## 19. Access Rules

This service detail page is intended for normal tenant users, not only admins.

Expected permissions:

- any user who can access `/app/{slug}/services` can open `/app/{slug}/services/{serviceId}`
- the page is read-only
- account-settings edit controls must not appear here

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

## 21. Empty and Edge States

### No professionals

- show that no professionals are currently listed
- do not block viewing the page

### No follow-up templates

- show that no follow-up templates are available
- if transaction flow requires a template, communicate that clearly

### No checklist items

- show that no checklist is required or that none is configured

### No taxes

- explicitly say that taxes do not apply

### Tax exempt

- explicitly say that the service is tax exempt

## 22. Success Criteria

This feature is successful when:

- users can open one service and understand it quickly
- pricing and tax behavior are obvious
- operational readiness is visible through professionals, templates, and checklist sections
- users can start a transaction from the selected service without reselecting it
- the page feels polished, readable, and consistent with the rest of the product
