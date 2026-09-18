# Gestiabloc Page Header Style Guide

This guide defines the shared page-header pattern for contact views, operational registers, and other workflow screens in Gestiabloc. It is based on the current Contact Tasks, Contact Services, Services Enrollments, Transactions, and Follow-ups headers.

The design direction is **calm operational hierarchy**: a soft gradient shell, concise context when it is needed, restrained controls, and optional statistics only when they improve the first scan of the page. Search-heavy registers may use a control-first header without visible helper copy.

Reference implementations:

- `apps/react-ui/app/(tenants)/app/[tenantSlug]/contacts/[contactId]/tasks/page.tsx`
- `apps/react-ui/app/(tenants)/app/[tenantSlug]/contacts/[contactId]/_components/contact-services-panel.tsx`
- `apps/react-ui/app/(tenants)/app/[tenantSlug]/services/enrollments/_components/enrollments-register.tsx`
- `apps/react-ui/app/(tenants)/app/[tenantSlug]/services/transactions/_components/transactions-register.tsx`
- `apps/react-ui/app/(tenants)/app/[tenantSlug]/followups/_components/followups-table.tsx`
- `specs/ui/summary-cards.md`

## Header contract

Every page header contains:

1. A shared gradient shell.
2. One primary hierarchy: either contextual text or register controls.
3. An optional action group.
4. An optional statistics treatment on contextual headers.

Choose the variant that matches the page’s primary job:

| Variant | Use when | Reference |
| --- | --- | --- |
| No statistics | The title and actions provide enough context, or metrics already appear elsewhere | Base header |
| One compact statistic | One count is useful before the user acts | Contact Tasks |
| Statistics grid | Three or four related metrics materially improve the page scan | Contact Services |
| Operational register controls | Search, filtering, and ordering are the user’s primary entry points | Services Enrollments |

Prefer the operational register-controls variant without header statistics. An established register may retain a single four-card, high-signal summary when those metrics materially affect triage, as Transactions and Follow-ups do. Keep the summary and controls inside one gradient shell, place controls directly below the summary, and keep the page heading visually hidden. Do not use a compact statistic and a statistics grid for the same metric.

## Shared shell

Use the same shell for every variant:

```tsx
<header className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
  {/* Header content */}
</header>
```

Shell rules:

- Use `rounded-[26px]` and `border-slate-200` consistently.
- Keep the gradient subtle. It provides separation from the page background without competing with the content.
- Use `p-4 sm:p-5` so the shell remains compact on phones without changing its desktop rhythm.
- Keep all header actions and header-level statistics inside this shell.
- Do not place an additional full-width background card around the header.
- Do not add a decorative leading icon beside the title.

## Contextual text hierarchy

Use this hierarchy for contextual header variants. It communicates where the user is, what the page contains, and what they can do there. Do not add it above an operational register-control header when the route context is already clear.

```tsx
<div className="flex min-w-0 flex-col gap-2">
  <p className="text-xs font-semibold text-blue-700">Contact tasks</p>
  <div className="flex flex-col gap-1">
    <h1 className="text-2xl font-semibold text-slate-950">
      Tasks and follow-through
    </h1>
    <p className="text-sm text-slate-600">
      Review the work, timing, and ownership currently attached to this contact.
    </p>
  </div>
</div>
```

Text rules:

- Use natural title case for the eyebrow.
- Do not use uppercase transforms or expanded letter spacing on the eyebrow.
- Keep the eyebrow short and contextual, such as `Contact tasks` or `Contact services`.
- Use one `h1` per page with `text-2xl font-semibold text-slate-950`.
- Keep the description to one concise sentence.
- Describe the page outcome, not the implementation.
- Use `min-w-0` when the text block shares a row with actions so long copy can wrap safely.

## Base variant: no statistics

This is the default. Use it when statistics would be redundant, low value, or unavailable.

