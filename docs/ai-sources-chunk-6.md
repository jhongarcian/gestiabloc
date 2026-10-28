# AI sources — chunk 6

Knowledge Base links and files now persist as individual tenant- and skill-scoped sources. Ready text feeds the workspace Test helper with citations back to the saved source card. Contact-assistant integration remains chunk 8.

## Private Supabase storage

The configured `tenants-data` bucket was verified as private. This feature reuses the existing `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_STORAGE_BUCKET` settings; no new Supabase project or public bucket is required.

Every original knowledge file uses this server-generated object path:

```text
tenants/<tenantId>/ai/skills/<skillId>/sources/<sourceId>/<safeFilename>
```

All AI knowledge files for an account therefore live below its own `tenants/<tenantId>/ai/` folder. Folder names use stable IDs rather than editable account names. Private documents remain separate from public helper/profile avatars and ordinary contact attachments.

The backend checks active account-admin membership before listing, creating, editing, retrying, removing, viewing text, or downloading. It validates stored keys against the tenant/skill/source folder before storage operations. Clients never receive service credentials or choose raw storage paths. Downloads redirect to a signed URL valid for 60 seconds. Storage operations have a shared 30-second deadline and require a private bucket; the privacy check is cached for at most one minute.

## Sources and processing

- Upload one PDF, DOCX, or UTF-8 TXT file at a time, up to 10 MB. File extensions and actual content are checked. Each skill supports up to 100 sources.
- The original is stored before processing is queued. A client request ID deduplicates retries of the same upload. Interrupted uploads can be retried from the current workspace or removed and uploaded again.
- Source states are Uploading, Queued, Reading source, Ready, Could not process, and OCR needed. Upload transfer progress and processing progress have separate labels.
- PDF/DOCX extraction runs in an isolated worker with a 25-second timeout and 256 MB JavaScript heap limit. PDFs support up to 100 pages. Any PDF page without readable text requires review/OCR rather than being silently marked fully ready. OCR itself is outside this chunk.
- DOCX ZIP entries are validated and bounded before extraction, including actual expanded bytes. External file references and embedded code are not executed. Sources support up to 500,000 extracted characters.
- Text is split into passages of up to 1,600 characters with overlapping context and PDF page references. Read-only text previews load 25 passages at a time.
- Failed processing can be retried. Transient failures retry up to three attempts with backoff. OCR-needed files must receive a searchable text layer and be uploaded again.
- Source labels can be edited. Changing a link URL immediately excludes its old passages, then queues the new page. Revision checks prevent stale edits from silently overwriting newer changes.

Previously saved verification URLs are preserved for reference. An administrator explicitly adds a legacy page to sources before it is fetched. Description, operating notes, qualification rules, pricing and service steps remain independently owned and unchanged by source actions.

## Webpage limits

The worker fetches only the submitted public HTTP(S) page. It does not crawl links, load scripts/images, execute JavaScript, send browser cookies, or authenticate to sites. Page text must be UTF-8; compressed responses that ignore the identity-encoding request are rejected. HTML conversion removes script/style/navigation/footer/form content and renders extracted text as plain text.

URLs cannot contain credentials or custom ports. All DNS answers must be public; private, loopback, link-local, reserved, benchmark, mapped-private and non-global IPv6 destinations are rejected. The chosen public IP is pinned to the request while normal TLS hostname verification remains enabled. Each redirect is revalidated. Limits are three redirects, 2 MB of response data, five seconds for DNS, and a 25-second total fetch deadline.

## Retrieval and deletion

The additive migration `20261027120000_ai_knowledge_sources` creates source records, text passages, a GIN full-text index and a durable storage-cleanup queue. It has been applied to the configured development database. Other environments must apply migrations and regenerate the Prisma client before starting this backend.

PostgreSQL full-text search runs inside the current tenant and joins ready sources to active offerings under active parent services. Extracted text is accent-normalized for search; original text remains unchanged for answers and citations. Up to 12 matching passages compete within the existing nine-source/14,000-character reply context limit. Failed, unfinished, removed and inactive-service sources are excluded. Retrieved content supplies facts rather than instructions overriding helper behavior.

Removal deletes passages and excludes the source immediately. Private object deletion runs through a durable outbox with leases and retries. A database trigger also schedules cleanup when other routes delete a service or tenant, so cascading database deletion does not orphan the original files. A grace period covers uploads still finishing. Lease/revision checks prevent a stale extraction worker from restoring deleted or replaced passages.

The API server starts its source worker automatically. Atomic claims, leases and heartbeats permit multiple processes without claiming the same active job. A separate deployment may set `AI_SOURCE_WORKER_ENABLED=false` on API processes and run:

```sh
npm run worker:ai-sources -w backend
```

For development, use `worker:ai-sources:dev`. Backend shutdown releases the HTTP listener before waiting for document jobs, allowing development restarts to bind promptly.

The backend build now copies the generated Prisma client into `dist/generated/prisma`. This fixes the existing missing-client packaging problem and allows both the compiled API and the new standalone worker to start from the production output.

## API

All endpoints are below `/api/account-settings/:tenantId/ai/skills/:skillId/sources`:

- `GET /` lists source metadata and status, without storage keys or extracted text.
- `POST /links` accepts a request ID, label and public URL.
- `POST /files` accepts one multipart file and request ID.
- `PATCH /:sourceId` updates the label or link URL with a revision.
- `POST /:sourceId/retry` retries failed processing with a revision.
- `DELETE /:sourceId` removes a source with a revision.
- `GET /:sourceId/download` prepares a short-lived private download.
- `GET /:sourceId/text?after=<ordinal>` reads ready passages.

Mutations require an allowed browser origin. An administrator/account is limited to 30 source mutations per minute and one concurrent upload per server process. Request bodies are strict. No contact records are read, no qualification decisions are generated, and test transcripts are not persisted.

## Validation

- Backend suite: 457 passed, six opt-in tests skipped. Focused frontend draft tests: three passed.
- Isolated live checks passed with real Supabase objects and the configured Groq provider: private upload/download, anonymous-read rejection, tenant/admin/origin restrictions, stable retry IDs, source revisions, extraction, full-text retrieval, English/Spanish cited answers, URL changes, failure/retry, OCR state, immediate deletion exclusion, late-worker cancellation, service cascades and durable cleanup retry.
- PDF/DOCX/TXT parser tests and mocked HTTP tests cover invalid bytes, archive bounds, path isolation, IP/DNS validation, private redirects, response limits, and avoiding asset fetching.
- Browser checks covered link create/edit/refresh, URL feedback, ready and OCR-needed file cards, read-only extracted text, removal confirmation, real document-cited replies, citation navigation, keyboard dismissal/focus, and phone/tablet/desktop layouts.
- Chrome's extension blocked automated file selection because its “Allow access to file URLs” permission is off. That permission was left unchanged. File transport/storage/extraction were verified through the live API tests; browser file-card checks used synthetic API-created fixtures.
- Frontend lint has no errors; six existing subscription/date-input warnings remain. TypeScript and production builds pass.

All isolated accounts, temporary services, and synthetic storage objects are cleaned up after testing. Existing account service data, helper settings and company information are preserved. The local verification preview uses port 3001 with an isolated backend on port 4001; the existing port-4000 server is left untouched.

Storage behavior follows the [Supabase private-bucket access model](https://supabase.com/docs/guides/storage/buckets/fundamentals). Extraction uses [pdf-parse](https://github.com/mehmet-kozan/pdf-parse) and [Mammoth](https://github.com/mwilliamson/mammoth.js).
