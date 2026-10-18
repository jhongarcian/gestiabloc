# Bulk contact CSV imports

Tenant administrators can open the import workspace from the icon beside the automation action in the contact-list subheader. The flow uploads a UTF-8 CSV directly to private Supabase Storage, previews the first 50 rows, matches source columns to contact and active custom fields, then queues the file. The API does not receive the CSV body.

## Deployment

1. Apply `prisma/migrations/20261005090000_contact_imports/migration.sql` and regenerate Prisma Client as part of the normal backend deployment.
2. Build the backend, run the API normally, and run **one or more separate worker processes** with `npm run worker:contact-imports` from `apps/backend`. For local development, run `npm run dev:contact-import-worker` from the repository root. The worker uses PostgreSQL leases and `SKIP LOCKED` claims; each process handles up to two jobs concurrently. Set `CONTACT_IMPORT_WORKER=true` only on worker processes (the script sets it automatically) so their default database pool is limited to five connections. Set `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_STORAGE_BUCKET` on both API and worker. Also set `CONTACT_CUSTOM_FIELD_ENCRYPTION_KEY` on the worker if encrypted custom fields can be imported. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` on the UI.
3. Use a **private** storage bucket configured to accept `text/csv` files of at least 500 MB, with enough storage capacity for source and issue-report retention. The browser uses standard signed uploads for files up to 6 MB and signed, 6 MB resumable chunks for larger files. If Storage rejects a signed resumable upload with `Invalid Compact JWS`, the browser retries through the standard signed upload endpoint; that fallback is not resumable. For Supabase-hosted projects, confirm the project's plan and bucket file-size limits support this size.
4. Set `CONTACT_IMPORTS_ENABLED=false` on the API to pause new draft creation, previews, and queueing; existing queued jobs can still run. Stop the worker separately to pause processing. The import shortcut may remain visible while disabled and the API will return 503.

## Limits and behavior

- UTF-8 CSV, up to 500 MB, 500,000 nonblank contact rows, 200 columns, and 64 KB per cell. The full file is validated before any contact is created. First and last name columns must be mapped and populated per row.
- Dates default to the contact form's `MM/DD/YYYY` format. The importer also accepts unambiguous `YYYY-MM-DD` dates with that setting; select `DD/MM/YYYY` when a CSV uses day-first slash dates. Date-only values are stored at noon UTC like dates entered on the contact form. Choose a phone country for numbers without an international prefix; possible numbers are normalized to E.164 and displayed using the contact list's phone formatting. Rows with impossible numbers are reported as invalid.
- Import processes bounded batches of up to 250 rows or 1 MB of CSV cell content. Wide custom-field mappings lower the batch row count. Each batch commits contacts, custom values, errors, counters, and checkpoint together, so a restarted worker resumes after the last committed row without replaying it.
- Existing contacts are skipped when the same tenant already has a matching normalized primary email or primary phone. Duplicates inside the file are skipped too. Duplicate and invalid rows appear in a private issue CSV. Other valid rows continue. Imports do not update existing contacts or trigger automations.
- Issue rows in PostgreSQL contain only a row number, code, and explanation. The private downloadable report includes the original CSV values for correction, so it should be handled as sensitive contact data, including when encrypted custom fields were mapped.
- One queued or processing import is allowed per tenant. Cancellation stops after the current batch, keeps contacts already created, and does not roll them back. It may take a batch to complete.
- Drafts expire after one day. Uploaded source files are removed seven days after a terminal state; issue reports and stored row details are removed after 30 days. The worker performs this cleanup hourly. The job history and aggregate counts remain.
- A job retries transient worker failures up to three times with a short backoff. Structural CSV errors fail permanently. The browser can be closed once queueing succeeds; status is available in import history.

The import-specific tests run without a database:

```bash
node --import tsx --test apps/backend/src/lib/contact-import-csv.test.ts apps/backend/src/lib/contact-import-fields.test.ts
```

For a production rollout, first use a small tenant CSV to verify the bucket limit, CORS configuration, signed upload, worker connectivity, result counters, and report download. Then test a large file against a staging database with production-like indexes and worker resources.
