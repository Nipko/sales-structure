# Feature Request Board — Investigación y Diseño para Parallly

> Documento de diseño accionable. Fecha: Abril 2026.
> Propósito: construir un módulo propio de feedback y votación embebido en el dashboard de Parallly.

---

## 1. Análisis de Plataformas Líderes

### 1.1 Canny.io (líder de mercado)

**Pricing:** Free (100 posts), Core $24/mes, Pro $99/mes, Business custom. Crece por "tracked users" — a 1,000 usuarios activos el costo sube a $250-530/mes.

**Modelo de datos (documentado en su API pública):**
- **Post**: id, title, details, score (conteo de votos), status, statusChangedAt, category{id,name,parentID}, board{id,name,isPrivate}, author{User}, tags[{id,name}], mergeHistory[], imageURLs[], customFields{}, eta (MM/YYYY), etaPublic, jira/linear/clickup linkedIssues, commentCount, created
- **Vote**: id, userID, postID, created
- **Comment**: id, value, author, parentID (replies), reactions{}, internal (bool), private, likeCount, imageURLs[], mentions[]
- **Board**: id, name, isPrivate, privateComments, postCount, url
- **Category**: id, name, parentID (jerarquía 2 niveles), board, postCount

**Flujo de status:** open → under review → planned → in progress → complete → closed. Admiten statuses personalizados con color y descripción. Solo admins cambian status; al cambiar se notifica por email a todos los votantes.

**Algoritmo de priorización:** conteo de votos puro (campo `score`). En Growth+ permiten marcar votos como "Nice to have / Important / Must have" — multiplica peso. Sin decay temporal. Sin peso por plan del cliente.

**AI (Autopilot):** detección semántica de duplicados (modo automático o manual con aprobación). Smart Replies automáticas con follow-up questions. Comment Summaries. Feedback Discovery desde Intercom/Zendesk/Gong. Audit log de todas las acciones automáticas, reversible.

**UI patterns:** lista ordenable por votos/recientes/trending. Botón de voto con contador izquierdo. Sidebar con filtros status/categoría/tag. Vista detalle con campo details, comentarios anidados (2 niveles), reactions. Roadmap como vista kanban de columnas por status.

**Anti-spam:** vote limits por usuario, private boards, post approval antes de publicar.

**Multi-tenancy:** cada cliente de Canny tiene su propio workspace. No hay "meta-board" nativo. Segmentación por atributos de usuario (plan, company, MRR) para filtrar qué piden los enterprise vs starter.

---

### 1.2 ProductBoard

**Pricing:** Starter gratuito, Pro $80/maker/mes, Scale custom.

**Modelo de datos:** feedback items se mapean a features. Cada feedback tiene "impact score" (0 a +3) asignado manualmente. Features tienen prioridad total = suma de impact scores. Soporta objectives/OKRs vinculados a features.

**Priorización:** score manual de impacto + esfuerzo. No revenue-weighted nativamente. No soporta conectar atributos de cuenta (plan, MRR) con feedback — es la principal crítica documentada.

**Diferenciadores:** portal de investigación de clientes, vinculación de features a OKRs, Pulse AI para detectar tendencias en grandes volúmenes. Orientado a product managers con procesos formales.

**Limitación crítica para B2B:** "No lets you connect account data (plan, MRR, customer type) with your feedback" — esto lo hace inferior para SaaS con segmentación por tier.

---

### 1.3 UserVoice

**Pricing:** $899-1,333/mes (enterprise only). No viable para SaaS LatAm.

**Modelo de datos:** ideas con votos + revenue attribution. Cada votante puede tener `account.arr` adjunto, lo que permite ver "cumulative ARR tied to each feature".

**Priorización:** revenue-weighted — las ideas se pueden ordenar por suma del ARR de todos los votantes. Vista dual: popularidad (votos brutos) + impacto económico (ARR agregado). Segmentación por plan, empresa, región.

**Diferenciador único:** es el único que conecta nativo Salesforce para llevar ARR a nivel de feature request. Ideal para enterprise B2B donde un cliente vale $500K/año.

**Workflow:** Jira sync en plan Premium. Email notifications en cada cambio de status. Moderación de contenido, ban de usuarios.

---

### 1.4 FeatureOS (antes Feature.so)

**Pricing:** Starter $60/mes, Growth $120/mes, Business $250/mes. +$15/mes por seat adicional.

