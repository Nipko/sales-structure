# Dashboard (`apps/dashboard`)

Panel web de Parallly para tenants y super_admin. Next.js 16 (App Router), React 19, Tailwind + shadcn/ui, next-intl (es/en/pt/fr). Puerto 3001.

- Desarrollo: `npm run dev:dashboard` desde la raíz del monorepo.
- Tipos: `cd apps/dashboard && npx tsc --noEmit`.
- Toda página nueva o editada actualiza los 4 archivos de `messages/` (es/en/pt/fr).
- Acceso por página: `packages/shared/src/dashboard-page-access.ts` (deny-by-default).
- Contexto para agentes de código: [`CLAUDE.md`](CLAUDE.md). Convenciones del monorepo: [`../../AGENTS.md`](../../AGENTS.md).
