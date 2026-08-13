# Onboarding Sidebar Style Guide

This guide documents the reusable visual language of the Gestiabloc onboarding sidebar. Use it for setup wizards, guided configuration flows, imports, migrations, and other focused multi-step experiences.

The design direction is **calm operational confidence**: a deep navy control rail, a subtle technical grid, one restrained cobalt glow, and compact progress indicators. It should feel structured and dependable without making the workflow feel mandatory.

Source implementation: `apps/react-ui/app/(onboarding)/onboarding/[tenantSlug]/_components/onboarding-shell.tsx`

## Design tokens

### Color palette

| Purpose | Value | Tailwind usage |
| --- | --- | --- |
| Sidebar background | `#0b1730` | `bg-[#0b1730]` |
| Page canvas | `#f3f1ea` | `bg-[#f3f1ea]` |
| Accent glow | `#2f68ff` at 25% | `bg-[#2f68ff]/25` |
| Primary sidebar text | `#ffffff` | `text-white` |
| Supporting text | Slate 300 | `text-slate-300` |
| Muted text | Slate 400 | `text-slate-400` |
| Active icon/text | Slate 950 | `text-slate-950` |
| Completed step | Emerald 300 | `bg-emerald-300 border-emerald-300` |
| Directional accent | Blue 200 | `text-blue-200` |
| Badge text | Blue 100 | `text-blue-100` |
| Soft surface | White at 5–10% | `bg-white/5`, `bg-white/10` |
| Soft border | White at 10–20% | `border-white/10`, `border-white/15`, `border-white/20` |

Avoid adding more saturated colors to the rail. Emerald communicates completion; cobalt supplies atmosphere and direction. Other states should remain white or slate.

### Dimensions and spacing

| Element | Specification |
| --- | --- |
| Desktop rail width | `320px` |
| Mobile padding | `24px` (`px-6 py-6`) |
| Desktop padding | `32px` (`lg:px-8 lg:py-8`) |
| Brand icon container | `40 × 40px` (`h-10 w-10`) |
| Progress marker | `28 × 28px` (`h-7 w-7`) |
| Navigation item radius | `12px` (`rounded-xl`) |
| Navigation item padding | `8px 10px`, desktop horizontal `12px` |
| Brand icon gap | `12px` (`gap-3`) |
| Navigation content gap | `12px` (`gap-3`) |
| Badge horizontal padding | `12px` (`px-3`) |
| Badge vertical padding | `4px` (`py-1`) |
| Intro top spacing | `24px` (`mt-6`) |
| Progress list top spacing | Mobile `32px`; desktop `48px` |
| Footer top padding | `24px` (`pt-6`) |

Desktop layout:

```text
320px sidebar | fluid page content
```

Tailwind:

```tsx
<div className="min-h-screen lg:grid lg:grid-cols-[320px_minmax(0,1fr)]">
```

On smaller screens, the sidebar becomes a compact top rail. Step labels are hidden and the four progress markers form an equal horizontal grid.

## Background treatment

The background is built from three layers inside a `relative overflow-hidden` sidebar:

1. Solid deep navy foundation.
2. A low-contrast 42px technical grid.
3. A blurred cobalt glow near the lower-right edge.

```tsx
<aside className="relative overflow-hidden bg-[#0b1730] px-6 py-6 text-white lg:flex lg:min-h-screen lg:flex-col lg:px-8 lg:py-8">
  <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:42px_42px]" />
  <div className="absolute -right-24 bottom-10 h-64 w-64 rounded-full bg-[#2f68ff]/25 blur-3xl" />

  <div className="relative">
    {/* Sidebar content */}
  </div>
</aside>
```

Rules:

- Decorative layers must use `absolute`; all meaningful content uses `relative` so it stays above them.
- The grid uses white at only 8% opacity and is then reduced by the layer’s `opacity-20`.
- Keep the glow partly outside the rail with `-right-24`; it should create atmosphere, not look like a visible circle.
- Preserve `overflow-hidden` so the glow and grid never leak into the content area.

## Brand and badge

The brand row uses a 40px translucent icon tile and a compact wordmark.

```tsx
<a className="inline-flex items-center gap-3 font-semibold tracking-tight">
  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10">
    <PanelsTopLeft className="h-5 w-5" />
  </span>
  <span>Gestiabloc</span>
</a>
```

