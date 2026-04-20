---
name: Architecture Decisions
description: Key refactoring decisions made to break circular deps and improve reliability
type: project
---

**Circular deps resolved (2026-03-30):**
- ConversationsModule no longer imports WhatsappModule. Token resolution via `ChannelTokenService` in ChannelsModule.
- HandoffModule no longer imports AgentConsoleModule. Uses `EventEmitter2` (`handoff.escalated` / `handoff.completed` events). AgentConsoleGateway listens via `@OnEvent`.

**Outbound messages go through BullMQ queue** (`outbound-messages`). 3 retries, exponential backoff. Never fire-and-forget to Meta API.

**Webhook idempotency** via Redis key `idem:wa:{waMessageId}`, 24h TTL.

**Read receipts** fire-and-forget to Meta API immediately on webhook receipt, before message processing.

**Why:** These were identified as critical gaps when comparing the codebase against whatsapp-automation-blueprint.md patterns.

**How to apply:** When adding new message flows, always use OutboundQueueService. When adding new handoff triggers, emit events instead of injecting services directly.
