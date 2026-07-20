# Multi-cuenta por tipo de canal — Plan de implementación (Jul 2026)

> Estado: FASES 1-5 CODIFICADAS Y VERIFICADAS (tsc api/dashboard/whatsapp + test:bootstrap DI limpios).
> Permite N conexiones del mismo tipo de canal por tenant (p. ej. 2 números de WhatsApp, 2 cuentas de
> Instagram), **gateado por plan y por canal**, con **configuración de agente por conexión** (no por
> tipo). Reemplaza la regla de facto "una conexión por tipo de canal".
>
> Pendiente del usuario para activar en prod: re-correr el seed de planes y (opcional) subir límites
> por plan en `/admin/plans`; probar en producción reconectando canales. Ver "Pendiente del usuario".

## Problema (estado previo)

El ruteo **entrante** ya soportaba N conexiones (resuelve el tenant por identificador externo
específico: `phone_number_id`/`page_id`/`ig_user_id`, y persiste `channel_account_id` en la
conversación). Pero tres capas colapsaban a 1 por tipo:

1. **Credencial de salida**: `whatsapp_credentials` es single-slot por `(tenantId, credentialType='${type}_token')`
   → el 2º connect sobreescribía el token del 1º. `ChannelTokenService` resolvía con `findFirst`/`LIMIT 1`.
2. **Agente/persona**: `getPersonaForChannel(tenantId, channelType)` recibe solo el tipo;
   `agent_personas.channels TEXT[]` guarda tipos → dos números comparten forzosamente el mismo agente.
3. **UI + sin límite de cantidad**: la UI es single-slot (salvo Messenger); no había límite de nº de
   cuentas por tipo (solo allow-list `features.channels`).

Bugs latentes que esto arregla: Messenger multipágina (tokens pisados) y sobreescritura silenciosa
de una 1ª conexión al conectar una 2ª.

## Decisiones de diseño

- **Unidad = conexión**, identificada por la fila `channel_accounts` (`channel_type + account_id`,
  ya única globalmente). NO se añade `UNIQUE(tenant_id, channel_type)`.
- **Límite por plan × canal**: nueva key anidada `features.maxChannelAccounts` (patrón de `rateLimits`),
  `{ whatsapp, instagram, messenger, telegram, sms }`, `-1` = ilimitado. **Default 1 si falta la key**
  (fail-OPEN a 1 = comportamiento actual; NO reutilizar `getPlanLimit` que fail-closea a 0). Editable
  en vivo en `/admin/plans` + override por tenant (`quotaOverrides.maxChannelAccounts`).
- **Tokens por cuenta SIN migración global**: se usa `channel_accounts.access_token` (ya por-cuenta,
  cifrado con `WhatsappCryptoService`) como store por-cuenta. Antes se guardaba el placeholder
  `'encrypted_ref'` ahí y el token real en `whatsapp_credentials` single-slot. Ahora el connect
  guarda el token real cifrado por cuenta en `channel_accounts.access_token`; `whatsapp_credentials`
  queda como **fallback legacy** (para tenants ya conectados que aún no reconectan).
  - **WhatsApp**: el `system_user_token` sigue siendo tenant-wide (modelo Tech Provider, cubre todas
    las WABAs/números del mismo negocio). El fix es seleccionar la fila correcta de `whatsapp_channels`
    por `phone_number_id` (adiós `LIMIT 1`), no el token.
- **Agente por conexión**: nueva columna `agent_personas.channel_bindings TEXT[]` con claves
  `"${channelType}:${accountId}"`. `channels TEXT[]` se conserva como **default a nivel de tipo**
  (compatibilidad). Resolución jerárquica: ① binding a la cuenta → ② tipo (`channels`, actual) →
  ③ `is_default` → ④ legacy `persona_config`. Regla dura "1 agente por conexión" (array_remove sobre bindings).
- **Config compartida (v1, se queda global del tenant)**: KB/RAG corpus, business info, horarios del
  negocio, terminología vertical, procedures, calendarios. Lo que diferencia por cuenta va todo vía
  agente (`config_json`: persona, reglas, tools, skillset, custom prompt, horario del agente). KB por
  conexión = v2 (Fase 6, diferida).
- **Grandfathering**: nada se desactiva. Cuentas existentes por encima de un límite nuevo siguen
  activas; solo se bloquea AÑADIR más.

## Contratos (firmas / claves)