The context badge establishes what the flow is for:

```tsx
<span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-100 lg:mt-8 lg:inline-flex">
  Workspace launch
</span>
```

Keep badge labels to two or three words. Good alternatives include `Data import`, `Team setup`, `Service launch`, and `Workspace migration`.

## Icon system

Use **Lucide React** icons throughout. Any Lucide icon can be used as long as it follows the container and sizing rules below.

```tsx
import {
  Check,
  ChevronRight,
  PanelsTopLeft,
  Settings2,
  Users,
} from "lucide-react"
```

### Universal icon rules

- Use `h-5 w-5` inside the 40px brand or feature container.
- Use `h-4 w-4` for navigation, arrows, inline actions, and compact controls.
- Use `h-3.5 w-3.5` for completion checks inside the 28px progress marker.
- Keep Lucide’s default stroke width. Do not mix filled icon sets into the rail.
- Icons inherit their color from the surrounding container. Avoid setting arbitrary icon colors directly.
- Every icon-only control needs an accessible `aria-label`.
- Keep the icon container square with `shrink-0` when it sits next to text.

### Reusable generic icon tile

```tsx
import type { LucideIcon } from "lucide-react"

function SidebarIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10">
      <Icon className="h-5 w-5" aria-hidden="true" />
    </span>
  )
}
```

Example:

```tsx
<SidebarIcon icon={Users} />
<SidebarIcon icon={Settings2} />
```

Suggested semantic icons:

| Meaning | Suggested Lucide icons |
| --- | --- |
| Workspace or dashboard | `PanelsTopLeft`, `LayoutDashboard`, `Building2` |
| Business profile | `Building2`, `Landmark`, `BriefcaseBusiness` |
| Team | `Users`, `UserPlus`, `ContactRound` |
| Workflow | `Route`, `Workflow`, `GitBranch`, `ListChecks` |
| Services | `Sparkles`, `Package`, `Wrench`, `BadgeCheck` |
| Calendar or timezone | `CalendarClock`, `Clock3`, `Globe2` |
| Configuration | `Settings2`, `SlidersHorizontal`, `Cog` |
| Import or migration | `Upload`, `Import`, `DatabaseBackup` |
| Completion | `Check`, `CircleCheck`, `PartyPopper` |
| Direction | `ChevronRight`, `ArrowRight` |

Choose icons by meaning, not decoration. A step should normally have no more than one leading icon and one directional icon.

## Progress navigation

Progress items use three visual states:

| State | Marker | Label | Row |
| --- | --- | --- | --- |
| Upcoming | Transparent, white 20% border, slate 400 number | Slate 400 | Transparent |
| Active | White background and border, slate 950 number | Semibold white | White 10% background |
| Complete | Emerald 300 background and border, slate 950 check | Slate 400 unless active | Transparent |

Base item:

```tsx
<div className="group flex min-w-0 items-center gap-3 rounded-xl px-2 py-2.5 transition lg:px-3">
```

Active item:

```tsx
<div className="bg-white/10" aria-current="step">
```

Base marker:

```tsx
<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold">
```

State classes:

```ts
const markerClass = isPast
  ? "border-emerald-300 bg-emerald-300 text-slate-950"
  : isActive
    ? "border-white bg-white text-slate-950"
    : "border-white/20 text-slate-400"
```

Use `aria-current="step"` only on the active item. Progress items may be plain status indicators or links to already visited steps, depending on the flow’s navigation rules.

## Typography

The current application font is inherited from the root layout. The rail relies on scale, weight, tracking, and contrast instead of introducing a second typeface.

| Content | Style |
| --- | --- |
| Brand | `font-semibold tracking-tight` |
| Context badge | `text-[11px] font-semibold uppercase tracking-[0.18em]` |
| Intro text | `text-sm leading-6 text-slate-300` |
| Step label | `text-sm`; active adds `font-semibold text-white` |
| Progress number | `text-[10px] font-bold` |
| Footer note | `text-xs leading-5 text-slate-400` |

Avoid long copy. The intro should remain at or below three short lines at 320px width. Footer guidance should remain at or below four lines.

## Responsive behavior

### Below `lg`

