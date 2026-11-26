# Shared AI model and credit architecture

AI credit accounting now uses one path for all catalogued, approved models: reserve the model's credit units, generate and validate the answer, then commit the debit and encrypted replay together. Failure releases the exact reserved units. Duplicate requests replay the saved answer without generating or charging again. Rules-only results and contact fallbacks remain free.

## Model catalog and connections

`apps/backend/src/lib/ai-model-catalog.ts` owns provider/model identity, token prices and rate version, input/output budgets, request capabilities, credits per reply, and policy version. The catalog is server-owned. Tenant requests cannot supply prices, credit charges, approvals or provider credentials.

Current policies are Groq GPT-OSS 120B (1 credit), GPT-OSS 20B (1 credit), and Qwen 3.8 27B (12 credits). GPT-OSS policies have a 6,000-input / 1,800-output logical reply budget. Qwen uses a 24,000-input conservative UTF-8 preflight bound / 1,800-output budget so its grounding prompt fits without treating a UTF-8 byte as an exact tokenizer count. Qwen's staged charge covers its higher provider price; it is not activated by this change. Limits include internal FAQ matching, translations, and answer generation. Existing unbilled Qwen behavior is retained, while evaluation and enforced generation use its bounded policy.

`ai-provider-adapters.ts` contains transport, environment configuration, provider token normalization and response normalization. Groq is connected. OpenAI and Anthropic still require their own adapters and catalog entries; they are not activated by adding their names to an environment variable. New adapters must validate native usage counts, account for caching/reasoning without double counting, respect cancellation, and normalize successful output for the shared JSON/schema validation.

`ai-provider-request.ts` handles all metering, limits, uncertain provider outcomes and approved reservation checks. Existing Groq exports remain compatible. The request must match the provider/model and policy covered by its reservation. Failed provider calls can still cost the company; these expenses are recorded independently of customer credit charges. Unknown costs remain unknown.

## Configuration and approval

`SERVICE_FIT_AI_PROVIDER=groq` selects the installed connection. `AI_MODEL` optionally overrides its provider-specific `GROQ_MODEL`; a blank override preserves current configuration. Verification also supports `SERVICE_VERIFICATION_AI_MODEL`, with its existing Groq overrides retained.

After model evaluation and review, `AI_CREDIT_APPROVED_MODELS` lists exact keys such as `groq:openai/gpt-oss-20b@v1`, separated by commas. Each provider, model and policy is approved independently. Unknown or stale keys are rejected. Bump `policyVersion` and review again when changing a policy's credit cost, budget, capabilities or economics. The legacy `AI_CREDIT_MODEL_GATE_PASSED=true` approves only `groq:openai/gpt-oss-120b@v1`; it does not approve every model. Startup rejects enforcement when the selected model is unapproved or unsupported.

The evaluation CLI discovers models from the same catalog and installed adapters:

```sh
npm run ai:evaluate -w backend -- --provider groq --model openai/gpt-oss-20b
```

The default is a dry run. `--live` sends synthetic fixtures to the provider with an estimated $5 ceiling. The standalone process disables customer deductions only inside its own evaluation process and never accesses customer wallets. All 100 cases, critical cases, complete cost accounting and human review remain required for release. The cost check is $0.0015 average per charged credit, rather than per reply regardless of its credit charge. Evaluation never sets approval flags.

## Wallet and deployment

Apply `20261125160000_model_credit_units` before activating model-dependent deductions. It expands existing check constraints while preserving all existing one-credit rows. No grants, deductions, payment data, or subscriptions are rewritten. New requests can reserve 1–1,000 credits, consuming monthly units first and purchased units for any remainder. Settlement and recovery use the saved quantities, including for replies finishing after a renewal.

`GET /api/billing/:tenantId/credits` returns `replyCreditCost` alongside the existing balances. The shared usage card describes that actual cost when enforcement is active; an unavailable balance is never fabricated. Stripe products, grants and wallet snapshots remain provider-independent.

Policy/provider identity and units are included in new request fingerprints. Deploy after existing 15-minute replay windows have drained; changed fingerprints conflict rather than regenerate or double-charge an older request. Deploy and monitor credit maintenance before activation. This refactor does not change application environment flags, select a new provider, apply application migrations, or activate customer spending.

## Verification

571 backend tests passed, with 9 opt-in checks skipped and no failures. This includes the actual PostgreSQL credit integration tests against a temporary local database: concurrent spending, mixed monthly/purchased reservations, multi-credit commit/release/expiry, rollover, replay, authorization and free fallback replies. Model approvals, reserved-model mismatches, normalized provider responses, unknown costs and prompt budgets are covered. All 100 synthetic English/Spanish evaluation prompts fit every staged policy's initial input budget; this checks prompt admission, not live answer quality or release approval.

Nine credit interface tests passed. Backend and frontend production builds, OpenAPI YAML parsing, the catalog-driven evaluation dry run and whitespace checks passed. Frontend lint has no errors and four existing date-input warnings. No paid provider benchmark or real Stripe transaction was run, and application credit balances were not modified.

### Development activation repair — 2026-11-25

After credit enforcement and Qwen's policy approval were enabled in the local environment, AI requests returned `AI_BILLING_UNAVAILABLE`: the configured database still enforced the original one-credit request and ledger constraints. Confirmed that `20261125160000_model_credit_units` was the only pending migration, then applied it with `prisma migrate deploy`.

Verified the actual shared executor against that database inside a rolled-back transaction: Qwen's 12-unit reservation and commit succeeded, the encrypted reply replayed without a second generation/debit, and the account's 2,400-credit balance was unchanged after rollback. No provider request or payment was made by this diagnostic. All migrations were applied successfully. This repair verifies the billing mechanics; it does not constitute a live model quality evaluation.
