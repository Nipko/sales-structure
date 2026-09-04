# Plan: Parallly Assist veraz, aviso de acción crítica consecuente y recorridos guiados ("Mostrarme dónde")

_Estado: **IMPLEMENTADO Y VERIFICADO** (4-sep-2026). Las dos partes se construyeron en ocho unidades con archivos disjuntos, seguidas de tres revisiones adversariales que encontraron 24 defectos —3 de ellos críticos, capaces de romper a todos los tenants existentes— corregidos antes de subir. Verificación final: 5 paquetes compilan limpio; API 390 suites / 3.805 pruebas; grafo de dependencias NestJS; dashboard 33 suites / 313 pruebas; 9.900 claves i18n idénticas en los 4 idiomas. Este documento queda como el registro del diseño, la evidencia y el guion de prueba manual del §15, que sigue pendiente de correr en producción._

## 0. Qué ya está hecho (no rehacer)

- `packages/shared/src/guided-tour-contract.ts` — registro compartido de recorridos guiados (ids, ruta de entrada, rol mínimo, códigos de calidad que resuelve, artículos de la KB relacionados) + helpers `findGuidedTourForQualityCode`, `canRoleRunGuidedTour`, `guidedToursForArticles`, `extractGuidedTourMarker`, evento `GUIDED_TOUR_START_EVENT`. **Este archivo es el contrato entre API y dashboard: leerlo antes de tocar cualquiera de las dos apps.**
- `packages/shared/src/index.ts` — exporta el contrato.

Todo lo demás de este documento está pendiente.

---

## 1. Síntomas reportados por el dueño

1. **Parallly Assist afirma cosas falsas**: "no tenés canales conectados" cuando WhatsApp está conectado y operando.
2. **El aviso rojo "Hay una acción crítica que requiere atención. Revisa primero a Laura Sofia."** tiene un botón **Revisar** que manda a **Canales**, y esa página no dice nada: WhatsApp aparece "Conectado" en verde y no hay ninguna pista de qué hay que corregir. El aviso y el destino no son consecuentes.
3. Falta que Assist **pueda abrir la pantalla y mostrar, paso a paso, dónde se corrige, dónde se ve o qué se modifica** (tour guiado), no solo describirlo en texto.
4. Actualizar la **base de conocimiento del asistente** para que refleje lo anterior.

## 2. Diagnóstico (verificado en código)

### 2.1 De dónde sale la "acción crítica" y por qué el destino no dice nada

El aviso global (`apps/dashboard/src/components/quality/QualityAttentionBanner.tsx:48-55`) muestra `summary.topAction`, que es la señal abierta más grave (`agent-quality-signal.service.ts:387-401`). Cada señal nace de una recomendación `fix_<check>` (`agent-quality.service.ts:900-911`), y el botón **Revisar** navega al `href` del check.

El check **`channel_connection`** (`apps/api/src/modules/quality/agent-quality.service.ts:728-745`) es `critical` y su `href` es `/admin/channels`. Su estado es:

```ts
status: assignedCount === 0 || connectedAssignments < assignedCount
    ? 'fail'
    : credentialWarningAssignments > 0 ? 'warning' : 'pass'
```

Es decir: **falla como crítico si CUALQUIER asignación del agente no está conectada**, aunque el agente tenga WhatsApp funcionando. Dos formas muy probables de caer ahí (el wizard de configuración "selecciona canales pero nunca exige conectarlos" — memoria del proyecto, obs. 592):

- **(a) Asignación múltiple parcialmente conectada.** El agente tiene `channels = ['whatsapp','instagram', …]` (elegidos en el wizard) y solo WhatsApp está en `channel_accounts` activo → `connected (1) < assigned (2)` → crítico. En **Canales**, WhatsApp está verde, Instagram gris "Desconectado", y nada indica que eso sea "la acción crítica del agente".
- **(b) Vínculo por cuenta obsoleto.** `channel_bindings = ['whatsapp:<phone_number_id viejo>']` (el número se reconectó o cambió de id) → `activeAccountBindings.has(binding)` es falso → crítico, aunque el tipo `whatsapp` sí esté conectado. Canales muestra "Conectado".
- **(c) Credencial `missing` vs `unknown`.** Calidad trata la ausencia de fila en `whatsapp_credentials` como `missing` = fallo (`agent-quality.service.ts:327-337, 663-664`), mientras `/channels/overview` devuelve `unknown` (`channel-management.controller.ts:139`) y la página de Canales **oculta** `unknown` (`channels/page.tsx:85`). Dos fuentes de verdad distintas para "conectado".

En los tres casos el banner dice "crítico", **Revisar** lleva a `/admin/channels` y la página no muestra el motivo. Ese es el defecto de consecuencia.

### 2.2 Por qué Assist dice "no tenés canales conectados"

`CopilotService.buildAgentQualityContext` (`copilot.service.ts:448-529`) inyecta al modelo `preparation.criticalBlockers` **solo como códigos** (`['channel_connection']`, línea 492), sin evidencia (asignados/conectados/cuáles), y el prompt **no tiene ningún bloque con los canales realmente conectados del tenant**. El modelo interpreta "channel_connection bloqueado" como "no hay canales" y lo afirma. La KB (`kb/assistant/es/26-centro-calidad-agente.md`) tampoco explica qué verifica ese control.

### 2.3 Por qué no hay tour guiado desde Assist

Las acciones que devuelve `/copilot/chat` están limitadas a `open_quality_center | open_quality_action` (`copilot.service.ts:21-25`; filtro en `HelpAssistant.tsx:226-235`). El tour existente (Onborda 1.2.5, `components/tour/ProductTour.tsx`) tiene un solo tour `main` con 4-5 pasos anclados al sidebar (`#tour-<labelKey>`, `AppSidebar.tsx:947`) y se reinicia solo por el evento `parallly:start-tour`. Onborda **sí soporta tours múltiples y pasos multi-página** (`nextRoute`/`prevRoute`, con `MutationObserver` que espera el selector tras `router.push` — `node_modules/onborda/dist/Onborda.js:139-173`), así que no hace falta otra librería.

### 2.4 Confirmación en producción (opcional, solo lectura)

Antes o después de implementar, para el tenant afectado (reemplazar `<schema>` y `<tenant_id>`):

```sql
-- Asignaciones del agente
SELECT id, name, is_active, channels, channel_bindings, version FROM <schema>.agent_personas;
-- Conexiones reales
SELECT channel_type, account_id, display_name, is_active FROM public.channel_accounts WHERE tenant_id = '<tenant_id>'::uuid;
SELECT credential_type, rotation_state, expires_at FROM public.whatsapp_credentials WHERE tenant_id = '<tenant_id>'::uuid;
SELECT phone_number_id, access_token_ref, channel_status FROM <schema>.whatsapp_channels;
-- Señales abiertas
SELECT code, severity, state, href, evidence_count, last_seen_at FROM <schema>.agent_quality_signals WHERE state IN ('open','acknowledged','snoozed') ORDER BY last_seen_at DESC;
```

Se espera `code = 'fix_channel_connection'` y alguno de los patrones (a)/(b)/(c). El arreglo del §3 cubre los tres.

---

## 3. Diseño

Cuatro piezas, una por síntoma, con un solo principio: **la misma verdad en el chequeo, en el aviso, en la página destino y en Assist.**

### 3.1 Chequeo de canales consecuente (API)

**Semántica nueva** en `buildPreparation` (`agent-quality.service.ts`):

| Check | Crítico | Estado | Cuándo |
|---|---|---|---|
| `channel_assignment` (existe) | sí | `fail` | `assignedCount === 0` (sin cambios) |
| `channel_connection` (cambia) | sí | `not_applicable` | `assignedCount === 0` (ya lo bloquea `channel_assignment`; evita dos bloqueos críticos por una causa) |
| | | `fail` | `assignedCount > 0 && connectedOperational === 0` → el agente **no puede recibir nada** |
| | | `fail` | `credentialAffectedAssignments > 0` → conectado pero **no puede enviar** (error/revoked/expired/missing) |
| | | `warning` | `credentialWarningAssignments > 0` (unknown/expiring) |
| | | `pass` | resto |
| `channel_coverage` (**nuevo**, dimensión `actions_outcomes`, `weight: 3`, `critical: false`) | no | `not_applicable` | `assignedCount === 0` |
| | | `fail` (→ recomendación `high`) | alguna asignación **sin conexión activa** (tipo desconectado o binding obsoleto) mientras el agente sí tiene otra operativa |
| | | `pass` | todas las asignaciones tienen conexión activa |

Donde `connectedOperational = asignaciones con connected && !isCredentialFailure(health)`.

`href` de `channel_coverage`: `` `/admin/agent/${agent.id}` `` (la corrección típica es quitar la asignación que no se usa, o conectar ese canal; la barra de contexto del §3.2 explica ambas).

**Evidencia** (todo primitivo, acotado; los tipos de canal son enumeraciones, no texto libre):

- `channel_connection`: mantener las claves actuales y agregar `connectedChannels: 'whatsapp'` (tipos con al menos una conexión operativa, `join(',')`, ≤120 chars).
- `channel_coverage`: `{ assigned, connected, disconnectedChannels: 'instagram,messenger', staleBindings: <n> }`.

Binding obsoleto = `binding` no está en `activeAccountBindings` **pero** su tipo sí está en `activeChannelTypes` → cuenta en `staleBindings` y en `disconnectedChannels` como `whatsapp` (para que la explicación diga "reasigná el número").

**Una sola fuente de verdad para la salud de credenciales.** Extraer a `apps/api/src/modules/channels/channel-credential-health.util.ts` (función pura, sin DI):

```ts
export type ChannelCredentialHealth = 'ok' | 'expiring' | 'unknown' | 'missing' | 'error' | 'revoked' | 'expired';
export const CREDENTIAL_TYPE_BY_CHANNEL: Record<string, string>; // whatsapp→system_user_token, instagram→instagram_token, messenger→messenger_token, telegram→telegram_token
export function resolveCredentialHealth(input: {
    channelType: string;
    hasAccountToken: boolean;                 // channel_accounts.access_token real (no 'encrypted_ref'/'credential_ref'/'')
    metadata?: Record<string, unknown> | null; // tokenExpiresAt de Instagram
    latestCredential: { rotationState?: string | null; expiresAt?: Date | string | null } | null;
    lookupAvailable: boolean;                 // false si whatsapp_credentials no pudo leerse
    hasLegacyWhatsAppToken: boolean;          // whatsapp_channels.access_token_ref real (no 'credential_ref')
    now?: number;
}): ChannelCredentialHealth;
export function isCredentialFailure(h: ChannelCredentialHealth): boolean; // missing|error|revoked|expired
export function isCredentialWarning(h: ChannelCredentialHealth): boolean; // unknown|expiring
export function worstCredentialHealth(values: ChannelCredentialHealth[]): ChannelCredentialHealth;
```

Reglas (idénticas a las que hoy tiene calidad en `agent-quality.service.ts:285-303, 327-354`): `web_widget` → `ok`; WhatsApp usa la credencial `system_user_token` y cae a `ok` si hay token legado; Instagram con token por cuenta → vence según `metadata.tokenExpiresAt`; otros con token por cuenta → `ok`; sin token por cuenta → credencial por tipo; sin fila y lookup disponible → `missing`.

Consumidores:

1. `AgentQualityService.loadTenantContext` (reemplaza su lógica inline por el util).
2. `ChannelManagementController.getOverview` (`channel-management.controller.ts:120-168`): usar el util con las mismas entradas (agregar `SELECT phone_number_id, access_token_ref FROM whatsapp_channels` del schema tenant, que ya resuelve en esa función, y `has_account_token` de cada cuenta). `credentialStatus` pasa a poder ser `missing`; `needsReauth = isCredentialFailure(status)`. La página `channels/page.tsx` ya pinta en rojo todo lo que no sea `ok|unknown|expiring`, así que `missing` sale como **Requiere reautorizar** sin cambios extra.

**Snapshot de canales para Assist** — método público nuevo en `AgentQualityService`:

```ts
export interface TenantChannelSnapshot {
    generatedAt: string;
    total: number;                                   // cuentas activas
    channels: Array<{ type: string; accounts: number; health: ChannelCredentialHealth }>; // health = peor de las cuentas del tipo
}
async getTenantChannelSnapshot(tenantId: string): Promise<TenantChannelSnapshot>;
```

Sin nombres, ids ni números de teléfono. Reutiliza `loadTenantContext`.

**Endpoint nuevo (aditivo)** en `quality.controller.ts`:

```
GET /quality/:tenantId/signals/:signalId?agentId=<uuid>
@Roles('super_admin','tenant_admin','tenant_supervisor')
→ { success: true, data: AgentQualitySignal }   // vía AgentQualitySignalService.getSignalForAssistant (renombrar a getActiveSignal y mantener alias)
```

404 cuando la señal ya no está activa (`open|acknowledged|snoozed`) o no pertenece al agente.

**Tests** (`agent-quality.service.spec.ts`, harness existente `createHarness`):

