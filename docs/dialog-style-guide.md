# Gestiabloc Dialog Style Guide

This guide defines the shared structure for form dialogs across Gestiabloc. Use it when creating or modernizing dialogs for contacts, opportunities, tasks, appointments, services, account settings, and other operational workflows.

The design direction is **calm operational clarity**: a pale-blue contextual header, a white working surface, a restrained navy primary action, clear field hierarchy, and persistent actions. Dialogs should feel focused and dependable without looking heavy.

Reference implementation:

`apps/react-ui/app/(tenants)/app/[tenantSlug]/contacts/[contactId]/notes/_components/contact-notes-panel.tsx`

## Structural contract

Every form dialog uses three rows:

```text
Contextual header
Scrollable form content
Persistent action footer
```

The dialog must be bounded by the viewport. Only the middle row scrolls, so the title, close control, and actions remain available when content is long.

```tsx
<DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[28px] border-slate-200 bg-white p-0 shadow-2xl sm:max-w-3xl [&>button]:cursor-pointer">
  <DialogHeader>{/* Context */}</DialogHeader>
  <div className="min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
    {/* Form content */}
  </div>
  <DialogFooter>{/* Actions */}</DialogFooter>
</DialogContent>
```

Required layout rules:

- Use `max-h-[calc(100dvh-2rem)]` instead of a fixed pixel height.
- Use `grid-rows-[auto_minmax(0,1fr)_auto]` so the content row can shrink.
- Keep `overflow-hidden` on `DialogContent` to preserve the rounded outline.
- Put `min-h-0 overflow-y-auto overscroll-contain` on the middle row.
- Use `[scrollbar-gutter:stable]` to prevent content from shifting when a scrollbar appears.
- Do not place `overflow-y-auto` on multiple nested containers.
- The built-in close button must use `cursor-pointer`. Add `[&>button]:cursor-pointer` to `DialogContent` when the close control is its direct child.

## Header

The header communicates context through typography, not a leading icon. Keep it concise and left-aligned.

Hierarchy:

1. Small uppercase context eyebrow.
2. Clear action-oriented title.
3. One-sentence description explaining the outcome.

```tsx
<DialogHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
  <div
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
  />
  <div
    aria-hidden="true"
    className="pointer-events-none absolute -right-12 -bottom-20 size-48 rounded-full bg-blue-300/30 blur-3xl"
  />

  <div className="relative pr-10">
    <div className="flex max-w-2xl min-w-0 flex-col gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700">
        Contact activity
      </p>
      <DialogTitle className="text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
        Create a note
      </DialogTitle>
      <DialogDescription className="max-w-xl text-sm leading-6 text-slate-600">
        Capture the context your team needs and keep supporting files with the contact.
      </DialogDescription>
    </div>
  </div>
</DialogHeader>
```

Header rules:

- Do not add a decorative leading icon.
- Always render `DialogTitle`; it is required for accessibility.
- Keep the eyebrow to two or three words when possible.
- Begin titles with a direct verb: `Create`, `Add`, `Edit`, `Schedule`, `Assign`, or `Configure`.
- Describe the result, not the mechanics of filling out the form.
- Keep the description to one or two short lines at desktop width.
- Preserve `pr-10` so text never collides with the close control.
- Decorative grid and glow layers must use `aria-hidden="true"`.

## Color palette

Use the existing contact palette. New colors should communicate a state, not add decoration.

| Purpose | Tailwind usage |
| --- | --- |
| Header and supporting section surface | `bg-[#f1f7ff]` |
| Primary action | `bg-blue-950 text-white hover:bg-blue-900` |
| Context eyebrow | `text-blue-700` |
| Primary heading | `text-slate-950` |
| Body copy | `text-slate-600` |
| Muted guidance | `text-slate-500` |
| Standard border | `border-slate-200` |
| Contextual border | `border-blue-100` or `border-blue-200` |
| Form surface | `bg-slate-50/60` |
| Footer surface | `bg-slate-50/80` |
| Error | `text-rose-700`, `border-rose-200` |

Reserve rose for errors and destructive actions. Do not introduce purple gradients or unrelated accent colors.

## Form hierarchy

Use shadcn `FieldGroup` and `Field` for form layout. Each control needs a visible label, concise guidance, and an inline error location.

```tsx
<FieldGroup className="gap-5">
  <Field
    data-invalid={Boolean(errors.title)}
    data-disabled={isSaving}
    className="gap-2"
  >
    <FieldLabel htmlFor="dialog-title" className="text-slate-800">
      Title
    </FieldLabel>
    <Input
      id="dialog-title"
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      disabled={isSaving}
      aria-invalid={Boolean(errors.title)}
      className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
    />
    <FieldDescription className="text-xs">
      Explain what the team should recognize later.
    </FieldDescription>
    <FieldError>{errors.title}</FieldError>
  </Field>
</FieldGroup>
```

