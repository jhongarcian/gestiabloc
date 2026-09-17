# Gestiabloc Progress Bar Style Guide

This guide defines the shared progress-bar treatment for Gestiabloc operational interfaces. Use it when a user needs to understand determinate completion at a glance, such as checklist readiness, onboarding progress, or another count-based workflow.

The design direction is **visible operational completion**: a pale emerald track, a darker emerald completion fill, persistent percentage and count labels, and a smooth transition when progress changes.

Reference implementation:

- `apps/react-ui/components/ui/labeled-progress.tsx`
- `apps/react-ui/app/(tenants)/app/[tenantSlug]/services/enrollments/[contactServiceId]/_components/contact-service-details-panel.tsx`

## Component contract

Use `LabeledProgress` for a prominent, determinate progress summary. Provide the numeric percentage separately from the human-readable accessible description.

```tsx
<LabeledProgress
  value={completionPercentage}
  ariaLabel="Checklist completion"
  ariaValueText={`${completionPercentage}% complete, ${completedCount} of ${totalCount} items`}
  summaryLabel={`${completedCount} of ${totalCount} items`}
/>
```

Props:

| Prop | Purpose |
| --- | --- |
| `value` | Numeric completion from 0 through 100. The component clamps values outside this range. |
| `ariaLabel` | Concise accessible name for the progress indicator. |
| `ariaValueText` | Complete spoken description of percentage and operational meaning. |
| `summaryLabel` | Optional visible count displayed at the right edge. |
| `size` | `default` for primary progress or `compact` for secondary operational summaries. |
| `className` | Layout-only additions such as `mt-3`; do not override the visual contract. |

## Visual anatomy

The standard labeled progress bar contains three layers:

1. A 28px rounded emerald track.
2. A darker emerald completion fill that clearly distinguishes completed progress from the remaining track.
3. Two foreground pills: percentage on the left and an optional count on the right.

The shared implementation uses:

```tsx
<Progress
  value={value}
  className="h-7 border border-emerald-100/80 bg-emerald-50/80
    [&_[data-slot=progress-indicator]]:bg-emerald-600"
/>
```

Visual rules:

- Keep the track at `h-7`; this variant is intentionally more prominent than compact summary bars.
- Use the darker emerald fill only for positive completion, not errors or destructive states.
- Keep the percentage pill medium emerald with white text.
- Keep the count pill white with muted dark emerald text.
- Use `tabular-nums` for both pills so changing values remain visually stable.
- Do not place another percentage label immediately above or beside the bar.
- Keep the component on a surface wide enough for both pills. Use only the percentage pill when a second label would overlap.

## Data and state

Progress must derive from the same current collection that renders the related items.

```tsx
const completedCount = items.filter((item) => item.status === "RECEIVED").length
const completionPercentage = items.length
  ? Math.round((completedCount / items.length) * 100)
  : 0
```

State rules:

- Use one live source of truth for the item rows, completed count, and percentage.
- Update local state after a successful mutation so the bar and rows change together.
- Recalculate the percentage when either the completed count or total changes.
- Render `0%` for an empty or not-started collection; never divide by zero.
- Clamp unexpected values to the 0–100 range inside the shared component.
- Do not use this determinate component for unknown-duration loading. Use a spinner or skeleton instead.

## Motion

The completion indicator transitions over 700ms with an ease-out curve.

```tsx
className="[&_[data-slot=progress-indicator]]:transition-transform
  [&_[data-slot=progress-indicator]]:duration-700
  [&_[data-slot=progress-indicator]]:ease-out
  motion-reduce:[&_[data-slot=progress-indicator]]:transition-none"
```

Motion rules:

- Animate only the indicator transform; do not animate the surrounding card or labels.
- Update labels immediately while the fill moves toward the new value.
- Respect `prefers-reduced-motion` by removing the transition.
- Do not replay the animation on unrelated re-renders.

## Compact labeled progress bars

Use `size="compact"` for secondary operational progress such as payment collection and follow-up completion. It keeps the same emerald completion fill and two-label structure at a smaller 20px height.

```tsx
<LabeledProgress
  value={percentage}
  ariaLabel="Payment collection progress"
  ariaValueText={`${percentage}% complete, ${collectedLabel} collected of ${totalLabel}`}
  summaryLabel={`${collectedLabel} collected`}
  size="compact"
/>
```

Compact rules:

- Use `h-5` for the track and smaller foreground pills.
- Keep the embedded percentage because a thin unlabeled line is harder to interpret.
- Keep the summary concise, such as `3 of 5 steps` or `$400 collected`.
- Use the default size for the primary checklist progress treatment.
- Do not manually recreate compact sizing at each call site; use the `size` prop.
- If the surrounding control is too narrow for both pills, omit `summaryLabel` and retain the accessible value text.

Use the base shadcn `Progress` component without foreground pills for transient utility progress, such as an upload inside a compact form row. Those indicators describe an active operation rather than persistent business completion.

## Accessibility

- Keep the Radix/shadcn progress primitive so `role="progressbar"` and value semantics remain intact.
- Always provide `ariaLabel` and a descriptive `ariaValueText`.
- Include both percentage and count in `ariaValueText` when both are meaningful.
- Mark the visible percentage and count pills `aria-hidden="true"` because the progress primitive already announces their information.
- Do not rely on green fill alone; the percentage and count remain visible as text.
- Maintain sufficient contrast for both foreground pills.
- Respect reduced-motion preferences.

## Review checklist

Before reusing the progress bar, verify:

- The fill width matches the displayed percentage.
- The row states, completed count, and percentage use the same live data.
- The fill animates after an in-place update.
- The layout does not allow the percentage and count pills to overlap.
- Screen readers receive a useful label and complete value description.
- Reduced-motion mode disables the transition.
- Empty and 100% states remain readable.
