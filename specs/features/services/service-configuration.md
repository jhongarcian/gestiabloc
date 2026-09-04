# Service Configuration Feature Spec

## 1. Scope

This spec documents the account-settings service configuration experience for:

- `/app/{slug}/account-settings/services`
- `/app/{slug}/account-settings/services/{serviceId}`
- `/app/{slug}/account-settings/services/{serviceId}/follow-up-templates/*`

This spec is focused on the admin-facing `Service` configuration surface.

It should describe:

- how a tenant admin configures a service
- how tenant billing settings affect service billing
- how service readiness is shown
- how billing and partial payment rules are configured
- how checklist, follow-up templates, and professionals are organized

This spec does not cover:

- the public `/app/{slug}/services` registry table except where it consumes configured service data
- contact service enrollment execution except where the configuration directly feeds the purchase flow

## 2. Core Product Idea

The account-settings service configuration area is the source of truth for what can be sold and enrolled as a service.

Each configured service should define:

- service identity
- price and billing rules
- tax behavior
- whether the service is active
- checklist requirements
- follow-up templates
- professionals that can deliver the service

This configuration powers:

- the `/app/{slug}/services` table
- the create transaction dialog
- contact service enrollments
- enrolled checklist items
- enrolled follow-up steps
- available assigned professionals

## 3. Main Routes

### Service list

Route:

- `/app/{slug}/account-settings/services`

Purpose:

- show the tenant service catalog
- create a new service
- open one service configuration screen

### Service details

Route:

- `/app/{slug}/account-settings/services/{serviceId}`

Current implementation entry:

- [`service-details-panel-client.tsx`](gestiabloc/apps/react-ui/app/(tenants)/app/[tenantSlug]/account-settings/services/[serviceId]/_components/service-details-panel-client.tsx)

Actual interactive panel:

- [`service-details-panel.tsx`](gestiabloc/apps/react-ui/app/(tenants)/app/[tenantSlug]/account-settings/_components/service-details-panel.tsx)

Purpose:

- configure one service end to end
- expose readiness state
- guide the admin through missing configuration
- provide access to follow-up template editing

## 4. Data Model

The account-settings service configuration view is backed by:

- tenant billing settings in the account area
- `Service`
- `ServiceChecklistItem`
- `ServiceFollowUpTemplate`
- `ServiceFollowUpTemplateStep`
- `ServiceProfessional`

Important downstream consumers:

- `ContactService`
- billing-plan records derived from a sold service
- `ContactServiceChecklistItem`
- `ContactServiceFollowUpStep`

## 4A. Tenant Billing Settings Dependency

Service billing configuration depends on tenant-level billing settings configured in the account area.

Target account settings location:

- `/app/{slug}/account-settings/account`

The account page should allow the tenant to configure:

- whether taxes are enabled
- whether the tenant is a no-tax account
- the default tax percentage
- an optional tax label

Recommended first version:

- `Taxes enabled`
- `Tax percentage`
- `Tax label`

No-tax account behavior:

- if taxes are disabled for the tenant, service sales should not apply tax
- the account configuration should clearly support a no-tax state

Service-level taxability should still be configurable independently through `Tax Exempt`

## 4B. Tax Resolution Model

Tax should be resolved using both tenant billing settings and service configuration.

Tax application rules:

- if tenant taxes are disabled, no tax is applied
- if tenant taxes are enabled and the service is marked tax exempt, no tax is applied
- if tenant taxes are enabled and the service is not tax exempt, use the tenant default tax percentage

This resolved tax must be snapshotted at the time the service is sold.

## 5. Service Details Screen Goal

The service details screen should feel like a guided configuration workspace, not one long stacked form.

The target structure is:

1. header and configuration progress cards
2. tabbed workspace
3. sticky save action

The top of the screen should immediately answer:

- is this service ready to be sold?
- what is still missing?
- which configuration area needs attention?

## 6. Header

The service details page should start with a strong header section.

### Header content

- service name
- short support text describing what this screen configures
- complete or incomplete overall status
- delete action

### Overall status behavior

- If all required configuration areas are complete, show a success treatment
- If one or more required configuration areas are incomplete, show an alert treatment
- The overall incomplete state should use a red family treatment rather than amber

Recommended incomplete treatment:

- soft red badge or pill
- red icon accent
- copy such as `Configuration incomplete`

Recommended complete treatment:

- soft green badge or pill
- success icon accent
- copy such as `Ready`

## 7. Configuration Progress Cards

Configuration progress should be moved into cards near the top of the screen.

It should not live as a separate bottom section.

### Card placement

- directly below the header
- above the tabbed content

### Required cards

- `Overview`
- `Checklists`
- `Follow-Up Templates`
- `Professionals`

### Card behavior

Each card should show:

- area name
- a compact count or readiness summary
- completion state
- a visual status light or accent

### Incomplete card treatment

If a configuration area is incomplete:

- the card should use a light red background or border treatment
- the status light or accent should be red
- the supporting copy should explain what is missing

Examples:

- `Overview`: missing billing rules or invalid payment setup
- `Checklists`: no checklist items configured when checklist is expected to be mandatory for service readiness
- `Follow-Up Templates`: no published or usable template configured
- `Professionals`: no professional available for the service

### Complete card treatment

If a configuration area is complete:

- the card should use a light green treatment
- the status light or accent should be green

### Progress rules

The configuration cards are the primary readiness summary on the page.

They should replace the current bottom `Configuration Progress` section.

## 8. Tabbed Workspace

The service details screen should display the main configuration areas in tabs.

Required tabs:

- `Overview`
- `Checklists`
- `Follow-Up Templates`
- `Professionals`

The tabbed layout should make the screen easier to scan and reduce perceived form length.

## 9. Overview Tab

The `Overview` tab is the home for service identity, activation, and billing configuration.

### Overview tab sections

- service identity
- pricing
- partial payment rules
- activation state

### Fields

- `Service Name`
- `Description`
- `Base Price`
- `Currency`
- `Status`
- `Tax Exempt`
- `Allow Partial Payments`
- `Minimum Deposit`
- `Number of Installments`
- `Installment Frequency`

## 10. Payment Configuration Model

The billing model should remain simple and understandable for admins and for users creating transactions.

### Required behavior

The admin should be able to:

- enable or disable partial payments
- set a minimum deposit
- choose how many future installments the service is intended to be split into
- choose the installment frequency
- mark a service as tax exempt

Example:

- service price = `100`
- tenant tax = `10%`
- service is taxable
- partial payments enabled
- number of installments = `4`
- frequency = `MONTHLY`

The UI should communicate this as:

- `Total with tax: 110.00`
- `4 monthly installments`
- `20.00 minimum deposit`
- `20.00 per installment after the first payment` when the first payment is `30.00`

### Admin mental model

The admin is not configuring a complex financing engine.

The admin is configuring a simple payment plan summary for the service:

- whether partial payments are allowed
- what the minimum upfront deposit is
- how many future installments the amount is expected to be split into
- how frequently those installments are due
- whether tax should apply to the service

### Required fields

#### Allow Partial Payments

- boolean toggle

#### Minimum Deposit

- currency value
- same concept as the current minimum partial payment field
- only editable when partial payments are enabled

#### Number of Installments

- integer field or bounded select
- only editable when partial payments are enabled
- must be at least `2` if partial payments are enabled

Important semantic rule:

- installment count means the number of scheduled future installments after the first payment made during sale

#### Installment Frequency

- required when partial payments are enabled
- should be a constrained select

Supported values:

- `WEEKLY`
- `BIWEEKLY`
- `MONTHLY`

#### Tax Exempt

- boolean toggle
- if enabled, no tax should be applied to this service even if tenant tax settings are active

### Derived display

When partial payments are enabled, the overview tab should show a simple human-readable summary:

- `4 monthly installments`
- `Minimum deposit: $20.00`
- `Tax: 10%` when tax applies
- `Tax exempt` when the service is marked tax exempt

The UI should also show an easy-to-understand plan preview:

- subtotal
- tax amount
- total
- number of installments
- frequency
- a simple per-installment estimate

### Validation rules

- base price must be a valid positive currency amount
- minimum deposit must be a valid currency amount when partial payments are enabled
- minimum deposit cannot exceed the base price
- number of installments must be a valid integer greater than or equal to `2` when partial payments are enabled
- installment frequency must be selected when partial payments are enabled
- if partial payments are disabled:
  - minimum deposit should be cleared or ignored
  - number of installments should be cleared or ignored
  - installment frequency should be cleared or ignored
- tax exempt is independent from partial payment rules

### Rounding behavior

If the final remaining balance does not divide evenly by the number of installments:

- the UI should still show a simple installment summary
- backend rounding should be cent-safe
- the spec should prefer keeping any remainder handling deterministic and explicit

Example:

- total = `110.00`
- first payment = `20.00`
- remaining balance = `90.00`
- installments = `4`

Possible presentation:

- `4 installments of approximately $22.50`

Implementation note:

- exact cent remainder distribution can be finalized during implementation
- the important requirement is that the admin can understand the plan easily

## 10A. Full Payoff Rule

Even when a service is configured for partial payments and installments, staff or the contact should be able to pay the full remaining amount at any time.

Implications:

- installment plans do not block full payoff
- the billing model must allow a payment that satisfies all remaining open balance
- follow-up or checklist state is not tied to payoff behavior
- the service price itself cannot be overridden at sale time

## 10B. Fixed Schedule Rule

Installment dates are fixed by service rules.

This means:

- installment frequency is defined on the service
- the generated installment schedule should be predictable at sale time
- equal installments are the only supported structure in this spec
- custom schedules are out of scope

## 11. Overview Completion Rules

The `Overview` card should be considered complete when:

- service name exists
- base price is valid
- currency is valid
- service status is set
- tax exempt state is explicitly configurable
- if partial payments are enabled:
  - minimum deposit is valid
  - number of installments is valid
  - installment frequency is valid

The `Overview` card should be considered incomplete when any of the above is missing or invalid.

## 12. Checklists Tab