- agente con `channels: ['whatsapp','instagram']`, solo WhatsApp activo → `channel_connection: pass` con `connectedChannels: 'whatsapp'`; `channel_coverage: fail` con `disconnectedChannels: 'instagram'`; `criticalBlockers` **no** contiene `channel_connection`; hay recomendación `fix_channel_coverage` con severidad `high`.
- agente con `channels: ['instagram']`, nada conectado → `channel_connection: fail` crítico.
- binding `whatsapp:old` con cuenta activa `whatsapp:new` → `channel_coverage.evidence.staleBindings = 1`, `disconnectedChannels: 'whatsapp'`, y `channel_connection` `fail` si no hay otra asignación operativa.
- `assignedCount === 0` → `channel_connection: not_applicable`, `channel_coverage: not_applicable`, solo `channel_assignment` en `criticalBlockers`.
- los casos existentes de credenciales (`error|revoked|expired|missing|unknown|expiring`) siguen pasando sin cambios de expectativa salvo el nuevo `connectedChannels`.
- `getTenantChannelSnapshot` devuelve solo `type/accounts/health` (asegurar que el JSON no contenga `account_id`, `display_name` ni el valor cifrado).
- `channel-credential-health.util.spec.ts`: tabla de casos del util.
- `quality.controller.spec.ts`: el endpoint nuevo exige `agentId` UUID y devuelve 404 si la señal no está activa.
- `channel-management.controller` (spec nuevo o existente): `missing` cuando hay cuenta activa de WhatsApp sin credencial ni token legado; `ok` con token legado.

### 3.2 Aviso consecuente: barra de contexto en la página destino (dashboard)

Cuando el usuario llega a una pantalla desde una señal de calidad, la pantalla **debe decir por qué está ahí y qué hacer**. Se hace con parámetros de URL y una barra de contexto global, sin tocar cada página.

**Parámetros**: `?qa=<signalId>&qagent=<agentId>` (UUIDs; se ignora cualquier otro valor).

`apps/dashboard/src/lib/quality-health.ts`:

```ts
export const QUALITY_FOCUS_SIGNAL_PARAM = 'qa';
export const QUALITY_FOCUS_AGENT_PARAM = 'qagent';
export function withQualityFocus(href: string, focus: { signalId: string; agentId: string }): string; // conserva query existente; solo /admin…
export function readQualityFocus(params: URLSearchParams | null): { signalId: string; agentId: string } | null; // valida UUID
export function stripQualityFocus(pathname: string, params: URLSearchParams): string; // misma ruta sin qa/qagent
```

**Quién agrega los parámetros**: `QualityAttentionBanner` (Revisar), `AgentHealthCard` (Revisar), y en la API `CopilotService` en la acción `open_quality_action` cuando hay `signalId` (el `safeAdminHref` del copilot y el filtro de `HelpAssistant` ya admiten query string).

**Componente nuevo** `apps/dashboard/src/components/quality/QualityFocusBanner.tsx`, montado en `app/admin/layout.tsx` justo debajo de `<QualityAttentionBanner />`, envuelto en `<Suspense fallback={null}>` (usa `useSearchParams`; sin Suspense Next 16 falla el build por CSR bailout):

- Elegibilidad igual a `QualityHealthProvider` (admin, supervisor, super_admin impersonando).
- Carga `api.getAgentQualitySignal(tenantId, signalId, agentId)` (nuevo en `api.ts`) + `api.getAgentQualityOverview(tenantId, agentId)`; caché por señal 5 min en un `Map` de módulo. Si el endpoint responde 404 o no existe (API vieja durante el deploy), muestra `qualityHealth.focus.signalGone` y un botón cerrar; nunca rompe la página.
- Contenido: etiqueta de la recomendación (misma lógica que `useRecommendationLabel` de `AgentHealthCard.tsx:12-27` → **extraer a `apps/dashboard/src/lib/quality-labels.ts`** y reutilizar en tarjeta, página de calidad y barra), nombre del agente, chip de gravedad, **explicación en lenguaje llano** construida con la evidencia del check correspondiente (`overview.preparation.dimensions[].checks` buscando `code === recomendación sin 'fix_'`), chips de evidencia con `agentQuality.evidenceKeys`.
- Explicaciones i18n con ICU (`qualityHealth.focus.explanations.<code>`), al menos para: `fix_channel_connection`, `fix_channel_coverage`, `fix_channel_assignment`, `fix_human_handoff_route`, `fix_handoff_triggers`, `fix_business_identity`, `fix_rag_knowledge`, `fix_knowledge_coverage`, `fix_tool_appointments`, `fix_business_hours`, `fix_fallback_message`, `fix_behavior_rules`, `run_eval`, `refresh_eval`, `collect_production_evidence`, `resolve_knowledge_gaps`, y `generic` como fallback. Ejemplo ES:
  - `fix_channel_coverage`: "{agent} está asignado a {assigned} canales y solo {connected} están conectados. Sin conexión: {disconnected}. Conectá ese canal o quitalo de la asignación del agente."
  - `fix_channel_connection` (con `connected = 0`): "{agent} no tiene ningún canal conectado que pueda recibir mensajes. Conectá {disconnected} o asigná un canal que ya esté conectado." (con `credentialIssue`): "{agent} está conectado a {connectedChannels}, pero la credencial de ese canal requiere reautorizar ({credentialIssue}); el agente no puede enviar respuestas."
- Acciones: **Mostrarme dónde** (si `findGuidedTourForQualityCode(code)` existe, `canRoleRunGuidedTour(tour, role)` y ancho ≥768 → despacha `GUIDED_TOUR_START_EVENT` con `{ tourId, signalId, agentId }`), **Preguntar a Assist** (`askAssistAboutQuality`), **Posponer 24 h** (`snoozeSignal` del contexto y luego quita los parámetros), **Cerrar** (quita los parámetros con `router.replace`).
- Accesibilidad: `role="region"`, `aria-live="polite"`, mismo patrón de foco que el resto del layout.
- `QualityAttentionBanner` se oculta mientras la barra de contexto muestra **la misma señal** (evita dos avisos rojos); vuelve al cerrar.

**Página de calidad** (`agent/quality/page.tsx`): en cada `RecommendationRow` agregar el botón **Mostrarme dónde** cuando exista tour para el código (misma condición). No cambia nada más.

### 3.3 Recorridos guiados desde Assist y desde el aviso ("Mostrarme dónde")

**Contrato**: `packages/shared/src/guided-tour-contract.ts` (hecho). Ids: `connect_channel`, `assign_agent_channel`, `agent_handoff_rules`, `human_handoff_route`, `business_identity`, `knowledge_base`, `appointments_setup`, `business_hours`, `run_agent_tests`, `agent_quality_center`.

**API — `copilot.service.ts`**

1. Tipo de acción:

```ts
export type CopilotChatAction =
    | { code: 'open_quality_center'; labelKey: 'openCenter'; href: string }
    | { code: 'open_quality_action'; labelKey: 'resolvePriority'; href: string }
    | { code: 'start_guided_tour'; labelKey: 'showMe'; href: string; tourId: GuidedTourId }; // href = tour.route (fallback móvil)
```

2. **Bloque de canales (autoritativo)** — `buildChannelContext(tenantId, userRole)`, solo admin/supervisor (agentes no reciben nada), usando `agentQuality.getTenantChannelSnapshot`:

```
## CANALES CONECTADOS (autoritativo, derivado del tenant autenticado)
{"total":1,"channels":[{"type":"whatsapp","accounts":1,"health":"ok"}]}
REGLA DE CANALES: esta lista es la ÚNICA fuente sobre qué canales están conectados. Si no está vacía, NUNCA afirmes que no hay canales conectados; nombra los tipos conectados. Una señal de calidad sobre canales significa que UNA asignación del agente no está conectada, que un vínculo por cuenta quedó obsoleto o que una credencial requiere reautorizar; no significa que el negocio no tenga canales. Si la lista está vacía, indícalo y guía a Administración → Canales.
```

3. **Evidencia acotada en el bloque de calidad**: agregar `criticalBlockerEvidence` (para cada código de `criticalBlockers`, la evidencia del check) y `selectedSignal.evidence` (cuando la señal es `fix_<check>`), filtrando valores a `number | boolean | string` con `/^[a-z0-9_,:.-]{1,80}$/i` y máximo 8 claves por check. Nada de ids de conversación ni texto libre (mantener el test que verifica que no se filtra `PRIVATE JUDGE TEXT` ni `private-conversation`).

4. **Acción de tour desde la señal**: `tour = findGuidedTourForQualityCode(selectedSignal?.code ?? recommendations[0]?.code ?? criticalBlockers[0])`; si existe y `canRoleRunGuidedTour(tour, userRole)` → agregar `{ code:'start_guided_tour', labelKey:'showMe', href: tour.route, tourId: tour.id }`. Máximo una acción de tour; máximo 3 acciones en total (el dashboard hoy corta en 2: subir a 3).

5. **Acción de tour desde chat libre**: `available = guidedToursForArticles(articles.map(a => a.id), userRole)`. Si hay, inyectar:

```
## RECORRIDOS GUIADOS DISPONIBLES (el botón "Mostrarme dónde" abre la pantalla y resalta paso a paso; no modifica nada)
- connect_channel — dónde conectar o reautorizar un canal
- ... (uno por tour disponible, descripción estática en un mapa del servicio)
REGLA DE RECORRIDOS: cuando el usuario pregunte DÓNDE o CÓMO hacer algo que cubre un recorrido de esta lista, termina tu respuesta con una línea exacta [[tour:ID]] (un solo marcador, ID de esta lista). No lo uses para preguntas conceptuales ni para recorridos que no estén en la lista.
```

Tras la respuesta del modelo: `const { text, tourId } = extractGuidedTourMarker(reply, available)` **siempre** (aunque `available` esté vacío, para eliminar marcadores inventados); `reply = text`; si `tourId` y todavía no hay acción de tour → agregarla. La `href` sale del registro, nunca del texto del modelo.

6. Regla nueva en el prompt (10): "RECORRIDOS: cuando exista un recorrido para lo que pide el usuario, prefiere ofrecerlo a describir menús largos. El recorrido no cambia configuración: la persona hace el cambio."

7. `open_quality_action.href` → `withQualityFocus(href, { signalId, agentId })` (helper local en el servicio; mantener ≤512 chars y prefijo `/admin`).

**Tests** (`copilot.service.context.spec.ts` + nuevo `guided-tour-contract.spec.ts` en `apps/api/src/modules/copilot/`, que importa de `@parallext/shared` — jest de la API lo mapea a `src`):

- bloque de canales presente para admin y supervisor, ausente para `tenant_agent`; contiene la frase "NUNCA afirmes que no hay canales conectados".
- señal `fix_channel_connection` con rol admin → acción `start_guided_tour` con `tourId: 'connect_channel'`; con rol supervisor → **sin** acción de tour (minRole admin) pero sí `open_quality_center`; señal `collect_production_evidence` con supervisor → `agent_quality_center`.
- respuesta del modelo `"…\n[[tour:knowledge_base]]"` con artículo `base-conocimiento` recuperado → texto sin marcador + acción; el mismo marcador sin ese artículo → texto sin marcador y **sin** acción; `[[tour:delete_everything]]` → eliminado, sin acción.
- `criticalBlockerEvidence` no incluye valores de más de 80 chars ni ids de conversación.
- `open_quality_action.href` contiene `qa=` y `qagent=`.
- contrato: `findGuidedTourForQualityCode('fix_channel_connection').id === 'connect_channel'`, `('channel_coverage')`, rol, `extractGuidedTourMarker` (primer marcador permitido gana; todos se eliminan; espacios normalizados).

**Dashboard**

`apps/dashboard/src/lib/guided-tours.ts` (nuevo):

```ts
export function guidedTourAnchorId(name: string): string;      // `tour-target-${name}`
export function guidedTourSelector(name: string): string;      // `#tour-target-${name}`
export interface GuidedTourStepDefinition { selector: string; route?: `/admin${string}`; titleKey: string; contentKey: string; side?: Step['side']; icon: string }
export function getGuidedTourStepDefinitions(tourId: GuidedTourId, ctx: { agentId?: string | null }): GuidedTourStepDefinition[];
export function buildGuidedTourSteps(tourId: GuidedTourId, ctx, t: (key, values?) => string): Step[]; // convierte a pasos Onborda con nextRoute/prevRoute cuando cambia la ruta entre pasos
```

Pasos (2-4 por recorrido; el primer paso puede ser el ítem del sidebar `#tour-<labelKey>` y el resto anclajes de la página):

