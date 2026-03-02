# Parallext Engine

> Multi-tenant conversational AI platform for sales automation — by Parallext.

## Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- Git

### Development Setup

```bash
# 1. Clone and install
npm install

# 2. Start infrastructure (PostgreSQL + Redis)
npm run docker:dev

# 3. Copy environment config
cp .env.example .env
# Edit .env with your API keys

# 4. Run database migrations
npm run db:migrate

# 5. Start the API server
npm run dev:api

# 6. Start the dashboard (separate terminal)
npm run dev:dashboard
```

### API Documentation
Once running, visit: `http://localhost:3000/docs`

## Project Structure

```
parallext-engine/
├── apps/
│   ├── api/            # NestJS Backend (port 3000)
│   └── dashboard/      # Next.js Admin Panel (port 3001)
├── packages/
│   └── shared/         # Shared types & utilities
├── infra/
│   ├── docker/         # Docker Compose configs
│   └── backup/         # Backup scripts
└── templates/
    └── personas/       # Industry persona templates (YAML)
```

## Adding a New Client

1. Create tenant via API or admin dashboard
2. Configure persona using YAML template (see `templates/personas/`)
3. Upload knowledge base documents (PDFs, catalogs)
4. Connect WhatsApp number via Meta Cloud API
5. Configure tools & integrations
6. Test in sandbox mode
7. Go live!

**Estimated onboarding time: 2-3 hours**

## License
Proprietary — Parallext © 2026
