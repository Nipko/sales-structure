---
name: No Chatwoot - internal CRM only
description: User explicitly stated Chatwoot is NOT part of this project - handoff goes to internal agent console
type: feedback
---

No Chatwoot in this project. The CRM and agent console are built into the system itself. Handoff escalation goes to the internal agent console (WebSocket gateway at /agent namespace), NOT to Chatwoot.

**Why:** User made it explicitly clear: "Chatwoot aqui no va! El crm esta implementado en este sistema propio."

**How to apply:** Never reference Chatwoot for inbox, messaging, or handoff. The HandoffService notifies agents via AgentConsoleGateway WebSocket events. All messaging goes direct to Meta API via ChannelGatewayService.