| Tour | Ruta de entrada | Pasos (selector → qué dice) |
|---|---|---|
| `connect_channel` | `/admin/channels` | `#tour-channels` → `#tour-target-channel-cards` ("cada tarjeta muestra Conectado/Desconectado y si requiere reautorizar") → `#tour-target-channel-card-whatsapp` → (`nextRoute: /admin/channels/whatsapp`) `#tour-target-whatsapp-status` |
| `assign_agent_channel` | `/admin/agent/{agentId}` o `/admin/agent` | `#tour-aiAgent` → `#tour-target-agent-channels` ("marcá solo los canales que este agente atiende; un canal marcado sin conexión aparece como cobertura incompleta") → `#tour-target-agent-save` |
| `agent_handoff_rules` | `/admin/agent/{agentId}` o `/admin/agent` | `#tour-target-agent-behavior` → `#tour-target-agent-handoff-triggers` → `#tour-target-agent-fallback` → `#tour-target-agent-save` |
| `human_handoff_route` | `/admin/users` | `#tour-users` → `#tour-target-users-invite` ("invitá al menos una persona activa con rol agente o supervisor") → `#tour-target-users-list` |
| `business_identity` | `/admin/settings/business-info` | `#tour-target-business-info-form` → `#tour-target-business-info-save` |
| `knowledge_base` | `/admin/knowledge` | `#tour-knowledgeBase` → `#tour-target-knowledge-add` → `#tour-target-knowledge-tabs` (FAQ) |
| `appointments_setup` | `/admin/appointments` | `#tour-appointments` → `#tour-target-appointments-tabs` (servicios → disponibilidad) |
| `business_hours` | `/admin/settings/business-hours` | `#tour-target-business-hours-toggle` → `#tour-target-business-hours-save` |
| `run_agent_tests` | `/admin/agent/simulation` | `#tour-target-simulation-launch` → `#tour-target-simulation-history` |
| `agent_quality_center` | `/admin/agent/quality` | `#tour-target-quality-agent-select` → `#tour-target-quality-priority` → `#tour-target-quality-dimensions` |

Cuando `agentId` viene en el evento (barra de contexto o Assist con target), las rutas de agente usan `/admin/agent/${agentId}`; si no, `/admin/agent` con un paso sobre `#tour-target-agent-list` ("elegí el agente").

Anclajes a agregar (`id={guidedTourAnchorId('…')}`), ubicaciones concretas:

- `app/admin/channels/page.tsx`: contenedor de la grilla (`channel-cards`) y cada tarjeta (`channel-card-${ch.key}`).
- `app/admin/channels/whatsapp/page.tsx:181-198`: contenedor de la píldora de estado (`whatsapp-status`).
- `app/admin/agent/[agentId]/page.tsx`: bloque de asignación de canales (~línea 470-560, `agent-channels`), barra de guardado (`agent-save`); en `_components/BehaviorSection.tsx` el campo de motivos de escalamiento (`agent-handoff-triggers`) y el contenedor (`agent-behavior`); en `_components/PersonalitySection.tsx` o donde viva el `fallbackMessage` (`agent-fallback`).
- `app/admin/agent/page.tsx`: contenedor de la lista (`agent-list`).
- `app/admin/users/page.tsx:438`: botón invitar (`users-invite`) y tabla (`users-list`).
- `app/admin/settings/business-info/page.tsx`: formulario (`business-info-form`), botón guardar línea 350 (`business-info-save`).
- `app/admin/settings/business-hours/page.tsx`: toggle 24/7 línea 151 (`business-hours-toggle`), guardar (`business-hours-save`).
- `app/admin/knowledge/page.tsx:572`: botón crear (`knowledge-add`), fila de tabs 590-606 (`knowledge-tabs`).
- `app/admin/appointments/page.tsx:916`: `TabNav` (`appointments-tabs`) — si `TabNav` no acepta `id`, envolver en un `div`.
- `app/admin/agent/simulation/page.tsx`: panel de lanzamiento (`simulation-launch`) e historial (`simulation-history`).
- `app/admin/agent/quality/page.tsx`: `select#quality-agent` (`quality-agent-select`), sección `quality-actions` (`quality-priority`), sección `quality-dimensions` (`quality-dimensions`).

Runner (`components/tour/ProductTour.tsx`):

- `useProductTourSteps()` pasa a devolver `[{ tour: 'main', steps }, ...GUIDED_TOUR_IDS.map(id => ({ tour: id, steps: buildGuidedTourSteps(id, { agentId }, t) }))]`. `agentId` viene de un `GuidedTourContext` (nuevo, en el mismo archivo) que el runner actualiza antes de arrancar.
- `TourLauncher` agrega un listener de `GUIDED_TOUR_START_EVENT`: valida `isGuidedTourId(detail.tourId)`, `canRoleRunGuidedTour(tour, role)` y las capacidades del hook `useRole` (`canEditAgent`/`canManageChannels`/`canManageSettings`/`canManageUsers` según el tour), `canRunProductTourAtWidth(window.innerWidth)`; guarda `agentId` en el contexto; si `pathname !== ruta de entrada` hace `router.push(ruta)`; espera el **primer selector** con `MutationObserver` + timeout 8 s (si no aparece: despacha `PRODUCT_TOUR_CLOSED_EVENT` y no arranca); despacha `PRODUCT_TOUR_PREPARE_EVENT` (expande el sidebar) y llama `startOnborda(tourId)` tras 350 ms como el tour principal. Entre pasos, `nextRoute` lo maneja Onborda.
- `TourCard`: sin cambios funcionales (ya cierra con `PRODUCT_TOUR_CLOSED_EVENT`); solo asegurarse de que el paso final de un tour guiado muestre **Listo**.
- El sidebar ya expande secciones con `parallly:prepare-tour` (`AppSidebar.tsx:586-604`); agregar `aiGrowth/operation/insights/administration/config` si el tour lo necesita (settings vive en `config`).

`HelpAssistant.tsx`:

- `ChatAction` admite `start_guided_tour` cuando `isGuidedTourId(action.tourId)` y `href` pasa el filtro actual. Corte de acciones a 3.
- Render: en escritorio, botón **Mostrarme dónde** que cierra el sheet y despacha `GUIDED_TOUR_START_EVENT` con `{ tourId, signalId: qualityTarget?.signalId, agentId: qualityTarget?.agentId }`; en móvil, `Link` a `href`.
- Cuando se abre desde una señal, agregar el chip `helpAssistant.chat.quality.showMeWhere` ("¿Dónde lo corrijo?") que envía ese texto (el servidor devolverá la acción del tour por la señal).

`api.ts`: `getAgentQualitySignal(tenantId, signalId, agentId)` y ampliar el tipo de `copilotChat`.

**i18n (los 4 JSON: es/en/pt/fr, mismas claves)**:

- `qualityHealth.focus.{title, from, signalGone, close, showMe, explanations.<código>…, explanations.generic}`.
- `guidedTours.<id>.steps.<n>.{title,content}` para los 10 tours; `guidedTours.unavailableMobile`; `guidedTours.anchorMissing`.
- `helpAssistant.chat.quality.actions.showMe`, `helpAssistant.chat.quality.showMeWhere`.
- `agentQuality.checks.channel_coverage`; `agentQuality.evidenceKeys.{connectedChannels, disconnectedChannels, staleBindings, credentialAffectedAssignments, credentialWarningAssignments, hasCredentialIssue, credentialIssue}` (hoy no existen y la UI muestra "Evidencia:" genérico).
- `channels.credentialMissing` opcional (hoy `credentialNeedsReauth` cubre `missing`).

**Tests dashboard** (jest, `src/lib/*.spec.ts`):

- `quality-health.spec.ts`: `withQualityFocus` conserva query previa, rechaza hrefs fuera de `/admin`, `readQualityFocus` valida UUID, `stripQualityFocus`.
- `guided-tours.spec.ts`: cada id de `GUIDED_TOUR_IDS` tiene ≥2 pasos; toda `route`/`nextRoute` coincide con un `pattern` de `navigation-contract.ts` (con `:agentId` sustituido); el primer paso de cada tour es un selector `#tour-…`; las claves i18n de cada paso existen en `messages/es.json` y en los otros 3.

### 3.4 Base de conocimiento de Assist (4 locales) y docs

Reglas del contrato (`assistant-kb-contract.spec.ts`): mismos `id/routes/roles` en los 4 idiomas; rutas solo canónicas; mantener **intactas** las frases que verifican los regex existentes de `centro-calidad-agente` (badge, banner, "Posponer … no la corrige", privacidad, "no envían correo ni notificación push", "Assist no aplica cambios ni inicia comunicaciones") y de `primeros-pasos` (pastilla `8/9` retirada). Sin precios ni cuotas.

`26-centro-calidad-agente.md` (es/en/pt/fr) — agregar tres secciones:

1. **Qué verifica "Conexión operativa del canal"**: asignación (el agente tiene canales marcados) ≠ conexión (la cuenta existe y está activa en Canales) ≠ credencial (el token permite enviar). Un canal marcado sin conectar **ya no bloquea** al agente si otro canal sí opera: aparece como **Cobertura de los canales asignados** (alta, no crítica). Solo bloquea cuando ningún canal asignado puede recibir, o cuando una credencial requiere reautorizar.
2. **Al hacer clic en Revisar**: la pantalla destino muestra una **barra de contexto** con la acción, el agente, la explicación con evidencia y los botones **Mostrarme dónde**, **Preguntar a Assist**, **Posponer 24 h** y cerrar.
3. **Mostrarme dónde (recorrido guiado)**: abre la pantalla y resalta paso a paso dónde se hace el cambio; **no modifica nada**; disponible en escritorio; Admin ve recorridos de edición, Supervisor los de revisión. Assist puede ofrecerlo cuando preguntas dónde o cómo hacer algo.

Además, en "Preguntar a Parallly Assist" aclarar que Assist recibe la lista de canales conectados del negocio y la evidencia acotada del control (conteos y tipos de canal), por lo que puede decir qué canal falta y cuál sí opera.

`02-canales-whatsapp.md`: en "Estados del canal" agregar **Conectado, pero requiere reautorizar** (credencial vencida, revocada, con error o ausente) y que Salud de agentes lo reporta como conexión operativa afectada.

`01-primeros-pasos.md`: en "El tour del producto", mencionar que desde Assist y desde Salud de agentes existe **Mostrarme dónde**.

`README.md` de la KB: sumar las reglas "no prometer que el recorrido guiado cambia configuración" y "no describir la barra de contexto como notificación".

`assistant-kb-contract.spec.ts`: agregar marcadores en 4 idiomas para las tres secciones nuevas (p. ej. ES `/\*\*Mostrarme dónde\*\*[\s\S]{0,240}no modifica/i`, `/barra de contexto/i`, `/Cobertura de los canales asignados/i`) y para el estado nuevo de WhatsApp.

`docs/agent-quality-center.md`: actualizar "Superficie y acceso" (endpoint nuevo, barra de contexto), "Preparación" (semántica de `channel_connection`/`channel_coverage`) y "Parallly Assist como coach" (bloque de canales, evidencia acotada, acción `start_guided_tour`). `docs/platform-assistant-knowledge.md`: fila nueva en la tabla de fuentes ("Recorridos guiados → `guided-tour-contract.ts` + `guided-tours.ts`"). `CLAUDE.md`: una línea en el índice de docs apuntando a este plan.

---

## 4. Orden de ejecución sugerido (para Opus, con archivos disjuntos por agente)

| Unidad | Archivos (propiedad exclusiva) | Depende de |
|---|---|---|
| **A. API calidad + canales** | `quality/agent-quality.service.ts` (+spec), `quality/quality.controller.ts` (+spec), `quality/agent-quality-signal.service.ts` (renombre con alias), `channels/channel-credential-health.util.ts` (+spec), `channels/channel-management.controller.ts` | contrato de `getTenantChannelSnapshot` y del endpoint (fijados arriba) |
| **B. API copilot** | `copilot/copilot.service.ts`, `copilot/copilot.service.context.spec.ts`, `copilot/guided-tour-contract.spec.ts` | firma de `getTenantChannelSnapshot` (A) — en tests se mockea |
| **C. Dashboard** | `lib/quality-health.ts` (+spec), `lib/quality-labels.ts`, `lib/guided-tours.ts` (+spec), `lib/api.ts`, `components/quality/*`, `components/tour/ProductTour.tsx`, `components/HelpAssistant.tsx`, `app/admin/layout.tsx`, páginas con anclajes, `messages/{es,en,pt,fr}.json` | contrato compartido (hecho) y forma del endpoint (A) |
| **D. KB + docs** | `apps/api/kb/assistant/**`, `copilot/assistant-kb-contract.spec.ts`, `docs/agent-quality-center.md`, `docs/platform-assistant-knowledge.md`, `CLAUDE.md` | ninguna |

A, B, C y D pueden correr en paralelo. Después, **una sola** pasada de verificación (§5) y una revisión adversarial con tres lentes: corrección de la semántica de calidad (¿puede volver a dar crítico con WhatsApp operando?), privacidad/seguridad de Assist y del tour (¿puede el modelo abrir algo fuera del registro? ¿se filtra un id?), y consistencia UX + i18n (¿toda clave existe en los 4 JSON? ¿todo anclaje existe en la página?).

## 5. Verificación (obligatoria antes de push)

```bash
cd packages/shared && npx tsc --noEmit
cd apps/api && npx tsc --noEmit
cd apps/api && npx jest src/modules/quality src/modules/copilot src/modules/channels/channel-credential-health.util.spec.ts --maxWorkers=2
cd apps/api && npm test -- --runInBand src/modules/copilot/assistant-kb-contract.spec.ts
cd apps/api && JWT_SECRET=test npm run test:bootstrap      # DI (el contrato compartido se importa como valor en runtime)
cd apps/dashboard && npx tsc --noEmit
cd apps/dashboard && npx jest
```

