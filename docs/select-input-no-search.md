# Gestiabloc Select Input — No Search

This guide defines the shared select pattern for short, fixed option lists that do not need search. Use it for operational choices such as a checklist status, payment mode, or another small enum where every option can be scanned immediately.

The design direction is **compact choice recognition**: the selected value should be easy to identify, the complete option list should be visible as soon as the menu opens, and the control should not introduce a search field that adds no value.

Reference implementation:

`apps/react-ui/app/(tenants)/app/[tenantSlug]/contacts/[contactId]/_components/contact-service-details-panel.tsx`

Related guidance:

- `docs/status-input-style-guide.md` for status colors and form integration.
- `docs/assignee-input-style-guide.md` for searchable people selectors.

## When to use this pattern

Use a no-search select when:

- The values are fixed by the product or API.
- There are two to seven options.
- Every option has a short, recognizable label.
- Users benefit from seeing the entire list immediately.

Use a searchable `Popover` and `Command` instead when the list is dynamic, can grow beyond seven options, contains people or records that need disambiguation, or cannot be scanned comfortably without filtering.

Do not place `CommandInput`, search filtering, or a search-empty state inside a fixed-option select.

## Component contract

Use the shared shadcn `Select`. Keep option values stable and keep display metadata in the option object.

```tsx
type FixedOption = {
  value: string
  label: string
  className?: string
}

const options: FixedOption[] = [
  {
    value: "NOT_RECEIVED",
    label: "Not received",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  },
  {
    value: "INFORMED",
    label: "Informed",
    className: "border-blue-200 bg-blue-100 text-blue-800",
  },
]
```

Component rules:

- Use the API value as the selected value, never the display label.
- Keep the selector controlled with `value` and `onValueChange`.
- Disable the complete selector while its update is running.
- Do not optimistically replace the selected value when failure must preserve the saved state.
- Keep every `SelectItem` inside `SelectGroup`.
- Do not add `Command`, `CommandInput`, or client-side filtering.

## Visual structure

For compact status selectors, match the established header status treatment:

```text
┌──────────────────┐
│ Informed      ⌄  │
└──────────────────┘
```

- Use `h-8`, `rounded-full`, `px-3`, and `text-xs font-semibold`.
- Use the selected option's background and text colors on the trigger.
- Add a restrained `shadow-sm` and `ring-1 ring-black/5`.
- Truncate the selected label and cap the trigger at `220px`.
- Keep the dropdown near `240px` wide and cap it to the viewport.
- Render option labels as compact colored `Badge` pills.
- Use the Select's built-in check indicator for the selected option.
- Do not add a decorative leading icon or status dot when the colored label already communicates the state.

## Reusable shadcn example

```tsx
<Select value={value} onValueChange={onValueChange} disabled={disabled}>
  <SelectTrigger
    size="sm"
    aria-label={ariaLabel}
    aria-busy={isSaving}
    className={cn(
      "h-8 w-fit min-w-0 max-w-full rounded-full px-3 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/5 [&_[data-slot=select-value]]:truncate sm:max-w-[220px]",
      selectedOption.className,
    )}
  >
    <SelectValue>{selectedOption.label}</SelectValue>
  </SelectTrigger>

  <SelectContent
    position="popper"
    align="end"
    className="w-[240px] max-w-[calc(100vw-2rem)]"
  >
    <SelectGroup>
      {options.map((option) => (
        <SelectItem
          key={option.value}
          value={option.value}
          className="cursor-pointer gap-2 px-3 py-2"
        >
          <Badge
            variant="outline"
            className={cn(
              "max-w-[170px] truncate rounded-full px-2 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/5",
              option.className,
            )}
          >
            {option.label}
          </Badge>
        </SelectItem>
      ))}
    </SelectGroup>
  </SelectContent>
</Select>
```

## Loading, disabled, and failure behavior

- Disable every related selector while one mutation is running when only one update may occur at a time.
- Set `aria-busy="true"` on the active trigger.
- Place a visible spinner adjacent to the active selector without changing its width.
- Keep the saved value visible until the request succeeds.
- On failure, leave the menu context intact when possible, retain the previous value, and show the product's standard error toast or inline error.
- If the selector sits inside a sheet or dialog that cannot close during saving, guard dismissal and disable its footer close action too.

## Accessibility and keyboard interaction

- Give the trigger a visible label or a descriptive `aria-label`.
- Preserve the shadcn Select's arrow-key, Enter, Escape, and focus-return behavior.
- Keep labels understandable without relying on color.
- Maintain visible focus contrast against every possible selected background.
- Expose disabled and busy states programmatically.
- Do not replace the native Select composition with clickable `div` elements.

## Responsive behavior

- Use `max-w-full` on the trigger so long labels cannot widen a sheet or dialog.
- Truncate both selected values and menu badges.
- Cap dropdown width with `max-w-[calc(100vw-2rem)]`.
- Keep the compact pill aligned with its row on desktop and allow its container to wrap below primary text on narrow screens.

## Review checklist

Before merging a no-search select, verify:

- No search input or filtering state is rendered.
- Every fixed option is visible when the menu opens.
- The selected option has a check indicator.
- Trigger and menu labels use the correct state treatment.
- Long labels cannot widen the containing sheet or dialog.
- Mouse and keyboard selection both work.
- Focus returns to the trigger after selection or dismissal.
- Busy, disabled, success, and failure states preserve the saved value correctly.