**AI features (las más avanzadas del mercado mid-market):**
- Duplicate detection en tiempo real, "intent-aware, not just keyword matching" — usa embeddings + contexto semántico
- Sentiment analysis automático en feedback
- Auto-sugerencia de assignee, label, equipo basado en patrones históricos
- Natural language search sobre todo el backlog
- Instant replies con sugerencias pre-construidas

**Modelo:** 5 módulos integrados: Feedback Board, Product Roadmap, Forms, Changelog, Knowledge Base. User Segmentation (5 segmentos en Growth, 10 en Business). Full REST API en Growth+. SSO en Growth+.

**Multi-producto:** soporte de múltiples boards y roadmaps. Roadmaps internos vs públicos.

**Changelog:** widget embebible, email releases hasta 50K/mes, analytics de engagement.

---

### 1.5 Frill

**Pricing:** Startup $25/mes (50 ideas), Business $49/mes, Growth $149/mes, Enterprise $349/mes+.

**Modelo:** idea board + roadmap kanban + announcements (changelog). Tablero con columnas custom (under consideration / upcoming / building / launched). Benefit/Cost scores configurables para priorización.

**Diferenciadores:** UI/UX considerado uno de los mejores del mercado. Multi-language support (internacionalización del widget). SSO en todos los planes. Built-in prioritization scoring (Benefit vs Cost). Embeddable widget.

**Notificaciones:** email automático a votantes cuando cambia el status. @mentions en comentarios.

**Limitaciones:** 50 ideas máximo en plan Startup. No AI. Sin revenue weighting.

---

### 1.6 Nolt.io

**Pricing:** Essential $29/mes (1 board), Pro $69/mes (5 boards). Sin plan gratuito.

**Modelo:** feedback boards con tags/status personalizables. Post approval mode. Merge tool para duplicados (manual). Anonymous voting.

**Diferenciador:** el mejor diseño visual del mercado según reviews. Rating G2: 5.0/5. Extremadamente simple de configurar.

**Limitaciones:** sin changelog, sin AI, sin API, sin Jira integration, inglés solamente. El más limitado funcionalmente entre los comparados.

**Flujo de status:** completamente customizable con tags de color. Email automático a votantes.

---

### 1.7 FeedBear

**Pricing:** $49/mes por proyecto. 14-day trial.

**Modelo:** feedback board + roadmap + changelog integrado. Votación sin registro obligatorio (reduce fricción, aumenta participación 3-10x según documentación propia).

**Diferenciador:** único que permite votar sin crear cuenta — reduce la fricción al máximo. Custom branding. Multi-project en un solo workspace.

**Notificaciones:** alerts automáticos cuando features van al roadmap.

---

### 1.8 Fider (open source)

**Pricing:** gratis, self-hosted. Stack: Go + PostgreSQL + React.

**Modelo de datos (inferido del repo):**
- Tenants propios (multi-tenant en una instalación)
- posts: id, tenant_id, number, title, description, slug, user_id, tags[], status, votes_count, created_at
- votes: id, post_id, user_id, created_at
- comments: id, post_id, user_id, content, created_at, edited_at, reactions JSONB
- tags: id, tenant_id, name, slug, color, is_public
- webhooks: id, name, type, status, url, content, http_method, additional_http_headers, tenant_id
- notifications: por email en cambios de status y nuevos comentarios

**Priorización:** conteo de votos puro, sin decay.

**Diferenciador clave:** completamente open source, esquema PostgreSQL extensible, multi-tenant por diseño. Es la referencia técnica más cercana para implementar un módulo propio.

---

### 1.9 Upvoty

**Pricing:** $15/mes (1 board, 150 tracked users), $25/mes (3 boards), $49/mes (unlimited).

**Modelo:** feedback hub + roadmap + changelog. SSO. Anonymous voting sin login.

**Diferenciador:** el más barato del mercado con SSO y anonymous voting. Inglés solamente — crítico para LatAm.

---

### 1.10 Pendo Feedback

**Pricing:** $10,000-50,000+/año. Solo en planes enterprise de Pendo (todo el suite).

**Modelo:** feature requests integrados con in-app analytics de Pendo. Correlación entre "lo que piden" y "lo que realmente usan". Conecta votantes con sesiones de usuario, funnels, y NPS.

**Diferenciador único:** es el único que correlaciona feature requests con behavioral analytics in-app. Si el usuario votó por "exportar a CSV" pero nunca usa la vista de tablas, el voto tiene menos peso.

---

## 2. Best Practices Universales

Todos los líderes implementan estos patrones — son el baseline obligatorio:

1. **Votación visible con contador prominente** — botón izquierdo del post con número. Feedback inmediato al hacer clic (optimistic UI).
2. **Flujo de status canónico** — open → under review → planned → in progress → shipped → declined. Colores por status. Solo admins lo cambian.
3. **Email automático a votantes** — trigger en cada cambio de status. El "shipping notification" es el momento de mayor satisfacción del usuario.
4. **Merge de duplicados** — herramienta para fusionar posts similares, consolidando votos. Al menos manual; los líderes lo hacen con AI.
5. **Comentarios con @mentions** — discusión en el post. Admins deben poder comentar internamente (hidden from public).
6. **Roadmap público** — kanban o lista de columnas por status. Genera confianza y reduce soporte ("¿van a implementar X?").
7. **Changelog / Announcements** — cierra el loop: "shippeamos lo que pediste". Vinculado automáticamente a los posts originales.
8. **Filtros y búsqueda** — por status, categoría, tag. Orden por votos / recientes / trending.
9. **Embeddable widget** — para capturar feedback desde dentro del producto, no solo en un portal externo.
10. **Post approval** — moderar antes de publicar. Reduce spam y duplicados.
11. **SSO / Identity** — el voter debe ser la misma persona que usa el producto. Previene ballot stuffing.

---

## 3. Diferenciadores por Plataforma

| Plataforma | Diferenciador único |
|---|---|
| Canny | 50+ integraciones, Autopilot AI con audit trail, más maduro del mercado |
| ProductBoard | Vinculación a OKRs, portal de investigación, Pulse AI para tendencias |
| UserVoice | Revenue-weighted (ARR por votante), Salesforce native, único para enterprise sales |
| FeatureOS | AI más completo del mid-market: embeddings, sentiment, auto-label, NL search |
| Frill | Mejor UX/UI, Benefit/Cost scoring, multi-language widget |
| Nolt | Diseño premium, simplicidad radical, 5.0/5 G2 |
| FeedBear | Votación sin registro (máxima participación) |
| Fider | Open source, PostgreSQL extensible, multi-tenant nativo |
| Upvoty | Más barato con anonymous voting + SSO |
| Pendo | Correlación behavioral analytics + feature requests |

---

## 4. Algoritmos de Ranking Observados

### 4.1 Conteo simple (Canny, Nolt, Upvoty)
```
score = vote_count
```
Problema: favorece posts antiguos que acumularon votos. Un request con 100 votos de hace 2 años puede bloquear a uno con 80 votos esta semana.

### 4.2 Hacker News score (tiempo exponencial)
```
score = (P - 1) / (T + 2)^1.5
donde P = puntos (votos), T = edad en horas
```
Excelente para contenido de alta rotación (noticias). Demasiado agresivo en decay para feature requests donde la demanda puede ser estable por meses.

### 4.3 Reddit hot score (logarítmico, no decae)
```
score = log10(max(abs(ups - downs), 1)) + sign * seconds / 45000
```
No decae con el tiempo — posts más recientes tienen ventaja por el componente `seconds`. Los primeros 10 votos valen tanto como los siguientes 100 (escala logarítmica).

### 4.4 Wilson Score (estadístico, confianza)
```
score = (p_hat + z²/2n - z * sqrt(p_hat*(1-p_hat)/n + z²/4n²)) / (1 + z²/n)
donde p_hat = votos_positivos/total, z = 1.96 (95% confianza)
```
Ideal para sistemas con upvotes Y downvotes. No aplica bien a feature boards donde solo hay upvotes.

### 4.5 Hybrid score ponderado por tier (RECOMENDADO para Parallly)
El más adecuado para un SaaS B2B con planes de pago:

```
score = Σ(vote_weight_i) × recency_factor × engagement_bonus

donde:
  vote_weight_i (por plan del tenant votante):
    starter    = 1.0
    pro        = 2.5
    enterprise = 5.0
    custom     = 8.0

  recency_factor = 1 + (votes_last_30d / total_votes) × 0.5
    — bonus del 50% máximo si la mayoría de votos son recientes

  engagement_bonus = 1 + min(comment_count × 0.1, 0.3)
    — bonus hasta 30% por discusión activa (indica demanda cualitativa)
```

El resultado es un `weighted_score` que convive con el `raw_votes` visible. El usuario siempre ve votos reales; el ordenamiento interno usa `weighted_score`.

---

## 5. Diseño Propuesto para Parallly

### 5.1 Arquitectura: Board por tenant + Meta-board global

**Decisión: ambos.**