Notas de la memoria del proyecto: la suite completa de la API con `--runInBand` no termina; usar `--maxWorkers=2` y no lanzar dos corridas a la vez. El bootstrap necesita `JWT_SECRET` en el shell. Si `tsc` local pasa pero CI marca implicit-any en callbacks de Prisma, anotar los tipos explícitamente.

**Prueba manual en producción (el dueño prueba en prod):**

1. Con el tenant afectado, abrir Inicio: la tarjeta **Salud de tus agentes** ya no debe mostrar "Conexión operativa del canal" como crítica si WhatsApp opera; debe mostrar **Cobertura de los canales asignados** (alta) si el agente tiene Instagram/Messenger marcados sin conectar.
2. Clic en **Revisar** → la página destino muestra la barra de contexto con la explicación ("asignado a 2, conectado 1, sin conexión: instagram").
3. **Mostrarme dónde** → se abre el editor del agente y se resalta el bloque de canales; **Listo** cierra el tour y devuelve el foco.
4. **Preguntar a Assist** → Assist nombra el canal conectado (WhatsApp) y dice exactamente qué asignación falta; nunca "no tenés canales conectados".
5. En chat libre: "¿dónde conecto Instagram?" → respuesta con botón **Mostrarme dónde** → tour `connect_channel`.
6. Posponer 24 h desde la barra → desaparece el aviso y la barra; la señal vuelve al vencer.

## 6. Despliegue y riesgos

- Sin migraciones. El endpoint nuevo es aditivo; la barra de contexto tolera un 404 si la API vieja sigue viva unos minutos durante el rolling restart.
- La KB viaja dentro de la imagen de la API: los cambios de §3.4 requieren deploy de API, no solo de dashboard.
- Onborda `nextRoute` usa `router.push` + `MutationObserver`; si un anclaje no existe en la página destino el paso queda esperando: por eso el runner tiene timeout y los tests de `guided-tours.spec.ts` verifican rutas canónicas. Verificar en prod cada tour una vez.
- `useSearchParams` en componentes del layout exige `<Suspense>`; sin él el build de Next falla.
- No cambiar la semántica de posponer/reconocer ni el esquema de `agent_quality_signals`. No hay envío de correo/push. El tour nunca escribe datos.

## 7. Fuera de alcance (a propósito)

- Auto-corrección desde Assist (editar agente/conocimiento): prohibido por diseño del Centro de calidad.
- Recorridos en móvil (los anclajes viven en el layout de escritorio): se muestra el enlace de fallback.
- Nuevos checks de calidad más allá de `channel_coverage`.


---
---

# PARTE II — Onboarding, primer canal y ayudas en pantalla: análisis completo y plan de simplificación

_Agregado el 4-sep-2026. Método: lectura estática por cinco analistas en paralelo (alta y wizard, primer canal, Inicio y sistema de ayudas, configuración esencial, decisiones previas) + verificación puntual. Nada se ejecutó en producción. Leyenda: **[V]** verificado por segunda lectura independiente o grep directo; **[sv]** con evidencia archivo:línea, sin segunda verificación; **[inferido]** deducido del código, no observado._

## 8. Objetivo y principios

**Objetivo:** que una persona sin conocimientos técnicos (peluquería, clínica, inmobiliaria; muchas veces desde el celular) llegue a ver a su agente respondiendo por WhatsApp **sin llamar a soporte**, guiada solo por lo que la pantalla le dice, por los recorridos guiados ("Mostrarme cómo / Mostrarme dónde") y, si pregunta, por Parallly Assist. Metas medibles: el agente responde en el chat de prueba antes de los **3 minutos** desde el alta; WhatsApp conectado antes de los **6 minutos** propios (sin contar lo que tarde la ventana de Meta) cuando tiene los requisitos a mano; todo lo demás es opcional, viene pre-hecho por la industria y se completa después con guía.

Principios (cada uno es comprobable en código o en la prueba manual del §15):

| # | Principio | Cómo se comprueba |
|---|---|---|
| P1 | **Un solo camino y un solo estado.** Alta → conocer al agente → conectar WhatsApp → Inicio. Un único `onboardingStage` que leen todos. | `grep onboardingStage` aparece en el resolver de redirect, en Inicio, en la tarjeta de puesta en marcha y en el runner de tours; no quedan tres máquinas de estado |
| P2 | **Una sola guía a la vez.** En cada pantalla, como máximo un aviso y una tarjeta de progreso. El tour se ofrece, nunca se dispara solo. | Al aterrizar sin canal se renderiza solo la tarjeta de puesta en marcha; `PRODUCT_TOUR_PENDING_KEY` no se escribe sin canal |
| P3 | **Lo esencial viene hecho; la persona confirma, no crea.** El bootstrap por industria ya crea agente, FAQs, servicios y pipeline. | El wizard muestra el agente derivado ("Preparamos a Sofía…") y no vuelve a pedir plantilla |
| P4 | **Toda pantalla de configuración explica qué es y cómo se hace, y puede mostrarlo.** HelpPanel con pasos numerados + botón **Mostrarme cómo** + estado vacío con la acción principal. | Las páginas del §10 tienen HelpPanel con `tourId`; los estados vacíos tienen CTA |
| P5 | **Lenguaje llano.** Nada de RAG, topK, umbral, tokens, triggers, webhooks, chunks fuera de un plegable **Avanzado**. | La lista de jerga del §11 queda en cero fuera de "Avanzado" |
| P6 | **Todo error dice qué hacer, en el idioma del usuario y junto al campo.** | No hay `message` crudo del backend en pantalla; el mapa código→i18n cubre alta, wizard y conexión de canal |
| P7 | **Lo que se difiere deja huella y vuelve solo.** "Conectar después" guarda fecha y el sistema lo vuelve a ofrecer. | `channelConnectSkippedAt` escrito; Inicio lo lee |
| P8 | **Una sola verdad.** Tarjeta de puesta en marcha, Salud de agentes y Assist leen los mismos hechos (Parte I). | La tarjeta deriva sus ítems de los checks críticos; no hay heurísticas paralelas |
| P9 | **Primero el celular.** Banners que apilan, grillas de una columna, y un modo "spotlight" del tour bajo 768 px. | Ninguna grilla `grid-cols-2/3` sin breakpoint en las pantallas de alta y canales |

## 9. El recorrido real hoy (post-julio)

Lo que ve hoy un dueño nuevo, verificado en el código de septiembre:

```
LANDING → /signup?plan=&country=&cycle=  (intención comercial y UTMs en sessionStorage: signup/page.tsx:93-116)
  ▼
[1] /signup ······ 1 pantalla · Nombre, Apellido, "Email corporativo", contraseña con 5 reglas · Google/Microsoft · ~1 min
  │  sin checkbox de términos · éxito → directo a /onboarding (:228); el correo de verificación sale en segundo plano
  ▼
[2] /onboarding ·· 4 pasos ("Tu empresa · Tus clientes · Objetivos · Plan", STEP_KEYS :32) · ~4-6 min
  │  Paso 1: 13 campos, 5 obligatorios (nombre, industria, subtipo, tamaño, "sobre tu empresa" — canProceed :711-717) [V]
  │          zona horaria detectada del navegador (:661-665) pero mostrada como select obligatorio
  │  Pasos 2-3: audiencias y objetivos por vertical · Paso 4: país, ciclo, tarjetas del catálogo vivo, "Crear mi cuenta" (:1525)
  │  borrador local por usuario 7 días (:39-48) · sin selector de idioma, sin link de ayuda · sin ayuda en pantalla
  │  errores del backend fuera de auth: crudos y en inglés (ValidationPipe sin exceptionFactory, main.ts:96-101) [V]
  │  SUBMIT idempotente con lock (auth.service.ts:1791-1799, :1841-1890) → tenant + agente por objetivos + bootstrap vertical
  ▼
  puente "¡Cuenta lista! Preparando…" 1,4 s → window.location.href = /admin/setup-wizard (:843-850)
  ▼
[3] /admin/setup-wizard ·· Dialog modal, 5 pasos (setup-wizard/page.tsx:276-282) · solo tenant_admin · ~5-10 min + Meta
  │  (0) "Elige tu agente": grilla completa de plantillas, la derivada preseleccionada y marcada Recomendada (:101-140, :313)
  │  (1) Personalizar: nombre, saludo, tono, horario (huso fijo America/Bogota :78,:82 [V]), 3 FAQs · autoguarda al avanzar (:202-217)
  │  (2) Pruébalo: chat real contra el agente ya guardado
  │  (3) Conéctalo: pre-check de 3 casillas (WhatsAppPrerequisites.tsx) → 3 rutas (coexistencia Recomendado, nuevo, "número de prueba")
  │      sin pasos/requisitos/aviso de 24 h en esta pantalla (viven solo en /admin/channels/whatsapp:397-443) [sv]
  │      "Conectar después" = setStep(step+1) sin persistir nada (:622-632) [V]
  │  (4) Descúbrelo: tarjetas de herramientas + Copilot · "Finalizar" deja el tour pendiente aunque no haya canal (:258) [V]
  ▼
[4] /admin ·· se apilan: banner ámbar "Conecta tu primer canal" (:376) · banner "Retomar configuración" si saltó (:392)
             · AgentHealthCard (:428) · InitialSetupCard 3 ítems (:429) · hero vacío con 3 tarjetas (:432)
             · tour Onborda a los 350 ms en escritorio · burbuja del asistente · banner de verificación de correo
             · banner ROJO de calidad si `channel_connection` falla (Parte I) — 6 a 8 superficies a la vez [V]
```

**Conteo honesto:** 3 pantallas de alta + 5 del wizard + Inicio; unos 30 campos visibles (5 + 5 obligatorios); 12-20 minutos si nada falla; el "aha" (el agente contesta) sigue en la pantalla 7. Mejor que en julio (11 pantallas, aha en la 9), lejos de la meta (aha en la 5, canal en 6 min).

### 9.1 Qué se arregló desde julio y qué sigue igual

| Ítem del plan de julio | Estado | Evidencia |
|---|---|---|
| #1 Fusible de sesión de 6 min en /verify-email y /onboarding | **DONE** | `AuthContext.tsx:91,:98-99` (rutas fuera de `PUBLIC_PATHS`, keep-alive) |
| #2 Checklist no detectaba canal | **DONE** | reemplazado por `InitialSetupCard` + `lib/initial-setup.ts:61-64,:98-101` |
| #3 Borrador persistido | **DONE** (solo local) | `onboarding/page.tsx:39-48, :616-686` |
| #4 Email falla en voz alta | **DONE** | `auth.controller.ts:554`, `verify-email/page.tsx:41-48` |
| #5 Salidas en /verify-email + verificación no bloqueante | **DONE** | `verify-email/page.tsx:51-95,:331`; guard por capacidad (b2ae266e) |
| #6 Botón final y 404 de Analytics | **DONE** | `onboarding/page.tsx:1525`; `ToolsTour.tsx:55` |
| #7 Limpiar audiencias al cambiar industria | **DONE** | `onboarding/page.tsx:1084-1091` |
| #8 Timezone del navegador + mapa de país | **DONE** | `onboarding/page.tsx:661-665`; `auth.service.ts:2706` |
| #9 Un solo camino (plantilla derivada preseleccionada) | **PARTIAL** | preselección sí (`setup-wizard/page.tsx:70-100,:313`); el paso 0 sigue siendo la grilla "Elige tu agente" |
| #10 Autosave antes de Pruébalo | **DONE** | `setup-wizard/page.tsx:202-217` |
| #11 Alta idempotente, slug con sufijo | **DONE** | `auth.service.ts:1841-1890, :2095` |
| #12 Errores tipados end-to-end | **PARTIAL** | auth con `error`+`message` ES; validación de DTO, throttle y `plan_not_found` siguen crudos [V] |
| #13 Reabrir el wizard + roles | **PARTIAL** | `setupWizardSkipped` + banner (`admin/page.tsx:392-402`) + `@Roles('tenant_admin')` (`persona.controller.ts:110,:267`); **falta entrada en Configuración** y el banner se oculta si falta canal |
| #14 Embudo + UTMs | **DONE** (el doc de julio está desactualizado) | `signup-attribution.ts`, `tenants.service.ts:1979-2024`, `OnboardingMetricsCard` |
| #15 Idioma desde el locale real | **DONE** | `auth.service.ts:2100-2108` |
| #16 Preview vivo del agente en /onboarding | **PENDING** | sin `AgentTestChat` en `/onboarding` |
| #17 Crawl automático del sitio web | **PENDING** | sin job en el alta |
| #18 Consumir definiciones de verticales | **PARTIAL** | industrias/subtipos desde API (`:568-590`); `VERTICAL_GOALS/AUDIENCES` siguen hardcodeadas como fallback muerto (`:187-353`) |
| #19 Checklist responsive + una sola guía al aterrizar | **PARTIAL** | responsive sí; **una sola guía NO** (ver §11 #1) |
| #20 Términos y privacidad en el alta | **PENDING** | sin checkbox ni `acceptedTermsAt` |

Decisiones de producto ya tomadas que esta Parte respeta: trial-first sin tarjeta (catálogo `billing_plans`); verificación de correo no bloqueante; idioma del locale real; solo `tenant_admin` corre el setup, supervisor puede conectar canales; referido fuera del camino crítico; activación = primer canal conectado (`firstChannelConnectedAt`); coexistencia/QR como ruta estrella con pre-check; la tarjeta de puesta en marcha es el hub de esenciales (sin pastilla 8/9). **Dos decisiones acordadas que hoy NO están en vigor:** el camino canónico único con un solo estado (`onboardingStage`), y la guía única al aterrizar. Esta Parte las cierra.

