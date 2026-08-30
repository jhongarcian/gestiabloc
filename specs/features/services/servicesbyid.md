# Contact Service By Id

## Purpose

This spec documents the current contact service detail experience rendered by:

- Route: `/app/{slug}/contacts/{contactId}/services/{contactServiceId}`
- Page: `apps/react-ui/app/(tenants)/app/[tenantSlug]/contacts/[contactId]/services/[contactServiceId]/page.tsx`
- Main UI: `apps/react-ui/app/(tenants)/app/[tenantSlug]/contacts/[contactId]/_components/contact-service-details-panel.tsx`

This page is not the tenant service catalog detail page. It is the detail page for a **specific purchased/enrolled service attached to a contact**.

It is the operational screen used to manage the lifecycle of a contact’s service enrollment:

- billing and payments
- checklist completion
- follow-up execution
- service-specific notes
- status management
- activity history

## Primary Goals

The page must let a user quickly understand:

1. what service this contact is enrolled in
2. who is responsible for it
3. how much has been paid and what remains
4. what checklist items are still pending
5. what follow-up step is current and who owns it
6. what service-specific notes and history already exist

## Access And Permissions

The page receives `membershipSecurityLevel` and derives:

- `canManageSensitiveServiceActions = membershipSecurityLevel !== "LOW"`

This means:

- `LOW` users can view the screen but should not be able to perform sensitive mutations
- `MEDIUM` and `MAX` can perform management actions

Sensitive actions currently gated by this rule include:

- deleting the service enrollment
- changing service status
- adding payments
- editing or deleting payments
- changing follow-up owner
- changing follow-up step owner

Other actions such as checklist toggles, note creation, and task creation are currently available in the panel behavior and should be documented as active operational tools.

## Data Dependencies

### Main service enrollment payload

Loaded from:

- `GET /api/services/{tenantId}/contact-services/{contactServiceId}`

Important data groups returned and used by the UI:

- contact service record status and lifecycle dates
- service identity and commercial rules
- tenant billing defaults
- assigned professional
- selected follow-up template
- follow-up steps
- payments
- service notes
- checklist items

### Supporting assignee data

Loaded from:

- `GET /api/tasks/{tenantId}/assignees`

Used for:

- changing overall follow-up owner
- changing individual step owner

## Page Structure

The page is vertically stacked and uses large rounded white cards under a gradient header.

### 1. Hero Header Card

This is the main overview band at the top.

#### Left side content

- small eyebrow label: `Contact Service`
- if a follow-up template exists, the template name is shown inline in the eyebrow
- back button linking to `/app/{slug}/contacts/{contactId}/services`
- main title: service name
- secondary line: `Professional: {assigned professional label}`
- optional service description below if it exists

#### Right side action cluster

Buttons appear as compact rounded pills.

##### Delete

- label: `Delete`
- only shown when the user can manage sensitive service actions
- destructive style
- deletes the entire contact service enrollment

##### Add payment

- label: `Add payment`
- only shown when a remaining balance exists and the user can manage sensitive service actions
- opens the add payment dialog

##### Follow-up owner pill

- only shown when the service has follow-up steps and the user can manage sensitive service actions
- displays:
  - current open-step owner avatar + name
  - or `Mixed assignees`
  - or `Unassigned`
- clicking opens the change follow-up owner dialog

##### Status pill

- always visible
- if the user can manage sensitive actions, it opens a popover command menu
- status options:
  - `Pending`
  - `In Progress`
  - `Pending Payment`
  - `Completed`
  - `Canceled`

### 2. KPI Summary Cards

These cards now follow the same compact operational stat-card style used in the contact header and contact services list.

They should not feel like oversized dashboard blocks. They should be:

- short in height
- easy to scan in one pass
- icon-led
- value-first
- supported by one concise helper line

Required visual structure for each card:

1. muted icon + uppercase label row
2. compact strong value line
3. one short helper line

Recommended shell:

- `rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm`

Recommended value sizing:

- `text-xl font-semibold tracking-tight`

This card pattern should stay aligned with the shared card rules in:

- `specs/ui/summary-cards.md`

Directly under the hero is a four-card summary grid.

