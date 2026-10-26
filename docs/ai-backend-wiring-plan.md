# AI Backend Wiring — Eight Implementation Chunks

## Approach

Build one complete feature at a time, starting with the helper’s avatar and settings. Each chunk includes persistence, API integration, loading/error states, and end-to-end verification.

Keep one helper per tenant. Account admins manage its configuration and use the test chat. Connect the existing contact assistant after the workspace test chat works.

## Implementation chunks

### 1. Helper settings and avatar

- Add tenant-scoped persistence for helper name, language, tone, instructions, and avatar selection.
- Add a small bundled preset gallery, keeping the current bot as the default.
- Support uploading, replacing, and removing PNG, JPEG, and WebP images up to 5 MB. Reuse existing avatar storage infrastructure with separate AI-avatar ownership; never modify a user’s profile image.
- Avatar changes save immediately. Text settings use **Save changes**. Update the sidebar and identity preview after successful saves.
- Keep the previous avatar when an upload fails; remove replaced storage objects only after the database change succeeds.
- Replace temporary helper state with server-loaded settings and a saved baseline. Preserve unsaved text when a request fails.

**Complete when:** settings and avatars survive refresh and sign-in, another tenant cannot access them, and failed uploads leave the saved avatar intact.

### 2. Linked Company Info

- Load company name, website, email, phone, and structured address from the existing account profile.
- Allow editing here, updating the same shared fields used by Account Settings.
- Store only the AI-specific company description separately.
- Use a partial, whitelisted update so company edits cannot reset billing, tax, timezone, or unrelated account settings.
- Make the form clear that shared company edits apply throughout the account.

**Complete when:** changes appear in both locations after refresh and unrelated account configuration remains unchanged.

### 3. Real skills and qualification rules

- Replace sample cards and sample IDs with the tenant’s actual sub-services, grouped by parent service.
- Show inactive services with their status in administration; exclude inactive services and inactive parent groups from assistant answers.
- Connect qualification editing to the existing field catalog, validation, and `Service.fitProfile`.
- Preserve existing optional/weighted rules, requirement and option descriptions, operators, and grouping semantics. Extend the prototype editor wherever needed before enabling saves.
- Keep linked Overview, Pricing, and Checklist notes derived from current service configuration.

**Complete when:** existing rules round-trip without losing meaning, edits affect the deterministic fit scan, and unrelated service settings remain intact.

### 4. Workspace test chat

- Add **Test helper**, opening a side panel from the AI workspace without adding another sidebar section.
- Build a read-only reply service using saved helper settings, shared company information, and knowledge across all active skills.
- Reuse the existing server-configured Groq integration. Keep provider credentials and model configuration on the server.
- Retrieve relevant information within a bounded context and return source references.
- English/Spanish mode matches the language of the user’s question.
- Keep messages within the current workspace session. Refreshing or leaving clears them.
- Use saved configuration only. Clearly report an unavailable provider; never substitute a simulated response.
- Do not read contact records, perform actions, or generate qualification decisions in this test chat.

**Complete when:** saved identity, language, tone, instructions, and service information affect actual replies across multiple skills.

### 5. FAQ and Knowledge Base editing

Implemented in [AI content — chunk 5](ai-content-chunk-5.md), including dialog-based FAQ editing and per-answer exact/adapted behavior.

- Persist individual FAQ questions and answers with stable IDs and ordering.
- Connect the single skill description and advanced guidance to saved service knowledge.
- Preserve legacy FAQ and operating notes as imported content requiring review; do not invent questions or automatically split prose.
- Use section-specific updates so knowledge changes cannot overwrite qualification rules.
- Make new and updated content available to the test chat; remove deleted content from retrieval.

**Complete when:** FAQ and description changes survive refresh and change subsequent test answers without losing legacy information.

### 6. Source links and document ingestion

Implemented in [AI sources — chunk 6](ai-sources-chunk-6.md), with private per-tenant Supabase folders, queued extraction, source management, full-text retrieval and citations.

- Persist each link and file as an individual source attached to its tenant and skill.
- Store knowledge documents in existing private storage, separate from public avatar images.
- Support text extraction from PDF, DOCX, and TXT. Identify scanned PDFs requiring OCR instead of marking them ready.
- Process sources through queued jobs with progress, retry, and failure states.
- Fetch only the submitted webpage, without crawling its site. Validate public HTTP/HTTPS destinations, redirects, response size, and timeouts.
- Add tenant-scoped full-text retrieval over extracted content, with citations back to the source.
- Exclude failed, deleted, or unfinished sources from answers. Uploaded content supplies knowledge, not instructions that override helper behavior.

**Complete when:** an uploaded document or link supplies a cited answer, failed processing can be retried, and deleting a source removes it from future answers.

### 7. Real analytics

- Record server-side conversation and interaction metadata without retaining full transcripts.
- Replace sample values with conversations, answered questions, actual qualification runs, and questions needing review.
- Replace the placeholder handoff metric until a real handoff workflow exists.
- Separate test activity from contact-assistant activity. Retain the 7-, 30-, and 90-day filters.
- Deduplicate retries and show truthful zero-data states.

**Complete when:** known test interactions produce the expected totals and chart values without counting retries twice.

### 8. Existing contact assistant integration

- Apply the saved helper identity, company context, FAQs, and retrieved knowledge to the existing contact assistant.
- Reuse the shared reply service with the contact assistant’s existing authorization and data-access restrictions.
- Keep eligibility, scores, and qualification outcomes controlled by the deterministic engine.
- Preserve existing service-start actions and rule-based explanations when generation is unavailable.
- Instrument real qualification runs for analytics without manufacturing handoff events.

**Complete when:** workspace configuration affects contact-assistant replies while established qualification results and permissions remain unchanged.

## APIs, data, and rollout

- Group new administration endpoints under `/api/account-settings/:tenantId/ai`: settings, avatar, company, skills, FAQs, sources, test conversations/messages, and analytics.
- Retain existing `/api/services/:tenantId/fit-scan*` contracts for contact qualification.
- Add tenant-scoped records for assistant configuration, structured FAQs, knowledge sources/extracted content, and conversation/interaction metadata. Keep existing qualification profiles canonical.
- Use additive migrations and preserve existing service knowledge. Do not seed fictional prototype content into live accounts.
- Protect concurrent edits from silently overwriting saved changes.
- Remove preview notices and temporary-save behavior section by section as each section becomes connected; clearly label unfinished sections.

## Verification and defaults

- Every chunk tests authentication, admin permissions, cross-tenant isolation, validation, persistence, and failure recovery.
- Add focused backend tests with the existing Node test runner; stub storage and AI providers for automated tests.
- Verify browser flows, shared company updates, avatar replacement, source lifecycle, and qualification compatibility.
- Run relevant tests, frontend lint, TypeScript checks, and production builds.
- Test conversations retain usage/outcome metadata only; full transcripts are not persisted.
- OCR, public chat widgets, autonomous actions, external API connectors, and billing enforcement remain outside these chunks.
- Preserve the current security/CORS work. If testing on another local frontend port, use the configured additional trusted origins.

