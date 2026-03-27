# Summary Cards UI Spec

## 1. Purpose

This spec defines the reusable summary-card pattern used for dashboard-style metrics at the top of a page.

It should be used when a screen needs to show:

- 3 to 6 high-signal metrics
- optional date-range filtering
- quick operational visibility before the main table or detail content

Current reference implementations:

- `apps/react-ui/app/(tenants)/app/[tenantSlug]/services/_components/services-registry-panel.tsx`
- `apps/react-ui/app/(tenants)/app/[tenantSlug]/services/[serviceId]/_components/service-overview-panel.tsx`

This spec is intended to be reused in other views without inventing a new card pattern each time.

## 2. Core Pattern

The summary-card module is a page-level section that sits above the main content card.

Standard structure:

1. Summary section shell
2. Section heading and support copy
3. Optional range controls
4. Error banner when summary data fails
5. Grid of metric cards

The summary module is a separate card from the table or detail-content card below it.

## 3. Visual Structure

### Section Shell

Use a rounded card shell.

Recommended shell:

- `rounded-[26px] border border-slate-200 p-5`

Allowed backgrounds:

- white for standard summary sections
- branded gradient only when the summary is part of the main hero treatment

Rule:

- do not stack gradient cards repeatedly on the same page
- if the hero already uses the gradient, later summary sections should be white

### Section Header

Header content should include:

- section title
- one-sentence explanation
- optional date range controls aligned to the right

Recommended text styling:

- title: `text-xl font-semibold tracking-tight text-slate-950`
- support copy: `text-sm text-slate-600`

### Card Grid

Recommended grid:

- `grid gap-4 md:grid-cols-2 xl:grid-cols-4`

Cards should be:

- rounded
- lightly bordered
- white or frosted-white depending on the parent shell
- easy to scan in one glance

Recommended card shell:

- `rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm`

If the parent shell uses a gradient, frosted cards are allowed:

- `border-white/80 bg-white/70 backdrop-blur`

## 4. Card Anatomy

Each summary card should contain:

- a small label row
- optional icon
- the primary metric value
- optional badge
- one line of helper copy

Recommended order:

1. icon + uppercase label
2. metric value
3. optional status badge
4. short supporting text

### Label row

Recommended styling:

- `text-[11px] font-semibold uppercase tracking-[0.18em]`

### Metric value

Recommended styling:

- `text-2xl font-semibold tracking-tight text-slate-950`

Use:

- currency formatting for money
- plain number formatting for counts
- avoid long descriptive text in the value line

### Optional badge

Badges are appropriate for:

- `Live`
- `This range`
- `Taxable`
- `No tax`
- `Incomplete`

Recommended badge behavior:

- only use when it helps clarify metric scope
- do not place multiple badges in a single summary card unless clearly necessary

## 5. Range Controls

Summary sections may support range-based metrics.

Standard controls:

- `Summary range` select
- optional `Date range` picker when `Custom range` is selected

Recommended preset options:

- `This month`
- `Last month`
- `Last 3 months`
- `Custom range`

### Calendar Pattern

Use shadcn `Calendar` with `mode="range"` inside a `Popover`.

Required behavior:

- custom calendar only appears when the preset is `Custom range`
- custom dates must be disabled for future dates
- do not allow dates before `1900-01-01`

Recommended interaction:

- calendar picker on the left
- summary range select on the right

### Mixed Scope Metrics

Some cards may be filtered by the selected range while others are intentionally live totals.

Example:

- `Gross sales` and `Services sold` use the selected range
- `Active follow-up services` and `Remaining balance` are live totals

When this happens:

- the card must explicitly show a `Live` badge
- helper text must clarify that it is not range-limited

## 6. API Contract Requirements

Summary-card data must come from a dedicated summary endpoint.

Do not overload list endpoints or detail endpoints with heavy aggregate work when a separate summary contract is clearer.

Recommended response shape:

```ts
type SummaryResponse = {
  ok: boolean
  summary: {
    // metric fields
    range: {
      preset: "THIS_MONTH" | "LAST_MONTH" | "LAST_3_MONTHS" | "CUSTOM"
      from: string
      to: string
    }
  }
}
```

Rules:

- keep the summary payload small
- return only aggregate values needed for the cards
- do not return full row datasets for summary cards

### Query Parameters

Recommended query shape:

- `preset`
- `from`
- `to`

`from` and `to` are only used when `preset = CUSTOM`.

### Backend Validation

All summary endpoints must sanitize and validate input with Zod.

Required validation rules:

- path params are trimmed and must be non-empty
- `preset` must be a known enum
- `from` and `to` must be strict `YYYY-MM-DD`
- `from` and `to` are required when `preset = CUSTOM`
- `from` must be on or before `to`
- custom ranges should be capped to a safe maximum window

Recommended cap:

- 366 days

### Timezone Rule

Date-range summaries must be calculated using the tenant timezone when tenant-scoped data is involved.

## 7. Fetching Pattern

### Initial Render

If the page is server-rendered, the initial summary should be fetched on the server together with the main page data when practical.

Purpose:

- avoid an unnecessary extra client fetch on first paint
- allow cards to render with real values immediately

Recommended approach:

- fetch detail/list data and initial summary in parallel
- pass `initialSummary` into the client component

### Client Refetch

The client should refetch only when:

- the selected preset changes
- the custom date range changes

The client should not immediately re-fetch if the current state already matches the provided `initialSummary`.

## 8. Performance Requirements

Summary endpoints must be aggregate-oriented.

Do:

- use `count`
- use `_sum`
- use scoped aggregate queries
- run independent queries in `Promise.all`

Do not:

- load the full table dataset just to calculate cards
- include unused nested relations
- include large blobs, notes, graphs, or full node trees

If detail and summary are separate endpoints:

- the detail endpoint should remain read-focused
- the summary endpoint should remain aggregate-focused

## 9. Sanitization Rules

### Backend

All summary endpoints must sanitize:

- `tenantId`
- `serviceId`
- any other route param
- query params for preset and dates

Sanitization requirements:

- trim strings
- reject empty values
- reject unknown enum values
- reject malformed dates

### Frontend

Frontend callers should:

- use controlled state for preset/date inputs
- avoid sending `from`/`to` unless the preset is `CUSTOM`
- encode path params when building API URLs

Frontend validation improves resilience, but backend Zod validation remains the source of truth.

## 10. Loading State

Summary cards must use skeletons, not plain loading text.

Recommended loading pattern:

- preserve the card shell
- replace the metric value and badge/content with `Skeleton`

Example skeleton blocks:

- value: `h-8 w-24 rounded-lg`
- helper text: `h-4 w-32 rounded-md`
- optional badge: `h-6 w-14 rounded-full`

Rules:

- keep card size stable during loading
- do not flash `Loading...`
- if summary data already exists and a refetch starts, prefer keeping old data visible instead of clearing the cards

## 11. Error State

If the summary endpoint fails:

- keep the summary section visible
- show a single inline error banner above the cards
- do not collapse the whole area

Recommended behavior:

- keep previous successful summary values if available
- only fall back to empty values when there is no prior good result

Error copy should be short and readable.

Example:

- `Could not load service summary.`

## 12. Reuse Rules

Use this summary-card pattern for:

- services dashboards
- billing overview pages
- follow-up operational overviews
- contact-level operational summaries
- account-level reporting snapshots

When reusing it:

- keep the same shell structure
- keep the same label/value/badge hierarchy
- use the same range-control pattern
- keep API response contracts small and aggregate-focused

Do not create one-off summary cards with a different visual hierarchy unless the screen has a strong product reason to diverge.

## 13. Current Service Examples

### Services list page

Current card set:

- `Gross sales`
- `Services sold`
- `Active follow-up services`
- `Remaining balance`

### Single service page

Current card set:

- `Gross sales`
- `Services sold`
- `Active follow-ups`
- `Remaining balance`

These implementations should remain aligned with this spec as they evolve.