#### Total

- shows total service amount
- helper text explains tax inclusion or tax exemption
- uses neutral total styling

#### Paid

- shows total paid
- helper text shows latest payment date or says no payments exist
- uses positive/paid color styling

#### Balance

- shows remaining balance
- helper text shows remaining installments when installment count exists
- uses warning/open-balance color styling

#### Next Payment

- shows the next scheduled payment date
- helper text shows installment frequency or indicates none is configured
- uses neutral date styling

These four cards are critical. They are the fastest way to understand the financial state of the enrollment.

## Main Content Sections

After the KPI cards, the page continues with stacked operational cards.

### 3. Checklist Sheet

Purpose:

- operationally track the current state of documents or requirements for this contact service

The sheet is opened from the checklist quick action in the service header. Its header contains:

- section label: `Checklist Tracking`
- helper copy explaining the intent
- badge showing `{completed}/{total}` and completion percentage; only `RECEIVED` items count

Each checklist row includes:

- item label
- `Required` badge when applicable
- a compact selector with `Not received`, `Informed`, `Missing`, and `Received`
- optional description
- helper line with:
  - received timestamp for `RECEIVED`, or
  - operational helper text for the selected status
- status treatments are neutral for `NOT_RECEIVED`, blue for `INFORMED`, amber for `MISSING`, and emerald for `RECEIVED`
- all selectors and sheet dismissal are disabled while one update is saving

Empty state:

- dashed empty card
- text: this service does not have checklist requirements yet

### 4. Payments Card

Purpose:

- show payment history and support additional payment collection

Header contains:

- section label: `Payments`
- helper copy
- state badge:
  - paid in full
  - partial payment
  - pending payment style depending on remaining balance

Top helper band inside the card:

- payment plan summary
- next scheduled payment summary when available
- tax summary block explaining included tax or tax exemption

Payment list behavior:

- paginated progressively in-page via `Load more payments`
- each payment row is a clickable card for users with management permissions
- payment row contains:
  - amount
  - paid date/time
  - optional payment method badge
  - optional note
  - optional recorded-by name

Footer actions inside the list:

- `Load more payments`
- `Show less`

Empty state:

- dashed empty card
- `No payments have been recorded for this service yet.`

### 5. Service Follow-Up Card

Purpose:

- manage the actual follow-up execution path attached to this purchased service

Header contains:

- section label: `Service Follow-Up`
- helper description
- completion badge (`{percentage}% complete`)
- steps-complete badge (`{completed}/{total} steps`)

Main body:

- progress bar across the top
- ordered step cards rendered as a vertical timeline

Each follow-up step card includes:

- numbered circle in the left timeline rail
- badges such as:
  - `Step N`
  - current time/status label from timing metadata
  - `Current step` when active
- clickable step title opening the step details dialog
- helper line describing timing state
- owner row with avatar and owner name
- step description from `notesTemplate`
- optional latest step note block

Step action area:

##### Status button

- for active steps: editable rounded button
- for non-active steps: disabled button with tooltip
- only active/current steps can have status updated

##### Add note button

- icon button with tooltip
- opens dialog to create a contact note from the step context

##### Create task button

- icon button with tooltip
- opens task creation dialog with prefilled context

Important follow-up behaviors:

- only the active step can be status-mutated directly
- postponed status requires a new date/time
- postponing cascades future pending/active steps
- overall follow-up owner management is separate from per-step owner management

Empty state:

- dashed empty card
- `No follow-up steps are enrolled for this service yet.`

### 6. Service Notes Card

Purpose:

- keep notes specific to this service enrollment separate from general contact notes

Header contains:

- section label: `Service Notes`
- helper copy
- button: `Add note`

Each note row includes:

- author avatar
- note title
- metadata line with author and created date/time
- note body

Empty state:

- dashed empty card
- `No service notes have been added yet.`

### 7. Service History Card

Purpose:

- present a timeline-like feed of important service activity

Header contains:

- section label: `Service History`
- helper copy

History sources merged into one list:

- service purchased
- service completed
- service canceled
- durable checklist status transitions, including previous status, new status, actor, and timestamp
- payments
- service notes

Each history row includes:

