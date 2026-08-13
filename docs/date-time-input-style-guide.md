# Gestiabloc Date and Time Input Style Guide

This guide defines the shared date and time input pattern for Gestiabloc forms. Use it for tasks, appointments, opportunities, follow-ups, reminders, and other workflows that collect a calendar date, a time, or a timeline.

The design direction is **compact timeline clarity**: date and time remain distinct concepts, but they read as one connected control. Labels align with their segments, related dates share a row when space permits, and validation explains chronological relationships in plain language.

Reference implementations:

- `apps/react-ui/components/ui/date-time-input.tsx`
- `apps/react-ui/app/(tenants)/app/[tenantSlug]/tasks/_components/create-task-dialog.tsx`

## Component contract

Use the shared `DateTimeInput` instead of assembling separate date and time inputs in each form.

```tsx
type DateTimeDraft = {
  date: string
  time: string
}

<DateTimeInput
  id="task-start-date"
  timeId="task-start-time"
  value={startedAt}
  onValueChange={setStartedAt}
  disabled={isSubmitting}
  ariaInvalid={Boolean(errors.startedAt)}
  timezone={tenantTimezone}
  layout="joined"
/>
```

Component rules:

- Store the editable value as a `DateTimeDraft`; do not build an ISO timestamp on every keystroke.
- Pass stable and unique IDs for both segments using `id` and `timeId`.
- Use `layout="joined"` in modern dialogs and sheets.
- Use `hideTime` only when the workflow genuinely stores a date without a time.
- Use `timeStepMinutes` when the workflow requires a fixed time interval.
- Disable the entire control during submission.
- Pass `ariaInvalid` when either segment makes the field invalid.
- Convert the completed local draft to UTC at the request boundary using the tenant timezone.

## Visual structure

The joined control contains two connected segments:

```text
Date label                         Time label
┌──────────────────────────┬──────────────────┐
│ MM/DD/YYYY            ▣  │  ◷  09:00 AM    │
└──────────────────────────┴──────────────────┘
```

The date segment is wider because formatted dates and their calendar affordance need more space. The time segment remains compact but must not be narrower than `7.5rem`.

```tsx
<div className="grid grid-cols-[minmax(0,1.35fr)_minmax(7.5rem,0.8fr)] gap-0">
  <FieldLabel htmlFor="task-start-date">
    Start date <span className="text-rose-500" aria-hidden="true">*</span>
  </FieldLabel>
  <FieldLabel htmlFor="task-start-time">
    Time <span className="text-rose-500" aria-hidden="true">*</span>
  </FieldLabel>
</div>
```

Visual rules:

- Use a total control height of `h-11`, matching other form inputs.
- Use `rounded-l-xl` on the date segment and `rounded-r-xl` on the time segment.
- Use one shared seam; the time segment uses `border-l-0`.
- Use `bg-slate-50/60` with `border-slate-200` on the working surface.
- Keep the calendar button inside the date segment and separate it with a subtle left border.
- Place the clock icon inside the time segment.
- Use blue focus borders and rings from the dialog palette.
- Do not wrap the joined control in a background card.
- Do not use uppercase labels or expanded letter spacing.

## Labels and optional states

Each segment needs a visible label. Use product language that identifies the field's role in the workflow.

```tsx
<div className="grid grid-cols-[minmax(0,1.35fr)_minmax(7.5rem,0.8fr)] gap-0">
  <FieldLabel htmlFor="task-reminder-date">
    Reminder date
    <span className="text-xs font-normal text-slate-500">Optional</span>
  </FieldLabel>
  <FieldLabel htmlFor="task-reminder-time">Time</FieldLabel>
</div>
```

Label rules:

- Use `Start date`, `Due date`, `End date`, or `Reminder date` instead of the generic `Date` when context matters.
- Label the second segment `Time`.
- Mark required fields with a restrained rose asterisk.
- Mark optional fields with `Optional` in muted text beside the date label.
- Do not repeat `Optional` above both segments; date and time form one field.
- Do not place placeholder text where a persistent label is required.

## Timeline layout

When a form collects a start and due/end value, treat them as the primary timeline. Place them in the same responsive row, then place Reminder beneath them as a secondary action.

```tsx
<FieldGroup className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
  <Field className="min-w-0 gap-2">
    {/* Start date and time */}
  </Field>

  <Field className="min-w-0 gap-2">
    {/* Due or end date and time */}
  </Field>

  <Field className="min-w-0 gap-2 border-t border-slate-200 pt-4 sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
    {/* Reminder date and time */}
  </Field>
</FieldGroup>
```

