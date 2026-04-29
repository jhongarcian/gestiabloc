# AI Qualification Tab

## Purpose
- Add a dedicated contact-level workspace for qualification analysis.
- Let a user run one assistant-style analysis against all active services that have fit rules configured.
- Keep qualification deterministic. AI only explains the outcome in plain language.

## Route and Placement
- Route: `/app/[tenantSlug]/contacts/[contactId]/ai-qualification`
- Placement: top-level tab in the contact detail tabs.
- Tab label: `AI Qualification`
- Tab icon: sparkles / star-style icon.
- Relationship to `Services`:
  - `Services` remains the operational area for enrollments and service transactions.
  - `AI Qualification` becomes the main explanation/report workspace.
  - Eligible services in `AI Qualification` deep-link into the `Services` purchase flow with the service preselected.

## Core Behavior
- The page is manual-run.
- On first load, do not auto-run the scan.
- Show a landing state with:
  - page title
  - short assistant-style explanation
  - primary CTA: `Run qualification analysis`
  - note that the page explains rules but does not change them
- On click:
  - call the existing fit-scan endpoint for the current contact
  - store the timestamp of the run in UI state
  - render the assistant report
- Re-run:
  - keep a `Run again` button after the first run
  - replace the current report with fresh results

## Data Contract
- Source of truth: existing fit-scan response.
- Required fields per service result:
  - `serviceId`
  - `serviceName`
  - `description`
  - `fitProfile.summary`
  - `eligibilityStatus`
  - `fitScore`
  - `matchedRules`
  - `blockingRules`
  - `missingRules`
  - `summary`
  - `explanation`
  - `explanationSource`
  - `configurationGapNotes`
- UI-derived summary:
  - `ranAt`
  - `serviceCount`
  - `eligibleCount`
  - `needsInfoCount`
  - `notEligibleCount`
  - `reviewedFacts`
  - `nextSteps`

## Page Structure

### 1. Hero / Assistant Header
- Large assistant-style panel at the top of the page.
- Visual direction:
  - sparkles badge
  - soft gradient background
  - summary cards
  - assistant tone, not dashboard-table tone
- Required content:
  - `AI Qualification` badge
  - title: `Assistant qualification report for {contactName}`
  - supporting text explaining what the analysis does
  - summary cards:
    - `Last run`
    - `Analysis mode`
    - `Safety`
  - primary action:
    - before first run: `Run qualification analysis`
    - after first run: `Run again`

### 2. Empty / Pre-Run State
- Shown before the first analysis runs.
- Two-panel layout:
  - left panel: assistant intro
  - right panel: “what you will get”
- Required content:
  - assistant intro that says it will scan all active services with fit rules
  - explanation that the first run opens a report with reviewed signals, best matches, and next steps
  - benefits list:
    - assistant explanation per service
    - deterministic status consistency
    - next actions to take

### 3. Post-Run Summary Bar
- Shown after the first analysis.
- Required metrics:
  - total services reviewed
  - eligible count
  - needs-info count
  - not-eligible count
- Required quick filters:
  - `Show all`
  - `Show only eligible`
  - `Show missing info`
- The filters only affect what is displayed, not the scan itself.

### 4. What I Reviewed
- Short intake summary of relevant, non-sensitive qualification signals.
- Should not dump full contact data.
- Should only surface facts or rule labels that materially affected at least one result.
- Rendering:
  - small intro sentence
  - chip list of reviewed facts
- Example reviewed facts:
  - `Age`
  - `Date of birth`
  - `Part A date`
  - `Part B date`
  - `Legal status`
  - `Available assets`

### 5. What To Do Next
- Assistant-style summary of next steps derived from the result set.
- Rules:
  - if one or more services are eligible, show a move-forward summary
  - if one or more services are `NEEDS_INFO`, show what data to collect
  - if nothing is eligible, say to review blockers and update contact details
- Render as short stacked action cards, not as a single paragraph.

### 6. Best Matches Sections
- Show results in three ordered sections:
  - `Eligible now`
  - `Need more information`
  - `Not eligible`
- Each section contains only the services that belong to that status after the active filter is applied.
- If a section has no items:
  - show a small empty-state card for that section

