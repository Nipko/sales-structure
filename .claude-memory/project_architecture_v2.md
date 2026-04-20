---
name: Architecture V2 decisions (2026-04-06)
description: Key decisions for Parallly platform evolution — automation first, BullMQ stays, multi-tenant, wizard UI, branded automation agent
type: project
originSessionId: d5aaa220-582d-4f39-aed4-0a7831ce3013
---
Decisions made 2026-04-06 based on architecture spec `add_parallly_arquitectura.md`:

**Priority order:**
1. Automation system (expand triggers, conditions, wizard UI in dashboard) — COMPLETED
2. Instagram + Messenger channel adapters — COMPLETED
3. Identity service (customer unification cross-channel) — COMPLETED
4. Config service evolution (draft/review/publish)
5. SMS/Twilio notifications — COMPLETED (April 17-18, sms.adapter.ts + dashboard setup)
6. Multi-agent system — COMPLETED (April 17-18, agent_personas + agent_templates, 4 plans, 6 templates, channel routing)
7. Skills framework (dynamic, configurable)
8. OpenTelemetry observability

**Remaining priorities:**
- Config service evolution (draft/review/publish)
- Skills framework (dynamic, configurable)
- OpenTelemetry observability

**Closed decisions:**
- Stay with **BullMQ + EventEmitter2** (no NATS for now)
- Stay **multi-tenant** (schema-per-tenant)
- Config versioning stays **simple** (active/inactive) — evolve later
- Automation agent should have a **branded name** that acts as a human persona
- Dashboard automation config should be a **wizard** — intuitive, step-by-step

**Why:** User wants to solidify automation as the core differentiator before expanding channels. The branded name gives the automation a human-like identity for end customers.

**How to apply:** When building new features, follow this priority order. Don't start Instagram/Messenger until automation wizard is complete and tested.