```
// plan-features.registry.ts
CHANNEL_ACCOUNT_KEYS = ['whatsapp','instagram','messenger','telegram','sms']
registry += { key:'maxChannelAccounts', type:'object', category:'channel' }
NESTED_OBJECT_KEYS += 'maxChannelAccounts'
validatePlanFeatures: rama que valida inner keys ⊂ CHANNEL_ACCOUNT_KEYS, valores number
setQuotaOverrides: acepta objeto anidado maxChannelAccounts (valida inner keys)

// TenantThrottleService
getChannelAccountLimit(tenantId, channelType): Promise<number>   // override→plan→default 1; -1→Infinity
enforceChannelAccountLimit(tenantId, channelType, currentCount): Promise<void>  // 403 plan_limit_reached

// ChannelTokenService
getWhatsAppToken(tenantId, phoneNumberId?): ChannelCredentials     // whatsapp_channels por phone_number_id
getChannelToken(tenantId, channelType, accountId?): GenericChannelCredentials  // prefiere account.access_token
invalidateCache(channelType, tenantId, accountId?)                 // limpia clave base + por-cuenta
// cache keys: wa_token:{tenant}[:{phoneNumberId}] · {type}_token:{tenant}[:{accountId}]

// PersonaService
getPersonaForChannel(tenantId, channelType, accountId?): TenantConfig  // binding→tipo→default→legacy
// cache key: persona:{tenant}:channel:{type}[:acct:{accountId}]
// channel_bindings key: "${channelType}:${accountId}"
```

## Checklist file-by-file

### Fase 1 — Candado por plan
- [ ] `apps/api/src/modules/throttle/plan-features.registry.ts` — key + CHANNEL_ACCOUNT_KEYS + nested + validación + override
- [ ] `apps/api/prisma/seed-billing-plans.js` — `maxChannelAccounts` en los 5 planes
- [ ] `apps/api/src/modules/throttle/tenant-throttle.service.ts` — get/enforceChannelAccountLimit + override anidado
- [ ] `apps/api/src/modules/channels/channel-management.controller.ts` — `assertChannelAccountQuota` en 5 connect paths (+ loop Messenger con slots)
- [ ] `apps/api/src/modules/internal/*` + `apps/whatsapp` ESU — gate en registerChannelAccount vía endpoint interno
- [ ] `apps/dashboard/src/app/admin/plans/page.tsx` — render mapa anidado maxChannelAccounts
- [ ] `apps/dashboard/src/hooks/usePlanLimits.ts` — key en interface + defaults
- [ ] i18n x4 (`plansPage.features.*`)

### Fase 2 — Tokens por cuenta
- [ ] connect flows (telegram/messenger/instagram/sms/generic) — guardar token real cifrado en `channel_accounts.access_token`
- [ ] `channel-token.service.ts` — accountId en getWhatsAppToken/getChannelToken/invalidateCache + cache por cuenta + fallback
- [ ] call sites — propagar accountId (outbound processor, resolveAccessToken, nurturing, drip, recall, appointment-notifications, media-download, sms-sender, enriquecimiento perfil)

### Fase 3 — Conversaciones por cuenta
- [ ] `conversations.service.ts` resolveConversation — incluir channel_account_id (fallback histórico)
- [ ] adapters IG/Messenger/Telegram/SMS — poblar channelAccountId en NormalizedMessage
- [ ] Inbox — badge de cuenta

### Fase 4 — Agente por conexión
- [ ] `persona.service.ts` — channel_bindings (DDL lazy + ALTER) + getPersonaForChannel(accountId) + enforcement bindings + cache por cuenta
- [ ] `apps/api/prisma/tenant-schema.sql` — channel_bindings para tenants nuevos
- [ ] `conversations.service.ts` — pasar accountId a getPersonaForChannel
- [ ] editor de agentes (dashboard) — selector de conexiones reales (agrupadas por tipo) + SMS
- [ ] i18n x4

### Fase 5 — UI multi-cuenta
- [ ] overview canales — contador x/N + "Añadir cuenta" gateado
- [ ] páginas por canal — patrón multipágina (accounts[])
- [ ] desconexión por cuenta + "reemplazar" (límite 1) + limpieza huérfanas
- [ ] plantillas WhatsApp — selector de número si >1
- [ ] i18n x4

## Comportamientos v1 conocidos (aceptables)
- **Senders auxiliares** (recall, appointment-notifications, sms-sender) sin conversación en contexto
  envían desde la cuenta "primera activa" del tipo (número FROM y token consistentes entre sí). El
  pipeline principal y nurturing/drip (que traen conversación) sí son por-conexión. WhatsApp no se
  afecta (system_user_token tenant-wide).