```tsx
<div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs font-semibold text-blue-700">Contact records</p>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-950">Records and activity</h1>
        <p className="text-sm text-slate-600">
          Review and manage the records attached to this contact.
        </p>
      </div>
    </div>

    <div className="flex flex-col gap-3 sm:flex-row sm:items-center md:self-center">
      <Button variant="outline" className="bg-white/80 hover:bg-white">
        Secondary action
      </Button>
      <Button className="bg-blue-950 text-white hover:bg-blue-900">
        Primary action
      </Button>
    </div>
  </div>
</div>
```

Use no statistics when:

- the page has no reliable, high-signal metric;
- the same metric already appears in the navigation or content immediately below;
- only an action and page explanation are needed;
- loading a metric would create unnecessary page-load work;
- a number would not change the user’s next decision.

Do not render an empty statistic container as a placeholder. Remove the statistic markup entirely.

## Operational register-controls variant

Use this variant when the page is a searchable operational register and the page location is already clear from the sidebar and breadcrumbs. The header begins with the search control instead of repeating a visible eyebrow, title, and helper sentence.

When an established register retains four high-signal summary cards, render that grid before the controls inside the same shell. Keep the visible text hierarchy control-first: use an `sr-only` page heading, compact the stat descriptions on small screens, and preserve the same responsive control rows documented below.

Keep one semantic page heading. If the surrounding route does not already render an `h1`, add a visually hidden heading inside the header:

```tsx
<h1 className="sr-only">Enrollments</h1>
```

The layout is stacked below `lg` and becomes one aligned row at `lg` and above:

```tsx
<header className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
  <h1 className="sr-only">Enrollments</h1>

  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
    <form role="search" className="relative w-full lg:min-w-0 lg:flex-1">
      <Input
        type="search"
        placeholder="Search enrollments"
        aria-label="Search enrollments by contact, service, template, or coordinator"
        className="h-11 w-full rounded-xl border-white/80 bg-white/85 pr-14 pl-4 text-sm shadow-sm backdrop-blur placeholder:text-slate-400 focus-visible:border-blue-300 focus-visible:ring-blue-100"
      />
      <Button
        type="submit"
        size="icon-lg"
        aria-label="Search enrollments"
        className="absolute inset-y-0 right-0 h-11 w-12 rounded-l-none rounded-r-xl bg-blue-950 text-white shadow-none hover:bg-blue-900"
      >
        <Search aria-hidden="true" />
      </Button>
    </form>

    <div className="flex min-w-0 items-center justify-between gap-3 lg:shrink-0">
      <Button
        type="button"
        variant="outline"
        aria-expanded={isFilterSheetOpen}
        aria-controls="register-filter-sheet"
        className="h-11 rounded-full border-white/80 bg-white/85 px-3 text-xs font-semibold text-blue-950 shadow-sm backdrop-blur hover:bg-white hover:text-blue-950 sm:text-sm"
      >
        <Filter data-icon="inline-start" aria-hidden="true" />
        Filters
        {/* Optional active-filter count badge */}
      </Button>

      <Button
        type="button"
        variant="outline"
        aria-label={`Sort enrollments, currently ${selectedSortLabel}`}
        aria-expanded={isSortSheetOpen}
        aria-controls="register-sort-sheet"
        className="h-11 min-w-0 max-w-[58vw] rounded-full border-white/80 bg-white/70 px-3 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur hover:bg-white hover:text-slate-950 sm:max-w-none sm:text-sm lg:hidden"
        onClick={() => setIsSortSheetOpen(true)}
      >
        <span className="shrink-0 text-slate-500">Sort by</span>
        <span className="truncate">{selectedSortLabel}</span>
        <ChevronDown data-icon="inline-end" aria-hidden="true" />
      </Button>

      <Select
        value={sort}
        onValueChange={(value) => {
          setSort(parseSort(value))
          setPage(1)
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={`Sort enrollments, currently ${selectedSortLabel}`}
          className="hidden min-w-48 rounded-full border-white/80 bg-white/70 px-3 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur hover:bg-white data-[size=sm]:h-11 lg:flex"
        >
          <span className="text-slate-500">Sort by</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectGroup>{/* Sort options */}</SelectGroup>
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant="outline"
        disabled={!hasAppliedFilters}
        className="hidden h-11 rounded-full border-white/80 bg-white/70 px-3 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur hover:bg-white hover:text-slate-950 md:inline-flex"
        onClick={clearFilters}
      >
        Clear filters
      </Button>
    </div>
  </div>
</header>
```

