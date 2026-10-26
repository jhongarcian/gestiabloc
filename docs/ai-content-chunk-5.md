# AI content — chunk 5

FAQ and Knowledge Base editing now save to the account's real sub-services. Source links and file selections remain local previews for chunk 6; saving knowledge does not upload files or fetch or persist those preview sources.

## FAQ editing

Add and Edit open the same bounded dialog, with a scrollable middle and persistent footer. Each question has a stable server-generated ID, saved order, a question (500 characters), an answer (4,000 characters), and **Use answer as written**, unchecked by default.

- Checked: a close semantic match returns the saved answer directly, preserving its text. When the helper's response language differs, a dedicated translation step preserves the answer's information without applying tone, general instructions, or signatures.
- Unchecked: the normal reply path adapts the saved information to the caller's question and conversation.
- Matching uses current active skills and their names, respects additional questions and negation, and declines ambiguous matches. The current helper language choices remain English, Spanish, and English/Spanish.
- Test chat shows an answer-mode badge and a citation linking to the specific FAQ. Updated and removed records affect subsequent replies; old conversation text is not factual evidence.

Collection revisions prevent concurrent creates, edits, removals and reorders from silently overwriting one another. Failed saves retain dialog content. Conflicts show the current saved question and allow explicit recovery. Removal requires a confirmation dialog.

Legacy free-form FAQ notes are preserved unchanged and shown as imported content requiring review. They are not automatically split or converted into invented questions.

## Knowledge editing

The description, pricing guidance, operating guidance, adapter preference, and verification preferences save through a section-specific endpoint. Its revision covers the raw knowledge and verification sections. Writes merge only those owned fields, preserving qualification rules, legacy FAQ notes, existing source URLs, unknown extensions, service pricing and steps. Unrepresentable legacy formats remain read-only.

Unsaved knowledge and qualification drafts survive workspace navigation independently. Saving either section preserves the other section's edits; subsequent stale saves still produce a conflict. Preview links and files are excluded from the saved payload and dirty-state calculation.

## API and migration

Active tenant administrators only, with same-origin enforcement for mutations:

- `GET/POST /api/account-settings/:tenantId/ai/skills/:skillId/faqs`
- `PATCH/DELETE /api/account-settings/:tenantId/ai/skills/:skillId/faqs/:faqId`
- `PUT /api/account-settings/:tenantId/ai/skills/:skillId/faqs/order`
- `PATCH /api/account-settings/:tenantId/ai/skills/:skillId/knowledge`

Requests are strict and reject cross-section fields. FAQ mutations include the collection revision; knowledge writes include the knowledge revision. IDs are tenant and skill scoped. Service hierarchy locks serialize writes with existing service/qualification updates.

The additive migration `20261026120000_service_ai_faqs` creates `ServiceAiFaq` with tenant/service foreign keys and an ordering index. It has been applied to the configured development database. Other environments must run `prisma migrate deploy` and regenerate the Prisma client before starting the new backend. No existing profile data is migrated or fictional content seeded.

## Verification

- Backend suite: 452 passed, 5 opt-in tests skipped; focused frontend state/validation tests: 3 passed.
- Opt-in database route checks passed for tenant/admin/origin restrictions, strict validation, create/edit/order/delete, concurrent writes, preserved legacy profiles, qualification compatibility, service steps and ordinary service saves.
- Real Groq checks passed for exact English paraphrases, Spanish translation preserving facts and codes, unchecked adaptation using saved preferences, and deleted FAQ exclusion.
- Browser checks covered FAQ modal creation/editing, required-field feedback, conflict recovery, reordering, refresh persistence, FAQ citations, knowledge draft navigation and save/refresh, and a real reply using the newly saved description.
- Phone (390×844), short phone (390×600), tablet (820×1180), and desktop layouts reviewed. Dialog focus, Escape, labels, scrolling and persistent actions checked.
- Frontend lint has no errors; six existing warnings remain in subscription/date-input components. TypeScript and production builds pass.

Temporary UI services and isolated integration fixtures are removed after verification. Actual account service content, helper preferences and company data are unchanged by the tests.
