# 🚀 Parallext Engine

**Plataforma multi-tenant de IA conversacional para ventas y atención al cliente**

[![Deploy](https://github.com/Nipko/sales-structure/actions/workflows/deploy.yml/badge.svg)](https://github.com/Nipko/sales-structure/actions)

| Servicio | URL |
|----------|-----|
| 📊 Dashboard | [admin.parallly-chat.cloud](https://admin.parallly-chat.cloud/admin) |
| 🔌 API | [api.parallly-chat.cloud](https://api.parallly-chat.cloud) |

---

## 📋 ¿Qué es Parallext?

Un motor de IA conversacional que permite a cualquier empresa automatizar sus ventas y atención al cliente por WhatsApp (y próximamente Instagram, Messenger, Telegram). Cada cliente se configura con su propia **personalidad de IA**, **base de conocimiento**, y **reglas de negocio**, sin compartir datos entre sí.

### Características principales:
- 🏢 **Multi-tenant**: Aislamiento estricto schema-per-tenant en PostgreSQL
- 🤖 **LLM Router inteligente**: 5 factores de routing, 4 tiers de modelos (GPT-4o → DeepSeek), auto-upgrade
- 📱 **WhatsApp Cloud API**: Integración directa con Meta, 6 tipos de contenido
- 👤 **Personas configurables**: Define tono, reglas y comportamiento por YAML
- 📚 **RAG Pipeline**: Ingesta de documentos, chunking, embeddings con pgvector
- 🤝 **Handoff a humanos**: Integración con Chatwoot, detección de 5 tipos de triggers
- 📊 **Analytics dual**: Redis para tiempo real + PostgreSQL para históricos
- 🛡️ **Cloudflare Tunnel**: Zero puertos abiertos, todo el tráfico vía Zero Trust

---

## 🏗️ Arquitectura

```
Internet → Cloudflare (SSL + Zero Trust Tunnel) → Docker Stack (VPS)
   ├── 📊 Dashboard   (Next.js 16, port 3001)
   ├── 🔌 API         (NestJS 10, port 3000)
   ├── 🐘 PostgreSQL  (pgvector, schema-per-tenant)
   ├── 🔴 Redis       (caché, contadores, BullMQ)
   └── 🌐 Tunnel      (cloudflared)
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
│   └── dashboard/              # Next.js 16 Admin Panel
│       └── src/app/admin/      # Dashboard + Tenants pages
├── packages/
│   └── shared/                 # Types, interfaces, constants compartidos
├── templates/
│   └── personas/turismo.yaml   # Persona template: Sofia Henao (Gecko)
├── infra/
│   ├── docker/
│   │   ├── docker-compose.prod.yml  # Stack de producción (5 containers)
│   │   ├── Dockerfile.api           # API multi-stage build
│   │   └── Dockerfile.dashboard     # Dashboard standalone build
│   ├── nginx/                  # Nginx config (backup, no activo)
│   └── scripts/
│       └── setup-vps.sh        # Script automatizado de setup del VPS
└── .github/workflows/
    └── deploy.yml              # CI/CD → SSH → Docker Compose
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
npm run dev  # Levanta API (:3000) y Dashboard (:3001)
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
3. Construye y levanta los 5 contenedores Docker
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
- [ ] **Phase 2**: Extended Features (Instagram, Messenger, Telegram, pagos)
- [ ] **Phase 3**: Scale & Polish (Kubernetes, analytics avanzados, onboarding portal)

---

## 📄 Licencia

Propiedad de Parallext / Nipko. Todos los derechos reservados.
