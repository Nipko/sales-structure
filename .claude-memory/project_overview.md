---
name: Parallext Engine Project Overview
description: Multi-tenant conversational AI SaaS platform - monorepo with API, Dashboard, WhatsApp service
type: project
---

Parallext Engine is a multi-tenant conversational AI platform for sales automation.

**Stack**: NestJS 10 (API + WhatsApp), Next.js 16 (Dashboard), PostgreSQL 16 + pgvector, Redis 7, BullMQ, Turborepo monorepo.

**3 Apps**: @parallext/api (port 3000), @parallext/dashboard (port 3001), @parallext/whatsapp (port 3002). Shared types in @parallext/shared.

**Pilot client**: Gecko Aventura (tourism company in Colombia).

**Key domains**: WhatsApp Cloud API integration, LLM Router (OpenAI/Anthropic/Gemini/DeepSeek), CRM pipeline, agent console (WebSocket), handoff to human via Chatwoot, automation rules, knowledge base (RAG).

**Deployment**: Docker Compose + Cloudflare Tunnel + Watchtower on Hostinger VPS. CI/CD via GitHub Actions → GHCR.

**Why:** Building a full SaaS to automate WhatsApp sales conversations with AI for Latin American SMBs.

**How to apply:** All work should consider multi-tenancy, the WhatsApp pipeline flow, and production deployment constraints.
