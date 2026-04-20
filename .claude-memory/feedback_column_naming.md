---
name: Prisma @map vs raw SQL column names
description: Raw SQL must use snake_case DB column names, not camelCase Prisma field names — Prisma @map only applies to Prisma client queries
type: feedback
---

Prisma `@map("is_active")` renames `isActive` to `is_active` in PostgreSQL, but raw SQL queries (`$queryRaw`, `executeInTenantSchema`) hit PostgreSQL directly and must use the actual DB column name.

**Why:** `"isActive"` (quoted) is case-sensitive in PostgreSQL and doesn't match `is_active`. Caught in production: SLA cron and nurturing cron both failed with `column "isActive" does not exist`.

**How to apply:** In raw SQL, always use:
- `is_active` not `"isActive"`
- `first_name` not `"firstName"`
- `tenant_id` not `"tenantId"`
- `schema_name` not `"schemaName"`

The `users` table has a generated column `name` = `TRIM(first_name || ' ' || last_name)` for use in raw JOIN queries.
