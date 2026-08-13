# Dashboard — Claude Code Context

_Última actualización: jul-2026_

## Overview
Next.js 16 admin panel. Port 3001. React 19. App Router. Tailwind + shadcn/ui + CSS variables, temas dark/light/system vía next-themes. i18n next-intl (es/en/pt/fr). 126 páginas admin (139 `page.tsx` en total). Nota: la app mobile React Native/Expo (`@parallext/mobile`) es un proyecto aparte que sale por EAS, no por el deploy web.

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
    onboarding/page.tsx      — Wizard trial-first (3 pasos: empresa → audiencia → objetivos), vertical-aware (18 industrias + sub-tipos). Arranca trial plan "emprendedor" sin tarjeta; el upgrade vive en Configuración → Billing
    accept-invite/page.tsx   — Aceptar invitación de usuario
    auth/                    — Callbacks OAuth (Google, etc.)
    book/                    — Reserva pública (booking sin auth)
    offline/page.tsx         — Fallback PWA offline
    admin/
      layout.tsx        — Authenticated layout con AppSidebar + banners (Fiscal, Trial, Maintenance) + session/timeout modals
      setup-wizard/     — Onboarding guiado post-registro: conectar primer canal + probar agente (AgentTestChat) + canales secundarios (SecondaryChannels) + ToolsTour
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
      broadcast/        — Campaign manager multi-canal (WA/Email + SMS one-way por créditos). Selector de cuenta/número emisor (`senderAccountId` → `channelAccountId`) cuando el tenant tiene >1 conexión WhatsApp
      report-builder/   — Custom report builder (16 metrics, 4 chart types, save/edit/duplicate/favorite)
      channels/         — Channel overview (WhatsApp/IG/Messenger + agent assignment status)
      channels/whatsapp/ — WhatsApp Embedded Signup
      channels/whatsapp/templates/ — WA template management + in-app creation via Meta API
      channels/instagram/ — Instagram OAuth setup (popup + BroadcastChannel)
      channels/instagram/callback/ — Instagram OAuth code exchange (minimal layout)
      channels/messenger/ — Messenger FB SDK Login setup
      channels/telegram/ — Telegram bot setup
      channels/sms/      — SMS/Twilio setup
      identity/         — Merge suggestions (approve/reject)
      knowledge/        — RAG document management
      analytics-v2/     — Analytics overview del tenant (reemplaza al antiguo `analytics/`)
      crm-analytics/    — CRM analytics (funnel, velocity, win/loss, leaderboard)
      compliance/       — Privacy & consent (5 tabs: legal texts, consents, opt-outs, deletions, audit). Legal texts: named, typed (7 types), multi-channel chips, multi-agent chips
      inventory/        — Stock management
      orders/           — Order tracking
      landings/         — Landing page builder
      catalog/courses/  — Course management
      catalog/campaigns/ — Campaign management
      settings/         — Hub de configuración. Secciones registradas en `settings/_settings-config.ts` (fuente de verdad). ~29 subpáginas
      settings/custom-attributes/ — Dynamic field definitions
      settings/macros/  — Saved action sequences
      settings/prechat/ — Pre-chat form builder
      settings/media/               — Image bank, logo upload, tags, gallery
      settings/email-templates/     — Template editor with preview
      settings/change-password/     — Change password form
      settings/pipeline/            — Pipeline stages customization (drag-to-reorder)
      settings/fiscal/              — Datos fiscales del tenant (NIT/cédula, DIAN) — feeds el gate collect-before-pay
      settings/ai-config/, settings/ai-providers/ — Config de agente/LLM y proveedores (reemplaza al antiguo `ai/`)
      settings/integrations/        — crm, slack, webhooks, mcp, reviews, vertical (Toast/Mindbody/Cliniko), web-chat (widget + triggers), sms-notifications
      settings/billing/             — Tenant billing (plan info, ciclo mensual/anual, countdown, upgrade/downgrade, payment history)
      settings/security/            — 2FA + SSO (SAML IdP settings, force-SSO toggle, SP metadata download)
      appointments/          — Calendar, list, availability config
      users/            — User management
      tenants/          — Tenant management (6 tabs: Overview/Onboarding/Offboarding/Billing/Usage/Platform)
      tenants/[tenantId]/ — Tenant detail (Info/Users/Channels/Billing + impersonación con motivo)
      financials/       — SaaS financial metrics (5 tabs: Overview/Revenue/Customers/Costs/Settings)
      automation/_components/FlowBuilder.tsx — Visual automation builder using @xyflow/react (React Flow canvas with trigger, condition, action, delay nodes)

      # ── Platform mode (super_admin, sin tenant implícito) ──
      ops/, ops/alerts/  — Ops Center: platform-monitor, salud de contenedores/backup, alertas
      incidents/         — Incidentes de plataforma
      health/            — Platform health (uptime, dependencias)
      storage/           — Per-tenant storage monitoring + quota enforcement
      plans/             — Editor de planes/tiers (billing_plans) cross-tenant
      billing-ops/       — Billing Ops: subs/pagos/eventos cross-tenant, refund inline, sync + reconciliación con MercadoPago, auditoría de precios
      sms-packages/      — SMS reseller: tiers de créditos editables, kill-switch, uso
      fiscal/            — Fiscal DIAN cross-tenant (FiscalInvoice, reintentos Factus)
      managed/           — Done-for-you tier: tracking de garantías (target vs verified)
      usage/             — Platform usage cross-tenant
      audit/             — Platform audit log
      llm-stats/         — LLM router health/uso
      webhooks/          — Webhook tap (debug de webhooks entrantes)
      compliance-admin/  — Compliance a nivel plataforma
      funnel/            — Funnel de adquisición de tenants
      vertical-analytics/ — Analytics por vertical/industria (plataforma)
      coupons/           — Cupones de descuento
      feature-requests/  — Feature requests board (tenant + platform)
      carla/             — Copiloto interno super_admin
      ... (126 páginas admin; 139 `page.tsx` en total)
  components/
    layout/TopBar.tsx       — Breadcrumbs, theme toggle, notification bell (7 categories), tenant selector, user menu
    layout/AppSidebar.tsx — Navegación seccionada + capability-based. `tenantSections` (operation/growth/management/config) vs `platformSections` (super_admin platform mode). ~60 hrefs; items filtrados por capability y por vertical del tenant; accordions
    Providers.tsx       — Client providers wrapper
    ImpersonationBanner.tsx — Amber banner durante impersonación super_admin (muestra tenant + motivo; localStorage)
    SuperAdminGuard.tsx     — Gate de rutas solo-plataforma
    FiscalBanner.tsx        — Aviso de datos fiscales faltantes (DIAN); usado en admin/layout + settings/billing
    FiscalGateModal.tsx     — Modal bloqueante collect-before-pay (NIT/cédula) antes de cobrar
    TrialCountdownBanner.tsx / MaintenanceBanner.tsx — Banners de estado (trial / mantenimiento)
    SessionTimeoutModal.tsx / SessionConflictModal.tsx — Timeout de sesión 60min + conflicto de sesión
    TwoFactorVerification.tsx — Verificación 2FA (TOTP/email/backup)
    SuspendedScreen.tsx     — Full-page block for suspended tenants (only action: logout)
    InitialSetupCard.tsx    — Essential setup tasks, plan/role/vertical-aware and fail-closed
    quality/                — Global Agent Health card, banner and safe quality status UI
    SetupBanner.tsx / AgentReadinessBanner.tsx — Prompts de personalización/readiness del agente
    CopilotWidget.tsx / HelpAssistant.tsx — Copiloto y asistente de ayuda
    tour/ProductTour.tsx    — Tour guiado del producto
    pwa/                    — InstallPrompt, OfflineIndicator, PushNotificationToggle, ServiceWorkerRegistrar
  contexts/
    AuthContext.tsx      — JWT auth + auto-refresh + tenant switching
    TenantContext.tsx    — Multi-tenant context for API calls
  hooks/
    useApiData.tsx      — API hook with LIVE/DEMO badge
  lib/
    api.ts              — HTTP client (fetch wrapper; ~1.8k líneas, cientos de métodos)
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
- i18n: next-intl with 4 languages (es/en/pt/fr), cookie-based locale switching, 0 hardcoded strings. **Toda página nueva/editada actualiza los 4 JSON**
- Sidebar (`AppSidebar.tsx`): items filtrados por **capability** (`canHandleConversations`, `canEditAgent`, `canManageBilling`…) y por **vertical** del tenant, no solo por rol. Super_admin sin tenant activo ve `platformSections`; al impersonar ve `tenantSections`
- **Super_admin platform mode**: sin tenant implícito. Cada página de plataforma nueva necesita su regla en `roles.ts` (deny-by-default). Para operar dentro de un tenant se impersona con motivo obligatorio (`{reason, ticketId}`) → banner ámbar + sesión emparejada (`impersonationSid`); el actor real queda en auditoría
- Multi-agent: **un agente por conexión** (`agent_personas.channel_bindings`), gateado por `features.maxChannelAccounts` (default 1). El editor de agente enlaza cuentas concretas (`ChannelAccountLite`: channelType/accountId/displayName), no "un agente por canal"
- Pipeline stage labels: use `tc('stages.{key}')` from common namespace (not hardcoded)

