---
name: Multi-Agent System Design
description: Architecture for multi-agent system with 4 plans, channel assignment, custom templates — decided April 18 2026
type: project
originSessionId: d5aaa220-582d-4f39-aed4-0a7831ce3013
---
## 4 Subscription Plans

| Plan | Max Agents | Templates | Custom Prompt | Rate Limits |
|------|-----------|-----------|---------------|-------------|
| Starter | 1 | Built-in only | No | 50 auto/h, 200 outbound/h |
| Pro | 3 | Built-in + Custom | Yes | 500 auto/h, 2000 outbound/h |
| Enterprise | 10 | Built-in + Custom | Yes | 5000 auto/h, 20000 outbound/h |
| Custom | Unlimited | Built-in + Custom | Yes | Custom limits |

## Key Decisions
- 1 agent per channel (hard rule), warn when reassigning
- Users can save any agent as a reusable template (Pro+)
- Templates: 6 built-in (Sales, Support, FAQ, Appointments, Lead Qualifier, Custom Blank) + user-saved
- Each agent has its own schedule: 24/7 or custom hours
- Default agent: fallback for unassigned channels
- Pipeline change: getActivePersona(tenantId) → getPersonaForChannel(tenantId, channelType)

## DB: agent_personas table (per-tenant schema)
- id, name, template_id, is_active, is_default, config_json, channels (TEXT[]), schedule_mode, version

## DB: agent_templates table (per-tenant schema, for user-saved templates)
- id, name, description, config_json, created_by, created_at

## Setup Reminder Banner
- Persistent banner on dashboard when agent is still default/unconfigured
- Cannot be dismissed until user configures at least 1 agent (name + role + rules OR applies template)
- Stored in tenant settings: `agentSetupCompleted: boolean`
- Banner text: "Your agent is using the default configuration. Set up your specialized agent to get better results."
- Shows on /admin layout (visible on every page)

**Why:** User wants multi-agent with channel isolation, plan gating, and template reuse for rapid deployment. Plus persistent reminder to configure.
**How to apply:** All agent features must check plan limits before creation. Channel assignment UI must warn about conflicts. Banner must be non-dismissible until configured.