- **Media inbound de Telegram multi-bot** usa el token del primer bot activo (WhatsApp usa token
  tenant-wide → correcto; IG/Messenger descargan por CDN sin token).
- **Enriquecimiento de perfil** (IG/FB/TG durante webhook) usa token por-tipo.

## UI multi-cuenta por página (COMPLETADO)
- **WhatsApp**: `getChannelStatus` devuelve todos los números (adiós `LIMIT 1`); la página lista N
  números, "añadir otro número" (relanza Embedded Signup, gateado) y desconectar por número
  (`DELETE /channels/whatsapp/account/:phoneNumberId` — también borra la fila en `whatsapp_channels`).
- **Telegram / Instagram**: listan N cuentas, "conectar otra" (gateado) y desconectar por cuenta.
- **Messenger**: ya listaba páginas; desconexión por página cableada.
- **Inbox**: badge de cuenta por conversación (se muestra solo si el tenant tiene >1 cuenta).
- **SMS**: la página es un redirect a `/admin/channels` (canal oculto por decisión previa) — sin cambios.

## Auditoría de gaps de gestión (post-deploy) — fixes aplicados
- **Refresh de tokens de Instagram (era regresión, ARREGLADO)**: el cron escribía en
  `whatsapp_credentials` pero el runtime ahora lee `channel_accounts.access_token` → los tokens IG
  se habrían cortado a ~60 días (incluso con 1 cuenta). `instagram-token-refresh.service.ts` reescrito
  para refrescar POR CUENTA (escribe en `channel_accounts.access_token` + `metadata.tokenExpiresAt`,
  sincroniza el legacy, invalida caché, auto-migra filas placeholder). El connect IG guarda
  `metadata.tokenExpiresAt`.
- **Respuesta del agente humano desde el inbox (ARREGLADO)**: `sendAgentMessage` usaba
  `getValidAccessToken` (token WhatsApp tenant-wide) para todo canal → roto en IG/Messenger/SMS/Telegram.
  Ahora usa `getChannelToken(tenantId, channelType, channel_account_id)` → token por-conexión correcto
  para todos los canales.
- **`getValidAccessToken` determinístico (ARREGLADO)**: el `LIMIT 1` sin `ORDER BY` elegía número
  arbitrario; ahora `ORDER BY connected_at` (primer número = más antiguo) para el path `sendTemplate`.

## Diferido a v2 (aditivo, no bloquea)
- **Broadcast: selector de número de origen** cuando hay >1 (falta campo en `CreateCampaignDto`,
  tabla `campaigns`, `BroadcastJobData` y UI; hoy sale por la primera cuenta activa, no elegible).
- **Envíos sistémicos por cuenta específica**: nurturing-plantilla, drip, recordatorios de cita,
  recall, acciones de automatización y OTP/SMS de portal salen por la cuenta primaria (para WhatsApp
  el token es tenant-wide, solo varía el número de origen). El pipeline principal y nurturing-texto
  (dentro de 24h) sí van por-conexión.
- **Desconexión por-cuenta**: hace limpieza local (routing + whatsapp_channels + bindings + caché)
  pero NO des-suscribe el webhook de esa cuenta en el proveedor (queda inerte porque el routing está
  inactivo, pero el proveedor sigue enviando). La desconexión por-TIPO sí avisa al proveedor.
- Selector de número en plantillas de WhatsApp cuando hay >1 (backend fija el canal con `LIMIT 1`;
  las plantillas son a nivel WABA, así que suele bastar).
- Expiración de token IG por-cuenta en la UI (hoy se muestra una sola, del slot legacy).

## Pendiente del usuario (al cierre)
- Re-correr el seed en prod para materializar `maxChannelAccounts`: `docker exec parallext-api node prisma/seed-billing-plans.js`
- Decidir/ajustar valores de la matriz por plan (en `/admin/plans`, en vivo, sin deploy).
- Probar en producción (reconectar canales para que adopten el token por-cuenta; asignar agentes por conexión).
- Deploy normal (push a main → GitHub Actions). Migraciones per-tenant (channel_bindings) se aplican
  vía DDL lazy en primer acceso multi-agente + `tenant-schema.sql` para tenants nuevos; el schema
  global no cambió (no hay migración Prisma nueva).
</content>
</invoke>