### Header-control height contract

All visible controls in the register header use the same actual height. Do not rely on visual approximation.

| Control | Required height | Implementation note |
| --- | --- | --- |
| Search input | 44px | Use `h-11` |
| Search submit button | 44px | Use `h-11`; its width may remain `w-12` |
| Filters button | 44px | Use `h-11` on every breakpoint |
| Mobile and tablet Sort button | 44px | Use `h-11` and hide it with `lg:hidden` |
| Desktop Sort select | 44px | Use `data-[size=sm]:h-11`; a plain `h-11` does not override the Select trigger’s internal data-size rule reliably |
| Inline Clear filters button | 44px | Hide below `md`; use `hidden md:inline-flex` |

These 44px controls are a header-specific navigation and query pattern. Buttons in sheet and dialog footers remain the compact 32px `h-8` actions defined in `docs/button-style-guide.md`.

### Search behavior

- Let the search form grow with `lg:flex-1`; keep the Filters and Sort group stable with `lg:shrink-0`.
- Debounce typed search by approximately 300ms, while still allowing the submit button and Enter key to apply immediately.
- Trim the query before placing it in the URL or sending it to the API.
- Keep search, filters, sort, pagination, and page size URL-backed so refresh and Back navigation preserve the view.
- Reset pagination to page 1 whenever search, filter, or sort values change.
- Use an explicit `aria-label` that names the searchable fields when the visible placeholder is intentionally short.

### Filters behavior

- Open filters in the page’s standard filter sheet.
- Show the active-filter count inside a compact badge when one or more filters are applied.
- Below `md`, do not render `Clear filters` in the register toolbar. Keep the narrow action row to Filters and Sort, and place `Clear filters` in the filter-sheet footer.
- At `md` and above, show the inline `Clear filters` action alongside the other register controls.
- Treat `Clear filters` as a confirmed immediate action: clear the applied and draft filter values, reset to page 1, and close the sheet.
- Do not require the user to press `Apply filters` after choosing `Clear filters`.
- Clearing sheet filters does not clear the search query or change the selected sort order.

### Responsive sort behavior

Use one sort state and two responsive controls:

- Below `lg`, show the labeled Sort button and open a bottom sheet.
- At `lg` and above, hide the Sort button and show the inline Select trigger.
- Both controls update the same URL-backed sort value and reset pagination to page 1.
- Preserve the same translucent white surface, pill radius, typography, and 44px trigger height across screen sizes.
- Always show the active sort label in the trigger. Do not fall back to a generic unlabeled icon.

The compact sort sheet rises from the bottom and is limited to its content. It must not take over the full page:

```tsx
<Sheet open={isSortSheetOpen} onOpenChange={setIsSortSheetOpen}>
  <SheetContent
    id="register-sort-sheet"
    side="bottom"
    className="mx-auto max-h-[min(32rem,72dvh)] w-full gap-0 overflow-hidden rounded-t-[26px] border-x border-t border-slate-200 bg-white p-0 sm:bottom-4 sm:left-1/2 sm:right-auto sm:w-[min(32rem,calc(100%-2rem))] sm:-translate-x-1/2 sm:rounded-[26px] sm:border [&>button]:right-5 [&>button]:top-5 [&>button]:rounded-full [&>button]:bg-slate-100 [&>button]:opacity-100"
  >
    <div
      aria-hidden="true"
      className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-slate-200 sm:hidden"
    />
    <SheetHeader className="border-b border-slate-100 px-5 pt-4 pb-3 text-left sm:px-6 sm:pt-5">
      <SheetTitle className="pr-10 text-lg font-semibold text-slate-950">
        Sort enrollments
      </SheetTitle>
    </SheetHeader>

    <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:px-5 sm:pb-5">
      <ToggleGroup
        type="single"
        value={sort}
        orientation="vertical"
        spacing={2}
        aria-label="Choose enrollment order"
        className="grid w-full gap-2"
        onValueChange={(value) => {
          if (!value) return
          setSort(parseSort(value))
          setPage(1)
          setIsSortSheetOpen(false)
        }}
      >
        {/* Use h-12 option rows and mark the selected row with text and a check. */}
      </ToggleGroup>
    </div>
  </SheetContent>
</Sheet>
```

