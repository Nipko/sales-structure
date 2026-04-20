---
name: Chatwoot feature analysis for Parallly roadmap
description: Comprehensive comparison of Chatwoot CRM features vs Parallly current state — use as product roadmap reference
type: reference
---

Analysis completed 2026-04-07. Use as reference when planning new CRM features.

## HIGH PRIORITY (Competitive Advantage)

| Feature | Chatwoot | Parallly | Gap |
|---------|----------|---------|-----|
| Agent Capacity Limits | Enterprise only | Missing | Set max conversations per agent |
| SLA with Breach Alerts | Full | Partial (cron check) | Need real-time alerts + dashboard |
| CSAT Surveys + Reports | Full | Table exists, no UI | Need survey trigger + reports page |
| Pre-Chat Forms | Full | Missing | Collect info before agent responds |
| Contact Merge/Dedup | Full | Merge suggestions (new) | Need UI polish + auto-merge option |
| Company/Org Profiles | Full | Missing | B2B account-based support |
| Knowledge Base / Help Center | Full (articles, categories, multi-lang) | RAG docs only | Need public-facing help center |
| Macros (saved action sequences) | Full | Missing | Multi-step agent shortcuts |

## MEDIUM PRIORITY (Operational Efficiency)

| Feature | Gap |
|---------|-----|
| Conversation Snooze | Hide + auto-reappear at set time |
| Agent Availability Status | Online/Busy/Offline with auto-assignment rules |
| Supervisor Live View | Real-time monitoring of all agents |
| Campaign Management | One-time + ongoing campaigns with triggers |
| Custom Attributes (dynamic) | Flexible fields without schema changes |
| Contact Segments (saved filters) | AND/OR logic on any attribute |
| Contact Import/Export CSV | Bulk operations |
| Label-based Reports | Analytics grouped by conversation tags |
| Inbox-specific Reports | Per-channel analytics |
| Slack Integration | Handle conversations from Slack |

## LOWER PRIORITY (UX Polish)

| Feature | Gap |
|---------|-----|
| Keyboard Shortcuts | Command palette (Cmd+/) |
| Desktop Push Notifications | Browser notifications API |
| Sound Alerts | Audio on new message |
| Mobile App | Native iOS/Android |
| Message Formatting | Markdown, code blocks, emoji picker |
| Contact Activity Timeline | Unified history across all interactions |

## WHAT PARALLLY ALREADY HAS (vs Chatwoot)

- Multi-tenant architecture (Chatwoot is single-tenant)
- AI agent with LLM routing (Chatwoot has basic OpenAI integration)
- Plan-based rate limiting and throttling
- Automated nurturing sequences (3-attempt follow-up)
- Lead scoring with composite algorithm
- Pipeline auto-progress from conversation signals
- Identity service with cross-channel merge suggestions
- WhatsApp Embedded Signup onboarding
- Instagram + Messenger adapters (Chatwoot same)
