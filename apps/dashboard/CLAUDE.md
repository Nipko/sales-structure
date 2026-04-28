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
      contacts/         — CRM contacts + lead detail (edit mode + custom fields + score breakdown)
      contacts/segments/ — Saved contact filters
      contacts/[leadId]/ — Lead 360° detail (edit, archive, custom fields, score transparency)
      pipeline/         — Kanban board (deduped by lead, configurable stages)
      conversations/    — Global conversation view
      automation/       — Rules wizard (4-step)
      agent/              — AI agent list (channel-agent assignment, unassigned banner)
      agent/[agentId]/    — Agent editor (hub card grid + channel assignment + sticky save bar)
      agent/_components/  — 9 extracted components (ConfigCard, IdentitySection, etc.)
      agent-analytics/  — Reports (4 tabs: Overview/Agents/Channels/CSAT)
      ai/               — LLM router config
      broadcast/        — Campaign manager
      channels/         — Channel overview (WhatsApp/IG/Messenger + agent assignment status)
      channels/whatsapp/ — WhatsApp Embedded Signup
      channels/instagram/ — Instagram OAuth setup (popup + BroadcastChannel)
      channels/instagram/callback/ — Instagram OAuth code exchange (minimal layout)
      channels/messenger/ — Messenger FB SDK Login setup
      channels/telegram/ — Telegram bot setup
      channels/sms/      — SMS/Twilio setup
      identity/         — Merge suggestions (approve/reject)
      knowledge/        — RAG document management
      analytics/        — Platform analytics
      crm-analytics/    — CRM analytics (funnel, velocity, win/loss, leaderboard)
      compliance/       — Privacy & consent management
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
      settings/pipeline/            — Pipeline stages customization (drag-to-reorder)
      appointments/          — Calendar, list, availability config
      users/            — User management
      tenants/          — Tenant management (6 tabs: Overview/Onboarding/Offboarding/Billing/Usage/Platform)
      tenants/[tenantId]/ — Tenant detail (4 tabs: Info/Users/Channels/Billing + impersonation)
      financials/       — SaaS financial metrics (5 tabs: Overview/Revenue/Customers/Costs/Settings)
      settings/billing/ — Tenant billing (plan info, countdown, actions, payment history)
      ... (65+ pages total)
  components/
    layout/TopBar.tsx       — Breadcrumbs, theme toggle, notification bell (7 categories), tenant selector, user menu
    Sidebar.tsx         — Navigation (role-based, 16 items)
    Providers.tsx       — Client providers wrapper
    ImpersonationBanner.tsx — Amber banner shown during super_admin impersonation (localStorage-based state)
    SuspendedScreen.tsx     — Full-page block for suspended tenants (only action: logout)
    OnboardingChecklist.tsx — Progress checklist (generic "connect channel" step)
    SetupBanner.tsx         — Agent personalization prompt
  contexts/
    AuthContext.tsx      — JWT auth + auto-refresh + tenant switching
    TenantContext.tsx    — Multi-tenant context for API calls
  hooks/
    useApiData.tsx      — API hook with LIVE/DEMO badge
  lib/
    api.ts              — HTTP client (110+ methods wrapping fetch)
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
- Notification bell in TopBar: WebSocket-driven, 7 categories
- Media URLs: API_URL.replace('/api/v1', '') + file.url
- Navigation: PageHeader (all pages), TabNav (sub-navigation), Breadcrumbs (detail pages), SkeletonLoader (loading states)
- i18n: next-intl with 4 languages (es/en/pt/fr), cookie-based locale switching, 0 hardcoded strings
- Multi-agent: Agent list → template picker → agent editor with channel assignment
- Pipeline stage labels: use `tc('stages.{key}')` from common namespace (not hardcoded)

## CRM Features (Apr 27, 2026)
- **Lead edit**: pencil icon on lead detail → inline edit (name, email, phone, stage, VIP, tags)
- **Create lead**: modal from contacts list (phone required)
- **Archive (soft delete)**: archive button → confirmation → archived_at set, filtered from lists
- **Bulk actions**: checkboxes + sticky bar (change stage, add tag, archive)
- **Custom fields**: values stored in custom_attribute_values table, rendered by type in lead detail
- **Score transparency**: click score to expand 5-factor breakdown
- **Contact consolidation**: grouped by customer_profile_id, multi-channel badges
- **Pipeline dedup**: DISTINCT ON (lead_id), one card per lead
- **Pipeline settings**: /admin/settings/pipeline — drag-to-reorder, color/probability/terminal
- **CRM Analytics**: /admin/crm-analytics — 4 tabs with recharts

## Channel-Agent Assignment (Apr 27, 2026)
- Agent cards only show channels that are connected AND assigned
- /channels/overview API returns assignedAgent + needsAssignment per channel
- RED BANNER on agent list when channels are connected but unassigned
- Checklist step: "Conectar un canal" (generic, not WhatsApp-specific)
- Sticky save bar on agent editor (always visible at bottom)

## Shared UI Components
```
components/
  ui/tab-nav.tsx         — Stripe underline tabs (ARIA tablist)
  ui/page-header.tsx     — h1 + subtitle + icon + badge + action
  ui/breadcrumbs.tsx     — Detail page navigation
  ui/skeleton-loader.tsx — Skeleton, SkeletonKPIs, SkeletonTable, SkeletonCards, SkeletonPage
  SetupBanner.tsx        — Persistent amber banner for unconfigured agents
  OnboardingChecklist.tsx — Progress steps with channel/agent checks
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

## Channel OAuth (Apr 26-27, 2026)
- **Instagram**: OAuth popup → `instagram.com/oauth/authorize` → callback exchanges code via BroadcastChannel → long-lived token stored. Profile fetched from graph.instagram.com (name, username, profile_pic). Username shown as "Name (@username)". Cached 1h in Redis.
- **Messenger**: FB SDK loaded → `FB.login()` with `pages_messaging` scope → page token exchange. Profile fetched from graph.facebook.com (name, profile_pic). Cached 1h in Redis.
- **Telegram**: Bot API getUserProfilePhotos for avatar. Name from webhook payload (first_name + last_name).

## Environment
- `NEXT_PUBLIC_API_URL` — API base URL
- `NEXT_PUBLIC_WA_SERVICE_URL` — WhatsApp service URL
- `NEXT_PUBLIC_META_APP_ID` — For Embedded Signup widget + Messenger FB SDK
- `NEXT_PUBLIC_META_CONFIG_ID` — For Embedded Signup config
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — Google Sign-In
- `NEXT_PUBLIC_INSTAGRAM_APP_ID` — Instagram OAuth app ID
- `NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI` — Instagram OAuth callback URL
- `NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID` — Facebook Login configuration ID for Messenger