The `Checklists` tab should contain the checklist configuration tools.

### Purpose

- define service requirements that will be copied into contact-service checklist items during purchase

### Tab contents

- checklist intro text
- add checklist item action
- sortable checklist item list
- edit checklist item dialog

### Checklist item fields

- label
- description
- required or optional
- sort order

### Checklist behaviors

- drag to reorder
- inline summary of required vs optional state
- create
- edit
- delete
- persist order

### Completion rule

The `Checklists` progress card should define completion according to product policy.

Recommended rule:

- complete when at least one checklist item exists

If the product later decides checklist is optional for some services, the completion logic can evolve, but the progress card should still explain the reason.

## 13. Follow-Up Templates Tab

The `Follow-Up Templates` tab should contain the follow-up template list for this service.

### Purpose

- define which follow-up flows can be enrolled when the service is purchased

### Tab contents

- follow-up templates table
- action to add a new template
- row click navigation to template builder route
- empty state when there are no templates

### Table columns

- `#`
- `Template`
- `Nodes`
- `Edges`

### Behaviors

- rows should be clickable
- keyboard accessible row navigation should be preserved
- add-template action should route to the new template builder page
- empty state should explain that a template is needed to drive follow-up execution

### Completion rule

The `Follow-Up Templates` card should be complete when:

- there is at least one usable follow-up template for the service

Preferred usability rule:

- at least one template exists and is usable for enrollment

## 14. Professionals Tab

The `Professionals` tab should contain the service professional management interface.

### Purpose

- configure the professionals who can deliver this service
- provide options for assigned professional in the transaction flow

### Tab contents

- add professional action
- sortable professionals table
- professional create and edit dialog
- empty state

### Professional types

- `INTERNAL_USER`
- `EXTERNAL`

### Internal professional fields

- user
- optional notes

### External professional fields

- external professional name
- external contact
- optional notes

### Table columns

- drag handle
- type
- name
- contact number or contact detail

### Behaviors

- drag to reorder
- click row to edit
- create
- edit
- delete
- persist order

### Completion rule

The `Professionals` card should be complete when:

- at least one professional is configured for the service

## 15. Tab Design Rules

### General

- tabs should reduce visual overload compared with one long vertical page
- only the active tab content should dominate the screen
- tab labels should be short and obvious

### Navigation behavior

- the current tab should be obvious
- switching tabs should not discard unsaved local edits unexpectedly
- save behavior should remain understandable across tabs

### Mobile behavior

- tabs should remain usable on smaller screens
- card and tab density should not force horizontal scrolling

## 16. Save Behavior

The page should retain a sticky save action.

### Save expectations

- save remains globally available from the service details screen
- tab switching should not hide the save affordance
- save should persist all modified sections safely

### Error handling expectations

- backend validation errors should surface clearly
- section-specific failures should be understandable
- partial payment validation errors should reference the exact field at fault

## 17. Relationship To Transaction Flow

This configuration screen directly powers the create transaction dialog documented in [`service-managment.md`](/Users/jhongarcian/coding/gestiabloc/specs/features/services/service-managment.md).

Specifically:

- `Overview` provides price, tax, and payment-plan rules
- `Checklists` provides checklist items copied to `ContactServiceChecklistItem`
- `Follow-Up Templates` provides selectable templates in the `Follow up` step
- `Professionals` provides assigned-professional choices in the `Service` step

## 18. Transaction Flow Implications

Because of the current transaction design:

- service selection needs a configured service
- professional assignment needs configured professionals
- follow-up coordination only makes sense when follow-up templates exist
- checklist review depends on configured checklist items
- payment step depends on the billing, tax, and installment rules from the overview tab

## 19. Partial Payment Plan Implications For Purchase Flow

The transaction flow should remain easy to understand for staff users.

For that reason, the configuration screen should express partial payments in a way that can be reused downstream.

Recommended downstream display examples:

- `Full only`
- `Partial payments allowed`
- `Tax exempt`
- `Tax 10%`
- `4 monthly installments`
- `Minimum deposit $20.00`
- `Pay full at any time`

This should align with:

- service list table
- service transaction flow
- future detail screens if installment guidance is shown there

## 20. Completion Summary Rules

The top summary cards should be the canonical readiness view.

Recommended completeness model:

- service is fully ready when:
  - overview is complete
  - checklists are complete
  - follow-up templates are complete
  - professionals are complete

If any required area is incomplete:

- overall service state = incomplete
- missing areas must show red card treatment at the top

## 21. Non-Goals

This spec does not require:

- implementing installment collection logic across multiple payment records yet
- redesigning the follow-up template builder itself
- replacing the dedicated follow-up template builder route

The current goal is the service configuration experience and the data shape it should express.

## 22. Implementation Guidance

When implementation starts, the work should likely be split into:

1. tabbed layout refactor for the service details screen
2. move progress status into top cards with red/green completion states
3. add tenant billing settings in account settings
4. overview billing model update to support tax exemption, installment count, and frequency
5. backend payload and schema changes for the new payment-plan fields
6. downstream usage updates in service table and transaction flow if needed
