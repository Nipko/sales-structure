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
    admin/
      layout.tsx        — Authenticated layout with Sidebar
      page.tsx          — Dashboard overview
      inbox/            — Agent console (WhatsApp-style chat + bell notifications)
      contacts/         — CRM contacts + lead detail
      contacts/segments/ — Saved contact filters
      pipeline/         — Kanban board
      conversations/    — Global conversation view
      automation/       — Rules wizard (4-step)
      agent/            — AI agent config (6-step wizard + custom prompt mode)
      agent-analytics/  — Reports (4 tabs: Overview/Agents/Channels/CSAT)
      ai/               — LLM router config
      broadcast/        — Campaign manager
      channels/         — Channel overview (WhatsApp/IG/Messenger)
      channels/whatsapp/ — WhatsApp Embedded Signup
      channels/instagram/ — Instagram DM setup
      channels/messenger/ — Messenger setup
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
      users/            — User management
      tenants/          — Tenant management (super_admin only)
      ... (35+ pages total)
  components/
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
- Styling: inline CSS with CSS variables (dark theme), NO Tailwind classes in most pages
- Icons: lucide-react throughout
- Forms: useState objects + onChange handlers + toast notifications
- Modals: fixed overlay, backdrop blur, click-outside dismiss

## CSS Variables
```
--bg-primary: #0a0a12    --text-primary: #e8e8f0
--bg-secondary: #12121e  --text-secondary: #9898b0
--bg-card: #1a1a2e       --accent: #6c5ce7
--border: #2a2a45        --success: #00d68f
                         --warning: #ffaa00
                         --danger: #ff4757
```

## Environment
- `NEXT_PUBLIC_API_URL` — API base URL (e.g., https://api.parallly-chat.cloud/api/v1)
- `NEXT_PUBLIC_WA_SERVICE_URL` — WhatsApp service URL
- `NEXT_PUBLIC_META_APP_ID` — For Embedded Signup widget
- `NEXT_PUBLIC_META_CONFIG_ID` — For Embedded Signup config
