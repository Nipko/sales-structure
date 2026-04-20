---
name: UUID casts required in raw SQL
description: All executeInTenantSchema queries comparing UUID columns must use ::uuid casts — PostgreSQL does not auto-cast text to uuid
type: feedback
---

Every raw SQL query via `executeInTenantSchema` that compares a UUID column to a `$N` parameter MUST include `::uuid` cast. PostgreSQL throws `operator does not exist: uuid = text` otherwise.

**Why:** PostgreSQL strict typing — Prisma passes all parameters as text, but UUID columns require explicit casting in raw queries. This was a systemic issue across 20+ files caught in production 2026-04-06.

**How to apply:** When writing any new `executeInTenantSchema` call:
- `WHERE id = $1::uuid` (not `WHERE id = $1`)
- `VALUES ($1::uuid, ...)` when inserting into UUID columns
- `WHERE conversation_id = $1::uuid`, `WHERE lead_id = $1::uuid`, etc.
