# AI credit enforcement and encrypted replay — chunk 4

Both workspace test chat and typed contact-assistant questions now use the credit wallet when enforcement is enabled. All rollout flags remain off by default. No model switch, application-database migration, credit grant, subscription charge or credit purchase was activated in this chunk.

## Request lifecycle

1. Authenticate and authorize the current request, validate its scope, and reload current knowledge/contact/case projections. Protected and encrypted contact fields remain excluded from AI prompts.
2. Require server-authenticated tenant/actor identity and client conversation/request UUIDs for generated replies. The server computes an HMAC fingerprint covering those identities, the question/history, selected scope, model and current authorized source context. Prompts/history are not stored in the wallet.
3. Reserve one credit before AI generation. Internal FAQ matching, translation and answer calls share that reservation and provider usage scope. The provider-usage logical request ID matches the wallet request's internal ID.
4. Validate the complete answer, encrypt its reply object, then commit the debit and replay copy in one database transaction. No provider calls run while a database transaction is held. A persistence failure rolls back the debit and releases the hold; an ambiguous committed transaction remains charged once and recoverable.
5. On failure, cancellation before commit or invalid output, release the reservation. Contact assistant provider/validation failures continue to return deterministic FALLBACK guidance for free. Billing/access errors propagate with their specific code. Rules-only scans, case selection and summaries that do not generate an AI answer never reserve credits. A valid AI-generated NEEDS_REVIEW answer still costs one credit.

A repeated active request returns `409 AI_REQUEST_IN_PROGRESS` with Retry-After. A completed request replays the original reply for 15 minutes without another debit or provider call. Replays bypass generation rate limits but still require current tenant access and matching source context. A different request payload or changed facts/knowledge returns `AI_REQUEST_CONFLICT`, so outdated or newly restricted facts are not replayed. A paid reply can be retrieved within its TTL while subscription spending is paused; it does not run AI or consume a new credit.

Released requests and expired replay copies cannot regenerate under the same ID. `AI_RESPONSE_EXPIRED` requires a new, explicit request. The browser preserves IDs after ambiguous failures and only clears an attempt after success or an explicit terminal conflict/expiry. It displays specific messages for billing required, exhausted credits, in-progress requests and unavailable credit tracking. Successful test-chat retries retain the same reply ID.

## Privacy and encryption

`20261029130000_ai_credit_replay` adds nullable encrypted reply fields and expiry/maintenance indexes to the existing request table. AES-256-GCM uses a fresh IV and authenticated data binding the ciphertext to tenant, actor, channel, request UUID, fingerprint and expiry. Swapping rows, changing expiry or tampering with ciphertext cannot produce a valid reply. This is a short-lived encrypted answer cache, not a stored conversation transcript. The cached reply includes answer text and its returned helper/source metadata; request text/history are not cached.

Provide a separate server-only `AI_REPLAY_ENCRYPTION_KEY`: base64 encoding of 32 random bytes. Do not reuse the contact-field encryption key or expose it to the browser. Version 1 supports one active key; rotation invalidates old replay fingerprints/copies, so plan rotation around the 15-minute replay window or explicitly expire existing copies. Wallet debit tombstones remain to prevent regeneration/double charging. Normal account deletion cascades wallet/replay records.

Logical replay expiry is enforced immediately at 15 minutes. The maintenance worker physically clears expired ciphertext and authentication fields in bounded batches; expiry on lookup also clears its copy. Request/ledger metadata remains for accounting. Cleanup timing depends on the worker interval/backlog; deploy and monitor the worker before enforcement. The worker also recovers abandoned five-minute reservations. It continues cleanup if billing is later disabled and never needs the replay decryption key.

```sh
# From the repository root after building and applying migrations:
npm run worker:ai-credits -w backend
# One maintenance pass (nonzero exit if it fails):
npm run worker:ai-credits -w backend -- --once
```

The worker runs every 60 seconds by default; `AI_CREDIT_MAINTENANCE_INTERVAL_MS` supports 1,000–60,000 ms. It logs counts/errors without customer content or identifiers. Use the existing deployment process manager to keep it running; this chunk does not install a hosted scheduler.

## Rollout gates

Enforcement now requires billing configuration, `AI_CREDIT_MODEL_GATE_PASSED=true`, `AI_PROVIDER_METERING_ENABLED=true`, and the separate valid replay key. Startup rejects unsafe combinations. Generated credit-backed replies currently accept only the planned `openai/gpt-oss-120b` model; default Qwen is preserved until an approved rollout explicitly selects the candidate. Provider calls outside a reservation are blocked when enforcement is on. Unknown provider usage remains an uncertain company expense rather than fabricated zero cost; fixed customer credit accounting is independent of provider token totals.

Apply the additive Chunk 1–4 migrations in order, finish subscription/payment/no-trial integration and verified grants, deploy maintenance, complete the full model evaluation and human review, then enable enforcement through the rollout configuration. The Chunk 2 evaluation remains incomplete due to provider rate limits. **Do not enable enforcement or credit purchases yet.** This chunk leaves the application database and environment flags unchanged.

The existing endpoints document conditional UUID requirements and 402/409/503 errors in OpenAPI. Existing clients without tracking IDs keep their old behavior while enforcement is off; once on, generated replies require both UUIDs. Account/tenant authorization still runs before reservation or replay. The usage progress bar, Stripe subscriptions and pack checkout remain later chunks.

## Verification

Unit checks cover authenticated encryption, identity/expiry tampering, canonical HMAC fingerprints, unsafe configuration, disabled-mode compatibility, missing IDs and provider calls outside a reservation. Disposable PostgreSQL tests cover concurrency, replay after lost responses, atomic rollback on encryption persistence failure, cancellation, TTL cleanup, abandoned holds, fresh access checks and uncharged contact fallbacks. The application database is not used by these billing tests. No live AI or Stripe calls are made.

Final results: **519 backend tests passed, 9 existing opt-in integrations skipped, 0 failures** with the disposable credit-test database enabled. Both application TypeScript checks, Prisma validation/client generation, backend production build and frontend webpack production build passed. The two frontend retry/tracking tests passed. Frontend lint has zero errors and six existing warnings. OpenAPI YAML parsing and `git diff --check` passed. Application database migrations and live model/payment flows remain unactivated.
