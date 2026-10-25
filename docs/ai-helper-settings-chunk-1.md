# AI workspace — chunk 1

Implemented: one saved AI helper per account, with a name, response language,
tone, general instructions, and avatar. The default is **AI Helper**, English,
Professional, no instructions, and the bot avatar. Language and tone are saved
preferences; connecting them to AI replies belongs to a later chunk.

Settings use **Save changes**. Built-in avatar choices and image uploads save
immediately, independently of unsaved text. Skills, Company Info, and Analytics
retain their sample data and temporary drafts.

## Backend contract

All routes below require an active tenant administrator. Mutations enforce the
existing allowed-origin policy. The account is resolved from the URL, never from
an uploaded field or request-body override.

| Route under `/api/account-settings/:tenantId/ai` | Purpose                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `GET /settings`                                  | Read saved settings; return clean defaults for a new account     |
| `PATCH /settings`                                | Save name, language, tone, instructions, and text revision       |
| `PATCH /avatar`                                  | Choose bot, sparkles, compass, or lightbulb with avatar revision |
| `POST /avatar`                                   | Upload one image with avatar revision                            |
| `DELETE /avatar`                                 | Remove the image and restore the bot with avatar revision        |

Text and avatar use separate revision counters. A stale write returns `409`.
The UI keeps text edits and requires an explicit choice between the latest saved
settings and the local edits. An avatar conflict displays the saved avatar and
asks the administrator to choose again.

The additive migration `20261024120000_add_tenant_ai_settings` creates
`TenantAiSettings` and adds `AI_AVATAR` file ownership. A composite foreign key
prevents linking another account's file. Uploads use the existing public Vercel
Blob configuration (`BLOB_READ_WRITE_TOKEN`), with unique account-specific paths.
PNG, JPEG, and WebP are accepted up to 5 MiB; the backend checks their signatures.
SVG is excluded. Failed uploads retain the saved image. Replaced AI images are
deleted after saving the new avatar. If cleanup fails, the file ledger remains
and the failure is logged for later cleanup; this chunk adds no cleanup worker.
Personal profile avatars are never removed by these operations.

Request and response schemas are documented in the backend OpenAPI specification.
No service fit profiles or existing AI runtime behavior are changed.

## Verification

- Frontend lint, TypeScript, and production webpack build passed. Lint retains
  six existing warnings in subscription-dashboard and date-input.
- Backend build and the complete default test suite passed with a test database
  placeholder for tests that load Prisma without connecting.
- Focused tests cover validation, administrator access, cross-account access,
  origins, independent revisions, failed uploads, cleanup, and profile isolation.
- The opt-in live test passed against real authenticated routes, PostgreSQL,
  and blob storage. It checks upload, replacement, removal, competing saves,
  foreign-account file rejection, and persistence across new sessions. It
  creates and removes isolated test accounts and images.
- Browser checks passed for refresh persistence, draft retention through
  navigation and Back, language and tone saves, required-name feedback,
  conflict resolution across two tabs, and phone/tablet layouts without overflow.
- Browser file selection was blocked by the Chrome extension's local-file
  permission. Real file transfer was verified by the live backend test instead.

Run the isolated live test explicitly from `apps/backend` when database and blob
credentials for the intended test environment are configured:

```sh
AI_SETTINGS_LIVE_TEST=1 node --env-file=.env --import tsx --test src/lib/ai-helper-settings.integration.test.ts
```

The live test is skipped during ordinary test runs.
