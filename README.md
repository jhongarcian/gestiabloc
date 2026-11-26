# Gestiabloc

Multi-tenant agency CRM with an Express backend and a Next.js frontend.

## Environment setup

Each app loads its own configuration:

- `apps/backend/.env` — database, email, private storage, AI and Stripe.
- `apps/react-ui/.env` — backend URL and public Supabase settings.

For a fresh checkout, copy the example files without replacing existing values:

```sh
cp -n apps/backend/.env.example apps/backend/.env
cp -n apps/react-ui/.env.example apps/react-ui/.env
npm install
```

Set `DATABASE_URL` to a development PostgreSQL database. Generate a separate
value for each of `CONTACT_CUSTOM_FIELD_ENCRYPTION_KEY`,
`CONTACT_SSN_ENCRYPTION_KEY` and `AI_REPLAY_ENCRYPTION_KEY`:

```sh
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64"))'
```

Keep existing encryption keys when connecting to an existing database. The local
server defaults are backend port `4000`, frontend port `3000`, and
`WEB_ORIGIN=http://localhost:3000`. Add another frontend origin to
`WEB_ADDITIONAL_ORIGINS` if needed. Leave `COOKIE_DOMAIN` empty for localhost.

Fill in the optional services as you need them:

| Feature | Backend settings | Frontend settings |
| --- | --- | --- |
| Email delivery | `RESEND_API_KEY`, `EMAIL_FROM` from a verified sender domain | None |
| Private files and AI documents | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` (private bucket) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the same project |
| Generated AI replies | `SERVICE_FIT_AI_PROVIDER=groq`, `GROQ_API_KEY`, `GROQ_MODEL` | None |
| Stripe subscriptions and credit purchases | Sandbox server key, webhook secret, portal configuration and six Price IDs listed in the backend example | None |

Without an email provider, local development prints login codes and verification
links in the backend terminal. Without a Groq key, AI features use their existing
rules/fallback behavior. Changing frontend public values requires restarting the
frontend; public values are also embedded at build time. Keep service secret keys
in the backend file. Both real `.env` files are ignored by Git.

## Start development

On a new development database, generate the Prisma client and apply migrations:

```sh
npm exec -w backend -- prisma generate
npm exec -w backend -- prisma migrate deploy
```

Optionally fill the `SEED_*` variables and create the first tenant:

```sh
npm run db:seed -w backend
```

Start the two apps in separate terminals:

```sh
npm run dev:backend
npm run dev:ui
```

Open `http://localhost:3000`. Backend API documentation is at
`http://localhost:4000/docs`. Advanced worker/pool settings and opt-in test
variables are documented in `apps/backend/.env.example`.

## Stripe setup

The backend environment file includes empty fields for the selected Gestiabloc
sandbox's restricted server key, webhook signing secret, portal configuration ID,
three monthly subscription Price IDs and three one-time credit-pack Price IDs.
Fill them with values from that sandbox; credentials from the Stripe plugin
connection do not automatically populate the local backend environment.

For local webhook delivery, use the installed Stripe CLI with the sandbox key
already stored in the backend environment. Save its signing secret once:

```sh
npm run stripe:listen -w backend -- --configure
```

The command writes `STRIPE_WEBHOOK_SECRET` without printing it. It only accepts
test keys. Restart the backend, then keep this command running while testing:

```sh
npm run stripe:listen -w backend
```

The forwarding command uses that same sandbox key and filters to handled events.
If switching sandboxes, run configuration again to save the matching secret.
The existing handler expects snapshot events matching its pinned API version,
`2026-09-30.endive`; hosted endpoints require their own signing secret and a
public HTTPS backend URL. The event list and rollout steps are in
`docs/billing-chunk-5.md` and `docs/credit-purchases-chunk-6.md`.

Keep `BILLING_ENABLED`, `AI_CREDIT_ENFORCEMENT_ENABLED`,
`AI_CREDIT_PURCHASES_ENABLED`, `AI_CREDIT_MODEL_GATE_PASSED`, and
`AI_PROVIDER_METERING_ENABLED` false until the deployment and evaluation checks
are complete. In that state, empty Stripe fields allow local development.
Enabling billing still requires all subscription settings; purchases additionally
require all pack IDs, credit enforcement, metering and an approved model. New
accounts and seeded tenants have no trial or paid credit grant.

Model-specific approvals, credit costs and provider connections are described in
`docs/ai-model-credit-architecture.md`. New models use the shared wallet through
the server-owned catalog; the legacy model approval flag approves only the
original GPT-OSS 120B policy. OpenAI and Anthropic connections remain separate
provider additions. Apply the model-credit-units migration before activation.

AI settings → Analytics displays the current credit balance alongside filtered
credit spending, token totals and daily usage. Definitions and validation are in
`docs/ai-analytics-chunk-7.md`.

After migrations and rollout approval, run the billing, purchase reconciliation,
and credit maintenance workers alongside the API using the workspace scripts
`worker:billing:dev`, `worker:credit-purchases:dev`, and `worker:ai-credits:dev`.
