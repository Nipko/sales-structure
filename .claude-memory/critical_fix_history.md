---
name: Critical Fix History
description: Critical bugs found and fixed during April 17-18 sessions — DO NOT reintroduce these patterns
type: feedback
originSessionId: d5aaa220-582d-4f39-aed4-0a7831ce3013
---
## NEVER add dependencies to OutboundQueueProcessor
**Why:** Adding ComplianceService to the BullMQ processor broke the DI graph. The processor silently failed to instantiate, causing ALL outbound messages to never be processed — no error in logs.
**How to apply:** Any compliance/analytics check must happen BEFORE enqueueing (in ConversationsService), not in the processor itself. The processor must only have ChannelGatewayService + TenantThrottleService.

## NEVER block conversation replies based on opt-out
**Why:** isBlocked() was returning true for a contact and skipping the AI response. If a customer writes to you, you MUST always respond. Opt-out blocking only applies to proactive outbound (broadcasts, automations, reminders).
**How to apply:** Only check isBlocked in broadcast/automation/reminder flows, never in processIncomingMessage response path.

## Always use ::uuid casts in raw SQL
**Why:** PostgreSQL doesn't implicitly cast text to uuid. Missing casts cause silent failures.
**How to apply:** Every $N parameter that goes into a UUID column needs ::uuid. Also ::timestamp for timestamp columns.

## Business hours 24/7 detection
**Why:** The isWithinBusinessHours method didn't detect the 24/7 pattern (all days 00:00-23:59). Also had off-by-one with < instead of <=.
**How to apply:** Check for 24/7 pattern first (all 7 values with start=00:00 end=23:59 → return true). Use <= for end time comparison.

## Analytics tracking was never wired
**Why:** AnalyticsService.trackEvent() was never called from ConversationsService. Dashboard showed "No data" because Redis counters were never incremented.
**How to apply:** Track events at: conversation_started (step 1), message_sent (step 6), handoff_triggered (step 5). All fire-and-forget (.catch(() => {})).
