---
name: Redis must use noeviction policy
description: Redis maxmemory-policy must be noeviction, not allkeys-lru — BullMQ jobs and tenant cache data get silently dropped otherwise
type: feedback
---

Redis with `allkeys-lru` silently evicts keys when memory is full, including BullMQ job data (outbound messages, nurturing, automation) and tenant schema cache.

**Why:** BullMQ stores job payloads in Redis. If evicted, jobs disappear without error. Outbound WhatsApp messages, nurturing follow-ups, and automation actions would be lost silently.

**How to apply:** Both `docker-compose.yml` and `docker-compose.prod.yml` must use `--maxmemory-policy noeviction`. If Redis runs out of memory, it will return errors (which are catchable) instead of silently dropping data.
