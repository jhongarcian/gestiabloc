# Gestiabloc Contact Table Style Guide

This guide documents the tenant contacts table pattern. Use it as the baseline table style for the follow-up page and other dense list views.

Reference implementation:

`apps/react-ui/app/(tenants)/app/[tenantSlug]/contacts/_components/contacts-table.tsx`

## Design Direction

The contact table is a dense operational list. It should feel clean, stable, and easy to scan without turning each row into a card.

Use the same pattern when another page needs contacts-style pagination, loading rows, horizontal scrolling, and row navigation.

## Page Structure

Use this outer shape:

- A full-height flex column with `min-h-0` so the table can own the scrolling area.
- A gradient header panel for title, primary action, search, filters, and clear filters.
- A separate white table section with a rounded border and footer.

Key classes:

```tsx
<div className="flex h-full min-h-0 flex-col gap-5">
  <header className="shrink-0 rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
    ...
  </header>

  <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
    ...
  </section>
</div>
```

## Search And Actions

The search row uses one flexible search input followed by compact actions.

```tsx
<div className="mt-5 grid gap-3 lg:grid-cols-[minmax(280px,1fr)_auto_auto]">
```

Controls should use:

- Search input: `h-11 rounded-xl border-white/80 bg-white/85 px-4 shadow-sm backdrop-blur`
- Filter button: `h-11 rounded-xl border-white/80 bg-white/85 px-4 text-blue-950 shadow-sm backdrop-blur`
- Clear button: `h-11 rounded-xl border-white/80 bg-white/70 px-4 text-slate-700 shadow-sm backdrop-blur`
- Active filter count: blue badge with `bg-blue-950 text-white`

## Table Shell

The table section owns the scrolling. Horizontal scrolling belongs to the table content area, not the page.

```tsx
<section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
  <div className="min-h-0 flex-1 overflow-auto px-4 pt-4">
    <Table className="min-w-[1120px] table-fixed border-separate border-spacing-0">
      ...
    </Table>
  </div>
</section>
```

For wider tables, increase `min-w` enough to keep cells on one row. Do not stack cell details into two visual rows just to avoid horizontal scrolling.

## Header Row

Use the rounded, pale header row:

```tsx
<TableHeader className="drop-shadow-sm [&_tr]:border-0">
  <TableRow className="h-14 border-0 hover:bg-transparent">
    <TableHead className="w-[16%] rounded-l-xl border-y border-l bg-slate-50 px-4 text-xs text-slate-600">
      Full name
    </TableHead>
    ...
    <TableHead className="w-[10%] rounded-r-xl border-y border-r bg-slate-50 px-4 text-xs text-slate-600">
      Follow-ups
    </TableHead>
  </TableRow>
</TableHeader>
```

Rules:

- First header cell gets `rounded-l-xl border-l`.
- Middle header cells get `border-y`.
- Last header cell gets `rounded-r-xl border-r`.
- Use fixed percentage widths and `table-fixed`.
- Keep labels short and scannable.

## Rows

Rows should be stable and compact:

- Use `h-14` for data, loading, and placeholder rows.
- Use `px-4 py-0` on cells.
- Use `truncate` on long text.
- Use neutral row backgrounds; hover may be subtle blue.
- Preserve keyboard navigation when the row opens a detail page.

Add the spacer row under the header:

```tsx
<TableRow aria-hidden="true" className="h-2 border-0 hover:bg-transparent">
  <TableCell colSpan={columnCount} className="p-0" />
</TableRow>
```

## Loading And Empty State

Loading should show skeleton rows matching the selected page size. Empty pages should keep the table height stable with placeholder rows.

```tsx
const placeholderRowCount =
  items.length === 0 ? pageSize - 1 : Math.max(0, pageSize - items.length)
```

Use this after the real rows:

```tsx
{!isLoading && !errorMessage
  ? Array.from({ length: placeholderRowCount }, (_, index) => (
      <TableRow key={`placeholder-${index}`} aria-hidden="true" className="h-14 hover:bg-transparent">
        <TableCell colSpan={columnCount} className="px-4 py-0" />
      </TableRow>
    ))
  : null}
```

## Pagination

The footer has the same structure on contact-style tables:

- Summary text on the left.
- `Rows per page` select beside the summary.
- Numbered pagination on the right.
- Previous and next are icon buttons.
- Show up to five page number buttons.
- Current page button is blue and disabled.

```tsx
const visiblePageCount = Math.min(5, totalPages)
const firstVisiblePage = Math.max(
  1,
  Math.min(page - 2, totalPages - visiblePageCount + 1),
)
const visiblePages = Array.from(
  { length: visiblePageCount },
  (_, index) => firstVisiblePage + index,
)
```

Footer shell:

```tsx
<footer className="flex flex-col gap-4 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
  ...
</footer>
```

Use `SelectGroup` inside the page-size select and `size="icon-sm"` for previous, page number, and next buttons.

## Follow-Up Page Usage

For the follow-up table, keep the follow-up-specific columns from `docs/follow-up-table-style-guide.md`, but use this contacts table shell, header row styling, loading rows, placeholder rows, and pagination footer.