- **Tenant board** (visible a los tenants de Parallly): cada cliente tiene su propio board donde envía y vota ideas. El board pertenece a un `tenant_id`. Los tenants no ven lo que piden otros tenants.
- **Meta-board** (solo para el founder/super_admin): vista agregada de TODOS los requests de TODOS los tenants, agrupados por similitud semántica (AI clustering). El founder ve "esta feature fue pedida por 12 tenants distintos" con el detalle de qué plan tienen cada uno.

Esto es lo que ninguna plataforma del mercado hace nativamente: el "meta-board" con AI clustering cross-tenant.

### 5.2 Cinco mejoras sobre el estado del arte

#### Mejora 1: AI Clustering Cross-Tenant (Diferenciador principal)
Al enviar un feature request, se genera un embedding (OpenAI `text-embedding-3-small`) del título + descripción. En el meta-board, se agrupan requests con cosine similarity > 0.82 como "cluster". El founder ve: "Dark mode: pedido por 8 tenants (2 enterprise + 4 pro + 2 starter). Weighted score: 47.5". Un mismo request en el tenant board puede pertenecer a un cluster global sin que el tenant lo sepa.

#### Mejora 2: Señales desde conversaciones de IA (Única en el mercado)
Parallly tiene ventaja competitiva: su agente IA procesa miles de conversaciones. Se puede inferir demanda de features sin que el usuario vote explícitamente. Implementación:
- El `ConversationsService` emite un evento `feature.signal_detected` cuando el LLM detecta un patrón de necesidad (configurable con un prompt de extracción post-turn)
- Se crea un `implicit_vote` (peso 0.3 vs 1.0 de voto explícito) vinculado al request más similar por embedding
- En la vista del founder: "Este request tiene 15 votos explícitos + 43 señales implícitas de conversaciones"

#### Mejora 3: Peso por antigüedad y LTV del cliente
No solo por plan actual — también por tiempo como cliente (churn en LatAm es alto, fidelidad vale):

```
tenure_multiplier = 1 + min(months_as_customer / 24, 1.0) × 0.5
  — hasta 50% extra por clientes de 2+ años

vote_weight = plan_weight × tenure_multiplier
```

Esto incentiva retener clientes: cuanto más tiempo llevan, más impacto tienen sus requests.

#### Mejora 4: Detección automática de "ya implementado"
Al hacer deploy de una nueva feature, el sistema usa embeddings para buscar en el backlog de requests abiertos si alguno coincide (cosine similarity > 0.85). Si encuentra match, sugiere al admin cerrarlos como "shipped" con un click. Evita el estado zombie de requests que ya fueron atendidos pero nadie actualizó.

#### Mejora 5: "Predicted Effort" automático
Al crear un nuevo request en el meta-board (vista admin), un LLM (Claude claude-haiku) estima el esfuerzo relativo comparando el request con los últimos 10 items shipped del backlog y sus tiempos reales de implementación. Genera un badge "~2 días / ~1 semana / ~1 mes" como señal para priorización. No es un compromiso — es una heurística rápida para ordenar quick wins vs grandes proyectos.

---

## 6. Modelo de Datos PostgreSQL

### Tabla global (schema `public`)

