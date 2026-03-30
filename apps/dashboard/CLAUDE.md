# Dashboard — Claude Code Context

## Overview
Next.js 16 admin panel. Port 3001. React 19 + Tailwind CSS 4. App Router.

## Structure
```
src/
  app/
    layout.tsx          — Root layout with Providers
    page.tsx            — Landing/redirect
    login/page.tsx      — Login form
    signup/page.tsx     — Tenant self-signup
    admin/
      layout.tsx        — Authenticated layout with Sidebar
      page.tsx          — Dashboard overview
      inbox/            — Agent console (messaging)
      contacts/         — CRM contacts + lead detail
      pipeline/         — Kanban board
      conversations/    — Global conversation view
      automation/       — Rules builder
      broadcast/        — Campaign manager
      ai/               — LLM router config
      knowledge/        — RAG document management
      channels/whatsapp/ — Embedded Signup UI
      analytics/        — Platform analytics
      agent-analytics/  — Agent performance
      settings/         — Platform config
      users/            — User management
      ... (25+ pages total)
  components/
    Sidebar.tsx         — Navigation (role-based)
    CopilotWidget.tsx   — AI assistant
    Providers.tsx       — Client providers wrapper
  contexts/
    AuthContext.tsx      — JWT auth + auto-refresh + tenant switching
    TenantContext.tsx    — Multi-tenant context for API calls
  hooks/
    useApiData.tsx      — API hook with LIVE/DEMO badge
  lib/
    api.ts              — HTTP client (30+ methods wrapping fetch)
```

## Key patterns
- All API calls go through `src/lib/api.ts` which handles auth headers and base URL
- Auth state in `AuthContext` — provides `user`, `token`, `login()`, `logout()`, `switchTenant()`
- Pages under `/admin/` are protected by AuthContext redirect
- WebSocket connection via socket.io-client for real-time inbox updates
- LIVE/DEMO badge system in useApiData to show data source

## Environment
- `NEXT_PUBLIC_API_URL` — API base URL (e.g., http://localhost:3000/api/v1)
- `NEXT_PUBLIC_WA_SERVICE_URL` — WhatsApp service URL
- `NEXT_PUBLIC_META_APP_ID` — For Embedded Signup widget
