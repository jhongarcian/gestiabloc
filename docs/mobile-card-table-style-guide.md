# Gestiabloc Small-Screen Card Table Style Guide

This guide defines how a wide operational table becomes an easy-to-read card list on small screens. It is a responsive presentation of the same records, not a separate feature or reduced data set.

Reference implementations:

- `apps/react-ui/app/(tenants)/app/[tenantSlug]/services/enrollments/_components/enrollments-register.tsx`
- `apps/react-ui/app/(tenants)/app/[tenantSlug]/services/transactions/_components/transactions-register.tsx`
- `apps/react-ui/app/(tenants)/app/[tenantSlug]/followups/_components/followups-table.tsx`

Related guidance:

- `docs/contact-table-style-guide.md` for the desktop table shell and row behavior.
- `docs/header-style-guide.md` for responsive search, filter, and sort controls.
- `docs/button-style-guide.md` for action hierarchy and focus behavior.

## When To Use Cards

Use a card list when a table has enough columns that a user would need horizontal scrolling to understand one record. The card must preserve the table's important fields while reorganizing them into a vertical reading order.

- Render cards below `md` and the table at `md` and above.
- Do not place a wide table inside a horizontally scrolling phone viewport.
- Do not fetch a second data set for cards. Cards and the desktop table render the same page of results.
- Keep sorting, filtering, page size, pagination, and row destinations identical across both views.
- Below `md`, keep the register toolbar to Filters and Sort. Put `Clear filters` in the filter drawer; restore the inline clear action at `md` and above.

```tsx
<div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 md:hidden">
  {/* Small-screen card list */}
</div>

<div className="hidden min-h-0 flex-1 overflow-auto px-4 pt-4 md:block">
  {/* Desktop table */}
</div>
```

## Card Anatomy

Build records with the shared shadcn `Card` composition:

1. `CardHeader`: primary identity, status, and directional affordance.
2. `CardDescription`: the most important secondary relationship, such as the service name.
3. `CardContent`: supporting fields arranged in a compact two-column grid.
4. `Separator`: a clear boundary before metadata.
5. `CardFooter`: dates or other low-priority metadata in two equal columns.

Use a two-column content grid when two fields have comparable importance. This fills the available width, avoids a tall stack with empty space, and keeps related information easy to compare.

```tsx
<CardContent className="grid min-w-0 grid-cols-2 items-start gap-4 px-4 pb-4">
  <CardField label="Template" value={templateName} />
  <CardField label="Assigned to" value={coordinatorName} />
</CardContent>
```

## Typography And Density

- Use natural-case labels with normal letter spacing.
- Do not use `uppercase` or `tracking-*` utilities for field labels.
- Use `text-xs font-medium text-slate-500` for labels.
- Use `text-sm font-medium` for values and `text-xs` for date metadata.
- Keep the primary identity at `text-base`; allow truncation when the full value is available through `title` or the detail view.
- Use `min-w-0`, `truncate`, or `break-words` deliberately so no value creates horizontal page overflow.
- Prefer `gap-4` between field columns and `gap-1` or `gap-1.5` between a label and its value.

## Status And Missing Values

- Reuse the same status label and badge treatment as the desktop row.
- Status must remain readable as text; color is supporting information only.
- Apply a muted surface and muted text to canceled records without hiding their data.
- Use explicit missing-value copy such as `Manual flow` or `Unassigned` when it explains the state.
- Use an em dash only when no useful explanatory label exists, such as a missing legacy date.

## Row Interaction

When the desktop row opens a detail route, the entire card should do the same.

- Use `role="link"`, `tabIndex={0}`, and a descriptive `aria-label`.
- Open the record with Enter or Space as well as pointer input.
- Preserve the complete `returnTo` URL.
- Show a small chevron as a directional affordance. It is decorative and must not become a nested button.
- Provide visible hover, focus-visible, and pressed states.
- Respect reduced-motion preferences for transform effects.

Do not place secondary interactive controls inside a card that behaves as one large link. If a record needs several independent actions, use a non-clickable card with explicit buttons instead.

## Loading, Empty, And Error States

- Render three skeleton cards that match the final card structure.
- Keep the header, two-column details, separator, and footer visible in each skeleton.
- Render filtered-empty, unfiltered-empty, and error states inside the same mobile list region.
- Provide a clearly labeled retry action for recoverable errors.
- Do not render desktop placeholder rows in the card list.

## Small-Screen Pagination

The mobile pager is a single, visually connected control below the cards:

- Put Previous, the current page indicator, and Next in one three-column grid.
- Use labeled Previous and Next buttons on small screens. Do not rely on arrow icons alone.
- Keep both navigation buttons at least 40px high with equal available width.
- Display the page as `{current} of {total}` in a centered, tabular-number indicator.
- Disable Previous on the first page and Next on the last page.
- Keep the result summary and page-size selector in a separate row immediately above the pager.
- Use the shorter `Per page` label on narrow phones.
- Switch to icon buttons and numbered pages at `md`, at the same breakpoint where the desktop table returns.
- Announce result-summary and current-page changes with polite live regions.

```tsx
<nav
  aria-label="Record list pagination"
  className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-2xl border bg-white p-1.5 shadow-sm md:flex md:w-auto md:border-0 md:bg-transparent md:p-0 md:shadow-none"
>
  <Button variant="outline" size="sm" className="h-10 min-w-0 rounded-xl md:size-8">
    <ChevronLeft aria-hidden="true" />
    <span className="md:sr-only">Previous</span>
  </Button>

  <span className="min-w-20 rounded-xl bg-slate-50 px-2 py-2 text-center text-xs tabular-nums md:hidden">
    <strong>{page}</strong> of {totalPages}
  </span>

  <Button variant="outline" size="sm" className="h-10 min-w-0 rounded-xl md:size-8">
    <span className="md:sr-only">Next</span>
    <ChevronRight aria-hidden="true" />
  </Button>
</nav>
```

## Responsive Checklist

Before shipping a card-table view, verify:

- No horizontal page scrolling at 320px, 375px, and 430px widths.
- Long names, services, templates, and assignee names do not force the card wider.
- Cards and table rows open the same route and preserve the same filters.
- Every desktop column is either represented in the card or intentionally excluded as low-value mobile data.
- Focus order follows the visual order.
- Skeleton, error, empty, filtered-empty, canceled, and missing-value states remain understandable.
- Previous and Next stay balanced when localized labels become longer.
- The pager changes from labeled mobile controls to numbered desktop controls at `md`.
- The small-screen toolbar does not include an inline Clear filters button; the filter drawer provides that action and closes after clearing.
