---
name: WhatsApp Automation Blueprint
description: Reference doc from prior project (Parallext original) with Chatwoot-based WhatsApp automation patterns and gotchas
type: reference
---

The file `whatsapp-automation-blueprint.md` in the repo root contains lessons learned from a prior project implementation using Chatwoot as the WhatsApp inbox.

Key gotchas documented: Chatwoot SuperAdmin tokens don't work with account API, Cloudflare strips api_access_token header (use Docker internal network), TypeORM numeric→string casting for OpenAI params, Chatwoot webhook payload varies by version (use `any` not strict DTOs), account field is object not number, Docker networks between compose stacks need external bridge.

**Why:** The current project (Parallext Engine) has evolved beyond Chatwoot to a custom solution but still uses Chatwoot for handoff. The blueprint patterns inform the WhatsApp integration approach.

**How to apply:** When working on webhook handling, Chatwoot handoff, or WhatsApp messaging, reference these gotchas to avoid repeating past mistakes.