Form rules:

- Use `FieldGroup` with `gap-*`; do not use `space-y-*`.
- Put `data-invalid` on `Field` and `aria-invalid` on the control.
- Put `data-disabled` on `Field` and `disabled` on the control.
- Use `h-11 rounded-xl` for standard text inputs in medium and large dialogs.
- Use `min-h-40 resize-y` for long-form textareas.
- Keep descriptions instructional and under one sentence.
- Show character counts using `tabular-nums` and keep them aligned to the right.
- Use product language instead of implementation language. Prefer `Note details`, `Description`, `Instructions`, or `Context` over `Body`.
- Keep API field names unchanged when only the user-facing label changes.

## Content sections

The main content uses `px-6 py-6 sm:px-7` and a vertical `gap-7`.

```tsx
<div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
  <div className="flex flex-col gap-7">
    <FieldGroup>{/* Primary fields */}</FieldGroup>
    <section>{/* Related or optional content */}</section>
  </div>
</div>
```

Use a tinted section for supporting or optional content such as attachments, participants, reminders, or advanced options:

```tsx
<section className="flex flex-col gap-4 rounded-[22px] border border-blue-100 bg-[#f1f7ff] p-4 sm:p-5">
  {/* Section heading, controls, and content */}
</section>
```

Do not wrap every field in a card. The white form surface establishes the primary workflow; tinted sections group secondary content.

## Attachments and uploads

Attachment sections should explain supported types and limits before the user selects a file.

Each selected file row includes:

- File-type icon.
- Truncated filename.
- Formatted file size.
- State label: `Ready to upload`, `Uploading now`, or `Upload complete`.
- Remove action while the form is editable.

Use sequential uploads unless the backend explicitly supports concurrent uploads. Sequential uploads make progress, errors, and retry behavior predictable.

Recommended state:

```ts
type SaveProgress = {
  phase: "uploading" | "saving"
  completed: number
  total: number
  currentFileName: string | null
}
```

Show a determinate progress panel while files upload:

```tsx
{isSaving && saveProgress ? (
  <div className="flex flex-col gap-3 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm" aria-live="polite">
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-2.5">
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-blue-800" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-semibold text-slate-900">
            {saveProgress.phase === "uploading"
              ? `Uploading ${Math.min(saveProgress.completed + 1, saveProgress.total)} of ${saveProgress.total}`
              : "Finishing your changes"}
          </p>
          <p className="truncate text-xs text-slate-500">
            {saveProgress.currentFileName ?? "Saving the record..."}
          </p>
        </div>
      </div>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-blue-900">
        {progressPercent}%
      </span>
    </div>
    <Progress value={progressPercent} aria-label="Upload progress" />
  </div>
) : null}
```

Upload rules:

- Show progress only after the save action begins.
- Display the active filename and `current / total` file count.
- Change completed file rows to `Upload complete`.
- Transition the progress label from uploading to saving after all files finish.
- Disable file selection and removal during upload.
- Explain size limits in the UI and repeat them in the error toast.
- Use `aria-live="polite"` for changing upload status.
- Give `Progress` a descriptive `aria-label`.

If byte-level upload progress is unavailable, the progress bar may represent completed files. Do not imply byte-level precision in the label.

## Footer and actions

The footer is always the third dialog row.

```tsx
<DialogFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:items-center sm:px-7">
  {canDelete ? (
    <Button variant="outline" className="border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:mr-auto">
      <Trash2 data-icon="inline-start" />
      Delete
    </Button>
  ) : null}

  <Button type="button" variant="outline" disabled={isSaving}>
    Cancel
  </Button>
  <Button
    type="submit"
    disabled={isSaving}
    className="min-w-32 bg-blue-950 text-white shadow-sm hover:bg-blue-900"
  >
    {isSaving ? (
      <Loader2 data-icon="inline-start" className="animate-spin" />
    ) : null}
    {isSaving ? "Saving..." : "Save changes"}
  </Button>
</DialogFooter>
```

Action rules:

- Primary action is last in the DOM and visually right-aligned on desktop.
- Cancel is immediately before the primary action.
- Destructive actions appear on the left with `sm:mr-auto`.
- Use a stable minimum width on the primary action to prevent label shifts.
- Disable all dismiss and mutation actions while saving.
- Icons inside `Button` use `data-icon="inline-start"` and no sizing classes.
- Use specific pending copy: `Uploading...`, `Saving...`, `Creating...`, or `Updating...`.