- icon bubble with contextual tone
- title
- timestamp
- description

Empty state:

- dashed empty card
- `No service activity is available yet.`

## Dialogs And Detailed Actions

This page relies heavily on contextual dialogs. They are a major part of the UX.

### Change Follow-Up Owner Dialog

Purpose:

- bulk update owner on all open follow-up steps

Contains:

- current owner preview card
- count of affected open steps
- follow-up owner select
- `Cancel`
- `Save owner`

### Add Payment Dialog

Purpose:

- record a full or partial payment

Contains:

- remaining balance summary card
- payment action select:
  - `Pay remaining in full`
  - `Record partial payment`
- amount input
- payment method select
- note textarea
- helper text about installment math and suggested payment
- `Cancel`
- `Add payment`

Important validation:

- partial payment blocked when the service does not allow partial payments
- amount must be valid
- amount cannot exceed remaining balance

### Edit Payment Dialog

Purpose:

- correct or delete an existing payment

Contains:

- amount input
- payment method select
- note textarea
- actions:
  - `Delete payment`
  - `Cancel`
  - `Save payment`

### Add Service Note Dialog

Purpose:

- create a service-specific note

Contains:

- title input
- body textarea
- `Cancel`
- `Add note`

### Update Step Status Dialog

Purpose:

- update active follow-up step status

Contains:

- service/template/step context block
- status select
- optional step note textarea
- postpone date/time input when status is `POSTPONED`
- `Cancel`
- `Save status`

Important validation:

- postpone date/time is required when postponing
- incomplete postpone datetime is rejected

### Follow-Up Step Details Dialog

Purpose:

- inspect a single step in more detail and optionally reassign the owner

Contains:

- service/template/step context block
- status summary
- due date summary
- follow-up owner summary
- optional owner change select for users with permission
- description block
- latest step note block
- actions:
  - `Save owner` when allowed
  - `Close`

### Add Step Note Dialog

Purpose:

- create a contact note from a step context

Contains:

- service/template/step context block
- note title input
- note body textarea
- `Cancel`
- `Save note`

Behavior:

- creates a note in the contact note system with service and step context embedded in the body

### Create Step Task Dialog

Purpose:

- create a linked task from a follow-up step

Contains:

- service/template/step context block
- task title input
- description textarea
- optional due date
- `Cancel`
- `Create task`

Behavior:

- task is created under the tenant task API
- task is linked back to this contact and references the service/step

## Important Derived UI Logic

The following derived values are central to the screen and should be preserved in future redesigns:

- payment collection state
- latest payment
- remaining scheduled installments
- suggested installment payment amount
- next scheduled payment date
- payment plan summary
- follow-up completion percentage
- current follow-up owner
- mixed-owner detection for open steps
- tax amount and tax messaging
- activity/history merged timeline

These derived pieces make the screen useful without forcing the user to manually interpret raw records.

## Important UX Priorities

The most important things on this page are:

1. service identity and assigned professional
2. status and follow-up ownership
3. total paid vs remaining balance
4. current follow-up step and progress
5. checklist completion state
6. payment plan context
7. service notes and audit history

The UI should always optimize for:

- operational clarity over decoration
- fast scanning of financial state
- fast scanning of current follow-up state
- obvious next actions
- low-friction mutation flows through dialogs

## Current Buttons Inventory

Top-level visible buttons and controls currently used:

- back button
- delete
- add payment
- follow-up owner trigger
- service status trigger
- checklist status selector in the checklist sheet
- payment row click for edit
- load more payments
- show less payments
- add note
- follow-up step status trigger
- add step note
- create task from step

Dialog-level buttons currently used:

- cancel
- save owner
- add payment
- save payment
- delete payment
- add note
- save status
- save note
- create task
- close

## Notes For Future Changes

If this page is redesigned, do not collapse everything into tabs too early.

The current value of the screen is that it behaves like an operational command center:

- billing
- checklist
- follow-up execution
- notes
- timeline

These areas are strongly related and are valuable when visible in a single scroll.

If a future version introduces tabs, the highest-priority sections that must remain instantly visible are:

- hero header
- financial summary cards
- current follow-up state
- payment state
