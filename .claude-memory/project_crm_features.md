---
name: CRM Features implementation status
description: Status of all 4 CRM blocks (Operativo, Analytics, CRM Avanzado, Engagement) implemented 2026-04-07
type: project
---

All 4 blocks implemented 2026-04-07. Backend complete, most frontend pages done.

## Implemented (backend + frontend)
- Agent Availability Status (online/busy/offline + auto-offline cron)
- Conversation Snooze (BullMQ delayed wake-up)
- Macros (CRUD + sequential action execution)
- CSAT Survey Trigger (auto after resolve + Redis flag detection)
- Enhanced Reports (4 tabs: Overview/Agents/Channels/CSAT + date range)
- Custom Attributes (dynamic fields per entity type)
- Contact Segments (saved filters with dynamic SQL builder)
- Import/Export CSV
- Pre-Chat Forms (conversational data collection)
- KB Public Portal (/kb/[tenantSlug], light theme, no auth)

## Pending (from roadmap)
- Tool/Skills framework for AI agent (function calling / tool use)
- Config versioning (draft/review/publish/rollback)
- SMS/Twilio notifications
- OpenTelemetry observability

**Why:** These features bring Parallly to Chatwoot-level CRM parity while maintaining AI-first advantage (LLM routing, nurturing, scoring, identity).

**How to apply:** When adding new features, check this list to avoid duplicating work. All services are registered in their respective modules and controllers have REST endpoints.
