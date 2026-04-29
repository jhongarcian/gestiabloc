# Account Settings Feature Spec

## 1. Scope

This spec documents the account settings experience for:

- `/app/{slug}/account-settings/account`

This page is the tenant-level account form.

It currently manages tenant profile and location fields.

This spec updates that scope so the same page also manages tenant billing tax behavior.

This spec is intentionally limited to:

- tenant account/profile settings
- tenant tax configuration
- how tenant tax settings affect service billing

This spec does not define:

- service-level billing rules in detail
- installment generation logic in detail
- subscription billing

Those are covered by service-related specs and downstream billing implementation.

## 2. Product Role Of This Page

The account page is the source of truth for tenant-wide account settings.

It should define:

- tenant identity and contact details
- tenant location details
- tenant timezone
- tenant website
- tenant tax behavior for service billing

The account page should remain a form-driven admin screen.

## 3. Current Implementation Baseline

Current route:

- `/app/{slug}/account-settings/account`

Current frontend form:

- [`tenant-info-form.tsx`](/Users/jhongarcian/coding/gestiabloc/apps/react-ui/app/(tenants)/app/[tenantSlug]/account-settings/_components/tenant-info-form.tsx)

Current backend endpoints:

- `GET /api/account-settings/{tenantId}/account`
- `PATCH /api/account-settings/{tenantId}/account`

Current tenant fields already handled by the form:

- `name`
- `email`
- `phone`
- `addressLine1`
- `addressLine2`
- `city`
- `state`
- `postalCode`
- `country`
- `timezone`
- `website`

Current note:

- the `Tenant` model does not yet include tax settings
- this spec describes the target state that should be added

## 4. Page Goal

The account page should remain simple, but it must now support tenant-wide tax settings in a way that is understandable to admins and reusable by service billing.

The page should answer:

- who is this tenant?
- where is the tenant located?
- what timezone should tenant workflows use?
- does this tenant charge taxes?
- if taxes apply, what percentage should be used?

## 5. Page Structure

The account page should remain a form, but it should be organized into clear sections.

Recommended sections:

- `Tenant Information`
- `Location & Timezone`
- `Billing & Taxes`

The tax configuration should not feel like a separate app.

It should be presented as one additional form section inside the account settings page.

## 6. Tenant Information Section

This section continues to manage the current tenant identity fields.

Fields:

- `Tenant Name`
- `Email`
- `Phone`
- `Website`

Behavior:

- values should be editable in the same form
- validation should remain lightweight and field-specific
- this section should not be blocked by tax configuration fields

## 7. Location & Timezone Section

This section continues to manage the current address and timezone fields.

Fields:

- `Address Line 1`
- `Address Line 2`
- `City`
- `State/Province`
- `Postal Code`
- `Country`
- `Timezone`

Behavior:

- timezone preview should remain supported
- location fields remain optional unless business rules later require them

## 8. Billing & Taxes Section

This is the new section to add to the account page.

Its purpose is to define tenant-wide tax behavior for service billing.

This section should be clear enough that a non-technical admin understands whether the tenant charges tax.

### Required fields

- `Taxes Enabled`
- `Tax Rate`
- `Tax Label`

### Recommended UI

- a section card or bordered block inside the form
- short explanatory copy
- a toggle for taxes on/off
- tax inputs that enable only when taxes are on

## 9. Tax Configuration Model

The tax model for the tenant should be intentionally simple.

### Supported behavior

- a tenant can be a no-tax account
- a tenant can charge one default tax percentage
- services can later opt out individually through `Tax Exempt`

### Tenant-level fields

Recommended target fields on `Tenant`:

- `taxEnabled: boolean`
- `defaultTaxRateBps` or `defaultTaxRatePercent`
- `taxLabel: string | null`

Preferred implementation direction:

- store percentage in a backend-safe numeric format
- basis points are preferred for precision

Example:

- `8.25%` can be stored as `825` bps

## 10. No-Tax Account Behavior

The account page must support a no-tax state cleanly.

No-tax account rules:

- if `Taxes Enabled` is off, the tenant should be treated as not charging tax
- tax rate should be ignored when taxes are off
- tax label should be optional and ignored when taxes are off
- services should resolve to no tax even if they are not marked tax exempt