```sql
-- Requests de tenants (schema público porque cruza tenants)
CREATE TABLE feature_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    author_user_id  UUID,                        -- user del tenant que lo envió
    author_name     VARCHAR(120),                -- snapshot, por si el user se elimina
    author_email    VARCHAR(255),
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    status          VARCHAR(50) NOT NULL DEFAULT 'open',
                    -- open | under_review | planned | in_progress | shipped | declined
    category_id     UUID REFERENCES feature_categories(id),
    raw_votes       INT NOT NULL DEFAULT 0,
    weighted_score  NUMERIC(10,2) NOT NULL DEFAULT 0,
    implicit_signals INT NOT NULL DEFAULT 0,     -- señales desde conversaciones IA
    cluster_id      UUID REFERENCES feature_clusters(id), -- meta-board cluster
    embedding       VECTOR(1536),                -- pgvector, text-embedding-3-small
    merged_into_id  UUID REFERENCES feature_requests(id), -- si fue mergeado
    eta             VARCHAR(7),                  -- "04/2026" MM/YYYY
    eta_public      BOOLEAN DEFAULT FALSE,
    is_internal     BOOLEAN DEFAULT FALSE,       -- solo visible a admins
    predicted_effort VARCHAR(30),               -- "~2 días" | "~1 semana" | "~1 mes"
    shipped_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fr_tenant_status ON feature_requests(tenant_id, status);
CREATE INDEX idx_fr_cluster ON feature_requests(cluster_id) WHERE cluster_id IS NOT NULL;
CREATE INDEX idx_fr_embedding ON feature_requests USING ivfflat(embedding vector_cosine_ops);

-- Categorías (por tenant)
CREATE TABLE feature_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    slug        VARCHAR(100) NOT NULL,
    color       VARCHAR(7) DEFAULT '#6B7280',
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Votos
CREATE TABLE feature_votes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
    voter_user_id   UUID,                        -- null si anonymous
    voter_tenant_id UUID NOT NULL REFERENCES tenants(id),
    weight          NUMERIC(4,2) NOT NULL DEFAULT 1.0,  -- calculado al momento del voto
    plan_at_vote    VARCHAR(30),                 -- snapshot del plan
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(request_id, voter_user_id)            -- un voto por usuario por request
);

CREATE INDEX idx_fv_request ON feature_votes(request_id);

-- Comentarios
CREATE TABLE feature_comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
    author_user_id  UUID,
    author_name     VARCHAR(120) NOT NULL,
    content         TEXT NOT NULL,
    is_internal     BOOLEAN DEFAULT FALSE,       -- solo admins ven
    is_admin        BOOLEAN DEFAULT FALSE,       -- comentario oficial del founder
    parent_id       UUID REFERENCES feature_comments(id),  -- replies (1 nivel)
    reactions       JSONB DEFAULT '{}',          -- {"👍": 5, "🎉": 2}
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    edited_at       TIMESTAMPTZ
);

CREATE INDEX idx_fc_request ON feature_comments(request_id);

-- Clusters del meta-board (agrupación cross-tenant)
CREATE TABLE feature_clusters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(255) NOT NULL,       -- generado por AI
    description     TEXT,                        -- resumen del cluster
    total_requests  INT DEFAULT 0,
    total_weighted_score NUMERIC(10,2) DEFAULT 0,
    centroid_embedding VECTOR(1536),             -- embedding promedio del cluster
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Señales implícitas desde conversaciones IA
CREATE TABLE feature_implicit_signals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
    conversation_id UUID,                        -- referencia a conversations table del tenant
    tenant_id       UUID NOT NULL,
    signal_text     TEXT,                        -- fragmento de la conversación que generó la señal
    confidence      NUMERIC(3,2),               -- 0.0 - 1.0
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Historial de cambios de status
CREATE TABLE feature_status_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
    old_status      VARCHAR(50),
    new_status      VARCHAR(50) NOT NULL,
    changed_by_id   UUID,                        -- admin que cambió
    note            TEXT,                        -- nota pública opcional
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Notificaciones pendientes
CREATE TABLE feature_notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
    user_email      VARCHAR(255) NOT NULL,
    notification_type VARCHAR(50) NOT NULL,     -- status_change | comment | shipped
    payload         JSONB,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Configuración por tenant
CREATE TABLE feature_board_settings (
    tenant_id           UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    board_name          VARCHAR(100) DEFAULT 'Feature Requests',
    board_slug          VARCHAR(100),
    is_public           BOOLEAN DEFAULT TRUE,
    allow_anonymous     BOOLEAN DEFAULT FALSE,
    require_approval    BOOLEAN DEFAULT FALSE,
    default_sort        VARCHAR(30) DEFAULT 'weighted_score', -- weighted_score | raw_votes | recent | trending
    custom_statuses     JSONB DEFAULT '[]',     -- [{name, color, sort_order}]
    branding_color      VARCHAR(7) DEFAULT '#10B981',
    logo_url            TEXT,
    lang_default        VARCHAR(5) DEFAULT 'es',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. Endpoints REST

Base: `/api/v1/feature-board`

### Board público (sin auth o con SSO token)

```
GET    /board/:tenantSlug                         Lista de requests (paginada, filtros: status/category/sort/q)
GET    /board/:tenantSlug/request/:id             Detalle + comentarios + votos
POST   /board/:tenantSlug/request                 Crear nuevo request (auth requerida o anon si allowAnonymous)
POST   /board/:tenantSlug/request/:id/vote        Votar (toggle)
DELETE /board/:tenantSlug/request/:id/vote        Quitar voto
POST   /board/:tenantSlug/request/:id/comment     Comentar
GET    /board/:tenantSlug/categories              Listar categorías del board
GET    /board/:tenantSlug/roadmap                 Vista pública por status (kanban data)
GET    /board/:tenantSlug/changelog               Posts con status=shipped ordenados por shipped_at
```

### Admin del tenant (JWT + RolesGuard: tenant_admin | tenant_supervisor)

```
GET    /admin/:tenantId/requests                  Lista con filtros avanzados (incluye internos)
GET    /admin/:tenantId/requests/:id              Detalle + comentarios internos + señales implícitas
PATCH  /admin/:tenantId/requests/:id/status       Cambiar status (notifica votantes)
PATCH  /admin/:tenantId/requests/:id              Editar título/descripción/categoría/eta/predicted_effort
POST   /admin/:tenantId/requests/:id/merge        Mergear en otro request
DELETE /admin/:tenantId/requests/:id              Eliminar (soft delete)
GET    /admin/:tenantId/settings                  Config del board
PATCH  /admin/:tenantId/settings                  Actualizar config
POST   /admin/:tenantId/categories                Crear categoría
PATCH  /admin/:tenantId/categories/:id            Editar categoría
DELETE /admin/:tenantId/categories/:id            Eliminar categoría
```

### Meta-board (JWT + RolesGuard: super_admin)

```
GET    /meta/clusters                             Lista de clusters con stats cross-tenant
GET    /meta/clusters/:clusterId                  Requests del cluster con detalle por tenant
GET    /meta/requests                             Todos los requests de todos los tenants (con filtros)
GET    /meta/signals                             Señales implícitas recientes de conversaciones
POST   /meta/clusters/rebuild                     Forzar re-clustering (puede tardar — usar BullMQ)
GET    /meta/stats                               KPIs: total requests, shipped rate, avg time to ship
PATCH  /meta/requests/:id/detect-shipped         Trigger de detección "ya implementado" manual
```

### Integración con ConversationsService (interna)

```
POST   /internal/feature-board/signal             Registrar señal implícita desde conversación
  Body: { tenantId, conversationId, signalText, confidence, embedding? }
