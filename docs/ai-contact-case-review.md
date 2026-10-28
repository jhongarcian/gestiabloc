# Contact AI case review and appointment booking

The contact chat now supports both prospective services and existing purchased cases. Qualification remains controlled by saved rules. Case records control payment and workflow facts; notes and knowledge cannot override those records.

Services with qualification disabled have no eligibility verdict. Their context uses `qualificationConfigured=false` and a null status, rather than a rejection-like sentinel. Selected-service prompts omit other services' verdicts, and general service questions must not receive unsolicited eligibility conclusions. Consultation booking remains available.

## Booking

The existing appointment sheet is opened from **Book appointment** with contact and service locked. It requires an explicit receiving-agent selection instead of defaulting to the salesperson. The service/context is captured when opening; calendar metadata is loaded only on demand. Closing or submitting preserves the chat and question draft.

The shared sheet adds optional `initialServiceId`, `lockService`, and `defaultToCurrentUser` props. Other callers retain their previous defaults. Existing calendar slots, tenant timezone, collision handling, booking limits, audit records and appointment creation are reused. Booking does not require qualification and does not create an enrollment. Appointments retain the existing contact-and-service relationship; they do not identify a particular purchase.

The contact page derives Start service permission from the authenticated membership: tenant admin or security level MEDIUM/MAX. LOW staff can book consultations and read cases. Existing eligibility/enrollment checks still control starting a new service. When qualification results show multiple purchases, Review purchases asks the user which purchase to inspect instead of silently opening the latest one.

## Purchased cases

Purchased services can be selected before or after an initial qualification scan. The selector searches service names/references, paginates purchases, includes inactive-service/completed/canceled records, and identifies each purchase by date, status and a short reference. Two to five explicitly checked purchases can be compared; follow-up questions retain the comparison until the user selects another scope.

The case reader uses a repeatable-read transaction and selects only authorized data for the tenant and contact. It never calls the existing workspace endpoints that can activate follow-ups, backfill checklists or reconcile case status. It does not load attachments, encrypted contact fields or retired executable configuration.

The shared contact header now requests the existing contact-services list with `readOnly=true`. This additive mode bypasses synchronization, checklist backfill and completion reconciliation; other list callers retain their previous default. This prevents the parent contact layout from changing older cases while the AI page loads.

Billing uses `summarizeServiceBilling` and sums only non-voided payments. It retains full totals regardless of displayed history page. Dates with no schedule remain unknown. Date-only installments retain their calendar dates, and timestamps use the tenant timezone. Work completion and payment completion remain separate. Checklist values use captured enrollment labels/required flags where present. Service-step evidence recognizes bypasses, latest occurrences, superseded entries and automation waits; manual follow-ups use the existing next-follow-up resolver without activating steps.

Payment history has 20 records per page. Notes merge service notes and contact/follow-up notes explicitly linked to the selected purchase, 10 per page, with server-side text search. General contact notes and other purchases' notes are excluded. A parameterized union query keeps merged-note pagination bounded. The model gets bounded excerpts with full monetary totals/counts and an explicit limited-context marker. Comparisons share a 40,000-character case-context budget and preserve every selected identity and total.

Saved notes are untrusted statements. The prompt requires review of contradictions with ledger/checklist/workflow facts. Exact generic FAQ answers are disabled for case analysis. Provider failure returns a factual case summary and validated links to overview, payments, progress and notes. The AI has no booking, payment or workflow mutation tools.

## API

- `GET /api/services/:tenantId/fit-scan/cases`: required `contactId`; optional `serviceId`, `q`, `page`, `pageSize` (10 or 25). Returns identities, catalog and pagination.
- `GET /api/services/:tenantId/fit-scan/cases/:contactServiceId`: required `contactId`; optional `paymentsPage`, `notesPage`, `q` (notes search). Returns fresh facts and history pages.
- Existing assistant POST accepts `scope: case`, `contactServiceId`, `compareContactServiceIds` (2–5 distinct IDs) and `caseHistory`. Responses add selected/compared cases, purchase choices, pagination, `CASE` reply source and server-owned record references. Existing all/service requests remain supported.

All reads require active membership and return `Cache-Control: no-store`. Every selected purchase is revalidated against both tenant and contact. No database migration is required.

Case-only chat does not run qualification or increment qualification-run analytics. An explicit qualification question about a selected purchase runs the existing engine, supplies both contexts, and records that actual run. Existing activity tracking retains counts/outcomes only, with retry deduplication and no transcript persistence. Reading/paginating histories does not write analytics.

## Validation

Automated tests cover duplicate-purchase isolation, case/tenant/contact access, inactive and canceled records, complete totals with paginated payment history, voided payments, captured checklist labels, overdue/future installments, separate currencies, note search and pagination, unchanged business records, pending follow-ups remaining pending, explicit qualification requests, and LOW staff booking a service appointment without creating an enrollment.

Run the database coverage alongside the existing assistant/analytics tests:

```sh
cd apps/backend
AI_CONTACT_CASES_DB_TEST=1 AI_CONTACT_ASSISTANT_DB_TEST=1 AI_ANALYTICS_DB_TEST=1 SERVICE_FIT_AI_PROVIDER=none node --env-file=.env --import tsx --test src/**/*.test.ts
```

Final validation on October 27, 2026: 485 backend tests passed, with six optional tests skipped and no failures. Frontend lint had no errors and six existing warnings. Standalone TypeScript checks and both production builds passed.

Browser checks covered desktop, tablet and phone layouts; keyboard access; purchase selection and comparison; payment and note pagination/search; live balance and installment answers; LOW staff permissions; booking for services without qualification rules; explicit agent selection; and chat/draft retention after booking or cancellation. The test appointment retained only the selected contact and service and created no enrollment. The fictional account, agent and associated records were removed after verification, and temporary preview servers were stopped.