## 10. Mapa de ayudas en pantalla

Inventario de las pantallas por las que pasa la puesta en marcha (HelpPanel = componente `components/ui/help-panel.tsx`; "media" = GIF por convención `/help/{mediaKey}.gif`; "ancla" = ítem del sidebar `#tour-<labelKey>`):

| Pantalla | HelpPanel | Tips | Media real | Ancla de tour | Estado vacío con CTA | Observación |
|---|---|---|---|---|---|---|
| `/onboarding` (3 pantallas) | **no** | — | — | — | — | fuera del layout admin: sin ayuda, sin Assist, sin selector de idioma, sin link de soporte |
| `/admin/setup-wizard` | **no** | — | — | — | — | Dialog modal; el Assist queda detrás del foco |
| `/admin` Inicio | sí (`page.tsx:421`) | 5 | no | `home` | hero con 3 tarjetas | tip cita un banner con otro nombre ("Sin canal conectado" vs "Conecta tu primer canal") [V] |
| `/admin/channels` | sí (`:127`) | 5 | no | `channels` | tarjetas fijas | describe **Email** como canal conectable; la página no tiene esa tarjeta [V] |
| `/admin/channels/whatsapp` | sí (`:202`) | 4 | no | — | — | el mejor panel del conjunto (requisitos, rutas, error frecuente); contradice la ruta recomendada al decir "elimínalo de la app" [sv] |
| `/admin/agent` (lista) | sí (`:381`) | 5 | no | `aiAgent` | sí | banner "Personaliza tu agente" solo aparece con nombres de plantilla genérica: nunca para tenants verticales [sv] |
| `/admin/agent/[id]` (editor) | **no** | — | — | — | n/a | la pantalla donde más se escribe no tiene ayuda; solo el banner de calidad con un contador |
| `/admin/agent/quality` | **no** | — | — | `agentQuality` | sí | — |
| `/admin/agent/simulation` | sí | 5 | no | hijo de `aiAgent` | sí | — |
| `/admin/knowledge` | sí (`:581`) | 5 | no | `knowledgeBase` | texto sin CTA | título "Knowledge Base" y badge "{n} chunks" sin traducir; tips nombran botones que no existen [sv] |
| `/admin/knowledge/faqs` | sí (`:160`) | 5 | no | — | texto sin CTA | — |
| `/admin/appointments` | sí (`:845`) | 5 | no | `appointments` | no | avisa que el horario debe confirmarse aparte (bien) |
| `/admin/settings/business-info` | sí (`:168`) | 4 | no | — | n/a | "Sobre nosotros" no está marcado obligatorio aunque el check `business_identity` lo exige |
| `/admin/settings/business-hours` | sí (`:126`) | 4 | no | — | n/a | — |
| `/admin/users` | sí (`:444`) | 5 | no | `users` | sí | roles sin descripción |
| `/admin/inbox` | sí (`:1349`) | 5 | no | `conversations` | sí | dice que hay **SMS** en el inbox, que no es un canal conversacional. **Corrección del análisis inicial:** el escalado a supervisor a los 5 minutos SÍ existe (`agent-availability.service.ts:126-195`, cron cada 2 min, con oyentes en `agent-console.gateway.ts:711` y `push-listener.service.ts:120`); lo que falta decir es que además, a los 180 minutos sin respuesta, la conversación vuelve a la IA (`handoff.service.ts:36`) [V] |

Fallas del sistema de ayuda como sistema:

- **Cero medios.** Las 103 páginas con HelpPanel pasan `mediaKey`; `apps/dashboard/public/help/` solo tiene un README. Cada apertura del panel pide un GIF que no existe y se oculta en silencio [V].
- **Sin "cómo mostrarlo".** `HelpPanelProps` no tiene ningún gancho para lanzar un recorrido; los tips dicen "haz clic en Configurar en la tarjeta de WhatsApp" y nada señala esa tarjeta [V].
- **Tres huecos donde más se escribe:** editor del agente, Centro de calidad y setup-wizard sin HelpPanel; y `help.settingsCompany` existe para una página que solo redirige [V].
- **Deriva de contenido:** cuatro textos describen cosas que no existen (SMS e Email como canales, escalado a los 5 minutos, nombre del banner).
- **Solo escritorio:** el tour se apaga bajo 768 px sin alternativa; en celular aterrizan a la vez banners, tarjetas y la burbuja del asistente.
- **Tres verdades de "listo":** la tarjeta de puesta en marcha (agente/canal/conocimiento), `getSetupStatus` (8 banderas) y los checks críticos de calidad no coinciden; la tarjeta puede decir 3/3 mientras Salud de agentes dice "Configuración incompleta" por `company.about` vacío [sv].

## 11. Fricciones ordenadas por impacto

| # | Problema | Sev. | Evidencia | Impacto para un novato | Esf. |
|---|---|---|---|---|---|
| 1 | **Al aterrizar sin canal se disparan 6-8 guías a la vez** y el tour se agenda aunque no haya canal | Alta [V] | `setup-wizard/page.tsx:258`; `admin/page.tsx:376,:392,:428,:429,:432`; `layout.tsx:206,:250`; `QualityAttentionBanner.tsx:50` | No sabe cuál de las 6 cosas tocar; el overlay del tour tapa el único aviso que importa | S |
| 2 | **"Conectar después" no deja estado**: el hilo no vuelve solo; el banner "Retomar" se oculta justamente cuando falta canal | Alta [V] | `setup-wizard/page.tsx:622-632`; `admin/page.tsx:392` | Difiere WhatsApp y nadie lo vuelve a llevar al wizard; vuelve por Canales a una página distinta a la que vio | S |
| 3 | El paso Conéctalo del wizard **esconde los pasos, requisitos y el aviso de 24 h** que sí están en la página de WhatsApp | Alta [sv] | `WhatsAppConnectPanel.tsx:63-67,:115-116` vs `channels/whatsapp/page.tsx:397-443`; `es.json:3183-3194` | Entra a la ventana de Meta sin saber que necesita la app actualizada, que WhatsApp Web se desconecta ni que tiene 24 h para autorizar el historial | M |
| 4 | **Éxito con advertencias** (negocio no verificado, webhook fallido) se muestra como éxito limpio | Alta [V] | `onboarding.service.ts:437-455,:1434-1456` (solo devuelve `errorMessage` unido, no `warnings[]`) vs `WhatsAppEmbeddedSignup.tsx:277-285` (llama `onSuccess` con solo `res.ok`), `page.tsx:450-453`, `ConnectPanel.tsx:71-74`; `grep COMPLETED_WITH_WARNINGS` en el dashboard = 0 | Ve "¡Conectado!" y después la IA no responde; llama a soporte convencido de que "no anda" | S |
| 5 | **Ventana de Meta bloqueada por el navegador**: nada lo detecta; el botón queda en "Esperando autorización…" | Alta [V] | `WhatsAppEmbeddedSignup.tsx:316-340` (`launching` solo se restablece si el SDK lanza, si Meta llama de vuelta o si llega un `message` de cancel/error), `:343-365` (botón deshabilitado con `waitingAuth`); sin `setTimeout` ni detección de popup en el archivo ni en `embedded-signup-events.ts`; el texto correcto ya existe en `es.json:3134` | En celular (donde el popup es otra pestaña) ve un botón muerto con barra de progreso | S |
| 6 | **"Número de prueba" es una ruta fantasma**: mismo flujo que "Número nuevo", ausente en la página | Alta [V] | `WhatsAppConnectPanel.tsx:17-21`; `WhatsAppEmbeddedSignup.tsx:245-251`; `WhatsAppPrerequisites.tsx:46` | Quien no tiene número es invitado a "probar sin compromiso" y termina en el mismo OTP | S |
| 7 | **Errores de validación del backend en inglés y sin decir en qué paso está el campo** | Alta [V] | `main.ts:96-101` (sin `exceptionFactory`); `onboarding/page.tsx:786-790`; `auth-throttle.guard.ts:63`; `billing.service.ts:188` | Escribe `contacto@mi-salon` en el paso 1, llena tres pasos más y recibe `company.email must be an email` en el paso 4 | S |
| 8 | **13 campos en el paso 1** (5 obligatorios) y la zona horaria detectada mostrada como select obligatorio | Alta [V] | `onboarding/page.tsx:929-1200,:711-717,:661-665,:1172` | Pantalla de scroll largo con asteriscos mezclados; no distingue lo importante (qué hace el negocio) de lo accesorio (TikTok, cupón) | S |
| 9 | **El editor guarda un agente sin nombre, sin fallback, sin reglas ni motivos de escalado**, y el banner de calidad no dice cuál falta | Alta [V] | `[agentId]/page.tsx:247-287` (Guardar solo `disabled={saving}`); `PersonaTab.tsx:147-179` sin `required`; `BehaviorSection.tsx:39-46` permite vaciar listas; `persona.controller.ts:510-524` `@Body() body: any` sin DTO; `persona.service.ts:1006-1155` escribe `config_json` sin chequeos (`validateConfig` solo desde `savePersonaFromYaml:121`); `AgentReadinessBanner.tsx:67-75` solo el conteo; sin `?tab=` (`page.tsx:87`) | "Limpia" un campo para reescribirlo, guarda, y queda con un "bloqueo crítico" que lo manda a la misma página sin señalar el campo | S |
| 10 | Los chips de **asignación de canales muestran los 6 tipos, incluido SMS, aunque nada esté conectado**, sin enlace a Canales | Alta [V] | `[agentId]/page.tsx:40,:491,:526-533` | "Asigna WhatsApp" sin haberlo conectado y cree que terminó; el check de conexión queda en fallo | S |
| 11 | El check crítico **`agent_active` no tiene ningún control en la UI** | Alta [V] | `agent-quality.service.ts:695`; `[agentId]/page.tsx:467-474` (badge sin acción); grep de toggle vacío | Ve "Inactivo" y un bloqueo que lo manda a una página donde no puede arreglarlo | S |
| 12 | La **plantilla FAQ enciende RAG**: un tenant con FAQs y cero documentos queda bloqueado por `rag_knowledge` | Media [V] | `persona.service.ts:1343-1369`; `onboarding-persona-resolver.ts:266`; `agent-quality.service.ts:713-717` | Ve "Base de conocimiento lista" en rojo aunque sus FAQs funcionan; el interruptor causante está al final de Herramientas con texto técnico | S |
| 13 | **Huso fijo America/Bogota** en los horarios del wizard y del controlador de persona | Media [V] | `setup-wizard/page.tsx:78,:82`; `persona.controller.ts:149,:237`; el tenant ya declaró su huso en `onboarding/page.tsx:663` | Un negocio en México o Argentina configura 9-18 y la IA responde "fuera de horario" estando abierto | S |
| 14 | **Dos horarios** (negocio vs disponibilidad de citas) sin sincronía y con defaults distintos | Media [sv] | `settings/business-hours/page.tsx:29-35` vs `appointments/page.tsx:124-129`; `ConfigTab.tsx:334-343` | Guarda "Horarios" y cree que la agenda ya tiene horario; la IA dice "sin disponibilidad" | S |
| 15 | "Sobre nosotros" es crítico (`business_identity`) pero la página **solo exige el nombre**; objetivos y público no tienen editor | Media [sv] | `settings/business-info/page.tsx:96-99,:210-211`; `agent-quality.service.ts:699,:702-704` | Un tenant creado fuera del alta (o que borra el texto) queda bloqueado sin pista | S |
| 16 | **Deriva de la ayuda en pantalla** (SMS y Email como canales inexistentes, nombre equivocado del banner, `settingsCompany` muerta) y **cero medios** en 103 páginas | Media [V] | `es.json help.inbox/help.channels/help.dashboard`; `settings/company/page.tsx:25`; `public/help/` | Busca una tarjeta de Email que no existe y espera mensajes de SMS en el inbox. **El escalado a los 5 minutos NO es deriva: existe** (ver §10); lo que hay que agregar es el retorno a la IA a los 180 min | XS + M |
| 17 | **Sin HelpPanel** en el editor del agente, el Centro de calidad y el wizard; **sin gancho "Mostrarme cómo"** en ningún panel | Media [V] | `agent/[agentId]/page.tsx`, `agent/quality/page.tsx`, `setup-wizard/page.tsx` (0 usos); `help-panel.tsx:8-22` | Donde más escribe, menos ayuda tiene | S |
| 18 | **Jerga visible**: "Base de conocimiento (RAG)", "Afinamiento de búsqueda", "Umbral de relevancia", "Triggers de escalado", "Información requerida por contexto" con placeholders `nombre_del_contexto`, "Upsell y cross-sell", "Knowledge Base", "{n} chunks", "Webhooks / MCP / API Keys" a todo admin | Media [sv] | `CapabilitiesSection.tsx:613,:732-780,:461,:187-233`; `BehaviorSection.tsx:23,:148,:204-232`; `knowledge/page.tsx:695,:1594`; `_settings-config.ts:141-148` | Miedo a tocar; cree que necesita un técnico | S |
| 19 | **Sin ayuda, sin idioma y sin salida en /onboarding y /verify-email**; el idioma del agente se decide justo ahí | Media [sv] | `onboarding/page.tsx:11-31` (sin `LocaleSwitcher`, sin soporte); `auth.service.ts:2104-2108` | Un brasileño sin cookie hace todo en español y su agente nace en español | XS |
| 20 | **Invitar** no explica roles ni que la IA necesita un humano **activo**; las invitaciones pendientes no cuentan | Media [sv] | `users/page.tsx:730-738,:361`; `agent-quality.service.ts:774` | Invita, la persona no acepta, y "Ruta hacia atención humana" sigue en rojo sin explicación | XS |
| 21 | **Celular:** grillas sin breakpoint (`grid-cols-3` en Canales, `grid-cols-2` en alta), banners de Inicio que no apilan, tour sin alternativa | Media [sv] | `channels/page.tsx:135`; `signup/page.tsx:300`; `onboarding/page.tsx:972`; `admin/page.tsx:377,:393`; `product-tour-contract.ts:5` | Tarjetas de 100 px, botón fuera del borde, nunca ve el tour | XS |
| 22 | **Manual y KB del Assist contradicen el flujo real** (verificar código antes del asistente; "elige una plantilla"; retomar entrando a la URL) | Media [V] | `kb/assistant/es/01-primeros-pasos.md:15-16,:29,:104`; `docs/user-manual.md:99-100`; `signup/page.tsx:228` | El asistente de ayuda le dice que espere un código que aún no necesita | S |
| 23 | **No hay entrada en Configuración para reabrir el wizard** y el estado de onboarding vive en tres lectores | Baja [V] | `_settings-config.ts` sin `setup-wizard`; `AuthContext.tsx:382-390` + `admin/page.tsx:172-210` + `InitialSetupCard` | Quien saltó y ya conectó canal pierde el banner y no tiene otra entrada | S |
| 24 | El puente "¡Cuenta lista!" promete fin y aterriza en otro asistente con reload duro | Baja [sv] | `onboarding/page.tsx:843-850` | Dos cargas completas en móvil con red lenta; percepción de dos productos | XS |