```

---

## 8. Componentes UI Principales

### 8.1 FeatureBoardPage (lista pública)
```
FeatureBoardPage
├── BoardHeader (nombre, descripción, CTA "Submit request")
├── FilterBar
│   ├── SearchInput (debounce 300ms, busca en título+descripción)
│   ├── StatusFilter (chips: All | Open | Planned | In Progress | Shipped)
│   ├── CategoryFilter (dropdown)
│   └── SortSelector (Most Votes | Recent | Trending | Weighted)
├── NewRequestModal (título + descripción + categoría + duplicate suggestions)
└── RequestList
    └── RequestCard (×N)
        ├── VoteButton (contador izquierdo, toggle, optimistic update)
        ├── RequestTitle + StatusBadge
        ├── CategoryTag
        ├── MetaLine (X comments · hace Y días)
        └── onClick → RequestDetailPage
```

### 8.2 RequestDetailPage
```
RequestDetailPage
├── BackButton + StatusBadge
├── VoteButton (grande, prominente)
├── Title + Description (markdown)
├── Meta: autor, fecha, categoría, ETA (si público)
├── StatusTimeline (historial de cambios de status)
├── CommentThread
│   ├── AdminComment (highlighted, avatar distinto)
│   ├── UserComment (con reactions)
│   └── CommentInput (solo si auth)
└── RelatedRequests (misma categoría, ordenados por votos)
```

### 8.3 NewRequestModal (con detección de duplicados en tiempo real)
```
NewRequestModal
├── TitleInput
│   └── [onChange: buscar similares por embedding en tiempo real]
│       → DuplicateSuggestions (si similarity > 0.7)
│           "¿Ya existe algo similar? → Vota este en su lugar"
├── DescriptionTextarea
├── CategorySelect
├── SubmitButton
└── [Admin toggle] Internal post
```

### 8.4 RoadmapView (público)
```
RoadmapView (kanban horizontal)
├── Column: Planned
│   └── RequestCard (mini, solo título + votos)
├── Column: In Progress
│   └── RequestCard
└── Column: Shipped (últimos 30 días)
    └── RequestCard (con shipped_at badge)
