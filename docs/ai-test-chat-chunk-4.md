# Workspace test chat — chunk 4

The **Test helper** action opens a right-side conversation panel from every AI workspace screen. The existing four sidebar sections remain unchanged.

## Saved configuration and scope

- Every question loads current saved helper name, language, tone, instructions, shared company information, and knowledge from active sub-services under active parent groups.
- Responses use service descriptions, saved knowledge overview, inherited base pricing/checklists, and legacy workflow/FAQ guidance. Qualification rules, fit results, contacts, and sensitive custom fields are not supplied to the model.
- English and Spanish mode follows the latest question’s language. Fixed English or Spanish settings take precedence when selected.
- Unsaved helper/company/qualification changes and FAQ/Knowledge Base preview edits are excluded. Source links are not fetched and selected files are not uploaded or read.
- The provider has no tools or actions. It is instructed to explain saved information, acknowledge missing information, and decline personal qualification decisions, fit scores, enrollments, and record changes.
- Source content and history are quoted reference data. They cannot override the system’s restrictions or the saved writing preferences. Current sources take precedence over earlier answers.

## Context, references, and session behavior

- Relevant source sections are ranked across the active catalog using the current question, bilingual topic terms, and recent user questions for follow-ups. At most nine sources and 14000 serialized source characters are supplied.
- Provider output is validated as JSON. Only IDs in the current tenant’s retrieved sources can become references. Invalid references, missing/invalid output, and truncated responses fail explicitly.
- Replies show saved source excerpts with links to Company Info or the skill’s Knowledge Base. An unavailable source is not replaced with fictional information.
- Completed messages live only in the mounted workspace session. Closing/reopening the panel and navigating within AI retains them; leaving AI or refreshing clears them. Clear chat also resets the local conversation.
- The browser retains up to 20 completed turns and sends at most six recent completed question/answer pairs, with a 12000-character history limit. No full transcript is stored server-side or in browser storage. Analytics/usage event persistence belongs to chunk 7.
- An active request prevents duplicate submissions. Stop reply cancels the request and retains the question. Failed requests retain the question and show a retry action. Leaving the workspace aborts pending requests.

## API and provider

- `GET /api/account-settings/:tenantId/ai/test-chat` reports whether the server is configured for real replies. It does not make a provider call or expose provider configuration.
- `POST /api/account-settings/:tenantId/ai/test-chat/messages` accepts only `{ question, history? }`. Client-supplied helper settings, source data, tenant overrides, system messages, and malformed/oversized histories are rejected.
- Both endpoints require a cookie-authenticated active tenant administrator, with tenant identity resolved from the path. POST also enforces existing allowed-origin checks. Responses use `Cache-Control: no-store`.
- A per-instance guard permits one in-flight request and ten requests per minute per administrator/account. Its bounded memory contains counters/timestamps only.
- Real provider requests have a 30-second timeout and propagate disconnect/Stop cancellation. Unavailable providers return 503; provider/local throttling returns 429; invalid replies/citations return 502. No simulated reply is substituted.
- Shared server-only Groq configuration is reused by the existing qualification explanation provider and the new chat provider. Credentials and model selection remain on the backend.

The previously configured local `qwen/qwen3-32b` returned `404 model_not_found`. The configured Groq account listed `qwen/qwen3.8-27b`; its real replies were verified, and the local `GROQ_MODEL` plus the shared default were updated to that successor. Existing credentials were preserved. Deployments with an explicit model override must use a model available to their Groq account. [Groq model documentation](https://console.groq.com/docs/model/qwen/qwen3.8-27b) and [JSON output guidance](https://console.groq.com/docs/structured-outputs) describe the provider settings used here.

No database schema or migration changes are required for this chunk.

## Validation

- Backend build and full suite: 445 passed; 5 opt-in tests skipped.
- New unit/route tests cover strict input and history limits, bounded serialized context, relevant multi-skill/bilingual retrieval, saved preferences, tenant/admin/origin restrictions, source ID validation, provider absence/errors/invalid output, duplicate requests, and throttling.
- Frontend history tests: 2 passed. TypeScript, lint, and the production webpack build pass. Lint retains six existing warnings in subscription/shared date input files.
- The opt-in integration test passed against real database fixtures and the configured real Groq provider. It verifies saved name/instructions, company context, multi-skill price references, inactive-service exclusion, language/tone changes, qualification/action boundaries, cross-tenant isolation, and unchanged business records after replies. Its isolated test records are removed afterward.
- Browser verification covers a real helper reply, a two-skill price comparison with source links, retry after an unavailable provider with the question retained, saved identity despite an unsaved name, source navigation and conversation retention, clearing on workspace exit, and phone/tablet/short-height layouts with a visible composer and no horizontal overflow.

Run the real integration test from `apps/backend`:

```sh
AI_TEST_CHAT_LIVE_TEST=1 node --env-file=.env --import tsx --test src/lib/ai-test-chat.integration.test.ts
```

Run frontend history tests from the repository root:

```sh
node --import tsx 'apps/react-ui/app/(tenants)/app/[tenantSlug]/account-settings/ai/_lib/test-chat.test.ts'
```

The next planned chunk connects FAQ and Knowledge Base saving. Source ingestion, analytics, and integration with the existing contact assistant remain later steps in [the wiring plan](ai-backend-wiring-plan.md).