Sort-sheet rules:

- Use `side="bottom"` so the sheet enters from bottom to top.
- Use content-driven height with `max-h-[min(32rem,72dvh)]`; never use `h-full`.
- Use full width only on the smallest screens. From `sm`, cap the width at `32rem` and float it above the bottom edge.
- Keep option rows at `h-12` for an accessible touch target; this does not change the 44px header-control contract.
- Mark the selected option with a text-preserving highlighted row and a check icon.
- Apply the selection immediately, reset pagination, and close the sheet.
- Keep a `SheetTitle` even when a future design visually hides it.

## Compact-stat variant

Use one compact statistic when a single total gives immediate context and no statistics grid is present. The Contact Tasks header is the reference.

```tsx
<div className="flex flex-col gap-3 md:flex-row md:items-center md:self-center">
  <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm">
    <span className="inline-flex items-center gap-2">
      <ClipboardList className="size-4 text-slate-500" aria-hidden="true" />
      <span className="font-semibold tabular-nums text-slate-950">{total}</span>
      tasks
    </span>
  </div>

  <Button className="bg-blue-950 text-white hover:bg-blue-900">
    Create task
  </Button>
</div>
```

Compact-stat rules:

- Show only one statistic.
- Use a short noun after the value: `tasks`, `notes`, or `appointments`.
- Use `tabular-nums` for changing numeric values.
- Keep the icon small, muted, and decorative.
- Do not make the statistic look interactive unless it is a real link or button.
- Do not use this variant when the same count appears in a statistics grid.
- Keep the statistic before the primary action so the action remains the final item in the row.

If the value loads on the client, keep the shell stable:

```tsx
{isLoading ? (
  <Skeleton className="h-4 w-8" />
) : (
  <span className="font-semibold tabular-nums text-slate-950">{total}</span>
)}
```

## Statistics-grid variant

Use a grid when three or four related metrics provide meaningful operational context. The Contact Services header is the reference.

The top row contains only the title and actions. The grid sits below it inside the same gradient shell.

```tsx
<div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs font-semibold text-blue-700">Contact services</p>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-950">
          Services and enrollments
        </h1>
        <p className="text-sm text-slate-600">
          Enroll purchased services and manage their follow-up records.
        </p>
      </div>
    </div>

    <div className="flex flex-col gap-3 sm:flex-row sm:items-center md:self-center">
      <Button variant="outline" className="bg-white/80 hover:bg-white">
        Open AI Qualification
      </Button>
      <Button className="bg-blue-950 text-white hover:bg-blue-900">
        Purchase service
      </Button>
    </div>
  </div>

  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {/* Three or four compact summary cards */}
  </div>
</div>
```

Use the compact detailed card from `specs/ui/summary-cards.md`:

```tsx
<Card className="min-w-0 gap-0 rounded-[22px] border-white/80 bg-white/70 py-0 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-slate-200 hover:bg-white hover:shadow-md">
  <CardHeader className="gap-0 px-4 pt-4 pb-0">
    <CardTitle className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
      <BriefcaseBusiness className="size-4 text-slate-400" aria-hidden="true" />
      Enrolled services
    </CardTitle>
  </CardHeader>
  <CardContent className="px-4 pt-2 pb-4">
    {isLoading ? (
      <Skeleton className="h-7 w-16" />
    ) : (
      <p className="truncate text-xl font-semibold tabular-nums tracking-tight text-slate-950">
        {total}
      </p>
    )}
    <CardDescription className="mt-1 text-xs">
      Active and historical enrollments for this contact.
    </CardDescription>
  </CardContent>
</Card>
```

Statistics-grid rules:

- Use three or four cards; do not add a grid for one metric.
- Use `mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4`.
- Keep each card to one label, one value, and one short helper sentence.
- Use frosted white cards only because the parent shell already provides the gradient.
- Preserve each card’s footprint while loading with a skeleton matching the value width.
- Use semantic value colors sparingly: green for completed or paid, amber for open balances, and slate for neutral totals.
- Do not repeat a grid metric in the top action row.
- Do not place filters inside metric cards. Put page filters below the header shell.

## Actions

Action hierarchy is consistent across every variant:

- Use `h-11` for search, filter, and sort controls in an operational register header. This is a query-control pattern, not the compact action pattern.
- The primary action uses `bg-blue-950 text-white hover:bg-blue-900`.
- A secondary action uses `variant="outline"` with `bg-white/80 hover:bg-white`.
- Place secondary actions before the primary action.
- Use action-oriented labels such as `Create task`, `Purchase service`, or `Open AI Qualification`.
- Keep icons inside action buttons, not beside the page title.
- Disable actions when their required data is unavailable or while their mutation is submitting.
- Preserve visible keyboard focus through the shared shadcn button styles.

## Responsive behavior

The header stacks naturally on smaller screens:

```tsx
<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
  {/* Text */}
  {/* Actions or compact stat + actions */}
</div>
```

Responsive rules:

- Stack text and actions before the `md` breakpoint.
- Keep `gap-4` between the text block and action group.
- Stack actions on narrow screens, then use a horizontal row from `sm` or `md` depending on label length.
- Allow descriptions to wrap; do not truncate meaningful header copy.
- Use two statistics columns from `sm` and four from `xl`.
- Do not force the page header into a horizontally scrollable region.

Operational register-control rules:

- Below `md`, keep search full width on the first row and place only Filters plus Sort in the two-column action row. The sheet footer owns `Clear filters` at this width.
- From `md` through `lg`, keep search on the first row and place Filters, Sort, and the inline Clear filters action on the second row.
- At `lg` and above, place search, Filters, Sort, and Clear filters in one row.
- Let search consume remaining width; do not give Filters or Sort flexible width on desktop.
- Keep every visible register control at 44px high before and after the breakpoint.
- Change only the sort interaction at `lg`: bottom-sheet trigger below it, inline Select at and above it.
- Preserve control colors, borders, radii, typography, and focus treatment across breakpoints.

## Loading and error behavior

- Keep the title, description, and actions visible while statistics load.
- Replace only statistic values with skeletons.
- Do not replace the entire header with a spinner.
- Use the same card or pill dimensions in loading and loaded states to avoid layout shift.
- If optional statistics fail, keep the header usable and show a restrained error near the statistics or fall back to an unavailable state.
- Do not show repeated error toasts for every statistic.

## Accessibility

- Use one semantic `h1` for the page title.
- When an operational register intentionally omits a visible title, keep its `h1` as `sr-only` unless the route layout already supplies the page heading.
- Give the search form `role="search"` and provide a specific accessible label for its input and submit button.
- Add `aria-expanded` and `aria-controls` to Filters and mobile Sort sheet triggers.
- Return focus to the originating trigger when a sheet closes through the shared Sheet behavior.
- Mark decorative icons with `aria-hidden="true"`.
- Ensure buttons and links have visible text or an accessible label.
- Do not communicate a statistic’s meaning through color alone.
- Use readable labels next to every value.
- Add `aria-busy` to the statistics region when its loading state needs to be announced.
- Preserve source order: context first, actions second, optional statistics after the top row.

## Selection checklist

Before implementing a header, answer these questions:

1. Is this primarily a searchable and filterable register? Use the operational register-controls variant.
2. If it is a contextual header, does a statistic change what the user needs to understand or do next?
3. Is there exactly one important count and no grid? Use the compact-stat variant.
4. Are there three or four related, high-signal metrics? Use the statistics-grid variant.
5. Is the metric already visible elsewhere in the header? Remove the duplicate.
6. Are the statistics optional or unreliable? Use the base no-statistics variant.
7. Are search, Filters, and Sort exactly the same rendered height?
8. Does the mobile layout remain readable without horizontal scrolling?

When uncertain on a contextual page, use the base variant without statistics. On a data register, prefer the operational register-controls variant and keep metrics in the content area.