```

### 8.5 AdminRequestsPage (gestión interna)
```
AdminRequestsPage
├── StatsBar (total requests, pending review, planned count, shipped this month)
├── BulkActionsBar (cambiar status en masa, merge, delete)
├── RequestTable
│   ├── Columns: Title | Status | Category | Raw Votes | Weighted Score | Signals | Created
│   └── RowActions: cambiar status, merge, edit, delete
└── [si super_admin] MetaBoardToggle → MetaClusterView
```

### 8.6 MetaClusterView (solo super_admin)
```
MetaClusterView
├── ClusterStats (N clusters, cobertura %)
├── ClusterList
│   └── ClusterCard
│       ├── Título generado por AI
│       ├── Total requests | Tenants distintos | Weighted score global
│       ├── Plan breakdown: [E:2] [P:5] [S:8] (enterprise/pro/starter)
│       └── onClick → ClusterDetail con requests individuales
└── ImplicitSignalsPanel
    ├── SignalFeed (últimas señales desde conversaciones)
    └── UnclaimedSignals (señales sin request asignado → sugerir creación)
```

### 8.7 EmbeddableWidget (iframe o Web Component)
```html
<!-- Para embeber en el dashboard del tenant -->
<parallly-feedback-widget
  tenant-slug="mi-empresa"
  user-id="{{ userId }}"
  user-email="{{ userEmail }}"
  user-plan="{{ plan }}"
  lang="es"
  position="bottom-right"
/>
```
El widget muestra un botón flotante "Solicitar feature" que abre el modal NewRequest directamente. Pasa el token del usuario ya autenticado (SSO seamless — si está logueado en el dashboard de Parallly, no necesita re-autenticarse en el board).

---

## 9. Flujo de Priorización: Cálculo de weighted_score

El score se recalcula en cada voto nuevo (job BullMQ o trigger de DB):

```typescript
// Pseudocódigo del cálculo
async function recalculateScore(requestId: string): Promise<void> {
  const votes = await db.query(`
    SELECT fv.weight, fv.created_at,
           t.subscription_plan, t.created_at as tenant_created
    FROM feature_votes fv
    JOIN tenants t ON t.id = fv.voter_tenant_id
    WHERE fv.request_id = $1
  `, [requestId]);

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  let totalWeight = 0;
  let recentVoteWeight = 0;

  for (const vote of votes) {
    // Peso base por plan
    const planWeight = { starter: 1.0, pro: 2.5, enterprise: 5.0, custom: 8.0 }[vote.subscription_plan] ?? 1.0;

    // Multiplicador por antigüedad del tenant (0 a +50%)
    const monthsAsCustomer = (now - vote.tenant_created) / (1000 * 60 * 60 * 24 * 30);
    const tenureMultiplier = 1 + Math.min(monthsAsCustomer / 24, 1.0) * 0.5;

    const voteWeight = planWeight * tenureMultiplier;
    totalWeight += voteWeight;

    if (vote.created_at.getTime() > thirtyDaysAgo) {
      recentVoteWeight += voteWeight;
    }
  }

  // Bonus por votos recientes (hasta +50%)
  const recencyFactor = totalWeight > 0
    ? 1 + (recentVoteWeight / totalWeight) * 0.5
    : 1;

  // Bonus por engagement en comentarios (hasta +30%)
  const commentCount = await db.count('feature_comments', { request_id: requestId, is_internal: false });
  const engagementBonus = 1 + Math.min(commentCount * 0.1, 0.3);

  const weightedScore = totalWeight * recencyFactor * engagementBonus;

  await db.update('feature_requests', {
    weighted_score: weightedScore,
    raw_votes: votes.length
  }, { id: requestId });
}
```

---

## 10. Flujo de Señales Implícitas desde Conversaciones IA

```
ConversationsService.processMessage()
  → después de generar respuesta LLM
  → si message_count % 5 == 0 (cada 5 turnos, no en cada mensaje)
    → LLM call secundario (claude-haiku, bajo costo):
        prompt: "Analiza este fragmento de conversación. ¿El usuario está pidiendo implícitamente 
                 una funcionalidad del producto? Si sí, extrae: [feature_request_text] con 
                 confidence 0-1. Si no, responde null."
    → si confidence > 0.6:
        → generar embedding del feature_request_text
        → buscar request más similar en feature_requests (cosine similarity > 0.75)
        → si existe: POST /internal/feature-board/signal
        → si no existe: guardar en feature_implicit_signals sin request_id (para revisión admin)
