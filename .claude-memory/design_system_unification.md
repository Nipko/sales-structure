---
name: Design System Unification
description: Complete design system unification done April 17-18 2026 — tokens, components, navigation pattern
type: project
originSessionId: d5aaa220-582d-4f39-aed4-0a7831ce3013
---
## Completed (verified with grep — 0 occurrences):
- **gray-*** → neutral-* across ALL 90+ tsx files
- **font-bold** → font-semibold everywhere
- **font-extrabold** → font-semibold everywhere
- **rounded-2xl** → rounded-xl everywhere

## Shared Components Created:
- `TabNav` (tab-nav.tsx) — Stripe underline tabs, ARIA tablist, optional icon+badge
- `PageHeader` (page-header.tsx) — h1 + subtitle + icon + badge + action + breadcrumbs
- `Breadcrumbs` (breadcrumbs.tsx) — detail page navigation
- `SkeletonLoader` (skeleton-loader.tsx) — Skeleton, SkeletonKPIs, SkeletonTable, SkeletonCards, SkeletonPage

## CSS Utilities Added (globals.css):
- Transition tokens: --duration-fast/normal/slow, --ease-out/in-out
- .animate-in, .animate-stagger, .hover-lift, .press-effect
- .skeleton (shimmer), .pulse-dot, .slide-in-bottom, .nav-underline
- Focus ring system on :focus-visible
- Base transitions on all interactive elements (150ms)

## Navigation Pattern (research-backed):
- Sidebar = primary (AppSidebar, already existed)
- TabNav = sub-navigation (2-7 tabs)
- Hub cards = Settings + Channels only
- Breadcrumbs = detail pages
- Wizards = only inside modals

## PageHeader Applied To (14 pages):
appointments, automation, broadcast, knowledge, compliance, identity,
inventory, orders, users, analytics, agent-analytics, contacts, pipeline,
contact detail (with breadcrumbs)

## CTA Button Pattern:
bg-neutral-900 dark:bg-white, text-white dark:text-neutral-900, hover:opacity-90, press-effect, rounded-lg
