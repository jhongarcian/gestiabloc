# Gestiabloc Follow-Up Table Style Guide

This guide defines the shared table pattern for the tenant follow-up workspace.

The design direction is **dense operational scanning**: each service path should read as one record, with primary facts in their own columns instead of stacked secondary rows.

Reference implementation:

`apps/react-ui/app/(tenants)/app/[tenantSlug]/followups/_components/followups-table.tsx`

Shared table shell and pagination reference:

`docs/contact-table-style-guide.md`

## Column Contract

Use one table row per follow-up record.

Required columns:

| Column | Content |
| --- | --- |
| Name | Contact display name |
| Number | Contact phone number, formatted when available |
| Service | Enrolled service name |
| Template | Follow-up template name and version |
| Current Step | Step number chip and current step title |
| Assigned | Current step assignee name or `Unassigned` |
| Status | Current step status badge |
| Due Date | Date and time only |
| Progress | Percentage, one compact progress bar, and completed step count |

## Row Rules

- Do not place phone number beneath the contact name.
- Do not place template beneath the service name.
- Do not place assignee beneath the current step.
- Keep due date to the formatted date and time only; overdue state may change text color but should not tint the full row or add a second label.
- Keep progress in one horizontal line: percentage, bar, and completed count. Do not add separate `remaining`, `left`, or `complete` rows.
- Truncate long names, services, templates, and assignees instead of increasing row height.
- Preserve row click behavior for opening the service path.
- Keep rows on a neutral surface. Do not use full-row background color to mark overdue records.

## Visual Rules

- Match the contacts table shell and pagination from `docs/contact-table-style-guide.md`.
- Use stable contact-table row sizing: `h-14` rows with `px-4 py-0` cells.
- Keep status as a pill badge using the same meaning and colors already used on the page.
- Keep the step number chip small enough to sit inline with the step title.
- Use tabular numbers for progress percentages and counts.
- Use horizontal table scrolling when the viewport is too narrow rather than wrapping cells into multiple lines.
- Keep the x-axis scrollbar at the end of the table content, not on the outer page surface.
- Keep summary metrics compact above the table so the row data remains the primary surface.

## Filter Sheet

- Follow `docs/dialog-style-guide.md` sheet adaptation, not the dialog pattern.
- Use a right-side sheet with a pale-blue contextual header, one scrollable content region, and a persistent footer.
- Use `FieldGroup`, `Field`, `FieldLabel`, and `FieldDescription` for filter controls.
- Keep filter controls at `h-11` with `rounded-xl`, `border-slate-200`, and `bg-slate-50/60`.
- Use `docs/assignee-input-style-guide.md` for the assignee filter: button trigger, avatar, searchable team list, and explicit all-assignees state.
- Use `Clear` as the secondary footer action and `Apply filters` as the primary footer action.

## Review Checklist

Before changing the follow-up table, verify:

- Each record occupies one visual row.
- Name, number, service, template, current step, assigned, status, due date, and progress each have their own column.
- No cell has metadata stacked into a second descriptive row.
- Due date shows only date and time.
- Progress does not create a taller two-row treatment.
- Pagination matches the contacts table: rows-per-page select, numbered page buttons, and icon previous/next buttons.
- Loading, empty, and error rows span all table columns.
- Frontend lint and production build pass.