The UI should make this obvious.

Suggested copy:

- `This account does not charge tax`

## 11. Tax Enabled Behavior

When taxes are enabled:

- the admin can set one default tax percentage
- the admin can optionally set a tax label
- service billing should use this tenant default unless the service is tax exempt

Suggested tax label examples:

- `Sales Tax`
- `VAT`
- `GST`

The system should not require a label if a default label is acceptable.

## 12. Field Definitions

### Taxes Enabled

Type:

- boolean toggle

Behavior:

- drives whether tax is applied at tenant level
- when off, tax rate inputs are disabled or hidden

### Tax Rate

Type:

- percentage input

Behavior:

- required only when taxes are enabled
- should support decimal percentages such as `8.25`

Validation:

- must be a valid number
- must be greater than or equal to `0`
- should have a reasonable upper bound

Recommended upper bound:

- `100`

### Tax Label

Type:

- optional short text input

Behavior:

- visible when taxes are enabled
- allows tenant-specific terminology

Validation:

- optional
- should be short, for example max `60` characters

## 13. Validation Rules

### General

- tenant name remains required
- email must be valid if provided
- website should continue to normalize if entered without protocol

### Billing & Taxes

- if taxes are disabled:
  - tax rate is optional and ignored
  - tax label is optional and ignored
- if taxes are enabled:
  - tax rate is required
  - tax rate must be numeric
  - tax rate must be within the allowed range

Recommended validation messages:

- `Tax rate is required when taxes are enabled`
- `Tax rate must be a valid percentage`
- `Tax rate cannot be negative`

## 14. Backend API Target State

The existing account endpoints should be extended, not replaced.

### Read endpoint

- `GET /api/account-settings/{tenantId}/account`

Target response should include current tenant fields plus:

- `taxEnabled`
- `defaultTaxRate`
- `taxLabel`

### Write endpoint

- `PATCH /api/account-settings/{tenantId}/account`

Target payload should accept current tenant fields plus:

- `taxEnabled`
- `defaultTaxRate`
- `taxLabel`

## 15. Tenant Model Target State

The `Tenant` model should be extended with billing tax settings.

Recommended additions:

- `taxEnabled Boolean @default(false)`
- `defaultTaxRateBps Int?`
- `taxLabel String?`

Notes:

- nullable rate is useful when taxes are disabled
- `taxLabel` should be optional

## 16. Relationship To Service Billing

This page is the tenant-wide source of truth for tax defaults.

It directly feeds the service billing behavior described in:

- [`service-configuration.md`](/Users/jhongarcian/coding/gestiabloc/specs/features/services/service-configuration.md)

Resolution rules:

- tenant taxes disabled => no tax
- tenant taxes enabled + service tax exempt => no tax
- tenant taxes enabled + service taxable => use tenant default tax rate

## 17. Relationship To Transaction Flow

These account settings indirectly affect the create transaction flow documented in:

- [`service-managment.md`](/Users/jhongarcian/coding/gestiabloc/specs/features/services/service-managment.md)

The transaction payment step should eventually use:

- tenant tax settings from this page
- service tax exemption from service configuration

The resulting tax must be shown clearly in the transaction billing summary.

## 18. UX Rules

- the page should still feel like one cohesive account form
- the new tax section should not make the page feel like a finance back office
- tax behavior should be easy to understand from the labels alone
- the save button should persist both account and tax settings together
- the user should not have to visit another page to manage basic tenant tax defaults

## 19. Error Handling

If saving fails:

- show a clear error message
- preserve unsaved field values in the form
- avoid resetting the page

Tax-related backend errors should be human-readable where possible.

## 20. Non-Goals

This spec does not require:

- multiple tax rates per tenant
- regional tax tables
- tax-inclusive pricing rules
- invoice generation
- subscription billing configuration
- service-level tax override beyond a simple `Tax Exempt` flag

## 21. Implementation Guidance

When implementation starts, the work should likely be split into:

1. extend the `Tenant` model with tax fields
2. extend `GET/PATCH /api/account-settings/{tenantId}/account`
3. update the account form UI with a `Billing & Taxes` section
4. add frontend validation and save behavior for tax fields
5. wire tenant tax settings into downstream service billing logic
