# Shared helper in the contact assistant — chunk 8

The contact assistant now uses the saved account helper for company and service knowledge questions. Helper name/avatar, response preferences, company information, structured FAQs, guidance, and ready source excerpts come from the same saved configuration as Account Settings → AI.

## Reply and qualification boundaries

- `ai-helper-replies.ts` is the shared grounded reply engine. Existing workspace imports remain compatible through `ai-test-chat.ts`.
- A selected service limits both structured knowledge/FAQ queries and document retrieval to that service. Every query remains tenant-scoped and excludes inactive offerings, inactive parents, deleted sources and sources that are not ready. All-service questions can use all active skills, including skills with qualification turned off.
- Contact questions use the submitted question and current saved company/service knowledge. For the current contact only, generation also receives a fresh server-built projection of authorized non-encrypted facts, exact expected values, and every alternative qualification path. Sensitive/encrypted custom fields and raw engine reason strings are excluded. Up to six completed conversation pairs (12,000 characters total) support follow-ups; messages remain in page memory and clear on rerun, contact change, departure or refresh. Current server facts override quoted history.
- Exact FAQ answers retain their saved text, including paragraphs. Translation uses the existing translation-only path; helper writing preferences cannot add a signature or rewrite an exact answer. Adapted replies use saved language, tone, and instructions.
- Typed questions, including qualification questions, use the shared grounded reply engine. It explains actual recorded values and exact thresholds, including all alternative paths. Eligibility, scores and service actions remain owned by the deterministic engine. Knowledge exceptions absent from the saved checks must be cited and flagged for review, never used to change qualification. Missing values remain unknown. The assistant must not invent disability, terminal-illness or other medical exceptions. Personal qualification questions bypass generic exact FAQ matching.
- The first scan and explicit service selection use deterministic explanations without a generation request. The existing passive fit-scan GET and qualification-preview contracts remain available with their existing behavior.

## Availability and permissions

If generation is absent, busy, timed out, invalid, or unable to load sources, the response still includes deterministic qualification guidance and current scan results. The UI labels this as qualification guidance and explains that a conversational reply is temporarily unavailable. Existing Open service, View service, and Start service links continue to derive from the current deterministic results.

Conversation generation has one concurrent request and ten attempts per minute per account/user/server process. The bounded guard is shared with the workspace implementation; rule guidance stays available when the generation limit is reached. Requests are canceled when the user leaves the contact page.

Active tenant staff retain access to the contact assistant. The new public helper identity returns only name and avatar; instructions and configuration administration remain restricted to account admins. Existing membership, origin, contact scope, and service scope checks remain in place. No database schema or migration is added in this chunk.

## API and UI

- `GET /api/services/:tenantId/fit-scan/helper` supplies the saved name/avatar without running qualification or calling generation.
- `POST /api/services/:tenantId/fit-scan/run` retains the scan response and adds the public helper identity.
- `POST /api/services/:tenantId/fit-scan/assistant` retains scope and answer fields and adds public helper identity, current scan items, and `answer.replySource` (`CONTACT`, `KNOWLEDGE`, `RULES`, `FALLBACK`). Knowledge replies also return the answer mode and bounded source references/excerpts.
- The panel displays the named helper and avatar, read-only source details, As written/Translated answer labels, and clear fallback feedback. Chat opens immediately after the first scan. Preset question chips are removed. Typing a service name selects its current rules and knowledge, including active knowledge-only services; ambiguous mentions remain in all-service scope. Follow-up questions retain that scope. Knowledge remains available when no services have qualification rules.
- The panel follows the header/button guides, uses existing shadcn components, labels the question input and send action, limits questions to 500 characters, preserves drafts after request failures, and provides visible keyboard focus. No date/time inputs are added.

## Analytics and validation

Completed contact replies keep the chunk 7 metadata-only analytics and retry deduplication. Every completed explicit scan still records one qualification run. A delivered rule fallback for a knowledge question is a completed reply marked `NEEDS_REVIEW`; a failed or canceled request does not manufacture an answered question or handoff.

Automated tests cover saved settings/company changes, exact and translated FAQs, scoped document citations, removed/inactive/foreign sources, model input boundaries, staff/admin permissions, bounded generation, fallback behavior, unchanged scores, and analytics isolation. The database test uses temporary tenants and a controlled provider; it reuses the real authenticated deterministic scan and removes its fixtures afterward:

```bash
cd apps/backend
AI_CONTACT_ASSISTANT_DB_TEST=1 node --env-file=.env --import tsx --test src/lib/ai-contact-assistant.integration.test.ts
```

Live external browsing, contact actions performed by AI, transcript persistence, and a handoff workflow remain outside this integration. Ready saved knowledge sources supply factual answers.

Original chunk 8 validation (before the contact-aware conversation update):

- Backend suite: 471 passed, 6 other opt-in tests skipped, no failures. The contact-assistant and analytics database integration tests ran successfully and removed their fixtures.
- Both standalone TypeScript checks and both production builds passed. Frontend lint has no errors and six existing subscription/date-input warnings.
- In a temporary browser-test account, the real configured provider answered using saved company information and returned an exact FAQ unchanged with its source. Qualification stayed eligible with score 100, and the existing Start service link remained available.
- Reviewed desktop, 768px tablet and 390px phone layouts. Fixed Radix scroll-content sizing so chat text wraps rather than clipping. Page and chat widths matched their viewports; source details support keyboard activation with visible focus, and the page has one main heading.
- Browser console reported no warnings or errors. The viewport override was reset. The temporary browser-test account, membership, contact, services and activity were removed afterward; existing accounts were preserved.


## Contact-aware conversation follow-up

The current-contact context is loaded together with the deterministic scan, so explanations and displayed results use the same fresh record. Each mandatory check is represented, every alternative is preserved as a complete tree, and optional scored checks remain separate from eligibility. Strict comparisons retain their meaning: more than 65 differs from at least 65. Fallback explanations use actual safe values too, without preset questions.

Context budgets keep whole service trees rather than truncating a qualification path. The assistant receives a limited-context marker when information is omitted. All typed messages share the existing generation rate guard. No new migration, contact search, record mutation or transcript table is introduced.

Additional tests cover the age/disability and coverage alternatives, unknown versus false, strict age boundaries, protected data exclusion, natural service switching, knowledge-only services, completed follow-up history, input bounds, immutable qualification outcomes and natural fallback text.

Follow-up validation:

- Full backend suite: 478 passed, 6 optional tests skipped, no failures, including the contact-assistant and analytics database tests. The final personal-name FAQ guard also passed the 13 focused assistant/context tests.
- Backend and frontend production builds and standalone TypeScript checks passed. Frontend lint has no errors and the same six existing subscription/date-input warnings.
- Real provider replies in an isolated fictional account explained age 56 versus the saved minimum of 64 and the alternative waiver, switched to another service named in a typed follow-up, and confirmed a knowledge exception requires manual review without overriding the current result. A provider rate limit returned usable rule guidance; a later retry succeeded.
- Phone (390px), tablet (768px) and desktop (1440px) layouts had no page overflow. Source details opened by keyboard, there was one main heading, and the browser console had no warnings or errors. Refresh and leaving/returning cleared conversation state. The All services control changed scope without injecting a message.
- Browser viewport settings were restored, the test tab and preview servers were closed, and the temporary account and all its records were removed.
