# Tables UI Spec

## 1. Purpose

This spec defines the standard table pattern for the app using the contacts table as the canonical reference implementation.

Reference implementation:

- `apps/react-ui/app/(tenants)/app/[tenantSlug]/contacts/_components/contacts-table.tsx`

The goal is to keep the same:

- pagination behavior
- search and filter behavior
- layout structure
- color system
- shadcn-based component composition

## 2. Required UI Stack

All table implementations must use our existing shadcn setup.

Current shadcn configuration:

- style: `new-york`
- base color: `neutral`
- css variables: enabled
- icons: `lucide`

Tables must be composed from shadcn primitives, not custom one-off replacements.

Required primitives for the standard table pattern:

- `Button`
- `Checkbox`
- `Input`
- `Label`
- `Select`
- `SelectContent`
- `SelectItem`
- `SelectTrigger`
- `SelectValue`
- `Sheet`
- `SheetContent`
- `SheetDescription`
- `SheetFooter`
- `SheetHeader`
- `SheetTitle`
- `Table`
- `TableBody`
- `TableCell`
- `TableHead`
- `TableHeader`
- `TableRow`

## 3. Standard Page Structure

The standard table page layout must follow this structure:

1. Outer page section
2. White rounded content shell
3. Header row with title, summary, and primary action
4. Search and filter controls
5. Optional filter sheet
6. Scrollable table area
7. Bottom pagination row

Reference shell:

- outer wrapper: `flex h-full min-h-0 flex-col gap-4`
- content shell: `flex min-h-0 flex-1 rounded-xl bg-white p-2 md:p-4`
- table module: `flex h-full min-h-0 flex-col gap-4`

## 4. Header Pattern

Every table module should start with:

- section title
- summary label
- primary action button on the right

Reference text styling:

- title: `text-lg font-semibold text-slate-900`
- summary: `text-sm text-slate-500`

Header layout:

- mobile: stacked
- desktop: `sm:flex-row sm:items-center sm:justify-between`

## 5. Search And Filter Pattern

### Search

The search input is part of the main table toolbar.

Reference behavior:

- controlled input
- debounce: `350ms`
- reset page to `1` when the search input changes
- store the trimmed debounced value in URL state

Reference placeholder:

- `Search by name, email, or phone`

### Filters

The standard advanced filter pattern uses a right-side shadcn `Sheet`.

Reference toolbar controls:

- search input
- `Filters` outline button
- `Clear Filters` outline button

Reference filter sheet structure:

- `SheetHeader`
- section cards inside the sheet body
- `Checkbox` selections
- `SheetFooter` with `Clear` and `Apply Filters`

Filter sections should use:

- `rounded-xl border border-slate-200 bg-white p-4`

Checkbox rows should use:

- `flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-slate-50`

## 6. URL State And Data Flow

The table pattern must keep list state in the URL.

Reference rules:

- search is stored in `search`
- page is stored in `page`
- page size is stored in `pageSize`
- multi-select filters are stored as comma-separated values
- defaults are omitted from the URL when possible

Reference default behavior:

- omit `page` when page is `1`
- omit `pageSize` when page size is `10`
- omit empty filters
- update the URL with `router.replace(..., { scroll: false })`

Page reset rules:

- search change => reset to page `1`
- filter apply => reset to page `1`
- clear filters => reset to page `1`
- rows per page change => reset to page `1`

## 7. Table Structure

The standard table area must be scrollable and live inside a white surface.

Reference structure:

- wrapper: `flex min-h-0 flex-1 flex-col rounded-lg bg-white`
- scroll area: `min-h-0 flex-1 overflow-auto`

Reference shadcn `Table` styling:

- `Table className="[&_td]:py-2 [&_th]:h-8"`

Recommended column rules:

- use `min-w-*` classes on `TableHead`
- use compact `text-xs` table headers
- keep table rows keyboard accessible when rows navigate

## 8. Row Interaction Pattern

If a table row navigates, the entire row must behave like an accessible link.

Reference behavior:

- `tabIndex={0}`
- `role="link"`
- descriptive `aria-label`
- click navigates
- `Enter` and `Space` also navigate

Reference row styling:

- `cursor-pointer transition-colors hover:bg-slate-50 focus-visible:bg-slate-50`

Primary text cells should use:

- `font-medium text-slate-900`

Secondary text cells should use:

- `text-slate-700`

## 9. Status And Badge Pattern

The fallback badge pattern uses a small rounded pill.

Reference fallback badge:

- `inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide bg-slate-100 text-slate-700`

If the backend provides colors, badges should use inline styles:

- `backgroundColor`
- `color`

This is the default pattern for:

- status badges
- tag badges inside filters

## 10. Table States

Every table must implement the three core list states:

- loading
- error
- empty

Reference rendering rules:

- loading row spans all columns
- error row spans all columns
- empty row spans all columns
- states are centered vertically with clear text

Reference text colors:

- loading: `text-slate-500`
- empty: `text-slate-500`
- error: `text-rose-600`

Reference spacing:

- `py-8 text-center`

## 11. Pagination Pattern

All standard tables should use the same pagination behavior as the contacts table.

### Page size

Allowed values:

- `10`
- `25`

Reference UI:

- label: `Rows per page`
- shadcn `Select`
- current value stored in state and URL

### Navigation

Reference controls:

- `Previous` button
- page indicator text
- `Next` button

Reference page label:

- `Page {page} of {totalPages}`

### Summary label

The table header summary and pagination summary should follow:

- no results: `No {entity} found`
- results: `Showing {start}-{end} of {total} {entity}`

### Button state rules

- disable `Previous` on page `1`
- disable `Next` on the last page
- disable pagination buttons while loading

## 12. Color System

All standard tables should reuse the same neutral + blue palette as the contacts table.

### Base surfaces

- primary surface: `bg-white`
- soft surface: `bg-slate-50`
- fallback badge surface: `bg-slate-100`

### Borders

- standard border: `border-slate-200`
- action border: `border-blue-200`

### Text

- primary heading/text: `text-slate-900`
- regular cell text: `text-slate-700`
- secondary/supporting text: `text-slate-600`
- muted helper text: `text-slate-500`
- error text: `text-rose-600`

### Actions

Primary action button:

- `bg-blue-950 text-white hover:bg-blue-950/90`

Secondary outline action:

- `border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950`

Interactive neutral hover:

- `hover:bg-slate-50`

## 13. Implementation Notes

Use these patterns by default for any new table screen:

- white rounded shell
- shadcn table primitives
- top summary and primary action
- debounced search
- optional filter sheet on the right
- URL-synced pagination and filters
- `10` and `25` row size options only
- bottom `Previous / Page X of Y / Next` controls
- slate neutrals with blue action accents

If a screen needs a different structure, it should justify why it cannot follow the contacts-table pattern.