**Descartado o corregido durante la verificación:** la afirmación de un analista de que "tamaño" y "sobre tu empresa" son opcionales en el paso 1 es falsa (`canProceed` los exige, `:711-717`); el diagnóstico de julio de que "falta `@Roles('tenant_admin')`" y "#14 pendiente" está desactualizado (ambos hechos); ningún hallazgo grave fue refutado.

## 12. Diseño objetivo

### 12.1 El flujo (seis pantallas, un estado)

```
[1] /signup ······················ igual que hoy (4 campos o Google). ~1 min
[2] /onboarding (4 pasos) ········· Paso 1 con 4 campos visibles: nombre, industria (+subtipo), "¿Qué hace tu negocio?", tamaño.
                                   Zona horaria como chip "Detectamos America/Bogota · cambiar". Web, teléfono, email, redes y cupón
                                   en "Más detalles (opcional)" plegado. Paso 4: una sola tarjeta (prueba sin tarjeta del país) + "Ver otros planes".
                                   Selector de idioma + link "Ayuda" arriba. Validación en el cliente con las reglas del DTO; errores
                                   del servidor mapeados a i18n y salto automático al paso del campo. ~3 min
    puente "Cuenta creada · ahora te presentamos a tu agente" (sin prometer "listo")
[3] /admin/setup-wizard → "Conocé a tu agente" (3 pasos, página con Esc, reabrible desde Configuración)
    (1) Tu agente: "Preparamos a Sofía, recepcionista de clínica" · nombre y saludo editables con autosave · chat de prueba al lado
        · botón secundario "Cambiar plantilla" (la grilla se muda a /admin/agent).                        🎯 AHA en la pantalla 5, ~4 min
    (2) Conectá WhatsApp: pre-check (3 casillas) → rutas compartidas con la página (coexistencia Recomendado, nuevo, migración)
        → resumen de la ruta elegida (pasos, requisitos, aviso de 24 h) → botón → estado "conectando" con timeout →
        éxito con "Probá tu agente" (wa.me) o tarjeta ámbar de advertencias → "Continuar".
        "Conectar después" persiste channelConnectSkippedAt y muestra "te lo recordamos en Inicio".               ~5 min propios
    (3) Listo: qué sigue (los 3 esenciales de la tarjeta) + "Ver el recorrido del panel" (ofrecido, no disparado).
[4] /admin ·· UNA guía: si falta canal → solo la tarjeta de puesta en marcha con el ítem canal expandido y "Mostrarme dónde";
             si hay canal → tarjeta hasta completar + Salud de agentes. Hero, tour automático y banner rojo de calidad
             quedan suprimidos en /admin mientras la puesta en marcha esté incompleta.
```

Lo que desaparece: el paso "Elige tu plantilla", el paso "Descúbrelo", el modal bloqueante, el tour automático, el hero de tres tarjetas y el aviso rojo de calidad sobre una cuenta recién creada.

### 12.2 Modelo de estado único

`tenant.settings.onboardingStage` (JSONB, aditivo; sin migración):

| Valor | Lo escribe | Cuándo |
|---|---|---|
| `account_created` | `completeOnboarding` (`auth.service.ts`) | al crear el tenant |
| `agent_reviewed` | `POST /persona/:tenantId/setup-wizard` (paso 1 del wizard) | al guardar nombre/saludo o al confirmar |
| `channel_connected` | el mismo hook que escribe `firstChannelConnectedAt` (`channel-management.controller.ts`, `whatsapp-connection.service.ts`) | al conectar cualquier canal certificado |
| `channel_deferred` (+ `channelConnectSkippedAt`) | "Conectar después" | al diferir |
| `completed` | "Listo" del wizard, o automáticamente cuando la tarjeta de puesta en marcha llega a 100 % | — |

Un solo resolver en el dashboard, `lib/onboarding-guide.ts`:

```ts
export function resolveOnboardingGuide(input: { stage; hasAnyChannel; role; setupWizardSkipped }): {
  redirect: '/admin/setup-wizard' | null;       // solo tenant_admin y stage account_created
  landing: 'setup_card_only' | 'setup_card_and_health' | 'normal';
  offerTour: boolean;                            // nunca auto-disparo
  showResumeBanner: boolean;                     // channel_deferred o skipped, con o sin canal
}
```

Lo consumen `AuthContext.getRedirectPath`, `admin/page.tsx`, `InitialSetupCard`, `TourLauncher` y `QualityAttentionBanner` (que en `/admin` devuelve `null` mientras `landing !== 'normal'`). Compatibilidad: si `onboardingStage` no existe (tenants anteriores), se deriva de `setupWizardCompleted/Skipped` + `firstChannelConnectedAt` en el mismo resolver.

### 12.3 La tarjeta de puesta en marcha como única fuente de progreso

Ítems derivados de los checks críticos de preparación (Parte I) más el canal, en este orden y con dos acciones cada uno (**Continuar** y **Mostrarme dónde** → tour):

| Ítem | Hecho cuando | Tour |
|---|---|---|
| Conectar WhatsApp (u otro canal certificado del plan) | hay cuenta activa | `first_channel_whatsapp` |
| Revisar a tu agente | sin bloqueos `persona_identity / fallback_message / behavior_rules / handoff_triggers` | `agent_handoff_rules` |
| Contar qué hace tu negocio | `business_identity` en pass | `business_identity` |
| Cargar lo que el agente debe saber (FAQ o catálogo de la industria) | `knowledge_coverage` en pass o catálogo vertical con registros | `knowledge_base` / ruta vertical |
| Invitar a una persona que reciba los chats | `human_handoff_route` en pass | `human_handoff_route` |
| Confirmar tu horario (solo industrias con agenda) | `business_hours` y `tool_appointments` en pass | `business_hours` → `appointments_setup` |

Se alimenta del overview de calidad del agente por defecto (endpoint existente) y de `/channels/overview`; conserva el comportamiento fail-closed de `resolveInitialSetupSources`. La tarjeta desaparece al completar; `AgentHealthCard` se muestra recién entonces.

### 12.4 Conexión del primer canal, una sola experiencia

- Un catálogo compartido `WHATSAPP_CONNECT_ROUTES` (id, modo, `recommended`, claves del resumen) consumido por el wizard y por `/admin/channels/whatsapp`: coexistencia (Recomendado), número nuevo, migración. **"Número de prueba" sale** hasta que se verifique con Meta que el `config_id` ofrece número de prueba; si se verifica, vuelve con su propio paso guiado dentro del wizard.
- `WhatsAppRouteBrief` extraído de `channels/whatsapp/page.tsx:393-443` (pasos, requisitos, avisos por ruta) y renderizado en ambos lugares al elegir la ruta, antes del botón.
- Pre-check de requisitos también en la página (hoy solo en el wizard).
- Mapa de errores código → i18n con acción y enlace (`channels.whatsapp.errors.*`, 4 idiomas): número ya registrado / PIN de dos pasos, token que no cubre la cuenta, límite del plan (enlace a Plan y facturación), canal no incluido en el plan, config inválida, "ya hay un onboarding en progreso" (con sondeo del estado y reintento cuando `retryable`).
- Timeout de la ventana de Meta (60-90 s sin callback → restablecer el botón, mensaje "permití las ventanas emergentes", botón Reintentar); además, recuperar el foco de la ventana poco después del clic es una señal más rápida que el temporizador solo.
- Respuesta `COMPLETED_WITH_WARNINGS` → tarjeta ámbar con las advertencias traducidas y el CTA "Probá tu agente"; el servicio de WhatsApp debe devolver `warnings[]` con códigos (hoy solo `errorMessage` unido por ` | `).
- El cierre "Probá tu agente" (link wa.me) también en el wizard; el avance a "Listo" espera el clic de la persona.
- Bajo 768 px, aviso antes del botón: "este paso funciona mejor en una computadora; con coexistencia podés escanear el QR desde el celular".

### 12.5 Configuración esencial "para cualquiera"

| Pantalla | Cambio |
|---|---|
| Editor del agente | nombre, rol y "Mensaje cuando no puede responder" obligatorios con mensaje por campo; ≥1 regla y ≥1 motivo de escalado; validación espejo en `persona.service.updateAgent`; interruptor **Activo/Inactivo** en el hero; chips de canal **solo con cuentas conectadas** (sin `sms`) y, si no hay ninguna, "Todavía no conectaste un canal → Conectar"; deep-link `?tab=&focus=` (scroll + resaltado) y esos href desde el servicio de calidad; banner de calidad que **nombra** los tres primeros bloqueos con enlace a su pestaña; "Información requerida por contexto", "Afinamiento de búsqueda" y "Herramienta de búsqueda" bajo **Avanzado**; etiquetas llanas ("Cuándo pasar a un humano", "Documentos y páginas web que el agente puede consultar", "Sugerir productos adicionales", "Usar lo que sabemos del cliente"); borrar los componentes muertos (`IdentitySection`, `PersonalitySection`, `AIModelSection`, `AgentProfileCard`, `ConfigCard`); HelpPanel nuevo (`help.agentEditor`) ordenado por los checks |
| Plantilla FAQ | `tpl_faq` enciende `tools.faqs` y deja `rag.enabled` apagado (o `rag_knowledge` pasa cuando `knowledgeChunks + faqs > 0`) |
| Conocimiento | "Base de conocimiento" / "{n} fragmentos"; primer tip "Empezá por FAQs"; estados vacíos con "Crear mi primera FAQ" / "Subir mi primer documento" + Mostrarme cómo; tips alineados con los botones reales |
| Información del negocio | "Sobre nosotros" obligatorio con ayuda ("2-3 frases: qué vendés, a quién, dónde"); sección "Objetivos y público" con chips (`chatReasons` / `customerTypes`, que hoy solo escribe el alta) |
| Horarios | huso desde `tenant.settings.timezone` (wizard y `persona.controller`); aviso "la disponibilidad para citas se define en Citas → Configuración"; en Citas, botón "Usar el horario del negocio" que precarga los bloques |
| Usuarios | descripción bajo cada rol ("Agente: recibe los chats que la IA pasa a una persona"); aviso "N invitaciones pendientes: hasta que acepten, la IA no tiene a quién pasar la conversación" |
| Configuración (hub) | franja "Esenciales para tu agente" arriba (negocio, horarios, usuarios, asistente de configuración); "Para desarrolladores" (webhooks, MCP, API keys) plegado |

### 12.6 Estándar del sistema de ayuda