## New Features (Jun-Jul 2026)
- **Multi-canal por tipo**: N conexiones del mismo tipo (2 números WhatsApp, 2 IG…) gateado por `features.maxChannelAccounts` (default 1) + override por tenant. Tokens por-cuenta (`channel_accounts.access_token`), disconnect por-cuenta, un agente por conexión (`channel_bindings`). UI: overview con contador/límite, editor de agente que enlaza cuentas, selector de número emisor en broadcast/plantillas
- **Billing anual + Billing Ops**: planes con ciclo mensual/anual (~15% desc anual) sincronizados a MercadoPago. `/admin/billing-ops` — vistas cross-tenant de subs/pagos/eventos, refund inline, reconciliación on-demand, downgrade que sincroniza con MP, auditoría de cambios de precio. `/admin/plans` edita tiers (`billing_plans`). Landing `/precios` es data-driven contra los planes
- **Fiscal DIAN (Colombia)**: facturación electrónica vía Factus (`IFiscalInvoiceProvider`, modelo `FiscalInvoice`). Gate collect-before-pay (NIT/cédula) **OFF por defecto** → `FiscalBanner` + `FiscalGateModal`. `/admin/fiscal` cross-tenant; `settings/fiscal/` por tenant
- **Ops Center (super_admin)**: `/admin/ops` (platform-monitor) — salud de contenedores/backup, alertas; incluye `/admin/storage` (monitoreo + quota por tenant), `/admin/health`, `/admin/incidents`. Alerta si el heartbeat `backup:last_success` supera ~26h
- **SMS reseller monetizado**: SMS conversacional **descartado**; SMS = notificación one-way por créditos (1 crédito = 1 segmento) vía Twilio de plataforma. `/admin/sms-packages` (tiers editables + kill-switch OFF por defecto); tenant compra créditos con MercadoPago (pago único); ledger atómico + firma de webhook Twilio

