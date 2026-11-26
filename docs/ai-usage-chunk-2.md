# AI usage and model evaluation — chunk 2

Implemented shared Groq request tracking for helper chat, FAQ matching/translation, qualification explanations, and service verification. Requests from tenant chat routes retain the tenant, authenticated actor, channel and logical reply identifier across internal calls. Ordinary fit scans now use deterministic explanations unless AI is explicitly requested. This chunk does not deduct credits or enable credit purchases.

## Usage records and rollout

`AiProviderUsage` records model, purpose, duration, HTTP status, provider-reported input/output/cache/reasoning counts and fixed-precision estimated USD cost. Prompts, answers, contact facts, credentials and raw provider errors are excluded. Reasoning counts are a subset of output, never an extra charge. Unknown pricing or missing usage stays unknown; an estimated upper bound is separate from reported usage. Failed/invalid responses can still incur provider costs.

The additive `20261028130000_ai_provider_usage` migration is prepared, **not applied**. After deployment migrations, set server-only `AI_PROVIDER_METERING_ENABLED=true` and restart the backend to persist usage. It defaults off to allow staged deployment before the table exists. With persistence enabled, a failed initial record prevents dispatch; a failed final record returns an error and leaves a STARTED attempt for reconciliation. Reconcile these uncertain attempts before using usage data to make billing decisions. No database persistence integration has been exercised in this chunk.

## Candidate model and limits

The existing Qwen default remains active. Deployed GPT-OSS selection requires `AI_CREDIT_MODEL_GATE_PASSED=true`; this flag is an operational approval, not an automatic evaluation result. Do not set it until the full evaluation and human review pass. The synthetic evaluation tool can pass a trusted model configuration without changing deployed settings.

GPT-OSS requests use low reasoning and hidden reasoning output. Each logical answer shares a 6,000 input / 1,800 billed-output token budget across internal calls. Input preflight uses the Harmony tokenizer with conservative framing overhead; provider usage is authoritative afterward. Old history pairs and lower-ranked knowledge sources are removed first. Fresh contact/case facts remain intact; requests that still exceed the budget fail with `AI_CONTEXT_TOO_LARGE`. Uncertain calls retain their reserved budget. No automatic paid retries are made. Qwen retains its existing context behavior; these candidate limits do not establish Qwen credit economics.

Rates are versioned `groq-2026-10-28`. Per million tokens: GPT-OSS 120B input $0.15, cached input $0.075, output $0.60; Qwen 3.8 27B input $0.80 and output $4.00, with no cache discount assumed. See [Groq GPT-OSS pricing](https://console.groq.com/docs/model/openai/gpt-oss-120b) and [Groq Qwen pricing](https://console.groq.com/docs/model/qwen/qwen3.8-27b). At the candidate caps, uncached model cost is $0.00198 per logical answer; this excludes infrastructure, Stripe fees and other operating costs and depends on the input preflight estimate.

## Synthetic evaluation

From the repository root:

```sh
npm run ai:evaluate -w backend
npm run ai:evaluate -w backend -- --live --output /private/tmp/ai-candidate.json
npm run ai:evaluate -w backend -- --live --model qwen/qwen3.8-27b --output /private/tmp/ai-baseline.json
```

Default execution is a dry run with no API calls. Live execution uses the existing server Groq key, only synthetic fixtures, sequential calls and a $5 estimated provider budget. It stops after three consecutive provider-availability failures. `--limit` supports smaller pilots, which cannot pass the release gates. Reports contain synthetic answers and metadata, are written with private permissions, and must not be repurposed to capture customer chats.

The 100 cases cover English/Spanish pricing, hours, unknown knowledge, prompt injection, age qualification, protected information, conflicting payment notes, separate purchase balances, exact FAQs and translations. Automated checks require at least 95% acceptance and every critical case passing. Cost checks require complete known usage and average model cost at most $0.0015 per case. Interrupted attempts and incomplete evaluations fail closed. Substring checks are only a screening tool; human factual/privacy review is always required. The runner never approves a release or changes environment flags.

### Live pilot result, 2026-10-28

Groq GPT-OSS 120B returned nine valid synthetic answers and four HTTP 429 errors before the runner stopped, covering only 13 of 100 cases. All nine returned answers passed the automated checks after accepting natural refusal wording. Known estimated provider cost was $0.0015813; including conservative bounds for uncertain attempts gives $0.00650745. These partial results establish neither full quality nor production average cost. Both gates remain closed. No paid Qwen comparison was completed. Rerun the full candidate and baseline evaluations when provider capacity allows, then review the answers before approving a model change or pack economics.

## Verification

Backend tests cover tenant isolation, logical request grouping, cached/reasoning cost arithmetic, uncertain attempts, invalid output, budget rejection, metering failure before dispatch, model selection gates, preservation of fresh facts during history trimming and evaluation screening. Prisma validation/client generation, TypeScript and backend production build passed. The migration and persistent recording still need deployment integration checks. Wallet balances, user-facing usage progress and Stripe checkout remain later chunks.

Final backend suite: **496 passed, 9 opt-in integration tests skipped, 0 failures** (`node --import dotenv/config --import tsx --test src/**/*.test.ts` from `apps/backend`). The model evaluation dry run makes no paid calls.
