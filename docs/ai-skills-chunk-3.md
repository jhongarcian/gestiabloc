# AI skills and qualification rules — chunk 3

The AI workspace now uses the account’s actual sub-services. Qualification changes are persisted to the existing `Service.fitProfile` and used by the existing deterministic contact fit scan. No migration or AI-provider call is introduced.

## Behavior

- Skills are grouped by their actual parent service. Search matches sub-service names, parent names, and descriptions. Inactive offerings and inactive parents remain visible to administrators with explicit status labels.
- Existing fit-scan filtering continues to exclude inactive offerings and offerings under inactive groups. Qualification can be configured while inactive.
- Overview, base pricing/currency, and non-archived checklist notes come from current service configuration. Inherited pricing/checklists reference the parent service. Links open the owning service configuration.
- Qualification editing supports shared required conditions, requirements containing alternative options, AND conditions inside each option, optional scored conditions with weights, all catalog operators, labels, explanations, and requirement/option descriptions.
- Legacy rules without explicit branches retain their existing logical membership. Renaming requirements cannot accidentally merge alternatives. Unsupported saved profile formats are read-only instead of silently dropping conditions.
- Field choices come from existing core/derived definitions, tenant statuses/tags, and active non-sensitive custom field definitions. The workspace does not search contacts or run live qualification tests.
- Drafts survive navigation inside the workspace. Saved qualification survives refresh and a new authenticated session. Failed saves retain edits. Concurrent changes require an explicit choice between the saved version and local edits before another save.
- FAQ and Knowledge Base editing remain local previews. Legacy FAQ, pricing, and workflow guidance remain readable and are preserved. Links are not fetched and files are not uploaded.
- Ordinary service forms omit `fitProfile`; their AI link now opens the corresponding real skill for offerings and the gallery for groups.

## API

All endpoints require an authenticated, active account administrator. Tenant identity is taken only from the path; another tenant’s skill or a parent group cannot be read as a skill.

- `GET /api/account-settings/:tenantId/ai/skills`: actual offerings and field catalog.
- `GET /api/account-settings/:tenantId/ai/skills/:skillId`: one offering, current qualification and linked notes, field catalog.
- `PATCH /api/account-settings/:tenantId/ai/skills/:skillId/qualification`: strict `{ revision, qualification }` input. Rejects stale revisions with `409 AI_QUALIFICATION_CONFLICT` and unsupported legacy profiles with `409 AI_PROFILE_REVIEW_REQUIRED`.

The revision hashes the complete raw saved profile. Saving locks the parent and offering using the existing service hierarchy lock, rereads the profile, validates with the current field catalog and existing fit engine, then updates only `fitProfile`. Raw knowledge, verification, unknown top-level extension fields, and extension properties on retained conditions are preserved.

## Verification

- Backend build and full test suite: 437 passed, 4 opt-in tests skipped.
- New qualification unit tests: 7 passed as part of the suite.
- Frontend grouping, rename, numeric/date validation tests: 6 passed.
- Opt-in database test: passed with isolated fixtures. Covers real cookie authentication, administrator/active membership restrictions, tenant isolation, inherited notes, field filtering, strict writes, origin checks, new-session persistence, concurrent saves, ordinary service updates, unchanged steps/billing/knowledge/verification, and actual deterministic fit-scan results before/after saving. Fixtures are removed afterward.
- Frontend lint: no errors; 6 existing warnings in subscription and shared date-input components.
- Frontend TypeScript and production webpack build: passed.
- Browser verification uses temporary service fixtures and leaves existing account/service configuration unchanged. Checks include real gallery/search, status labels, direct links, saved qualification after refresh, draft retention with Back, concurrent-edit recovery, inherited source notes/links, local link validation, and responsive layouts.

Run the database verification from `apps/backend`:

```sh
AI_SKILLS_LIVE_TEST=1 node --env-file=.env --import tsx --test src/lib/ai-skills.integration.test.ts
```

Run the frontend helper tests from the repository root (direct invocation avoids Node’s bracketed-path glob interpretation):

```sh
node --import tsx 'apps/react-ui/app/(tenants)/app/[tenantSlug]/account-settings/ai/_lib/qualification.test.ts'
```

The next planned chunk is the workspace test chat. FAQ persistence, document ingestion, analytics, and contact-assistant integration remain later chunks in [the wiring plan](ai-backend-wiring-plan.md).
