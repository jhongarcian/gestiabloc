# Gestiabloc Assignee Input Style Guide

This guide defines the shared assignee input pattern for Gestiabloc record pages and forms. Use it when a task, appointment, opportunity, contact, service, follow-up, or other record can be owned by a tenant user.

The design direction is **identity before metadata**: show the person's avatar and full name first, use email only as supporting context, and make unassigned ownership explicit.

Reference implementations:

- `apps/react-ui/components/assignee-input.tsx`
- `apps/react-ui/app/(tenants)/app/[tenantSlug]/tasks/_components/task-assignee-input.tsx`
- `apps/react-ui/app/(tenants)/app/[tenantSlug]/services/enrollments/[contactServiceId]/_components/contact-service-details-panel.tsx`

Related guidance:

- Use `docs/button-style-guide.md` for adjacent Save, Cancel, and other compact actions.

## Data contract

Assignee options must provide a stable user identifier and the user's full display name.

```ts
type AssigneeOption = {
  value: string
  label: string
  email?: string
  image?: string | null
}
```

Data rules:

- Use the user ID as `value`.
- Use the user's first and last name as `label` whenever both are available.
- Do not display only an email address when a user name exists.
- Use email as secondary information to distinguish people with similar names.
- Use the profile image URL when available.
- Keep an explicit unassigned sentinel in component state and convert it to `null` at the API boundary.
- Preserve the existing backend assignment field, such as `assignedToUserId`.

## Header-sized controls

On record pages, timelines, and inline editors, use `<AssigneeInput size="compact" />`. Its closed trigger must match the page header:

- `h-8` (32px), `rounded-full`, `px-3 py-1`, and `text-xs`.
- A `size-5` (20px) avatar with `text-[10px]` initials.
- Content-sized width, capped at 260px and the available container width.
- No full-width stretching across a step card or timeline row.
- Adjacent Status and action buttons also use `h-8`.

The existing `size="default"` variant is reserved for full forms whose adjacent controls are 44px tall. Do not use that variant in record headers or enrollment timelines.

## Component structure

Use a shadcn `Popover` containing `Command` for searchable assignment. The trigger displays the current owner; the popover displays searchable identity details.

```tsx
<Popover open={assigneePickerOpen} onOpenChange={setAssigneePickerOpen}>
  <PopoverTrigger asChild>
    <Button
      id="record-assignee"
      type="button"
      variant="outline"
      size="sm"
      disabled={isSubmitting}
      aria-invalid={Boolean(errors.assignee)}
      aria-expanded={assigneePickerOpen}
      className="h-8 w-fit min-w-0 max-w-[min(100%,260px)] justify-between gap-2 rounded-full border-blue-100 bg-white px-3 py-1 text-xs shadow-sm has-[>svg]:px-3"
    >
      {/* Selected avatar and full name */}
    </Button>
  </PopoverTrigger>

  <PopoverContent
    align="start"
    className="w-80 max-w-[calc(100vw-2rem)] p-0"
  >
    <Command>
      <CommandInput placeholder="Search team members..." />
      <CommandList>{/* Assignment options */}</CommandList>
    </Command>
  </PopoverContent>
</Popover>
```

Component rules:

- Use a button trigger, not a disabled text input.
- Match the header height with `h-8` and use `rounded-full` for the pill shape.
- Keep the compact trigger content-sized. Give its searchable popover a separate `w-80` width, capped to the viewport, so names and emails remain readable.
- Use `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, and `CommandItem` together.
- Put every `CommandItem` inside `CommandGroup`.
- Close the popover immediately after selection.
- Clear the assignment error when the value changes.
- Disable the trigger and search input during submission.

## Avatar and name hierarchy

Show an avatar in both the trigger and every person option. An avatar must always have a fallback.

```tsx
<Avatar className="size-5 ring-2 ring-blue-50">
  {option.image ? (
    <AvatarImage
      src={option.image}
      alt={`${option.label} profile photo`}
    />
  ) : null}
  <AvatarFallback className="bg-blue-950 text-[10px] font-semibold text-white">
    {getInitials(option.label)}
  </AvatarFallback>
</Avatar>
```

Identity rules:

- Keep the closed compact trigger avatar at 20px. Menu avatars may remain 24px for scanability.
- Display the full first and last name as the primary line.
- Truncate long names instead of widening the form.
- Display email as a smaller muted second line in the option list.
- Do not repeat email in the closed trigger unless the workflow needs disambiguation after selection.
- Use one or two initials derived from the full name when no image exists or the image fails.
- Use a neutral em dash avatar for `Not assigned`.
- Use a descriptive image alt such as `Jordan Lee profile photo`.

Recommended initials helper:

```ts
function getInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

  return initials || "?"
}
```

## Trigger hierarchy

The trigger shows selected identity and a compact disclosure affordance.

```tsx
<span className="flex min-w-0 items-center gap-2">
  <Avatar>{/* image and fallback */}</Avatar>
  <span className="truncate text-xs font-medium text-slate-800">
    {selectedAssignee?.label ?? "Not assigned"}
  </span>
