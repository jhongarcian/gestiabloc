# Gestiabloc Primary and Secondary Button Style Guide

This guide defines the shared primary and secondary button treatment for Gestiabloc operational interfaces. Use it for inline editors, compact action rows, page headers, sheets, dialogs, and other places where users confirm or dismiss a focused action.

The design direction is **compact operational confidence**: actions use a small pill shape, clear visual priority, restrained shadows, and predictable hover, focus, loading, and disabled behavior.

Reference implementation:

`apps/react-ui/app/(tenants)/app/[tenantSlug]/services/enrollments/[contactServiceId]/_components/contact-service-details-panel.tsx`

Related guidance:

- `docs/header-style-guide.md` for page-header placement and action grouping.
- `docs/dialog-style-guide.md` for persistent dialog and sheet action areas.
- `docs/assignee-input-style-guide.md` for assignment controls placed beside a save action.

## Button hierarchy

Use the button type that matches the consequence of the action:

| Type | Purpose | Examples |
| --- | --- | --- |
| Primary | Confirms the main change in the current context | Save assignee, Save changes, Create note |
| Secondary | Dismisses, returns, or opens a lower-priority interaction | Update step, Cancel, Close, Previous |

Rules:

- Use one primary action per compact action group.
- Place the primary action after secondary actions in the DOM and visually on the right.
- Do not use primary styling for navigation, disclosure, or neutral utility actions.
- Use destructive styling instead of primary styling for permanent deletion.
- Keep labels action-oriented and concise: `Save changes`, `Create task`, `Add payment`, or `Close`.

## Shared compact shape

Primary and secondary buttons use the same structural treatment:

- `h-8` for a compact 32px control.
- `rounded-full` for the pill shape.
- `px-3 py-1` for balanced horizontal and vertical padding.
- `text-xs font-semibold` for compact but readable labels.
- `shadow-sm` for restrained separation from the surface.
- `shrink-0` when the button sits beside an input.
- `cursor-pointer` for every enabled action.
- Visible focus treatment from the shared shadcn `Button` component.

Do not mix a compact pill button with a tall rectangular save button in the same workflow.

## Primary button

Use the navy primary treatment for the main confirming action.

```tsx
const COMPACT_PRIMARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"

<Button
  type="button"
  variant="ghost"
  className={COMPACT_PRIMARY_BUTTON_CLASS}
  disabled={isSaving}
  onClick={saveChanges}
>
  {isSaving ? (
    <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
  ) : null}
  {isSaving ? "Saving" : "Save changes"}
</Button>
```

Primary rules:

- Use `bg-blue-950 text-white` with `hover:bg-blue-900`.
- Add `ring-1 ring-black/5` so the pill remains defined on pale and white surfaces.
- Keep the button visible while saving and replace the leading icon with a spinner.
- Disable repeated submission while the request is active.
- When a save action is conditional, render it only after a real change exists.
- If the label changes during loading, consider a stable minimum width when the shift is visually distracting.

## Secondary button

Use an outlined white pill for cancel, close, and other lower-priority actions.

```tsx
const COMPACT_SECONDARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

<Button
  type="button"
  variant="outline"
  className={COMPACT_SECONDARY_BUTTON_CLASS}
  disabled={isSaving}
  onClick={closeEditor}
>
  Cancel
</Button>
```

Secondary rules:

- Use `variant="outline"` as the base.
- Keep the text neutral with `text-slate-700` and strengthen it only on hover.
- Do not give secondary actions the navy fill used by the primary action.
- Use the secondary pill for `Update step` when it opens an inline editor; the editor's final `Save changes` action remains primary.
- Disable Cancel or Close when dismissing would interrupt an active mutation.
- Do not add an icon when the text label is already clear.

### Secondary button on a tinted header

When the button sits on the shared contact or service header gradient, use the translucent header surface:

```tsx
<Button
  type="button"
  variant="ghost"
  className="h-8 shrink-0 cursor-pointer rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:bg-white/90 hover:text-slate-950"
>
  Secondary action
</Button>
```

Use the standard outlined white version inside plain white content, dialogs, and sheets. Do not use `border-white/70` on a white surface because the boundary will disappear.

## Primary and secondary action group

Keep related actions in one row when space allows. The primary action comes last.

```tsx
<div className="flex flex-wrap items-center justify-end gap-2">
  <Button
    type="button"
    variant="outline"
    className={COMPACT_SECONDARY_BUTTON_CLASS}
    disabled={isSaving}
    onClick={onCancel}
  >
    Cancel
  </Button>
  <Button
    type="submit"
    variant="ghost"
    className={COMPACT_PRIMARY_BUTTON_CLASS}
    disabled={!hasChanges || isSaving}
  >
    {isSaving ? (
      <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
    ) : null}
    {isSaving ? "Saving" : "Save changes"}
  </Button>
</div>
```

Grouping rules:

- Use `gap-2`; do not use margin utilities to create spacing between actions.
- Keep both buttons the same height and pill radius.
- Allow wrapping on narrow screens rather than shrinking labels until they become unreadable.
- When a save button sits beside an input, use `grid-cols-[minmax(0,1fr)_auto]` and `items-center` so the input can shrink while the button remains stable.
- Keep helper and error text below the input/action row so they do not change button alignment.

## Icons and loading

- Use Lucide icons through the existing project icon library.
- Icons inside `Button` use `data-icon="inline-start"` or `data-icon="inline-end"`.
- Do not manually size icons inside a button; let the shared component control icon size.
- Use `Loader2` with `animate-spin` for active mutations.
- Keep loading copy specific: `Saving`, `Creating`, `Updating`, or `Uploading`.
- Do not show both a normal leading icon and a spinner at the same time.

## Disabled and conditional behavior

- Use the native `disabled` attribute so pointer and keyboard interaction are blocked consistently.
- Use `disabled:cursor-not-allowed` for explicit cursor feedback.
- Disable the primary action when required input is invalid or a request is active.
- Disable secondary dismissal while an active request must not be interrupted.
- Hide a contextual save action until the edited value differs from the saved value.
- Add a no-change guard in the save handler even when the button is conditionally hidden.
- Preserve entered values when a request fails so the user can retry.

## Accessibility

- Use a native shadcn `Button`, not a clickable `div` or `span`.
- Keep visible text on standard primary and secondary buttons.
- Give icon-only actions an `aria-label` and tooltip; icon-only controls are a separate quick-action pattern.
- Preserve the shared focus-visible ring.
- Mark decorative icons and spinners with `aria-hidden="true"` when the button text communicates the action or loading state.
- Ensure disabled state is communicated with the native `disabled` attribute, not color alone.
- Keep action order logical for keyboard users: secondary first, primary last.

## Responsive behavior

- Keep compact buttons at `h-8` across breakpoints.
- Use `shrink-0` beside inputs so the action label does not collapse.
- Let the adjacent input use `min-w-0` and truncate its selected value.
- Allow an action group to wrap when the viewport cannot support both labels comfortably.
- In dialog and sheet footers, follow the responsive action ordering defined in `docs/dialog-style-guide.md`.

## Review checklist

Before merging primary or secondary buttons, verify:

- Primary and secondary buttons share `h-8`, `rounded-full`, and compact typography.
- Only the main confirming action uses the navy primary fill.
- Secondary actions remain outlined or translucent white.
- Enabled actions use `cursor-pointer`.
- Loading and disabled states prevent duplicate or interrupting actions.
- Conditional save actions appear only after a real change.
- Icons use the shared button icon contract.
- Focus remains visible and keyboard order follows the visual order.
- Buttons remain aligned beside inputs and wrap safely on narrow screens.
