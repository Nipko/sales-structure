# 🚀 Parallext Engine

**Plataforma multi-tenant de IA conversacional para ventas y atención al cliente**

[![Deploy](https://github.com/Nipko/sales-structure/actions/workflows/deploy.yml/badge.svg)](https://github.com/Nipko/sales-structure/actions)

| Servicio | URL | Puerto |
|----------|-----|--------|
| 📊 Dashboard | [admin.parallly-chat.cloud](https://admin.parallly-chat.cloud/admin) | 3001 |
| 🔌 API | [api.parallly-chat.cloud](https://api.parallly-chat.cloud) | 3000 |
| 📱 WhatsApp Onboarding | [wa.parallly-chat.cloud](https://wa.parallly-chat.cloud) | 3002 |

### 📚 Documentación

| Documento | Descripción |
|-----------|------------|
| [MANUAL.md](MANUAL.md) | Manual completo de la plataforma |
| [docs/](docs/README.md) | Índice completo de documentación |
| [docs/SECURITY.md](docs/SECURITY.md) | Autenticación, JWT, RBAC, cifrado |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Endpoints REST, WebSocket events, BullMQ queues |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Historial de cambios por versión |
| [CLAUDE.md](CLAUDE.md) | Contexto de arquitectura para desarrollo |

## 📋 ¿Qué es Parallext?

Un motor de IA conversacional que permite a cualquier empresa automatizar sus ventas y atención al cliente por WhatsApp (y próximamente Instagram, Messenger, Telegram). Cada cliente se configura con su propia **personalidad de IA**, **base de conocimiento**, y **reglas de negocio**, sin compartir datos entre sí.

### Características principales:
- 🏢 **Multi-tenant**: Aislamiento estricto schema-per-tenant en PostgreSQL
- 🤖 **LLM Router inteligente**: 5 factores de routing, 4 tiers de modelos (GPT-4o → DeepSeek), auto-upgrade
- 📱 **WhatsApp Cloud API**: Integración directa con Meta, 6 tipos de contenido
- 👤 **Personas configurables**: Define tono, reglas y comportamiento por YAML
- 📚 **RAG Pipeline**: Ingesta de documentos, chunking, embeddings con pgvector
- 🤝 **Handoff a humanos**: Agent Console interno con WebSocket, detección automática de 5 tipos de triggers
- 📊 **Analytics dual**: Redis para tiempo real + PostgreSQL para históricos
- 🛡️ **Cloudflare Tunnel**: Zero puertos abiertos, todo el tráfico vía Zero Trust

---

## 🏗️ Arquitectura

```
Internet → Cloudflare (SSL + Zero Trust Tunnel) → Docker Stack (VPS)
   ├── 📊 Dashboard         (Next.js 16, port 3001)
   ├── 🔌 API               (NestJS 10, port 3000)
   ├── 📱 WhatsApp Service   (NestJS 10, port 3002) ← NEW
   ├── 🐘 PostgreSQL         (pgvector, schema-per-tenant)
   ├── 🔴 Redis              (caché, contadores, BullMQ)
   └── 🌐 Tunnel             (cloudflared)
```

## 📁 Estructura del Monorepo

```
Sales_Structure/
├── apps/
│   ├── api/                    # NestJS Backend API
│   │   ├── src/modules/
│   │   │   ├── auth/           # JWT + RBAC + Tenant Isolation
│   │   │   ├── tenants/        # Multi-tenant management
│   │   │   ├── channels/       # Channel Gateway + WhatsApp adapter
│   │   │   ├── ai/             # LLM Router + Providers
│   │   │   ├── conversations/  # Orchestrator
│   │   │   ├── persona/        # YAML-based persona engine
│   │   │   ├── knowledge/      # RAG pipeline
│   │   │   ├── handoff/        # Chatwoot integration
│   │   │   ├── analytics/      # Event tracking + metrics
│   │   │   ├── prisma/         # Database service
│   │   │   └── redis/          # Cache service
│   │   └── prisma/
│   │       ├── schema.prisma   # Global tables
│   │       ├── tenant-schema.sql  # Template para tenant schemas
│   │       └── seed-gecko.sql  # Seed del piloto Gecko Aventura
│   ├── dashboard/              # Next.js 16 Admin Panel
│   │   └── src/
│   │       ├── app/admin/      # 8+ páginas: dashboard, tenants, inbox,
│   │       │                   #   contacts, pipeline, automation,
│   │       │                   #   agent-analytics, settings, channels
│   │       ├── contexts/       # AuthContext + TenantContext
│   │       ├── hooks/          # useApiData (LIVE/DEMO badge)
│   │       ├── lib/            # api.ts (centralized HTTP client)
│   │       └── components/     # Sidebar, UI components
│   └── whatsapp/               # WhatsApp Onboarding Service (NestJS) ← NEW
│       └── src/
│           ├── modules/
│           │   ├── onboarding/   # Embedded Signup v4 flow (10 steps)
│           │   ├── webhooks/     # HMAC-SHA256 validated webhook handler
│           │   ├── meta-graph/   # Meta Graph API client with retry
│           │   ├── jobs/         # BullMQ workers for async processing
│           │   ├── assets/       # Template + phone sync
│           │   └── audit/        # Audit logging
│           ├── common/           # Guards, decorators, enums
│           └── config/           # App, DB, Redis, Meta configs
├── packages/
│   └── shared/                 # Types, interfaces, constants compartidos
├── templates/
│   └── personas/turismo.yaml   # Persona template: Sofia Henao (Gecko)
├── infra/
│   ├── docker/
│   │   ├── docker-compose.prod.yml  # Stack de producción (6 containers)
│   │   ├── Dockerfile.api           # API multi-stage build
│   │   ├── Dockerfile.dashboard     # Dashboard standalone build
│   │   └── Dockerfile.whatsapp      # WhatsApp service build ← NEW
│   ├── nginx/                  # Nginx config (backup, no activo)
│   └── scripts/
│       └── setup-vps.sh        # Script automatizado de setup del VPS
└── .github/workflows/
    └── deploy.yml              # CI/CD → SSH → Docker Compose (3 images)
```

---

## 🔧 Tech Stack

| Capa | Tecnología |
|------|-----------|
| **Backend** | NestJS 10, TypeScript, Prisma ORM |
| **Frontend** | Next.js 16, React, CSS (dark mode glassmorphism) |
| **Database** | PostgreSQL 16 + pgvector, Redis 7 |
| **AI** | OpenAI, Anthropic Claude, Google Gemini, xAI Grok, DeepSeek |
| **Messaging** | WhatsApp Cloud API (Meta), BullMQ |
| **Infra** | Docker, Cloudflare Tunnel, Hostinger VPS (Ubuntu) |
| **CI/CD** | GitHub Actions |
| **Monorepo** | Turborepo |

---

## 🚀 Setup Local

```bash
# 1. Clonar
git clone https://github.com/Nipko/sales-structure.git
cd sales-structure

# 2. Instalar dependencias
npm install

# 3. Configurar variables
cp .env.example .env
# Editar .env con tus credenciales

# 4. Levantar DB y Redis localmente
docker compose -f infra/docker/docker-compose.dev.yml up -d

# 5. Ejecutar migraciones
cd apps/api && npx prisma migrate dev

# 6. Desarrollo
npm run dev              # Levanta API (:3000), Dashboard (:3001), WhatsApp (:3002)
npm run dev:whatsapp     # Solo WhatsApp service
```

---

## 🌐 Deploy en Producción (VPS)

```bash
# En el VPS:
cd /opt/parallext-engine
git pull origin main
bash infra/scripts/setup-vps.sh
```

El script `setup-vps.sh`:
1. Genera JWT secrets automáticamente
2. Crea `.env` de producción
3. Construye y levanta los 6 contenedores Docker (API, Dashboard, WhatsApp, Postgres, Redis, Tunnel)
4. Ejecuta el seed de Gecko Aventura

---

## 🦎 Gecko Aventura — Primer Piloto

| Tour | Precio (COP) | Dificultad |
|------|-------------|-----------|
| Rafting Río Chicamocha | $180,000 | Intermedio-avanzado |
| Parapente Cañón Chicamocha | $250,000 | Principiante |
| Canyoning Cascada Juan Curí | $150,000 | Intermedio |
| Espeleología Cueva del Indio | $120,000 | Fácil-intermedio |
| Bungee Jumping 70m | $200,000 | Extremo |
| Combo Aventura Total (2 días) | $650,000 | Intermedio-avanzado |

**Persona IA**: Sofia Henao — Asesora de aventuras extremas  
**Configuración**: `templates/personas/turismo.yaml`

---

## 📊 LLM Router — Tiers de Modelos

| Tier | Modelos | Uso |
|------|---------|-----|
| 🟣 Premium | GPT-4o, Claude Sonnet | Tickets altos, cierre de venta |
| 🔵 Standard | GPT-4o-mini, Gemini Pro | Consultas complejas |
| 🟢 Efficient | Gemini Flash, Grok | Conversaciones normales |
| 🟡 Budget | DeepSeek | FAQs simples, saludos |

**5 factores de routing**: Valor del ticket (30%), Complejidad (30%), Etapa de conversación (20%), Sentimiento (10%), Tipo de intent (10%)

---

## 📈 Roadmap

- [x] **Phase 1**: Foundation (MVP Core) ✅
- [x] **Phase 1.11**: Frontend → API Integration ✅
- [x] **Phase 2.1**: WhatsApp Embedded Signup v4 Onboarding ✅ ← NEW
- [ ] **Phase 2.2**: Extended Features (Instagram, Messenger, Telegram, pagos)
- [ ] **Phase 3**: Scale & Polish (Kubernetes, analytics avanzados)

---

## 📄 Licencia

Propiedad de Parallext / Nipko. Todos los derechos reservados.