1. **Toda pantalla del §10 tiene HelpPanel** con `description` = qué es (2 frases) y `tips` = cómo se hace, numerados en el orden real de los clics; se agregan `help.agentEditor`, `help.agentQuality`, `help.setupWizard`; se borra `help.settingsCompany`; se corrigen los cuatro textos con deriva.
2. **`HelpPanel` gana `tourId?: GuidedTourId`** y renderiza **Mostrarme cómo** (en la cabecera expandida y al final de los tips) cuando `canRoleRunGuidedTour(getGuidedTour(tourId), role)`; bajo 768 px el botón existe igual y el runner usa el modo spotlight (scroll + anillo pulsante sobre el primer anclaje de la página, sin overlay). Sin `tourId`, el panel es como hoy.
3. **`mediaKey` se retira** de las páginas que no tendrán asset (evita 103 peticiones 404 por sesión) y se conserva solo donde se grabe el GIF; el recorrido guiado reemplaza al GIF como pieza visual.
4. **Estados vacíos** de conocimiento, FAQs, citas, pipeline y contactos con la acción principal en línea y Mostrarme cómo.
5. **Pre-tenant** (`/onboarding`, `/verify-email`): coach marks inline de primera visita (localStorage), selector de idioma y link "Ayuda" (wa.me de soporte o mailto); no entran al registro de tours porque el contrato exige rutas `/admin`.
6. **Assist** conoce el estado (`onboardingStage`) y los ítems pendientes de la tarjeta para responder "¿qué me falta?" con precisión (bloque nuevo en el prompt, junto al de canales de la Parte I), y devuelve la acción `start_guided_tour` del ítem pendiente.

## 13. Catálogo de recorridos guiados

Se reutilizan los 10 recorridos de la Parte I (§3.3) tal cual; esta Parte agrega cinco al registro compartido (`packages/shared/src/guided-tour-contract.ts`) y define el mapeo página → `tourId` del HelpPanel. Convención de anclajes en página: `id={guidedTourAnchorId('<nombre>')}` → selector `#tour-target-<nombre>`; el primer paso puede usar el ítem del sidebar `#tour-<labelKey>`.

| Id (nuevo) | Ruta de entrada | minRole | Pasos (anclaje → qué dice) | KB |
|---|---|---|---|---|
| `home_first_steps` | `/admin` | tenant_admin | tarjeta de puesta en marcha (`#tour-target-setup-card`) → "Estos son tus pasos esenciales; cuando los completes, esta tarjeta desaparece" · ítem pendiente y su Continuar (`#tour-target-setup-next`) → "Empezá por acá: conectar WhatsApp toma unos 5 minutos" · botón del HelpPanel (`#tour-target-help-panel`) → "Cada pantalla tiene esta ayuda; abrila cuando te pierdas" · mascota del asistente (`#tour-target-assistant`) → "Y si preferís preguntar, Parallly te responde y te lleva al lugar" | primeros-pasos |
| `first_channel_whatsapp` | `/admin/channels/whatsapp` | tenant_admin | píldora de estado (`whatsapp-status`, `page.tsx:181-198`) → "Acá ves si WhatsApp ya está conectado" · rutas (`whatsapp-routes`) → "Elegí tu situación: ya usás la app de WhatsApp Business (recomendado, conservás tus chats), número nuevo, o venís de otro proveedor" · pre-check (`whatsapp-prerequisites`) → "Tené esto a mano antes de tocar el botón" · resumen de la ruta (`whatsapp-brief`) → "Después de conectar tenés 24 h para autorizar el historial; si migrás, apagá la verificación en dos pasos antes" · botón Conectar (`whatsapp-connect`) → "Se abre una ventana de Meta: no la cierres hasta ver Conexión exitosa; si no aparece, permití ventanas emergentes" · tarjeta Probá tu agente (`whatsapp-test`) → "Mandate un WhatsApp y mirá cómo responde" | canales-whatsapp, primeros-pasos |
| `resume_setup_wizard` | `/admin/setup-wizard` | tenant_admin | entrada en Configuración o banner Retomar (`#tour-target-resume-setup`) → "Desde acá reabrís el asistente sin perder nada" · indicador de pasos (`setup-steps`) → "Tres pasos; podés saltar al que falte" · paso Conectá WhatsApp (`setup-connect`) → "Conectar después te deja volver: Inicio te lo recuerda" | primeros-pasos |
| `help_system` | página actual | tenant_supervisor | botón del HelpPanel (`help-panel`) → "Ayuda de esta pantalla: qué es y cómo se hace" · botón Mostrarme cómo dentro del panel (`help-show-me`) → "Este botón te lleva paso a paso al lugar exacto" · buscador `Ctrl/⌘+K` (`command-palette`) → "Buscá cualquier pantalla por nombre" · mascota (`assistant`) → "Preguntá en tus palabras; responde con tu configuración real" | navegacion-configuracion |
| `inbox_first_conversation` | `/admin/inbox` | tenant_agent | lista de conversaciones (`inbox-list`) → "Acá llegan los mensajes de todos tus canales" · filtro Sin asignar (`inbox-filter-unassigned`) → "Las que la IA pasó a una persona aparecen acá" · botón Tomar (`inbox-take`) → "Tomá la conversación y respondé vos; la IA se retira" · resumen del handoff (`inbox-summary`) → "Arriba tenés el resumen de lo que pasó" | inbox |

Ampliaciones de recorridos existentes de la Parte I (mismos ids; solo se enriquecen los pasos con los anclajes que faltaban):

- `agent_handoff_rules`: nombre (`PersonaTab.tsx:143-153`) → bienvenida (`:165-171`) → "Mensaje cuando no puede responder" (`:173-180`, "obligatorio: promete pasar a una persona") → pestaña Instrucciones, lista Reglas (`BehaviorSection.tsx:101-145`) → "Cuándo pasar a un humano" (misma lista, índice 2) → Guardar (`[agentId]/page.tsx:399-408`). Requiere `?tab=` en el editor.
- `assign_agent_channel`: banner "canales sin agente" (`agent/page.tsx:396-416`) → chips de canales conectados (`[agentId]/page.tsx:487-548`) → Guardar → banner de calidad (`:443`).
- `knowledge_base`: pestaña FAQs (`knowledge/page.tsx:593`) → Nueva FAQ (`faqs/page.tsx:140-144`) → Pregunta/Respuesta (`:221-226`) → casilla Publicado (`:243-244`, "solo lo publicado lo usa la IA") → crear documento / importar web (`knowledge/page.tsx:573`) → Herramientas → interruptor Preguntas frecuentes (`CapabilitiesSection.tsx:444`).
- `business_identity`: nombre (`business-info/page.tsx:196-197`) → Sobre nosotros (`:210-211`) → teléfono/email (`:295-300`) → Guardar (`:350-355`).
- `business_hours`: 24/7 (`business-hours/page.tsx:144-160`) → zona horaria (`:170-176`) → días (`:200-246`) → mensaje fuera de horario (`:258-266`) → Guardar (`:274`) → aviso "la disponibilidad de citas se define en Citas".
- `appointments_setup`: pestaña Servicios (`appointments/page.tsx:916`) → Nuevo servicio (`ServicesTab.tsx:147-149`; nombre y duración `ServiceModal.tsx:85-160`) → pestaña Configuración, Horario de atención y Confirmar (`ConfigTab.tsx:503-556`, "sin confirmar acá la IA dirá que no hay horarios") → Herramientas → Agendamiento (`CapabilitiesSection.tsx:251-306`).
- `human_handoff_route`: Invitar (`users/page.tsx:438-441`) → email (`:719-722`) → rol con descripción (`:730-738`) → Enviar (`:786-796`) → pestaña Invitaciones ("hasta que acepte, la ruta sigue incompleta").
- `run_agent_tests` y `agent_quality_center`: sin cambios.

Coach marks pre-tenant (fuera del registro, dentro de cada página, una sola vez por navegador): `onboarding_business_step` (industria → "¿Qué hace tu negocio?" → zona horaria → Siguiente: "todo lo demás es opcional") y `onboarding_goals_and_plan` (objetivos → tarjeta de plan → "Crear mi cuenta": "falta conectar WhatsApp, te guiamos en la siguiente pantalla").

Mapeo HelpPanel → `tourId`: Inicio → `home_first_steps`; Canales → `connect_channel`; WhatsApp → `first_channel_whatsapp`; Agentes (lista) → `assign_agent_channel`; editor → `agent_handoff_rules`; Conocimiento y FAQs → `knowledge_base`; Citas → `appointments_setup`; Información del negocio → `business_identity`; Horarios → `business_hours`; Usuarios → `human_handoff_route`; Simulación → `run_agent_tests`; Salud de agentes → `agent_quality_center`; Inbox → `inbox_first_conversation`.

## 14. Cambios archivo por archivo

Cuatro unidades nuevas (E-H) con archivos disjuntos entre sí y con las unidades A-D de la Parte I. **E, F, G y H pueden correr en paralelo; F y G dependen del runner de tours de la unidad C (Parte I) para que "Mostrarme cómo" haga algo: hasta entonces los botones existen y no-op.**

### Unidad E — API: estado único, wizard y validaciones

| Archivo | Cambio |
|---|---|
| `packages/shared/src/guided-tour-contract.ts` | agregar los 5 ids nuevos con su `route`, `minRole`, `qualityCodes` (vacío salvo `first_channel_whatsapp` → `channel_connection`) y `kbArticleIds` |
| `packages/shared/src/onboarding-stage-contract.ts` (nuevo, exportado en `index.ts`) | tipo `OnboardingStage`, `resolveOnboardingGuide()` puro (lo usan API y dashboard) + spec |
| `apps/api/src/common/utils/tenant-settings.util.ts` | claves reservadas `onboardingStage`, `channelConnectSkippedAt` |
| `apps/api/src/modules/auth/auth.service.ts` | `completeOnboarding` escribe `onboardingStage: 'account_created'` |
| `apps/api/src/modules/persona/persona.controller.ts` | `POST :tenantId/setup-wizard` acepta `customizations.channelConnectSkippedAt` y `stage`; huso desde `tenant.settings.timezone` en `:149` y `:237`; `GET setup-status` devuelve `onboardingStage`, `timezone`, `defaultAgent {id,name,greeting}`; `POST setup-wizard/skip` escribe `channel_deferred` cuando corresponde |
| `apps/api/src/modules/persona/persona.service.ts` | `updateAgent` valida nombre/rol/fallback/≥1 regla/≥1 trigger con errores tipados `{error:'agent_invalid', fields}`; `tpl_faq` con `tools.faqs.enabled=true` y `rag.enabled=false` |
| `apps/api/src/modules/channels/channel-management.controller.ts`, `whatsapp/services/whatsapp-connection.service.ts` | al escribir `firstChannelConnectedAt`, también `onboardingStage: 'channel_connected'` (si el stage anterior era menor) |
| `apps/api/src/main.ts` | `ValidationPipe({ exceptionFactory })` → `{ error: 'validation_failed', fields: [{ path, constraint }] }` (mantiene 400) |
| `apps/api/src/common/guards/auth-throttle.guard.ts`, `billing/billing.service.ts:188` | mensajes con `error` + `message` en español |
| `apps/api/src/modules/quality/agent-quality.service.ts` | href de checks del agente con `?tab=&focus=` (`persona_identity` → `persona&focus=name`, `fallback_message` → `persona&focus=fallback`, `behavior_rules` → `instructions&focus=rules`, `handoff_triggers` → `instructions&focus=handoff`); si la Parte I ya cambió este archivo, es la misma unidad A la que lo hace |
| `apps/whatsapp/src/modules/onboarding/onboarding.service.ts` | respuesta con `warnings[]` codificados (`business_not_verified`, `webhook_subscription_failed`, …) además del texto |
| Tests | `persona.service.spec` (validación, `tpl_faq`), `persona.controller.spec` (stage, huso), `auth-onboarding-provisioning.spec` (stage inicial), `main` (exceptionFactory con un DTO de prueba), `onboarding-stage-contract.spec` |

### Unidad F — Dashboard: alta, wizard y aterrizaje

