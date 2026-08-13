# Gestiabloc Status Input Style Guide

This guide defines the shared status input pattern for Gestiabloc forms. Use it when a user assigns or changes the workflow state of a task, opportunity, contact, service, follow-up, or another operational record.

The design direction is **compact state recognition**: the selected status should be recognizable at a glance, use the configured status color, and remain the same height as adjacent form controls.

Reference implementations:

- `apps/react-ui/app/(tenants)/app/[tenantSlug]/tasks/_components/task-status-select.tsx`
- `apps/react-ui/app/(tenants)/app/[tenantSlug]/tasks/_components/create-task-dialog.tsx`

## Component contract

Use a domain-specific status selector around the shared shadcn `Select`. Do not rebuild status styling in every form.

```tsx
export type StatusOption = {
  label: string
  value: string
  bgColor?: string
  textColor?: string
}

<TaskStatusSelect
  id="create-task-status"
  value={statusConfigId ?? "__none__"}
  onValueChange={(value) => {
    setStatusConfigId(value === "__none__" ? undefined : value)
    setErrors((current) => ({ ...current, status: undefined }))
  }}
  options={selectableStatuses}
  disabled={isSubmitting}
  ariaInvalid={Boolean(errors.status)}
  noneValue="__none__"
  noneLabel="No status"
/>
```

Component rules:

- Use the status configuration ID as the selected value, not the display label.
- Keep display labels and colors in the option object.
- Preserve the existing API field name and payload contract.
- Exclude filter-only values such as `ALL` from form options.
- Support a domain-appropriate empty choice such as `No status` when status is optional.
- Clear the field error when the value changes.
- Disable the complete selector while the form is submitting.

## Visual structure

The trigger is a compact state surface. The menu uses colored pills so users can scan available states without turning the entire menu into large color blocks.

```text
Status
┌──────────────────────────┐
│ In progress          ⌄   │
└──────────────────────────┘
```

Visual rules:

- Use `h-11` and `rounded-xl` so Status matches Assignee and standard text inputs.
- Use `w-full` so the control fills its field column.
- Use `px-3` and `shadow-none` for the trigger.
- Use the configured background and text colors for a selected status.
- Use a neutral slate background and text color for `No status` or missing color data.
- Keep menu items at `py-2.5` with `rounded-xl` hit areas.
- Render each menu label as a compact rounded pill.
- Do not add a decorative leading icon.
- Do not use status colors for unrelated concepts such as priority or validation.

## Status color contract

Status colors are configuration data. The form must display the same status color used in task lists, opportunity boards, and record details.

```tsx
style={
  selectedStatus?.bgColor && selectedStatus.textColor
    ? {
        backgroundColor: selectedStatus.bgColor,
        color: selectedStatus.textColor,
      }
    : {
        backgroundColor: "#F1F5F9",
        color: "#334155",
      }
}
```

Color rules:

- Use both configured `bgColor` and `textColor` together.
- Fall back to neutral slate when either configured color is missing.
- Maintain readable contrast between the text and background.
- Keep colors light enough for a form surface; status text must remain legible.
- Do not hard-code a meaning such as green equals complete inside the component. Status meaning comes from tenant configuration.
- Reserve rose error styling for validation; an error must not overwrite the selected status meaning without an accompanying message.

## Form integration

Wrap the selector in `Field` and connect its label, disabled state, invalid state, and error message.

```tsx
<Field
  data-invalid={Boolean(errors.status)}
  data-disabled={isSubmitting}
  className="gap-2"
>
  <FieldLabel htmlFor="record-status">Status</FieldLabel>
  <TaskStatusSelect
    id="record-status"
    value={statusId ?? "__none__"}
    onValueChange={handleStatusChange}
    options={statusOptions}
    disabled={isSubmitting}
    ariaInvalid={Boolean(errors.status)}
  />
  <FieldError>{errors.status}</FieldError>
</Field>
```

Form rules:

- Put `data-invalid` and `data-disabled` on `Field`.
- Pass `ariaInvalid` and `disabled` to the status component.
- Use one visible `FieldLabel` associated through `htmlFor` and `id`.
- Keep guidance short; most configured statuses do not need a description.
- Map server errors such as an invalid tenant status back to `FieldError`.
- Do not silently fall back to another status after the user submits an invalid selection.

## Ownership row layout

Assignee is the primary identity choice and Status is the compact workflow choice. Give Assignee more horizontal space when they share a row.

```tsx
<FieldGroup className="gap-4 sm:grid sm:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)]">
  <Field>{/* Assignee */}</Field>
  <Field>{/* Status */}</Field>
</FieldGroup>
```

Layout rules:

- Stack Assignee and Status on narrow screens.
- Place them on one row at `sm` widths and above.
- Keep both triggers exactly `h-11`.
- Use `minmax(0, ...)` tracks to allow long names and labels to truncate safely.
- Do not force Status to match the wider Assignee column.

## Accessibility and interaction

- Associate the label with the `SelectTrigger` using matching `htmlFor` and `id`.
- Preserve native shadcn Select keyboard navigation.
- Expose invalid state with `aria-invalid`, not color alone.
- Keep a visible focus treatment against every possible configured background.
- Disable the selector during submission.
- Place every `SelectItem` inside `SelectGroup`.
- Use clear labels that are understandable without relying on the status color.

## Review checklist

Before merging a status input, verify:

- The trigger height matches Assignee and adjacent inputs.
- The selected status uses the configured label and colors.
- The neutral state remains readable and clearly named.
- All selectable items are inside `SelectGroup`.
- Filter-only options are excluded.
- Long labels do not widen the sheet or dialog.
- Keyboard selection and focus behavior work.
- Disabled and invalid states are programmatically exposed.
- Server validation errors render beneath the field.
- The selected configuration ID submits unchanged.

