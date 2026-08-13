# Gestiabloc Page Header Style Guide

This guide defines the shared page-header pattern for contact views and other operational screens in Gestiabloc. It is based on the current Contact Tasks and Contact Services headers.

The design direction is **calm operational hierarchy**: a soft contact-view gradient, concise title copy, restrained actions, and optional statistics only when they improve the first scan of the page.

Reference implementations:

- `apps/react-ui/app/(tenants)/app/[tenantSlug]/contacts/[contactId]/tasks/page.tsx`
- `apps/react-ui/app/(tenants)/app/[tenantSlug]/contacts/[contactId]/_components/contact-services-panel.tsx`
- `specs/ui/summary-cards.md`

## Header contract

Every page header contains:

1. A shared gradient shell.
2. A text hierarchy with eyebrow, title, and description.
3. An optional action group.
4. An optional statistics treatment.

Statistics are not required. Choose one of these variants:

| Variant | Use when | Reference |
| --- | --- | --- |
| No statistics | The title and actions provide enough context, or metrics already appear elsewhere | Base header |
| One compact statistic | One count is useful before the user acts | Contact Tasks |
| Statistics grid | Three or four related metrics materially improve the page scan | Contact Services |

Do not use a compact statistic and a statistics grid for the same metric. The Services header intentionally keeps only its actions in the top row because the enrolled-services count already appears in the grid below.

## Shared shell

Use the same shell for all three variants:

```tsx
<div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
  {/* Header content */}
</div>
```

Shell rules:

- Use `rounded-[26px]` and `border-slate-200` consistently.
- Keep the gradient subtle. It provides separation from the page background without competing with the content.
- Use `p-5` for standard contact-view headers.
- Keep all header actions and header-level statistics inside this shell.
- Do not place an additional full-width background card around the header.
- Do not add a decorative leading icon beside the title.

## Text hierarchy

The left side communicates where the user is, what the page contains, and what they can do there.

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
<div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
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
<div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
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

## Loading and error behavior

- Keep the title, description, and actions visible while statistics load.
- Replace only statistic values with skeletons.
- Do not replace the entire header with a spinner.
- Use the same card or pill dimensions in loading and loaded states to avoid layout shift.
- If optional statistics fail, keep the header usable and show a restrained error near the statistics or fall back to an unavailable state.
- Do not show repeated error toasts for every statistic.

## Accessibility

- Use one semantic `h1` for the page title.
- Mark decorative icons with `aria-hidden="true"`.
- Ensure buttons and links have visible text or an accessible label.
- Do not communicate a statistic’s meaning through color alone.
- Use readable labels next to every value.
- Add `aria-busy` to the statistics region when its loading state needs to be announced.
- Preserve source order: context first, actions second, optional statistics after the top row.

## Selection checklist

Before implementing a header, answer these questions:

1. Does a statistic change what the user needs to understand or do next?
2. Is there exactly one important count and no grid? Use the compact-stat variant.
3. Are there three or four related, high-signal metrics? Use the statistics-grid variant.
4. Is the metric already visible elsewhere in the header? Remove the duplicate.
5. Are the statistics optional or unreliable? Use the base no-statistics variant.
6. Does the mobile layout remain readable without horizontal scrolling?

When uncertain, use the base variant without statistics. Add statistics only when they improve decision-making rather than decorate the header.