| Archivo | Cambio |
|---|---|
| `app/onboarding/page.tsx` | paso 1 con 4 campos visibles + acordeón "Más detalles (opcional)" + chip de zona horaria; paso 4 con una tarjeta y "Ver otros planes"; `LocaleSwitcher` + link Ayuda; validación cliente espejo del DTO; mapa `errorCode → i18n` y salto al paso del primer campo inválido; coach marks; `router.replace('/admin')` si ya hay tenant; copy del puente; borrar `VERTICAL_GOALS/AUDIENCES` muertas |
| `app/signup/page.tsx`, `app/verify-email/page.tsx` | grillas `grid-cols-1 sm:grid-cols-2`; `codeExpires` visible; `LocaleSwitcher` en verify-email |
| `app/admin/setup-wizard/page.tsx` (+ `_components`) | 3 pasos ("Tu agente", "Conectá WhatsApp", "Listo"); página (no modal) con Esc; agente derivado con autosave y chat al lado; "Cambiar plantilla" secundario; "Conectar después" → `channelConnectSkippedAt`; no escribir `PRODUCT_TOUR_PENDING_KEY`; eliminar `ToolsTour` del flujo (queda como componente para el tour ofrecido) |
| `app/admin/channels/whatsapp/{WhatsAppConnectPanel,WhatsAppEmbeddedSignup,WhatsAppPrerequisites}.tsx`, `page.tsx`, nuevo `WhatsAppRouteBrief.tsx`, nuevo `whatsapp-connect-routes.ts` | catálogo compartido de rutas; resumen por ruta en ambos lugares; pre-check en la página; mapa de errores; tarjeta de advertencias; timeout del popup con Reintentar; sondeo del 409; "Probá tu agente" en el wizard; aviso móvil; anclajes `tour-target-whatsapp-*` |
| `app/admin/page.tsx` | regla de guía única vía `resolveOnboardingGuide`; banners apilables en móvil; hero y `AgentHealthCard` condicionados; banner Retomar visible aunque falte canal |
| `contexts/AuthContext.tsx` | `getRedirectPath` usa el resolver compartido |
| `components/InitialSetupCard.tsx`, `lib/initial-setup.ts` | ítems del §12.3 (fuente: overview de calidad + canales); botón "Mostrarme dónde" por ítem; anclajes `setup-card`, `setup-next`; escribe `completed` al llegar a 100 % |
| `components/tour/ProductTour.tsx` | el tour principal se ofrece (link en la tarjeta y en el pie del asistente), nunca se auto-dispara; `TourLauncher` respeta `offerTour` |
| `components/quality/QualityAttentionBanner.tsx` | `null` en `/admin` mientras `landing !== 'normal'` (además de lo que ya hace en Parte I) |
| `app/admin/settings/_settings-config.ts` | entrada "Asistente de configuración" (tenant_admin) → `/admin/setup-wizard` |
| `lib/api.ts` | `getSetupStatus` con los campos nuevos; `saveSetupWizard` con `stage`/`channelConnectSkippedAt` |
| `messages/{es,en,pt,fr}.json` | `onboarding.*` (acordeón, chip, ayuda, validaciones, coach marks), `setupWizard.*` (3 pasos, deferred), `channels.whatsapp.errors.*`, `channels.whatsapp.warnings.*`, `channels.whatsapp.brief.*`, `qualityHealth.setup.items.*` nuevos, `guidedTours.{home_first_steps,first_channel_whatsapp,resume_setup_wizard}.*` |
| Tests | `lib/onboarding-guide.spec.ts` (tabla de casos del resolver), `lib/initial-setup.spec.ts` (ítems derivados y fail-closed), `lib/whatsapp-connect-routes.spec.ts` (mismo catálogo en wizard y página; sin `sandbox`), `lib/guided-tours.spec.ts` (ids nuevos con pasos y rutas canónicas) |

### Unidad G — Dashboard: configuración esencial y sistema de ayuda

| Archivo | Cambio |
|---|---|
| `components/ui/help-panel.tsx` | prop `tourId?: GuidedTourId`; botón **Mostrarme cómo** (cabecera y pie) gateado por rol; spotlight bajo 768 px; `mediaKey` solo si `hasHelpMedia(mediaKey)` (lista estática de assets existentes) |
| `app/admin/agent/[agentId]/page.tsx` + `_components/{PersonaTab,BehaviorSection,CapabilitiesSection,ScheduleCard}.tsx` | obligatorios + validación por campo; interruptor Activo/Inactivo; chips solo con cuentas conectadas y enlace a Canales; `?tab=&focus=`; plegables Avanzado; etiquetas llanas; HelpPanel `help.agentEditor` con `tourId='agent_handoff_rules'`; anclajes `tour-target-agent-*`; borrar componentes muertos |
| `components/AgentReadinessBanner.tsx` | lista los 3 primeros bloqueos traducidos con enlace a pestaña |
| `app/admin/agent/page.tsx` | banner "Personaliza tu agente" por `config_json._personalizedAt` (o `updated_at == created_at`) en vez de nombres de plantilla; anclaje `agent-list` |
| `app/admin/agent/quality/page.tsx` | HelpPanel `help.agentQuality` con `tourId='agent_quality_center'` |
| `app/admin/knowledge/page.tsx`, `knowledge/faqs/page.tsx` | títulos traducidos; estados vacíos con CTA + Mostrarme cómo; tips alineados; anclajes |
| `app/admin/settings/business-info/page.tsx` | "Sobre nosotros" obligatorio con ayuda; sección Objetivos y público; anclajes |
| `app/admin/settings/business-hours/page.tsx`, `components/appointments/ConfigTab.tsx` | aviso cruzado; "Usar el horario del negocio"; anclajes |
| `app/admin/users/page.tsx` | descripciones de rol; aviso de invitaciones pendientes; anclajes |
| `app/admin/settings/page.tsx`, `_settings-config.ts` | franja Esenciales; grupo desarrolladores plegado |
| `app/admin/channels/page.tsx` | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`; anclajes de tarjetas |
| `app/admin/inbox/page.tsx` | anclajes para `inbox_first_conversation` |
| `lib/guided-tours.ts` | pasos de `help_system`, `inbox_first_conversation` y ampliaciones del §13 |
| `messages/{es,en,pt,fr}.json` | `help.*` (corregir inbox/channels/dashboard/channelsWhatsapp; agregar agentEditor/agentQuality/setupWizard; borrar settingsCompany; `help.showMe`), `agent.*` (etiquetas, validaciones, activo), `knowledge.*`, `users.roles.*Description`, `settings.essentials.*`, `guidedTours.{help_system,inbox_first_conversation}.*` |
| Tests | `help-panel` (render del botón por rol/ancho), `guided-tours.spec.ts` (claves i18n de cada paso presentes en los 4 JSON; anclajes declarados existen como `guidedTourAnchorId` en el código: grep estático en el spec) |

### Unidad H — KB de Assist y documentación

| Archivo | Cambio |
|---|---|
| `apps/api/kb/assistant/{es,en,pt,fr}/01-primeros-pasos.md` | orden real (alta → asistente de 4 pasos → "Conocé a tu agente" de 3 pasos → verificación cuando aplique); "Preparamos a tu agente, confirmalo"; "Conectar después te lo recuerda Inicio"; la tarjeta de puesta en marcha con sus ítems y "Mostrarme dónde"; retomar desde Configuración → Asistente de configuración; mantener el marcador de la pastilla `8/9` retirada |
| `02-canales-whatsapp.md` | rutas y "Recomendado" iguales al producto; requisitos; qué pasa si la ventana no aparece; advertencias tras conectar; errores frecuentes con su próximo paso; sin "número de prueba" |
| `06-agentes-ia.md` | campos obligatorios, "Cuándo pasar a un humano", Avanzado, interruptor Activo |
| `14-base-conocimiento.md` | "empezá por FAQs"; documentos y páginas web; nada de RAG/chunks |
| `20-navegacion-configuracion.md` | franja Esenciales; Asistente de configuración; Mostrarme cómo en cada ayuda |
| `08-inbox.md` | quitar SMS; comportamiento real del tiempo sin atención |
| `README.md` de la KB | reglas: no prometer que un recorrido cambia configuración; no describir número de prueba |
| `apps/api/src/modules/copilot/assistant-kb-contract.spec.ts` | marcadores en 4 idiomas: "Conocé a tu agente" / 3 pasos, "Mostrarme dónde", ausencia de "número de prueba" y de "SMS" en inbox |
| `docs/user-manual.md` §2 | citar la KB; corregir el orden |
| `docs/onboarding-audit-2026-07.md` | addendum de estado (§9.1) marcando #13/#14 como hechos y el residual |
| `docs/agent-quality-center.md`, `docs/platform-assistant-knowledge.md` | tarjeta de puesta en marcha como fuente única; bloque de estado de onboarding en Assist |

## 15. Verificación y criterios de aceptación

Comandos (además de los de la Parte I §5):

```bash
cd packages/shared && npx tsc --noEmit
cd apps/api && npx tsc --noEmit
cd apps/api && npx jest src/modules/persona src/modules/auth/auth-onboarding-provisioning.spec.ts src/modules/copilot/assistant-kb-contract.spec.ts --maxWorkers=2
cd apps/api && JWT_SECRET=test npm run test:bootstrap
cd apps/whatsapp && npx tsc --noEmit
cd apps/dashboard && npx tsc --noEmit
cd apps/dashboard && npx jest
```

**Guion manual "persona sin conocimientos"** (en producción, con un tenant nuevo, primero en celular y luego en escritorio; cada paso tiene un resultado esperado y un tiempo máximo):

| # | Paso | Resultado esperado | Máx. |
|---|---|---|---|
| 1 | Abrir la landing, "Empezar", registrarse con Google | Cae en `/onboarding` con el idioma de su navegador y un link "Ayuda" visible | 1 min |
| 2 | Paso 1 con solo nombre, industria y "qué hace tu negocio" | "Siguiente" habilitado sin abrir "Más detalles"; la zona horaria aparece como chip | 1 min |
| 3 | Escribir un email inválido en "Más detalles" | Error bajo el campo, en su idioma, antes de avanzar | — |
| 4 | Pasos 2-4 y "Crear mi cuenta" | Puente "Cuenta creada · ahora te presentamos a tu agente" → pantalla "Tu agente" con nombre, saludo y chat de prueba | 1,5 min |
| 5 | Escribir "¿qué precios manejan?" en el chat de prueba | El agente responde con datos del negocio (**aha antes de los 3 min acumulados**) | 30 s |
| 6 | Paso "Conectá WhatsApp": marcar el pre-check, elegir Coexistencia | Aparecen pasos, requisitos y el aviso de 24 h **antes** del botón | 1 min |
| 7 | Bloquear ventanas emergentes y tocar Conectar | En ≤90 s: mensaje "permití las ventanas emergentes" y botón Reintentar; el botón no queda muerto | — |
| 8 | Conectar de verdad (QR) | Tarjeta verde con "Probá tu agente"; si Meta devolvió advertencias, tarjeta ámbar con qué hacer | 5 min propios |
| 9 | Tocar "Conectar después" en otro tenant | Inicio muestra **solo** la tarjeta de puesta en marcha con "Conectar WhatsApp" expandido; sin hero, sin tour, sin aviso rojo | — |
| 10 | Tocar "Mostrarme dónde" en ese ítem | Se abre `/admin/channels/whatsapp` y el recorrido resalta estado → rutas → pre-check → botón | — |
| 11 | Ir al editor del agente, borrar el nombre y guardar | No guarda: mensaje bajo el campo; el banner de calidad nombra el bloqueo si lo hubiera | — |
| 12 | Preguntar a Assist "¿qué me falta para empezar?" | Responde con los ítems pendientes reales de la tarjeta y ofrece "Mostrarme dónde" | — |
| 13 | En Configuración | Franja "Esenciales" arriba, "Asistente de configuración" presente, "Para desarrolladores" plegado | — |
| 14 | Abrir la ayuda de Inbox y de Canales | No menciona SMS, Email ni "5 minutos"; cada panel tiene "Mostrarme cómo" | — |

Criterios de aceptación: los 14 pasos pasan en celular y escritorio; la KB pasa el contrato; `grep -rn "grid-cols-[23]\b"` sin breakpoint devuelve cero en las rutas de alta y canales; la lista de jerga del §11 #18 no aparece fuera de "Avanzado"; el embudo muestra `firstChannelConnectedAt` en la mayoría de los tenants nuevos antes de los 10 minutos desde `onboardingCompletedAt`.

### Convención de trato en el copy (medida, no opinada)

El español del panel mezcla voseo y tuteo desde hace tiempo (la auditoría de julio ya lo anotaba). Conteo sobre `messages/es.json` al 4-sep-2026:

| Namespace | voseo | tuteo |
|---|---:|---:|
| `help.*` | 48 | 249 |
| `channels.*` | 3 | 22 |
| `agent.*` | 2 | 15 |
| `setupWizard.*` | 15 | 20 |
| todo el archivo | 185 | 533 |

**Toda la copia nueva de este plan va en tuteo** ("conecta", "toca", "revisa"), que es lo que ya usan la ayuda en pantalla y la base de conocimiento de Assist —las dos superficies que lee alguien que está perdido—. No se reescribe el voseo existente en esta entrega: mezclar dos cambios de tono en el mismo commit haría ilegible el diff.

## 16. Fuera de alcance y riesgos

**Fuera de alcance (a propósito):** preview vivo del agente dentro de `/onboarding` (#16: el aha ya sube a la pantalla 5 con el wizard de 3 pasos); crawl automático del sitio web (#17: gateado por plan); términos y privacidad en el alta (#20: es legal, va aparte con columna nullable); número de prueba de Meta hasta verificarlo con el `config_id`; canal SMS; normalización de features en 5 niveles.

**Decisiones del dueño (tomadas el 4-sep-2026, en vigor para la implementación):** (a) **"Número de prueba" se retira** — la tarjeta y la nota del pre-check salen; quedan coexistencia (Recomendado), número nuevo y migración; (b) **el wizard pasa a ser una página con Esc**, reabrible desde Configuración, no un modal bloqueante; (c) **gate blando con memoria**: "Conectar después" persiste `channelConnectSkippedAt` + `onboardingStage: 'channel_deferred'` y el sistema lo vuelve a ofrecer desde Inicio; nunca se bloquea el acceso al panel; (d) alcance de ejecución: Partes I y II completas, con commit y push a `main` al terminar (dispara el deploy).

**Riesgos:** la ventana de Meta en celular no se puede probar en código, solo en producción; el rediseño del wizard toca `applySetupTemplate` (mantener el merge y el auto-apagado de citas sin prerequisitos); los tenants existentes sin `onboardingStage` dependen de la derivación de compatibilidad del resolver; cuatro idiomas para cada texto nuevo; los anclajes de los recorridos se rompen si alguien renombra un id, por eso el spec de `guided-tours` los verifica por grep estático.