</span>
<ChevronDown data-icon="inline-end" className="ml-1 text-slate-400" />
```

Trigger rules:

- Keep the avatar and name left-aligned.
- Keep the chevron at the far right.
- Use `min-w-0` before `truncate` so long names shrink correctly.
- Use `Not assigned` instead of an ambiguous empty placeholder when assignment is optional.
- Do not add a decorative person icon when an avatar already communicates identity.
- Keep hover and focus surfaces restrained and consistent with other form controls.

## Pill shape and adjacent actions

The assignee trigger uses the same rounded visual language as compact header controls and action buttons at the same `h-8` height as the header.

```tsx
<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
  <AssigneeInput
    size="compact"
    id="step-assignee"
    value={draftAssigneeId}
    onValueChange={setDraftAssigneeId}
    options={assigneeOptions}
  />
  {hasAssigneeChange ? (
    <Button className="h-8 rounded-full px-3 text-xs font-semibold">
      Save assignee
    </Button>
  ) : null}
</div>
```

Composition rules:

- Use `rounded-full` on the assignee trigger; do not mix it with `rounded-lg` or `rounded-xl` variants in the same workflow.
- Keep the compact trigger at `h-8`; do not increase its height to accommodate the avatar.
- Center the matching `h-8` Save action beside the input with `items-center`.
- Render Save only after the selected assignee differs from the persisted assignee.
- Keep Save outside the popover trigger so both controls retain clear keyboard and pointer behavior.
- Place validation or failure text below the entire control row, not between the input and Save action.
- The popover panel remains a conventional surface; the pill radius applies to the closed trigger, not the results panel.

## Search behavior

For a small list already loaded with the form, use Command's local filtering. Include the full name, email, and user ID in the searchable value.

```tsx
<CommandItem
  value={`${option.label} ${option.email ?? ""} ${option.value}`}
  onSelect={() => selectAssignee(option.value)}
>
  {/* Avatar, name, email, and selected check */}
</CommandItem>
```

For a large or remotely loaded team list:

- Sanitize control and formatting characters from the search input.
- Trim the query sent to the API.
- Debounce remote requests by approximately 250 milliseconds.
- Cancel or ignore stale requests when the query changes or the popover closes.
- Limit the number of visible results so the popover remains compact.
- Show `Searching team members...` while loading.
- Show `No team members found.` when the completed search has no results.
- Keep the selected assignee in component state even if it is absent from later search results.

Do not add a debounce to a small in-memory list; local Command filtering is immediate and does not create network load.

## Unassigned state

When assignment is optional, render `Not assigned` as the first option.

```tsx
<CommandItem
  value="Not assigned unassigned"
  onSelect={() => setAssignedToUserId("__UNASSIGNED__")}
>
  <Avatar size="sm">
    <AvatarFallback>—</AvatarFallback>
  </Avatar>
  <span className="min-w-0 flex-1">Not assigned</span>
  <Check className={isUnassigned ? "opacity-100" : "opacity-0"} />
</CommandItem>
```

Unassigned rules:

- Name the state explicitly.
- Do not use `Select user` after the user has deliberately chosen no owner.
- Convert the sentinel value to `null` before submitting.
- Keep the selected check visible for the unassigned state.
- If assignment is required, omit this option and validate that a real user ID is selected.

## Form integration

```tsx
<Field
  data-invalid={Boolean(errors.assignedToUserId)}
  data-disabled={isSubmitting}
  className="gap-2"
>
  <FieldLabel htmlFor="record-assignee">Assignee</FieldLabel>
  {/* Assignee popover */}
  <FieldError>{errors.assignedToUserId}</FieldError>
</Field>
```

Form rules:

- Put `data-invalid` and `data-disabled` on `Field`.
- Put `aria-invalid`, `aria-expanded`, and `disabled` on the trigger.
- Associate the visible label and trigger with matching `htmlFor` and `id`.
- Map invalid or inaccessible user errors back to `FieldError`.
- Never submit a stale user ID from another tenant.

## Layout with Status

Keep compact Assignee and Status controls together without stretching them to fill a card.

```tsx
<FieldGroup className="flex-row flex-wrap items-start gap-3">
  <Field className="w-fit min-w-0 max-w-full">{/* Compact Assignee */}</Field>
  <Field className="w-fit min-w-0 max-w-full">{/* Compact Status */}</Field>
</FieldGroup>
```

Layout rules:

- Keep both compact triggers at `h-8` with content-sized widths.
- Let the fields wrap when their labels and controls no longer fit on one row.
- Cap Assignee at 260px and Status at 220px, always within their container.
- Allow the name to truncate without hiding the avatar or chevron.
- In a full creation form, the explicit form-sized variant may fill a field column at 44px tall; use the same height for its adjacent Status input.

## Accessibility and interaction

- Keep the trigger keyboard accessible as a button.
- Expose the popover state with `aria-expanded`.
- Keep the selected check as supporting feedback; do not rely on it without the name.
- Preserve Command keyboard navigation and active-item styling.
- Provide `AvatarFallback` for every `Avatar`.
- Use readable names even when profile images do not load.
- Disable assignment changes during submission.

## Review checklist

Before merging an assignee input, verify:

- Full first and last names are displayed when available.
- Every person has an image or initials fallback.
- The trigger and options show the same selected person.
- Email is secondary and searchable.
- `Not assigned` is explicit when supported.
- Record-page triggers match the header and adjacent controls at exactly 32px.
- The compact trigger fits its label instead of filling the card, with a 20px avatar.
- The trigger uses the shared `rounded-full` pill shape.
- A conditional Save action follows the compact button guide and is vertically centered beside the input.
- Long names truncate without layout overflow.
- Search, empty, selected, disabled, and error states work.
- The popover closes after selection.
- The submitted value is a valid tenant user ID or `null`.