## Open and close behavior

Do not allow the dialog to close while an upload or mutation is active.

```tsx
<Dialog
  open={open}
  onOpenChange={(nextOpen) => {
    if (!nextOpen && isSaving) return
    setOpen(nextOpen)
    if (!nextOpen) resetForm()
  }}
>
```

Reset temporary files, validation errors, progress state, and input values only after a safe close or a successful submission.

## Responsive behavior

### Mobile

- Dialog width uses the shadcn default viewport inset.
- Maximum height is `calc(100dvh - 2rem)`.
- Footer buttons stack according to `DialogFooter` behavior.
- The middle row scrolls independently.
- Section headings and their actions may stack vertically.
- Avoid horizontal form grids unless each field remains at least 240px wide.

### Desktop

- Use `sm:max-w-xl` for simple confirmations or two-field forms.
- Use `sm:max-w-2xl` for standard operational forms.
- Use `sm:max-w-3xl` for forms with attachments or secondary sections.
- Avoid wider dialogs unless the content genuinely requires columns or a preview.

## Accessibility checklist

- `DialogTitle` is always present.
- `DialogDescription` explains the result of the workflow.
- Every control has a visible `FieldLabel` or an appropriate accessible name.
- Invalid controls use both `data-invalid` and `aria-invalid`.
- Error messages use `FieldError` or `role="alert"`.
- Decorative backgrounds use `aria-hidden="true"`.
- Icon-only actions have an `aria-label`.
- Progress changes use `aria-live="polite"`.
- The progress bar has an `aria-label`.
- Focus states remain visible.
- The close control and Cancel action cannot interrupt an active save.
- Content remains usable at 200% zoom and short viewport heights.

## Copy-ready dialog skeleton

```tsx
<Dialog
  open={open}
  onOpenChange={(nextOpen) => {
    if (!nextOpen && isSaving) return
    setOpen(nextOpen)
    if (!nextOpen) resetForm()
  }}
>
  <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[28px] border-slate-200 bg-white p-0 shadow-2xl sm:max-w-3xl [&>button]:cursor-pointer">
    <DialogHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -bottom-20 size-48 rounded-full bg-blue-300/30 blur-3xl"
      />
      <div className="relative pr-10">
        <div className="flex max-w-2xl min-w-0 flex-col gap-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700">
            Workflow context
          </p>
          <DialogTitle className="text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
            Create record
          </DialogTitle>
          <DialogDescription className="max-w-xl text-sm leading-6 text-slate-600">
            Explain what will be created and why it matters.
          </DialogDescription>
        </div>
      </div>
    </DialogHeader>

    <form id="record-form" onSubmit={handleSubmit} className="contents">
      <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
        <div className="flex flex-col gap-7">
          <FieldGroup className="gap-5">
            <Field data-invalid={Boolean(errors.name)} data-disabled={isSaving} className="gap-2">
              <FieldLabel htmlFor="record-name">Name</FieldLabel>
              <Input
                id="record-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={isSaving}
                aria-invalid={Boolean(errors.name)}
                className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
              />
              <FieldDescription>Use a name your team will recognize.</FieldDescription>
              <FieldError>{errors.name}</FieldError>
            </Field>
          </FieldGroup>

          {/* Optional secondary section */}
        </div>
      </div>

      <DialogFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:items-center sm:px-7">
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isSaving}
          className="min-w-32 bg-blue-950 text-white shadow-sm hover:bg-blue-900"
        >
          {isSaving ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : null}
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
```

The form uses `className="contents"` so its children participate in the three-row `DialogContent` grid while retaining native form submission behavior.

## Review checklist

Before considering a dialog complete, verify:

- [ ] Header follows eyebrow, title, description hierarchy.
- [ ] Header has no decorative leading icon.
- [ ] Dialog title and description are accessible.
- [ ] The top-right close button uses `cursor-pointer`.
- [ ] Dialog is bounded by the viewport.
- [ ] Only the middle row scrolls vertically.
- [ ] Fields use `FieldGroup` and `Field`.
- [ ] Labels use product language rather than API names.
- [ ] Validation appears beside the relevant control.
- [ ] Secondary content is visually grouped without card overload.
- [ ] Uploads show filename, size, state, and overall progress.
- [ ] Footer remains visible while content scrolls.
- [ ] Primary, cancel, and destructive actions follow the standard order.
- [ ] The dialog cannot close while saving.
- [ ] Loading labels describe the current operation.
- [ ] Mobile and short-height viewport behavior has been checked.
- [ ] ESLint, TypeScript, and the frontend production build pass.