```

Costo estimado: 1 llamada haiku cada 5 turnos × prompt ~200 tokens = ~$0.00004 por análisis. Despreciable.

---

## 11. Multi-idioma (es/en/pt/fr)

El widget y el board público respetan el campo `lang_default` de `feature_board_settings`. Las traducciones siguen el patrón next-intl ya establecido en el dashboard:

```json
// messages/es.json
{
  "featureBoard": {
    "title": "Solicitar nueva funcionalidad",
    "submitButton": "Enviar solicitud",
    "voteCTA": "Votar",
    "statusOpen": "Abierto",
    "statusPlanned": "Planificado",
    "statusInProgress": "En desarrollo",
    "statusShipped": "Implementado",
    "statusDeclined": "Descartado",
    "duplicateSuggestion": "¿Se parece a lo que buscas? Vota aquí en su lugar.",
    "noRequests": "Aún no hay solicitudes. ¡Sé el primero!",
    "implicitSignalBadge": "señales de conversaciones",
    "roadmapTitle": "Roadmap público"
  }
}
```

Los textos del board en sí (título, descripción de categorías) los escribe el admin del tenant en su idioma. No se traduce automáticamente el contenido UGC — solo la chrome del UI.

---

## 12. Plan de Implementación (orden sugerido)

| Fase | Duración estimada | Entregable |
|---|---|---|
| 1. Core | 3-4 días | Modelo de datos, CRUD de requests, votación, status workflow, notificaciones email |
| 2. Board público | 2 días | FeatureBoardPage, RequestDetailPage, RoadmapView, i18n |
| 3. Admin tenant | 2 días | AdminRequestsPage, cambio de status, merge, configuración |
| 4. Duplicados AI | 2 días | Embeddings en pgvector, NewRequestModal con sugerencias en tiempo real |
| 5. Meta-board | 2 días | ClusterView, re-clustering job, stats cross-tenant |
| 6. Señales implícitas | 2 días | Integración con ConversationsService, ImplicitSignalsPanel |
| 7. Widget embebible | 1 día | Web Component, SSO seamless |

**Total estimado: ~16 días de desarrollo.**

---

## 13. Consideraciones de Implementación en Parallly

- **Schema**: las tablas `feature_requests`, `feature_votes`, `feature_comments`, `feature_clusters`, `feature_implicit_signals`, `feature_status_history`, `feature_notifications`, `feature_board_settings`, `feature_categories` van en el **schema público** (no por tenant), porque el meta-board cruza tenants. La columna `tenant_id` en cada tabla provee el aislamiento.
- **pgvector**: ya debe estar instalado para el RAG de knowledge base. Las tablas de features reutilizan la misma extensión.
- **BullMQ**: crear una cola `feature-board-jobs` para: recalcular weighted_score, generar/actualizar clusters, enviar notificaciones email batch.
- **Plan de acceso**: el módulo de feature board puede ser visible para todos los planes (el board del tenant hacia el founder de Parallly es gratis), pero la opción de "board público para tus clientes" (donde los clientes de los tenants votan features del tenant) puede ser pro/enterprise.
- **Rate limiting**: 5 requests nuevos por usuario por día (evita spam). 1 voto por usuario por request (UNIQUE constraint). Post approval en tenants con historial de spam.
- **Prisma**: dado que las tablas van en `public`, se pueden modelar directamente en `schema.prisma` con el cliente global.
- **Raw SQL**: si se usa `$queryRawUnsafe` para queries de vectores o analytics del meta-board, aplicar `::uuid` casts y snake_case en nombres de columna, como dicta la convención del proyecto.

---

## Referencias de Investigación

- [Canny API Reference](https://developers.canny.io/api-reference)
- [Canny Autopilot AI Features](https://canny.io/features/autopilot)
- [FeatureOS AI Features](https://featureos.com/ai)
- [FeatureOS Pricing](https://featureos.com/pricing)
- [Feature Voting Best Practices - Canny Blog](https://canny.io/blog/feature-voting-best-practices/)
- [ProductBoard vs UserVoice - Savio](https://www.savio.io/blog/productboard-vs-uservoice/)
- [Top 14 Feature Voting Tools 2026 - Featurebase](https://www.featurebase.app/blog/top-feature-voting-tools)
- [Best Feature Request Tool 2026 - ProductLift](https://www.productlift.dev/best-feature-request-tool/)
- [AI-Powered Feature Voting Gap Analysis - MicroGaps](https://www.microgaps.com/gaps/2026-02-21-ai-feature-voting-roadmap-board)
- [Hacker News Ranking Algorithm - righto.com](http://www.righto.com/2013/11/how-hacker-news-ranking-really-works.html)
- [Fider Open Source - GitHub](https://github.com/getfider/fider)
- [Nolt Pricing - fdback.io](https://fdback.io/blog/nolt-pricing)
- [Canny vs Featurebase 2026 - RightFeature](https://rightfeature.com/blog/canny-vs-featurebase/)