Timeline rules:

- Start and Due/End share a row at `sm` widths and above.
- Stack all timeline fields on narrow screens.
- Keep Reminder beneath Start and Due/End to preserve chronological hierarchy.
- Keep Reminder approximately one column wide on larger sheets.
- Use a simple top divider before Reminder; do not add a card or tinted background.
- Use `min-w-0` on each field so the segmented control can shrink safely.

## Validation and chronological constraints

Validate the complete date-time value, not only its calendar date. Two values on the same day can still be in the wrong order.

For a task timeline:

```text
Start <= Reminder <= Due
Start <= Due
```

Rules:

- Start is required when it defines when work begins.
- Due/End cannot occur before Start.
- A Reminder requires a Due/End value.
- Reminder must fall within the inclusive Start–Due/End window.
- An incomplete draft containing only a date or only a time is invalid.
- Clear a field's error when that field changes.
- When Start changes, also clear and revalidate dependent Due/End and Reminder errors.
- When Due/End changes, also clear and revalidate the Reminder error.
- Use `disabledDate` to prevent obviously invalid calendar selections, but retain timestamp validation for same-day time conflicts and typed values.

Recommended messages:

| Condition | Message |
| --- | --- |
| Missing required start | `Choose a start date and time.` |
| Incomplete value | `Enter both a date and time.` |
| Due before start | `Due date must be at or after the start date.` |
| Reminder without due | `Choose a due date before adding a reminder.` |
| Reminder before start | `Reminder must be at or after the start date.` |
| Reminder after due | `Reminder must be at or before the due date.` |

Render the message with `FieldError` and connect the invalid state to the complete joined control.

```tsx
<Field data-invalid={Boolean(errors.dueDate)} data-disabled={isSubmitting}>
  {/* Labels and DateTimeInput */}
  <FieldError>{errors.dueDate}</FieldError>
</Field>
```

## Timezones and serialization

The displayed value represents local wall-clock time in the tenant timezone. The API payload should continue using UTC ISO timestamps.

```ts
const startedAtIso = dateTimeDraftToUtcIso(startedAt, tenantTimezone)
```

Timezone rules:

- Use the tenant timezone consistently for defaults, editing, validation, and serialization.
- Do not construct timestamps by passing an interpolated date-and-time string directly to `new Date()` because parsing varies by browser and machine timezone.
- Do not display UTC values directly in form controls.
- Compare normalized timestamps when enforcing chronological relationships.
- Preserve the existing API field names and payload contract when changing only the UI.
- If the tenant timezone is unavailable, use the application's established fallback rather than inventing one in the component.

## Accessibility and interaction

- Associate the date and time labels with their respective inputs using `htmlFor`, `id`, and `timeId`.
- Keep the calendar trigger keyboard accessible and give it an explicit `aria-label`.
- Preserve native keyboard behavior for the time input.
- Use `aria-invalid` on both segments when the combined value is invalid.
- Do not communicate required, optional, disabled, or error states by color alone.
- Keep a visible focus ring around the active segment.
- Disable date input, calendar trigger, and time input together during submission.
- Ensure touch targets are at least `h-11` in form sheets and dialogs.

## Responsive behavior

- A joined control remains connected at all widths; do not stack its date and time segments independently.
- The fields around the control may stack from two columns to one.
- Use full available width on mobile.
- Avoid fixed pixel widths for the complete control.
- Test at the sheet's narrow mobile width and its desktop `sm:max-w-2xl` width.
- Long validation messages must wrap without widening the sheet or causing horizontal scrolling.

## Review checklist

Before merging a date/time form, verify:

- Date and Time have separate, correctly associated labels.
- The control height matches adjacent text inputs and selects.
- Joined borders, corner radii, and focus states render as one control.
- Start and Due/End align on desktop and stack on mobile.
- Reminder follows the same joined style beneath the primary timeline.
- Required and optional states are understandable without relying on placeholder text.
- Due/End cannot precede Start, including on the same day.
- Reminder cannot fall outside the Start–Due/End window.
- Calendar restrictions and submit-time validation agree.
- Values are interpreted using the tenant timezone and serialized to UTC.
- Every editable segment is disabled while submitting.
- ESLint, frontend TypeScript, and the production build pass.
