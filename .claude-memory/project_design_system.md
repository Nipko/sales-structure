---
name: Design System status
description: Tailwind + shadcn/ui + next-themes migration completed — all pages migrated, 3 theme modes, animated logo
type: project
---

Design system migration completed 2026-04-09.

**Stack**: Tailwind CSS v4 + shadcn/ui + next-themes + Motion (Framer Motion)
**Dark mode**: `@custom-variant dark (&:is(.dark *))` — class-based via next-themes
**Themes**: Claro (light), Oscuro (dark), Sistema (follows OS)
**Future themes**: Graphite and Midnight prepared (commented out in globals.css)
**Palette**: Professional indigo (#4f46e5 light / #6366f1 dark)
**Font**: Inter + JetBrains Mono (for code/API keys)

**Components installed**: Button, Card, Input, Label, Separator, Badge, Tooltip, DropdownMenu, Sheet
**AnimatedLogo**: Motion-powered SVG animation (stagger reveal + hover glow)

**All 35+ dashboard pages migrated from inline styles to Tailwind classes.**

**Why:** Inline styles didn't support responsive design, hover states, or theme switching. Tailwind + shadcn gives consistency, dark mode for free, and faster development.

**How to apply:** New pages should use Tailwind classes + shadcn components. Never use inline `style={{}}` for static values.
