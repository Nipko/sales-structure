# WhatsApp Service — Claude Code Context

## Overview
NestJS 10 microservice. Port 3002. Handles WhatsApp Embedded Signup and Meta webhook routing.

## Modules
- `onboarding/` — 10-step Embedded Signup v4 flow (Facebook Login → token exchange → phone registration)
- `webhooks/` — Meta webhook receiver with HMAC-SHA256 validation
- `meta-graph/` — Meta Graph API client with retry logic
- `jobs/` — BullMQ async workers (token validation, phone sync)
- `assets/` — Template and phone number sync
- `audit/` — Audit logging
- `health/` — Liveness/readiness probes
- `prisma/` — Shared DB access

## Communication with API
- Uses `API_INTERNAL_URL` (http://api:3000/api/v1) for internal calls
- Auth via `x-internal-key` header with `INTERNAL_API_KEY`
- Shares same PostgreSQL database and Prisma schema

## Meta webhook flow
```
Meta → POST /api/v1/webhooks/whatsapp → HMAC validation → route to API's WhatsappWebhookService
```

Note: The actual message processing happens in the API service. This service handles onboarding and forwards webhooks.
