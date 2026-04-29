# Services Domain Overview

## 1. Purpose

This document explains the current services model in plain product terms.

It is intended as the easiest place to understand:

- what a service is
- how follow-ups relate to services
- how transactions work now
- what happens when a service is sold to a contact

This file is a domain overview, not a route-by-route implementation spec.

For detailed screen specs, see:

- `specs/features/services/service-managment.md`
- `specs/features/services/service-overview.md`
- `specs/features/services/service-configuration.md`

## 2. Core Idea

In the product, a `Service` is the sellable definition of work the tenant offers.

A service is not just a name and a price.

A service can define:

- a description
- a base price
- tax behavior
- payment rules
- checklist requirements
- follow-up templates
- professionals who can deliver or own the service

When a user creates a transaction for a contact, the product turns that configured service into a contact-specific enrollment.

That enrollment is the operational record that staff then work from.

## 3. The Three Main Service Layers

### A. Service configuration

This is the admin source of truth.

It lives under:

- `/app/{slug}/account-settings/services`
- `/app/{slug}/account-settings/services/{serviceId}`

This layer defines:

- what the service is
- how it is priced
- whether it is taxable
- whether partial payments are allowed
- what checklist items belong to it
- what follow-up templates belong to it
- what professionals can be assigned to it

### B. Service catalog / user-facing service views

This is what tenant users see when they browse services.

It lives under:

- `/app/{slug}/services`
- `/app/{slug}/services/{serviceId}`

This layer is read-only for normal users.

It helps them:

- understand the service
- review payment expectations
- review follow-up availability
- review checklist expectations
- start a transaction

### C. Contact service enrollments

This is the actual sold service attached to one contact.

It lives under:

- `/app/{slug}/contacts/{contactId}/services`
- `/app/{slug}/contacts/{contactId}/services/{contactServiceId}`

This layer tracks execution:

- service status
- payments
- checklist completion
- follow-up progress
- service notes
- assigned professional

## 4. What Happens When A Service Is Sold

Selling a service creates a `ContactService`.

That is the contact-specific version of the configured service.

At the moment of sale, the system:

1. links the selected contact
2. links the selected service
3. optionally links a follow-up template
4. optionally assigns a service professional
5. optionally assigns a follow-up owner
6. creates the service enrollment
7. creates an initial payment if one was entered
8. creates contact checklist items from the service checklist
9. creates contact follow-up steps from the chosen follow-up template or service follow-up defaults

From that point on, staff operate on the `ContactService`, not directly on the catalog `Service`.

## 5. Transaction Flow

The current transaction flow is intentionally guided.

### Standard flow

Current steps:

1. `Contact`
2. `Service`
3. `Follow up`
4. `Checklist`
5. `Payment`

### What each step does

#### Contact

The user selects which contact is buying or receiving the service.

#### Service

The user confirms the service and can optionally assign a professional to that service enrollment.

On the single service detail page, the service is already preselected and locked.

#### Follow up

The user selects:

- which follow-up template to use
- which user will own the follow-up work

#### Checklist

The user reviews which checklist items will be created for the contact.

This is review-only in the transaction flow.

#### Payment

The user decides how the service is being paid now:

- full payment
- partial payment
- no payment now

The system uses the service billing rules to validate what is allowed.

## 6. Follow-Ups

Follow-ups are one of the most important parts of the service model.

They allow the service to create a structured operational path after sale.

### Service-level follow-up definition

A service can have:

- follow-up templates
- follow-up template steps

The template defines the reusable path.

The steps define the ordered work that should happen after the service is enrolled.

### Enrollment-time follow-up behavior

When the transaction is created:

- the selected follow-up template is attached to the contact service
- its steps are copied into `ContactServiceFollowUpStep`
- each copied step becomes part of the operational execution for that contact

### Follow-up ownership

The transaction flow can assign a follow-up owner.

That owner is a tenant user who becomes responsible for the follow-up steps created for the enrollment.

This is different from the assigned service professional.

### Difference between professional and follow-up owner

Assigned professional:

- who is associated with delivering the service
- can be an internal user or an external professional

Follow-up owner:

- who is responsible for follow-up execution
- must be an internal tenant user

These are related, but they are not the same concept.

## 7. Checklists

Checklists define the required or optional requirements that come with a service.

Examples:

- proof of address
- signed consent form
- ID copy

At the service level:

- checklist items are configured once

At the enrollment level:

- checklist items are copied into contact-specific checklist records
- staff complete those records as work is done

This lets the configured service remain reusable while every sold service has its own completion tracking.

## 8. Payments

Payments are driven by the service configuration and tenant billing settings.

### Current billing behavior

A service can define:

- base price
- tax exempt or taxable
- whether partial payments are allowed
- minimum deposit
- number of installments
- installment frequency

Tenant billing settings define:

- whether taxes are enabled
- the default tax label
- the default tax percentage

### Tax resolution

Tax is applied only when:

- tenant taxes are enabled
- the service is not marked tax exempt

Otherwise:

- no tax applies

### Partial payment behavior

Current rules:

- the first payment can be any amount above the configured minimum
- equal installments only
- installment frequency can be:
  - `WEEKLY`
  - `BIWEEKLY`
  - `MONTHLY`
- staff cannot override the service base price during the sale
- the remaining full balance can be paid at any time later

## 9. Main Backend Endpoints

These are the current service-related endpoints that matter most to understanding the flow.

### User-facing service catalog

- `GET /api/services/{tenantId}/catalog/{serviceId}`
- `GET /api/services/{tenantId}/catalog-summary`
- `GET /api/services/{tenantId}/catalog/{serviceId}/summary`

### Contact service transactions

- `POST /api/services/{tenantId}/contact-services`
- `GET /api/services/{tenantId}/contact-services`
- `GET /api/services/{tenantId}/contact-services/{contactServiceId}`

### Admin service configuration

- `GET /api/account-settings/{tenantId}/services`
- `GET /api/account-settings/{tenantId}/services/{serviceId}`
- `POST /api/account-settings/{tenantId}/services`
- `PATCH /api/account-settings/{tenantId}/services/{serviceId}`

### Tenant billing settings

- `GET /api/account-settings/{tenantId}/account`
- `PATCH /api/account-settings/{tenantId}/account`

## 10. Mental Model To Keep

The easiest way to understand the services domain is:

- `Service` = reusable definition
- `Follow-Up Template` = reusable post-sale path
- `Checklist Item` = reusable requirement
- `Service Professional` = reusable delivery/ownership option
- `ContactService` = one sold service for one contact
- `ContactServiceFollowUpStep` = operational follow-up work for that sold service
- `ContactServiceChecklistItem` = operational requirement tracking for that sold service

In short:

- configure once at the service level
- sell through the transaction flow
- execute through the contact service enrollment

## 11. Why This Structure Exists

This separation gives the product three important advantages:

### Reusability

Services can be configured once and sold many times.

### Operational consistency

Every sold service starts from the same billing, checklist, and follow-up rules.

### Contact-specific execution

Once sold, each enrollment becomes independent.

That means:

- payments are tracked per contact service
- checklist completion is tracked per contact service
- follow-up execution is tracked per contact service
- service notes and status are tracked per contact service

## 12. Summary

Services are the bridge between configuration and execution.

The service defines:

- what is being sold
- what it costs
- what is required
- what follow-up work should happen
- who can handle it

The transaction flow turns that configured service into a live contact enrollment.

That enrollment is where the real operational work happens.