- Sidebar becomes a top rail.
- Brand and context badge share one row.
- Intro copy and footer guidance are hidden.
- Progress becomes `grid-cols-4`.
- Step labels and chevrons are hidden.
- Minimum sidebar height is content-driven.

### At `lg` and above

- Sidebar is fixed at 320px within the page grid.
- It fills the viewport with `lg:min-h-screen`.
- Content uses a vertical flex layout.
- Footer is pushed to the bottom with `mt-auto`.
- Progress becomes a single-column list.

Do not turn this into an off-canvas menu. It is contextual progress, not primary application navigation.

## Copy-ready component pattern

```tsx
import type { LucideIcon } from "lucide-react"
import { Check, ChevronRight, PanelsTopLeft } from "lucide-react"

type Step = {
  key: string
  label: string
  number: string
  icon?: LucideIcon
}

export function GuidedFlowSidebar({
  title,
  badge,
  description,
  steps,
  activeStepIndex,
  complete = false,
}: {
  title: string
  badge: string
  description: string
  steps: Step[]
  activeStepIndex: number
  complete?: boolean
}) {
  return (
    <aside className="relative overflow-hidden bg-[#0b1730] px-6 py-6 text-white lg:flex lg:min-h-screen lg:flex-col lg:px-8 lg:py-8">
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className="absolute -right-24 bottom-10 h-64 w-64 rounded-full bg-[#2f68ff]/25 blur-3xl" />

      <div className="relative flex items-center justify-between lg:block">
        <div className="inline-flex items-center gap-3 font-semibold tracking-tight">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10">
            <PanelsTopLeft className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>{title}</span>
        </div>

        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-100 lg:mt-8 lg:inline-flex">
          {badge}
        </span>
      </div>

      <p className="relative mt-6 hidden max-w-xs text-sm leading-6 text-slate-300 lg:block">
        {description}
      </p>

      <ol className="relative mt-8 grid grid-cols-4 gap-2 lg:mt-12 lg:grid-cols-1 lg:gap-1">
        {steps.map((step, index) => {
          const isActive = index === activeStepIndex
          const isPast = index < activeStepIndex || complete
          const Icon = step.icon

          return (
            <li key={step.key}>
              <div
                aria-current={isActive ? "step" : undefined}
                className={`group flex min-w-0 items-center gap-3 rounded-xl px-2 py-2.5 transition lg:px-3 ${isActive ? "bg-white/10" : ""}`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                    isPast
                      ? "border-emerald-300 bg-emerald-300 text-slate-950"
                      : isActive
                        ? "border-white bg-white text-slate-950"
                        : "border-white/20 text-slate-400"
                  }`}
                >
                  {isPast ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : Icon ? (
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    step.number
                  )}
                </span>

                <span
                  className={`hidden truncate text-sm lg:block ${
                    isActive ? "font-semibold text-white" : "text-slate-400"
                  }`}
                >
                  {step.label}
                </span>

                {isActive ? (
                  <ChevronRight className="ml-auto hidden h-4 w-4 text-blue-200 lg:block" aria-hidden="true" />
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>

      <div className="relative mt-auto hidden border-t border-white/10 pt-6 lg:block">
        <p className="text-xs leading-5 text-slate-400">
          Progress is saved automatically. You can return and finish later.
        </p>
      </div>
    </aside>
  )
}
```

## Accessibility checklist

- Use semantic `<aside>` and `<ol>` elements.
- Add `aria-current="step"` to the active step.
- Mark decorative icons and background layers as hidden from assistive technology when appropriate.
- Give icon-only buttons an `aria-label`.
- Never communicate progress using color alone; retain the number, icon, or checkmark.
- Maintain visible focus styles when progress items become links.
- Preserve at least a 44px interaction target for clickable rows.
- Keep text contrast high against the navy background.

## Usage guardrails

- Use this sidebar for focused, finite workflows of approximately 3–7 steps.
- Keep only one active step.
- Do not place tables, large forms, notification lists, or general app navigation inside it.
- Do not replace the navy background with a gradient; depth comes from the grid and glow layers.
- Do not add multiple glow colors.
- Do not use different icon sizes within the same semantic level.
- Keep the content area visually lighter than the rail so the user’s attention moves naturally toward the current task.
