# Dashboard — Claude Code Context

## Overview
Next.js 16 admin panel. Port 3001. React 19. App Router. Dark theme with inline CSS.

## Structure
```
src/
  app/
    layout.tsx          — Root layout with Providers
    page.tsx            — Landing/redirect
    login/page.tsx      — Login form
    signup/page.tsx      — Tenant self-signup
    kb/[tenantSlug]/    — Public KB portal (light theme, no auth)
    forgot-password/page.tsx — Password reset (OTP + new password)
    setup-password/page.tsx  — Google OAuth password setup
    verify-email/page.tsx    — 6-digit OTP verification  
    onboarding/page.tsx      — 4-step company wizard
    admin/
      layout.tsx        — Authenticated layout with Sidebar
      page.tsx          — Dashboard overview
      inbox/            — Agent console (WhatsApp-style chat + bell notifications)
      contacts/         — CRM contacts + lead detail
      contacts/segments/ — Saved contact filters
      pipeline/         — Kanban board
      conversations/    — Global conversation view
      automation/       — Rules wizard (4-step)
      agent/              — AI agent list (multi-agent management)
      agent/[agentId]/    — Agent editor (hub card grid + channel assignment)
      agent/_components/  — 9 extracted components (ConfigCard, IdentitySection, etc.)
      agent-analytics/  — Reports (4 tabs: Overview/Agents/Channels/CSAT)
      ai/               — LLM router config
      broadcast/        — Campaign manager
      channels/         — Channel overview (WhatsApp/IG/Messenger)
      channels/whatsapp/ — WhatsApp Embedded Signup
      channels/instagram/ — Instagram DM setup
      channels/messenger/ — Messenger setup
      channels/telegram/ — Telegram bot setup
      channels/sms/      — SMS/Twilio setup
      identity/         — Merge suggestions (approve/reject)
      knowledge/        — RAG document management
      analytics/        — Platform analytics
      compliance/       — Consent & opt-out management
      inventory/        — Stock management
      orders/           — Order tracking
      landings/         — Landing page builder
      catalog/courses/  — Course management
      catalog/campaigns/ — Campaign management
      settings/         — Platform config
      settings/custom-attributes/ — Dynamic field definitions
      settings/macros/  — Saved action sequences
      settings/prechat/ — Pre-chat form builder
      settings/media/               — Image bank, logo upload, tags, gallery
      settings/email-templates/     — Template editor with preview
      settings/change-password/     — Change password form
      appointments/          — Calendar, list, availability config
      users/            — User management
      tenants/          — Tenant management (super_admin only)
      ... (40+ pages total)
  components/
    layout/TopBar.tsx       — Breadcrumbs, theme toggle, notification bell (7 categories), tenant selector, user menu
    Sidebar.tsx         — Navigation (role-based, 16 items)
    Providers.tsx       — Client providers wrapper
  contexts/
    AuthContext.tsx      — JWT auth + auto-refresh + tenant switching
    TenantContext.tsx    — Multi-tenant context for API calls
  hooks/
    useApiData.tsx      — API hook with LIVE/DEMO badge
  lib/
    api.ts              — HTTP client (89+ methods wrapping fetch)
```

## Key patterns
- All API calls go through `src/lib/api.ts` which handles auth headers and base URL
- Auth state in `AuthContext` — provides `user`, `token`, `login()`, `logout()`, `hasRole()`
- Tenant state in `TenantContext` — provides `activeTenantId`, `setActiveTenant()`
- Pages under `/admin/` are protected by AuthContext redirect
- WebSocket via socket.io-client for real-time inbox updates (namespace `/inbox`)
- Socket URL: strips `/api/v1` from `NEXT_PUBLIC_API_URL` before connecting
- Styling: Tailwind CSS + shadcn/ui components, dark/light/system themes via next-themes
- Icons: lucide-react throughout
- Forms: useState objects + onChange handlers + toast notifications
- Modals: fixed overlay, backdrop blur, click-outside dismiss
- Notification bell in TopBar: WebSocket-driven, 7 categories (chat, handoff, compliance, appointments, automation, orders, system)
- Media URLs: API_URL.replace('/api/v1', '') + file.url (CORP header for cross-origin)
- Navigation: PageHeader (all pages), TabNav (sub-navigation), Breadcrumbs (detail pages), SkeletonLoader (loading states)
- i18n: next-intl with 4 languages (es/en/pt/fr), cookie-based locale switching, 0 hardcoded Spanish
- Multi-agent: Agent list → template picker → agent editor with channel assignment

## Shared UI Components
```
components/
  ui/tab-nav.tsx         — Stripe underline tabs (ARIA tablist)
  ui/page-header.tsx     — h1 + subtitle + icon + badge + action
  ui/breadcrumbs.tsx     — Detail page navigation
  ui/skeleton-loader.tsx — Skeleton, SkeletonKPIs, SkeletonTable, SkeletonCards
  SetupBanner.tsx        — Persistent amber banner for unconfigured agents
```

## CSS Variables
```
--bg-primary: #0a0a12    --text-primary: #e8e8f0
--bg-secondary: #12121e  --text-secondary: #9898b0
--bg-card: #1a1a2e       --accent: #6c5ce7
--border: #2a2a45        --success: #00d68f
                         --warning: #ffaa00
                         --danger: #ff4757
```
Design system unified April 2026: neutral-* colors, font-semibold max, rounded-xl cards, transition tokens

## Environment
- `NEXT_PUBLIC_API_URL` — API base URL (e.g., https://api.parallly-chat.cloud/api/v1)
- `NEXT_PUBLIC_WA_SERVICE_URL` — WhatsApp service URL
- `NEXT_PUBLIC_META_APP_ID` — For Embedded Signup widget
- `NEXT_PUBLIC_META_CONFIG_ID` — For Embedded Signup config
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — Google Sign-In (fallback hardcoded)