## New Features (May 2026)
- **Visual Automation Builder**: React Flow canvas (@xyflow/react), toggleable with existing 4-step wizard, same data format. Trigger, condition, action, delay node types
- **Handoff summary banner**: Orange banner in inbox showing AI-generated conversation summary when agent opens handed-off conversation
- **SSO in login**: Debounced domain check on email input, SSO button when domain matches, forced-SSO warning

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
  InitialSetupCard.tsx    — Essential setup tasks; optional adoption does not affect quality
  quality/                — Agent Health card and global attention banner
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

## New pages (May 31, 2026 — Competitive Roadmap Q2)

- `agent/simulation/` — **T2.13** Probar agente: launch panel (synthetic/replay), forecast-style results, regression diff, scenario transcript drawer, history polling
- `procedures/` — **T2.12** SOP editor: "write your SOP" (compile NL→steps), step-list editor (message/ask/tool/condition/handoff), trigger keywords, activate/version
- `agent/_components/CapabilitiesSection.tsx` — **T2.17** adds skillset selector (sales/support/both) + upsell (intensity, max discount) + e-commerce tools card
- `contacts/organizations/` — **T3.21** B2B accounts + forecast KPIs (weighted/committed/best-case/velocity) + weighted-by-stage + rotting alerts
- `attribution/` — **T3.22** Ads→WhatsApp→sale funnel, per-ad performance, broadcast revenue, range selector
- `managed/` — **T3.24** super-admin done-for-you tier: guarantee tracking table (target vs verified rate, met/at-risk/breached)
- `settings/integrations/vertical/` — **T3.19** Toast/Mindbody/Cliniko connect/test/sync
- `settings/integrations/mcp/` — **T3.20** MCP server endpoint + external MCP connectors
- `settings/integrations/reviews/` — **T3.23** Google Business Profile connect + reviews list with AI-suggest/post reply

All add nav entries (AppSidebar.tsx) + i18n namespaces in 4 languages. Vertical/MCP/Reviews are registered in `settings/_settings-config.ts` (integrations section).
