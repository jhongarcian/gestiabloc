# AI workspace — chunk 2

Company Info now edits the same profile as **Account Settings → Account**.
Company name, description, website, email, phone, and structured address fields
have one source of truth on Tenant. Both screens use **Save changes** and show
validation and save errors without discarding entered values.

Unsaved company edits survive navigation between AI workspace sections. Refresh
reloads saved values. Successful saves refresh the app’s account context, and the
helper identity preview uses the saved company name. Skills and Analytics remain
sample previews. Company context will be consumed by AI replies in a later chunk.

## Persistence and API

The additive migration 20261025120000_share_ai_company_profile adds nullable
Tenant.description and Tenant.accountRevision (initially zero). Existing contact,
address, billing, and timezone values remain intact.

Both forms use GET/PATCH /api/account-settings/:tenantId/account. Updates require
the current revision and at least one edited field. Omitted fields are preserved;
blank optional strings deliberately clear values. Company Info sends only edited
company fields, preserving timezone and billing defaults.

The endpoint requires an active account administrator and enforces the existing
allowed-origin policy on writes. The URL supplies the tenant identity. Website
input accepts domain names and HTTP/HTTPS URLs, normalizes bare domains to HTTPS,
and rejects other schemes and embedded login details. Description has a limit of
4,000 characters.

Stale revisions return 409 ACCOUNT_INFO_CONFLICT. Both forms keep local edits,
display the newer saved values, and require an explicit choice before retrying.
Keeping edits merges only locally changed fields into the latest profile.
Onboarding profile saves also advance the revision to protect older account forms.

Release backend and frontend together: older account clients that omit revision
receive a validation error. Helper settings, avatars, service profiles, and the AI
runtime retain their existing behavior.

## Verification

- Frontend lint, TypeScript, and production webpack build passed. Lint retains
  six existing warnings in subscription-dashboard and date-input.
- Backend build and default suite passed: 430 tests passed, three opt-in tests
  skipped.
- Focused tests cover partial updates, explicit clearing, validation, billing
  preservation, admin restrictions, foreign accounts, origins, and stale edits.
- The isolated live database test passed for shared saves, concurrent writes,
  new sessions, onboarding conflicts, and preservation of helper settings and
  account defaults. Temporary test accounts were removed.
- Browser checks passed for saves in both directions, refresh persistence,
  navigation and Back retention, two-form conflicts, invalid website feedback,
  keyboard focus, and phone/tablet layouts without overflow. Temporary description
  edits were restored.

Run the opt-in live test from apps/backend against the intended test database:

    ACCOUNT_PROFILE_LIVE_TEST=1 node --env-file=.env --import tsx --test src/lib/tenant-account.integration.test.ts

It creates isolated temporary accounts and removes them afterward. It makes no
email, upload, or AI calls.
