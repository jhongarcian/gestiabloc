# Gestiabloc — Agent Guide

Multi-tenant SaaS CRM for insurance/service agencies. npm workspaces monorepo with two apps.

## Repo structure

```
apps/backend/   Express 5 + Prisma + PostgreSQL + Socket.io (CommonJS, port 4000)
apps/react-ui/  Next.js 16 + React 19 + Tailwind v4 + shadcn (port 3000)
packages/       Empty — no shared packages yet
```

## Commands

```bash
# Root (runs all workspaces in parallel)
npm run dev            # both apps
npm run dev:ui         # frontend only
npm run dev:backend    # backend only
npm run build          # all workspaces

# Backend
cd apps/backend
npx prisma generate    # regenerate client → src/generated/prisma
npx prisma migrate dev # create/apply migration
npm run db:seed        # seed database (requires env vars, see below)
npm test               # runs all *.test.ts files via Node built-in test runner

# Run a single test file
node --import tsx apps/backend/src/lib/tag-utils.test.ts

# Frontend
cd apps/react-ui
npm run lint           # ESLint (flat config, eslint-config-next)
```

**No typecheck script exists.** Run `npx tsc --noEmit` manually in either app when needed.

## Backend specifics

- **Entrypoint:** `apps/backend/src/index.ts` — mounts all route files, starts HTTP + Socket.io server
- **Prisma client output:** `src/generated/prisma` (not the default `node_modules/.prisma`). Import from `../generated/prisma/index.js`
- **Prisma adapter:** Uses `@prisma/adapter-pg` (driver adapter), not the default engine. Requires `DATABASE_URL` env var
- **Auth:** Cookie-based sessions (not JWT). Token hash stored in DB. Cookie name in `src/lib/cookies.ts`
- **Middleware pattern:** `requireAuth` → `requireTenantAdmin` → `requireTenantSecurityLevel` (chained in route files)
- **Route files:** One per domain in `src/routes/*.routes.ts`. Each exports an Express Router. All mounted at `/api/<name>`
- **Validation:** Zod schemas inline in route files. Zod errors caught globally and returned as 400
- **OpenAPI spec:** `apps/backend/docs/openapi.yml`, served at `/docs` via swagger-ui-express
- **Realtime:** Socket.io with cookie-based auth middleware. Events emitted via `src/lib/realtime.ts`
- **CommonJS module system:** `"type": "commonjs"` in package.json. All imports use `.js` extension even for `.ts` source files

### Seed script

```bash
# Required — pass via env or flags:
npx prisma db seed
# SEED_TENANT_NAME / --tenant-name
# SEED_ADMIN_NAME / --admin-name
# SEED_ADMIN_EMAIL / --admin-email
# SEED_ADMIN_PASSWORD / --admin-password

# Optional:
# SEED_TENANT_SLUG / --tenant-slug (auto-generated from name)
# SEED_PLAN_KEY / --plan-key (STARTER|PRO|BUSINESS, default STARTER)
# SEED_PAID_NOW / --paid-now (true/false)
```

Upserts if user+tenant already exist. Errors if only one exists (won't guess).

### Tests

Uses **Node.js built-in test runner** (`node:test`), not Jest or Vitest. Assertions via `node:assert/strict`. Test files are `*.test.ts` colocated with source in `src/lib/`.

```bash
# All tests
npm test                          # from apps/backend
# Single test file
node --import tsx apps/backend/src/lib/service-fit.test.ts
```

## Frontend specifics

- **Routing:** Next.js App Router with route groups:
  - `(tenants)/app/[tenantSlug]/...` — main tenant dashboard (multi-tenant, slug-based)
  - `(saas)/portal/...` — SaaS owner portal (currently empty)
  - `login/`, `signup/`, `verify/`, `reset-password/`, `create-new-password/` — auth pages
- **shadcn/ui:** Configured in `components.json` (new-york style, neutral base, lucide icons). UI components in `components/ui/`. Add new ones with `npx shadcn@latest add <component>`
- **API client:** Axios instance in `lib/api.ts`. Base URL from `NEXT_PUBLIC_BACKEND_URL` (defaults to `http://localhost:4000`). All requests are cookie-authenticated (`withCredentials: true`)
- **Tenant session:** Server components fetch user/membership via `getTenantMembershipContext(slug)` in `_lib/tenant-session.ts`. Uses React `cache()` for request-level deduplication
- **Path alias:** `@/*` maps to project root (e.g., `@/components/ui/button`)
- **CSS:** Tailwind v4 via PostCSS plugin (`@tailwindcss/postcss`). CSS variables for theming in `globals.css`
- **ESLint:** Flat config (`eslint.config.mjs`) using `eslint-config-next`

## Multi-tenant architecture

- Every backend route requires a `tenantId` (from body, params, or query)
- `Membership` links `User` ↔ `Tenant` with `role` (TENANT_ADMIN, TENANT_USER) and `securityLevel` (LOW, MEDIUM, MAX)
- Frontend URL pattern: `/app/[tenantSlug]/<section>`
- Tenant context resolved server-side from session cookie → user memberships → slug match

## Environment variables

**Backend** (`apps/backend/.env`):
- `DATABASE_URL` — PostgreSQL connection string (required)
- `PORT` — backend port (default 4000)
- `WEB_ORIGIN` — allowed CORS origin (default http://localhost:3000)
- `COOKIE_DOMAIN` — optional, for cross-subdomain cookies

**Frontend** (`apps/react-ui/.env`):
- `NEXT_PUBLIC_BACKEND_URL` — backend API base URL (default http://localhost:4000)

## Key conventions

- Backend uses **Zod v4** (check import: `zod` not `zod/v3`)
- Prisma schema has **tenant-scoped composite unique constraints** pattern: `@@unique([tenantId, id])` on most tables
- Custom field values support **encryption** (`isEncrypted` flag on `ContactCustomField`, ciphertext/iv/authTag columns)
- Service fit analysis has its own subsystem in `src/lib/service-fit*.ts` with AI assistant integration
- Follow-up templates store flow graph as JSON (`flowNodes`, `flowEdges` on `ServiceFollowUpTemplate`)
