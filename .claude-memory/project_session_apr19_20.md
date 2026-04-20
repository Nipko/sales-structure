---
name: Session April 19-20 2026
description: Booking engine refactor — 15+ iterations, from LLM-dependent to deterministic + WhatsApp Interactive Messages
type: project
originSessionId: d5aaa220-582d-4f39-aed4-0a7831ce3013
---
## Critical: Booking Agent Pipeline (15+ iterations)

### What failed (and why)
- LLM (gpt-4o-mini, gpt-4.1-mini) cannot reliably follow multi-step booking instructions
- System prompts over ~800 tokens cause instruction-following degradation
- LLM forgets context between turns even with state injection
- LLM invents availability without calling tools
- LLM asks for email/personal info when not needed
- "no quiero" triggered false opt-out detection

### Architecture evolution
1. Prompt engineering → failed (LLM ignores long prompts)
2. State machine in prompt → failed (LLM ignores state instructions)
3. Backend state machine + pre-loaded services → partially worked but LLM still broke flow
4. Deterministic booking engine (booking-engine.service.ts) → worked for data flow but LLM still mangled responses
5. **Current: WhatsApp Interactive Messages + deterministic engine** → in testing

### Current architecture
```
Message → BookingEngine.process() → deterministic decision
  ├── Interactive message (WhatsApp list/buttons) → sent directly, NO LLM
  ├── Text response → LLM ONLY translates (isolated context, no history)
  └── Not booking → LLM handles with minimal tools
```

### Key files
- `conversations/booking-engine.service.ts` — deterministic flow, multi-language intent detection
- `conversations/conversations.service.ts` — orchestrator, sends interactive messages directly
- `channels/whatsapp/whatsapp.adapter.ts` — sendListMessage, sendButtonMessage, parseInteractiveReply
- `conversations/tools/appointment-tools.ts` — tool definitions (used when LLM handles non-booking)
- `conversations/ai-tool-executor.service.ts` — tool execution with service name→UUID resolution

### Bugs fixed
- Session detection: previousMessageAt captured before saveMessage updates timestamp
- toolContext/bookingState cleared on new session (30min gap)
- Service matching: accent normalization (consultoría = consultoria)
- Date extraction: hoy/mañana/lunes + month names in 4 languages
- Google Calendar timezone: busy times converted to tenant timezone for comparison
- serviceId resolution: LLM passes name instead of UUID → fuzzy match
- Opt-out: "no quiero" too broad → changed to "no quiero recibir/mensajes/que me contacten"
- Circular dependency: AppointmentsModule ↔ ChannelsModule → forwardRef
- durationMinutes field name mismatch (was "duration")

### Model analysis
- gpt-4o-mini: too weak for tool calling (~75% reliability)
- gpt-4.1-mini: not ranked in benchmarks, unreliable
- gpt-4o: ~90% tool calling but $0.018/convo
- Claude Opus 4.6: 99.3% tool calling (best) but most expensive
- **Recommendation**: don't depend on ANY model for flow decisions

### Research findings (Parlant, LangGraph, etc.)
- **Parlant** (parlant.io): dynamic context assembly — only relevant guidelines per turn
- **LangGraph**: explicit state machine with nodes/edges, tool execution guaranteed
- **Pydantic AI**: type-safe tool calling with validation and retries
- **WhatsApp Interactive Messages**: native lists + buttons, 99%+ reliable
- Production bots (Bland AI, Retell AI) use deterministic flows, not LLM decisions
- `tool_choice: "required"` forces LLM to call tools (we never used this)
- `strict: true` in tool definitions guarantees schema adherence

### Cost analysis (per conversation, 5-8 turns)
| Model | Cost/convo | 400 convos/month |
|-------|-----------|-----------------|
| gpt-4o-mini | $0.001 | $0.40 |
| gpt-4.1-mini | $0.003 | $1.20 |
| gpt-4o | $0.018 | $7.20 |

### Pending issues
- WhatsApp Interactive Messages may not be rendering (need to verify API response)
- LLM translation fallback now isolated but needs production testing
- Google Calendar scope not yet verified by Google (testing mode only)
- Booking state persistence between turns needs production validation
