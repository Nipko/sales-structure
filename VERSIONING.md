# Versionado — Parallly Engine

## Semantic Versioning (SemVer)

Formato: `MAJOR.MINOR.PATCH` (ej: `v4.1.2`)

| Tipo | Cuando | Ejemplo |
|------|--------|---------|
| **MAJOR** (4.x.x) | Cambios que rompen API o requieren migracion | Reestructura de DB, endpoints eliminados |
| **MINOR** (x.1.x) | Features nuevos (backwards compatible) | Nuevo modulo, nueva pagina, nuevo endpoint |
| **PATCH** (x.x.1) | Bug fixes, mejoras menores | Fix de query, correccion de UI, typo |

## Conventional Commits

Todos los commits deben seguir este formato:

```
tipo(alcance): descripcion corta

Cuerpo opcional con mas detalle.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

### Tipos permitidos

| Tipo | Uso | Bump |
|------|-----|------|
| `feat` | Nuevo feature | MINOR |
| `fix` | Bug fix | PATCH |
| `docs` | Solo documentacion | - |
| `refactor` | Reestructuracion sin cambio funcional | PATCH |
| `perf` | Mejora de rendimiento | PATCH |
| `test` | Tests | - |
| `chore` | Mantenimiento, deps, CI | - |
| `ci` | Cambios de CI/CD | - |
| `style` | Formato, CSS, sin cambio logico | - |
| `BREAKING CHANGE` | En el footer = MAJOR bump | MAJOR |

### Alcances comunes

`auth`, `inbox`, `crm`, `media`, `compliance`, `appointments`, `email-templates`,
`channels`, `ai`, `deploy`, `infra`, `api`, `dashboard`, `whatsapp`, `landing`

## Flujo de Release

### 1. Desarrollo normal (en main)
```bash
git commit -m "feat(media): add batch upload support"
git commit -m "fix(inbox): timestamp not showing for old messages"
git push origin main
```

### 2. Crear release
```bash
# Actualizar version en package.json (todos)
# Crear tag
git tag -a v4.1.0 -m "v4.1.0 — Media batch upload, inbox timestamp fix"
git push origin v4.1.0

# Crear GitHub Release (automatico via gh CLI)
gh release create v4.1.0 --title "v4.1.0" --notes-from-tag
```

### 3. Hotfix (fix urgente en produccion)
```bash
git commit -m "fix(auth): prevent token expiry loop"
git push origin main

# Bump patch
git tag -a v4.1.1 -m "v4.1.1 — Fix auth token expiry"
git push origin v4.1.1
```

## Historial de Versiones

| Version | Fecha | Descripcion |
|---------|-------|-------------|
| v4.0.0 | 2026-04-13 | Google OAuth, Media, Templates, Appointments, PgBouncer, Sentry |
| v3.1.0 | 2026-03-30 | CRM completo, design system, landing page, WhatsApp Embedded Signup |
| v3.0.0 | 2026-03-15 | Multi-tenant, schema-per-tenant, LLM Router, BullMQ |