## Service Card Requirements
- Each service card must show, in this order:
  - status badge
  - fit score
  - service name
  - service description
  - assistant conclusion paragraph
  - explanation source label
  - configuration notes if any
  - matched reasons
  - missing info
  - blocking reasons
  - CTA if eligible

### Assistant Conclusion
- This is the primary text the user reads first.
- Source priority:
  - `explanation`
  - then `summary`
  - then `fitProfile.summary`
- Tone:
  - conversational but concise
  - must sound like an assistant summary
  - must not imply the AI changed qualification logic

### Explanation Source
- Always display one of:
  - `AI explanation from configured rules`
  - `Rule-based explanation`

### Configuration Note
- Show when `configurationGapNotes.length > 0`
- Purpose:
  - call out that the service description mentions a qualification path that is not encoded in rules
- Visual treatment:
  - warning/amber panel

### Matched / Missing / Blocking Columns
- Show as three separate evidence panels on desktop.
- Each panel should render up to the top 3 reasons.
- Empty text:
  - matched: `No matched rules were triggered.`
  - missing: `No missing information is blocking this service.`
  - blocking: `No blocking rules are active for this service.`

### CTA Rules
- `ELIGIBLE`:
  - show primary CTA: `Start service`
  - link to `/contacts/[contactId]/services?create=1&serviceId={serviceId}`
- `NEEDS_INFO`:
  - no start CTA
  - rely on assistant explanation + missing-info panel
- `NOT_ELIGIBLE`:
  - no start CTA
  - rely on explanation + blocking panel

## Handling Multiple Qualified Services
- If multiple services are `ELIGIBLE`:
  - all of them must appear in the `Eligible now` section
  - keep the backend sort order from fit-scan
  - do not collapse into one winner
  - each eligible service gets its own `Start service` CTA
- If multiple services are `NEEDS_INFO`:
  - show all of them in the `Need more information` section
  - the `What to do next` section should aggregate the missing field labels across services
  - deduplicate repeated missing fields where possible
- If multiple services are `NOT_ELIGIBLE`:
  - show all of them in the `Not eligible` section
  - blockers remain per service card
- If a contact qualifies for a large number of services:
  - preserve section grouping
  - show cards in a responsive grid
  - filters must still let the user narrow to `eligible` or `needs info`
- If all services fall into one status:
  - still render the three section headers in the same order
  - only the active section contains cards
  - the other sections show their section-level empty state

## UI Tone and Style
- The page should feel like an AI assistant workspace, not a CRUD screen.
- Required visual cues:
  - sparkles icon
  - assistant-oriented copy like “I reviewed”, “What to do next”, “Assistant conclusion”
  - soft gradient hero
  - rounded panels and grouped sections
- Avoid:
  - chat transcript bubbles
  - freeform prompt input
  - fake conversational history
  - exposing raw rule operators such as `greater_than_or_equal`

## Safety and Data Rules
- Qualification status must remain deterministic.
- The page must never claim that AI changed or overrode the rules.
- Do not surface sensitive contact values in the “What I reviewed” area.
- Only show non-sensitive, relevant, human-readable signals.
- If AI is unavailable:
  - still render the entire page using deterministic explanations
  - label the explanation source as rule-based

## Loading and Empty States
- Loading state:
  - disable run button
  - show spinner
  - button text: `Running analysis`
- No configured services:
  - after run, if there are no active services with fit rules, show a report-friendly empty state
  - message should explain that there are no configured services ready for qualification analysis

## Acceptance Criteria
- A new top-level `AI Qualification` tab exists in the contact page.
- Opening the tab does not auto-run the scan.
- Clicking `Run qualification analysis` fetches and renders the report.
- The page shows:
  - hero header
  - run summary
  - reviewed facts
  - next steps
  - three grouped result sections
- Eligible services include a CTA that deep-links to the `Services` purchase flow.
- Multiple eligible services are shown independently, not collapsed into one.
- Multiple missing-info services aggregate useful next steps without losing per-service detail.
- The explanation source is always visible.
- The UI remains usable when AI is disabled and deterministic explanations are used.
