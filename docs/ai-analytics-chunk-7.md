# AI analytics — chunk 7

Account Settings → AI → Analytics now reports recorded activity using the existing shadcn chart components (Recharts). The fictional metrics and handoff count are removed. Source filters separate Test helper from Contact assistant; 7-, 30-, and 90-day presets include today and use explicitly labeled UTC calendar days.

## Recording and definitions

- `AiInteraction` stores tenant, actor, channel, conversation/request UUIDs, question outcome, whether qualification ran, and server creation time. It contains no question, answer, history, contact ID, extracted source text, or provider payload.
- A conversation is a distinct actor/channel/conversation combination active in the period. Daily active conversations may sum to more than the period total when a chat spans days.
- Answered and needs-review counts use the completed reply path. Exact/translated FAQs are answered. Adapted workspace replies include an automated outcome; missing labels conservatively require review. Missing knowledge, out-of-scope questions and requests for agency help require review. This is a reporting label, not a quality guarantee or a review queue.
- Contact replies use existing knowledge/verification and deterministic fit explanations. Questions that fall back to fit guidance instead of answering the question require review. Contact questions asking for fit information count as answered even when the deterministic result is needs-info or not-eligible. These labels never alter scores or eligibility.
- Qualification runs count successful explicit contact analysis requests, including deterministic scans for follow-up questions. A scan across multiple services is one run. Workspace Test helper never runs qualification. Passive fit-scan GETs and configuration previews do not create activity.
- Tracking starts at deployment. There is no invented history or backfill. Failed generation and requests stopped before completion do not create an interaction. A completed server interaction can be recorded even if the client loses its response.

## Retry and conversation behavior

The UI keeps conversation/request IDs in memory. A failed logical request reuses its request ID. A successful subsequent request gets a new ID, including repeated identical questions. Clearing Test helper, running a new contact analysis, refreshing, or remounting the workspace starts a new conversation.

The database unique constraint `(tenantId, actorId, channel, requestId)` plus `createMany(skipDuplicates)` deduplicates sequential and concurrent retries across server processes. The first completed outcome wins. This deduplicates analytics, not provider calls; replies are not stored or replayed. Older callers without tracking IDs remain supported and count as separate interactions. Authentication and the server reply path determine tenant, actor, channel, outcome, qualification activity and time; the browser cannot submit metric values.

## API and UI

- `GET /api/account-settings/:tenantId/ai/analytics?days=30&channel=ALL` requires an active account administrator and returns only aggregate totals plus zero-filled daily points. Period and channel are strict enums. The query is parameterized, bounded to 90 days, indexed by tenant/time and tenant/channel/time, and returns `Cache-Control: no-store`.
- `POST /api/services/:tenantId/fit-scan/run` connects the contact panel’s explicit Run analysis action to the established deterministic scan. The original passive GET contract remains available.
- Existing contact assistant and workspace test-message POSTs accept optional tracking UUIDs. Their authorization and qualification behavior remain intact; writes require a trusted origin.
- The screen includes honest empty/loading/error states, source and period filters, manual refresh, and automatic refresh after a completed Test helper reply. An expandable daily table provides the same data without a chart. Chart axes use whole numbers, preserve zero values, and use keyboard-accessible Recharts layers.
- The sidebar and page follow the existing header/button guides. The filters wrap on smaller screens; charts and the table stay within their containers. No date/time inputs are introduced.

## Database and validation

Additive migration: `20261028120000_ai_analytics`. Apply with the normal Prisma deployment workflow; no existing configuration is changed.

Automated coverage includes strict filters, UTC/leap/DST boundaries, zero filling, distinct period totals, frontend retry identity, isolated database fixtures for authenticated real routes, concurrent retry deduplication, source/period isolation, metadata-only storage, and actual qualification runs. Run the opt-in database test with:

```bash
cd apps/backend
AI_ANALYTICS_DB_TEST=1 node --env-file=.env --import tsx --test src/lib/ai-analytics.integration.test.ts
```

The test creates temporary tenants, membership, contact and service fixtures, uses a controlled provider without external AI calls, and removes its fixtures afterward. Full contact-assistant use of saved workspace identity and retrieved knowledge remains chunk 8.

Validation completed:

- Backend suite and focused outcome tests passed; the opt-in database integration test passed with all fixtures removed.
- Frontend retry identity test, both TypeScript checks, and backend/frontend production builds passed. Frontend lint reports no errors and six existing warnings in subscription/date-input components.
- A live helper greeting and missing-knowledge question produced one conversation, one answered question, one question needing review, and zero qualification runs. Analytics refreshed automatically after each reply; Contact assistant remained at zero.
- Verified 7/30/90-day filters, direct navigation and browser Back, empty/loading states, the daily table, and keyboard chart navigation with visible focus and zero-valued tooltips. Browser console reported no warnings or errors.
- Reviewed 390px phone, 768px tablet, and default desktop layouts. Page width matched the viewport on phone and tablet, including with the table expanded. The viewport override was reset afterward.
