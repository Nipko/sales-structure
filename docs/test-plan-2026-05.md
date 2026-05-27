# Plan de Pruebas Exhaustivo — Parallly Platform

**Fecha:** 2026-05-27  
**Alcance:** 68 módulos API, 80+ páginas dashboard, 6 colas BullMQ, 29 cron jobs  
**Metodología:** Prueba funcional en producción, funcionalidad por funcionalidad  
**Prioridad:** CRÍTICO > ALTO > MEDIO > BAJO

---

## Cómo usar este plan

Cada sección tiene un checklist con formato:
- `[ ]` = Pendiente
- `[x]` = Probado y funcional
- `[!]` = Bug encontrado (documentar en la sección de hallazgos al final)
- `[-]` = No aplica / no se puede probar en este momento

**Convención de prioridad por sección:**
- 🔴 CRÍTICO — Flujo principal de ingresos o datos de clientes
- 🟠 ALTO — Funcionalidad core visible al usuario
- 🟡 MEDIO — Funcionalidad secundaria o administrativa
- 🟢 BAJO — Features opcionales o de nicho

---

## PARTE 1: AUTENTICACIÓN Y SESIONES 🔴

### 1.1 Login / Registro
- [ ] Login con email + password → acceso correcto al dashboard
- [ ] Login con credenciales incorrectas → mensaje de error visible (no silencioso)
- [ ] Login con Google OAuth → redirect correcto, usuario creado/vinculado
- [ ] Login con Microsoft OAuth → redirect correcto, usuario creado/vinculado
- [ ] Signup de nuevo tenant → tenant creado, schema PostgreSQL generado, redirect a onboarding
- [ ] Verificación de email → código de 6 dígitos funciona, expira tras 10 min
- [ ] Forgot password → OTP enviado, 3 pasos completados, contraseña cambiada
- [ ] Setup password (post Google OAuth) → funciona correctamente

### 1.2 Autenticación 2FA
- [ ] Activar 2FA TOTP → QR generado, verificado con app autenticadora
- [ ] Login con 2FA activo → pide código TOTP antes de acceder
- [ ] 2FA fallback email → código enviado por email, funciona
- [ ] Backup codes → generados, uno funciona para login, se invalida tras uso
- [ ] Dispositivo confiable → marcar "recordar dispositivo" → skip 2FA por 30 días
- [ ] Email de notificación → se envía al confiar nuevo dispositivo
- [ ] Gestión de dispositivos en Settings > Security → listar, revocar

### 1.3 Sesiones y Tokens
- [ ] JWT access token expira a los 15 min → refresh automático transparente
- [ ] Refresh token rotation → token antiguo invalidado tras refresh
- [ ] Idle timeout 60 min → modal de advertencia a los 58 min
- [ ] Activity ping cada 5 min → sesión se mantiene activa con uso
- [ ] Session conflict (login desde otro navegador) → HTTP 409, modal de conflicto
- [ ] BroadcastChannel sync entre tabs → logout en una tab cierra todas
- [ ] Impersonation (super_admin) → genera tokens de 1h, audit trail registrado

### 1.4 Invitaciones
- [ ] Crear invitación → email enviado con link válido
- [ ] Aceptar invitación → usuario creado, asociado al tenant con rol correcto
- [ ] Reenviar invitación → nuevo email, expiración extendida
- [ ] Revocar invitación → link invalidado
- [ ] Invitación expirada → mensaje claro de error al intentar aceptar

### 1.5 SSO / SAML
- [ ] Configurar SAML → IdP URL, certificado, domain guardados
- [ ] Login via SAML → redirect a IdP, ACS callback funciona
- [ ] JIT provisioning → usuario creado automáticamente al primer login SAML
- [ ] SSO forced → login normal bloqueado cuando isSsoForced=true
- [ ] Metadata XML → GET /auth/saml/metadata/:tenantId devuelve XML válido

---

## PARTE 2: ONBOARDING Y SETUP 🟠

### 2.1 Setup Wizard
- [ ] Nuevo tenant → redirect automático al setup wizard
- [ ] Selección de industria → vertical config guardada correctamente
- [ ] Aplicar template de agente → persona creada con config correcta
- [ ] Skip wizard → flag marcado, no vuelve a aparecer
- [ ] Bootstrap vertical → pipeline stages, FAQs, servicios, tool flags creados según industria
- [ ] Bounce protection → no loop infinito si backend falla al guardar flag (30s window)

### 2.2 Onboarding (4 pasos)
- [ ] Paso 1: Datos de empresa → guardados en business_info
- [ ] Paso 2: Industria/vertical → vertical config creada
- [ ] Paso 3: Canal primario → canal configurado
- [ ] Paso 4: Primer agente → agente creado con template seleccionado
- [ ] Completar onboarding → redirect al dashboard principal

---

## PARTE 3: PIPELINE DE MENSAJES (FLUJO CORE) 🔴

### 3.1 Recepción de mensajes (Inbound)
- [ ] **WhatsApp** → webhook recibido, firma HMAC-SHA256 validada, mensaje procesado
- [ ] **Instagram DM** → webhook Meta validado, mensaje procesado
- [ ] **Messenger** → webhook Meta validado, mensaje procesado
- [ ] **Telegram** → webhook con secret token, mensaje procesado
- [ ] **SMS/Twilio** → webhook HMAC-SHA1 validado, mensaje procesado
- [ ] **Web Chat Widget** → WebSocket conectado, mensaje procesado
- [ ] Idempotencia → mensaje duplicado (mismo ID) no se procesa dos veces (Redis `idem:{channel}:{id}`)
- [ ] Conversation mutex → mensajes concurrentes al mismo conversationId no causan race condition (Redis SETNX lock 30s)

### 3.2 BUG CONOCIDO — Webhook Fire-and-Forget
> **CRÍTICO**: `whatsapp.controller.ts:504` — `handleWebhookPayload().catch(console.error)` retorna 200 a Meta sin esperar resultado. Meta no reintenta. Mensajes se pierden silenciosamente.
- [ ] Verificar: enviar mensaje WA cuando el backend tiene error interno → ¿se pierde el mensaje?
- [ ] Verificar: ¿hay logs en Sentry para errores de webhook?

### 3.3 Procesamiento de mensaje
- [ ] Identity resolution → contacto existente encontrado o nuevo creado
- [ ] Language detection → idioma detectado correctamente (es/en/pt/fr)
- [ ] Pre-chat form → si configurado, datos recolectados antes de respuesta AI
- [ ] Opt-out detection → keywords de opt-out detectadas, compliance notificado
- [ ] Prompt assembly (3 capas) → L1 contrato + L2 persona + L3 turno
- [ ] Safety guardrails → contenido peligroso bloqueado (violencia, drogas, PII, etc.)
- [ ] Booking engine → estado determinista funciona (select_service → select_date → select_time → confirm → booked)
- [ ] Double booking protection → re-check de slot en paso confirm
- [ ] History limiting → en modo booking, solo 4 últimos mensajes enviados al LLM
- [ ] Intent interpreter → confirmaciones, selección numerada, stem matching

### 3.4 Multimedia Processing
- [ ] Audio WhatsApp (OGG) → transcrito con Whisper, texto insertado en historial
- [ ] Imagen WhatsApp → descrita con vision model, descripción insertada
- [ ] Audio Instagram → descargado de CDN, transcrito
- [ ] Imagen Telegram → descargado via Bot API, descrito
- [ ] Throttle Layer 1 → quota mensual (audio/imagen) respetada
- [ ] Throttle Layer 2 → limite por contacto/día respetado
- [ ] Throttle Layer 3 → burst limit por conversación/5min respetado
- [ ] Throttle Layer 4 → limite por tenant/hora respetado
- [ ] Throttle Layer 5 → circuit breaker de presupuesto diario respetado
- [ ] Throttle Layer 6 → duración máxima de audio respetada
- [ ] Mensaje de texto persistido en messages table tras transcripción/descripción

### 3.5 LLM Router
- [ ] Task-based routing → conversación usa modelo de conversación, tool_calling usa modelo de tools
- [ ] Fallback chain → si provider falla, siguiente tier intenta (4 tiers)
- [ ] Circuit breaker → provider con 2+ fallos en 10 min marcado como unhealthy
- [ ] Plan-gated tiers → starter solo tier_3+4, pro tier_2+3+4, enterprise all
- [ ] AI usage tracking → tokens y costo registrados en Redis (`ai:stats:*`)

### 3.5.1 BUG CONOCIDO — Stats Tracking Silencioso
> **ALTO**: `llm-router.service.ts` — `trackStats().catch(() => {})` pierde datos de uso sin log. Facturación incorrecta.
- [ ] Verificar: dashboard AI usage muestra datos correctos después del fix de fe538e7
- [ ] Verificar: Redis keys `ai:stats:{tenantId}:*` se escriben para todas las llamadas LLM

### 3.6 Tool Execution (AI Agent)
- [ ] Appointment booking via chat → cita creada, calendar sync, evento emitido
- [ ] Reschedule appointment → verificación de ownership, fechas actualizadas, calendar re-created
- [ ] Cancel appointment → ownership verificado, status=cancelled
- [ ] Tour booking → capacidad decrementada atómicamente
- [ ] Cancel tour booking → capacidad restaurada
- [ ] Property booking → disponibilidad verificada, booking creado
- [ ] Cancel property booking → delegado a propertiesService.cancelBooking()
- [ ] Food order → pedido creado con items
- [ ] Cancel order → status verificado (received/confirmed/pending), actualizado
- [ ] Check order status → items detallados de food_order_items
- [ ] Gym class booking → booking creado
- [ ] Cancel class booking → delegado a gymsService.cancelBooking()
- [ ] Enrollment → asiento decrementado, enrollment creado
- [ ] Cancel enrollment → status verificado (enrolled/active), delegado a educationService
- [ ] Insurance quote → cotización generada
- [ ] Cancel quote → status actualizado
- [ ] File claim → claim creado, handoff al equipo humano
- [ ] List my claims → claims del contacto actual listados
- [ ] Service request → solicitud creada con urgencia
- [ ] Cancel service request → status verificado (pending/scheduled)
- [ ] Photo quote → sesión/cotización creada
- [ ] Cancel photo session → status verificado (scheduled)
- [ ] Register pet → mascota asociada al contacto
- [ ] Update pet → campos actualizados (weight_kg, allergies, chronic_conditions, is_neutered)
- [ ] Vaccination status → calendario vacunal devuelto
- [ ] Emergency triage → severidad categorizada (urgent/non-urgent), sin diagnóstico

### 3.7 Outbound Messages
- [ ] BullMQ queue → mensaje encolado con prioridad por plan
- [ ] 3 reintentos → mensajes fallidos se reintentan
- [ ] Channel gateway → mensaje ruteado al adaptador correcto (WA/IG/Messenger/TG/SMS)
- [ ] Rate limiting → tenant throttle respetado según plan

### 3.8 Handoff (AI → Humano)
- [ ] Trigger detection → handoff detectado (keyword, complexity, user request)
- [ ] Event emission → `handoff.escalated` emitido
- [ ] Agent console WebSocket → `inbox:handoff` recibido en tiempo real
- [ ] Skill-based routing → `tryAutoAssign` con skill_tags y max_capacity
- [ ] SLA deadline → conversation_assignments con timeout 5 min
- [ ] Email notification → agente asignado notificado por email
- [ ] SLA escalation cron (*/2 min) → conversaciones >5 min sin respuesta → supervisor alert
- [ ] Complete handoff → POST /handoff/:conversationId/complete funciona

---

## PARTE 4: INBOX / AGENT CONSOLE 🔴

### 4.1 Carga de inbox
- [ ] Lista de conversaciones cargada → filtros (all/mine/unassigned/handoff/resolved)
- [ ] Búsqueda de conversaciones → funciona por nombre de contacto
- [ ] WebSocket conectado → indicador visual de conexión
- [ ] Nuevos mensajes → notificación en tiempo real via WebSocket
- [ ] Skeleton loaders → mostrados mientras carga

### 4.1.1 BUG CONOCIDO — Socket Disconnect Silencioso
> **MEDIO-ALTO**: Si la conexión WebSocket se pierde, no hay indicador visual. El inbox muestra datos stale.
- [ ] Verificar: desconectar red brevemente → ¿se muestra indicador "offline"?
- [ ] Verificar: reconexión automática con exponential backoff

### 4.2 Gestión de conversación
- [ ] Ver historial completo de conversación
- [ ] Enviar mensaje como agente → mensaje entregado al cliente
- [ ] Agregar nota interna → nota visible solo para agentes
- [ ] Asignar a otro agente → asignación actualizada
- [ ] Resolver conversación → status=resolved
- [ ] Reabrir conversación → status restaurado
- [ ] Snooze conversation → snoozed hasta timestamp, despierta a tiempo
- [ ] Unsnooze → conversación restaurada inmediatamente
- [ ] Archivar → conversación movida a archivo
- [ ] Eliminar → soft delete funciona

### 4.3 AI Copilot (para agentes)
- [ ] Sugerencias AI → 3 respuestas sugeridas generadas
- [ ] Resumen de conversación → resumen coherente
- [ ] Detección de intent → intent del cliente identificado
- [ ] Preguntar al copilot → respuesta contextual

### 4.4 Operaciones en bulk
- [ ] Selección múltiple con checkboxes
- [ ] Bulk archive → todas las seleccionadas archivadas
- [ ] Bulk delete → todas eliminadas

### 4.4.1 BUG CONOCIDO — Bulk Delete Sin Confirmación
> **MEDIO**: Bulk delete no tiene diálogo de confirmación. Acción destructiva irreversible.
- [ ] Verificar: ¿hay modal de confirmación antes de bulk delete?

### 4.5 Canned Responses / Macros
- [ ] CRUD de canned responses → crear, editar, eliminar
- [ ] Expansión de shortcode en input → texto reemplazado correctamente
- [ ] Macros → secuencias de acciones ejecutadas

### 4.6 Agent Availability
- [ ] Cambiar status (online/away/offline) → Redis + DB actualizados
- [ ] Lista de agentes disponibles → refleja status en tiempo real
- [ ] Inactivity check (*/5 min cron) → agentes idle >15 min marcados

---

## PARTE 5: CRM Y CONTACTOS 🔴

### 5.1 Contactos
- [ ] Lista con búsqueda y filtros (nombre, etapa, tags, fecha, score)
- [ ] Crear contacto → phone requerido, lead creado
- [ ] Editar contacto → campos actualizados (nombre, email, phone, stage, VIP, tags)
- [ ] Eliminar/archivar contacto
- [ ] Import CSV → contactos creados, errores mostrados (max 5 + count)
- [ ] Export Excel → archivo descargado correctamente
- [ ] Bulk update (cambiar etapa, agregar tag, archivar) → todos actualizados

### 5.1.1 BUG CONOCIDO — Bulk Update Reporta Éxito Parcial
> **ALTO**: `leads.repository.ts` — Si una inserción de tag falla mid-loop, retorna `{updated: leadIds.length}` como si todo hubiera funcionado.
- [ ] Verificar: hacer bulk tag con un leadId inválido → ¿se muestra error?
- [ ] Verificar: ¿cuántos leads realmente se actualizaron vs. reportados?

### 5.2 Detalle de contacto (Lead 360°)
- [ ] Datos del lead cargados correctamente
- [ ] Timeline de actividades → acciones registradas
- [ ] Notas → CRUD funcional
- [ ] Tareas → crear, marcar como completada
- [ ] Score breakdown (5 factores) → cargado correctamente
- [ ] Custom attributes → campos renderizados por tipo (text, number, select, date, multi-select)
- [ ] Custom attribute values → guardados al editar
- [ ] AI insight → generado (async), resultado mostrado

### 5.2.1 BUG CONOCIDO — Update Silencioso
> **MEDIO-ALTO**: Actualización de contacto puede fallar sin feedback visual. No hay optimistic update.
- [ ] Verificar: editar un campo → ¿se muestra indicador de guardado?
- [ ] Verificar: simular error de red → ¿usuario sabe que no se guardó?

### 5.3 Pipeline / Kanban
- [ ] Kanban cargado → stages con deals
- [ ] Crear deal → asociado a contacto, stage, valor
- [ ] Drag-and-drop → deal movido a nueva stage
- [ ] Approval workflow → stages con aprobación requieren request → approve/reject
- [ ] Reject con razón → motivo registrado

### 5.3.1 BUG CONOCIDO — Optimistic Update No Rollback
> **MEDIO**: Si el move API falla, la UI no revierte el drag. Card aparece en stage incorrecta.
- [ ] Verificar: mover deal a stage con error → ¿card vuelve a posición original?

### 5.4 Pipeline Config
- [ ] CRUD de stages → crear, editar, eliminar
- [ ] Reorder stages → drag-to-reorder funciona, posiciones guardadas
- [ ] SLA config → tiempos por stage configurables
- [ ] SLA violations → deals que exceden tiempo mostrados

### 5.5 Scoring Config
- [ ] Pesos de scoring → 5 factores configurables
- [ ] Decay config → configuración de decaimiento
- [ ] Scores recalculados → reflejan nuevos pesos

### 5.6 Custom Attributes
- [ ] Crear attribute → nombre, tipo, required, default value
- [ ] Editar attribute → cambios guardados
- [ ] Eliminar attribute → confirmación requerida, eliminado
- [ ] Tipos soportados → text, number, select, date, multi-select

### 5.7 Segmentos
- [ ] Crear segmento → condiciones definidas
- [ ] Refresh dinámico (cron horario) → membresía actualizada
- [ ] Usar segmento como filtro en contacts list

### 5.8 Identity / Merge
- [ ] Sugerencias de merge → contactos similares detectados
- [ ] Aprobar merge → perfiles unificados, datos consolidados
- [ ] Rechazar merge → sugerencia descartada
- [ ] Manual merge → POST /identity/:tenantId/manual-merge funciona

### 5.9 CRM Analytics
- [ ] Overview KPIs → total leads, new, conversion rate, pipeline value
- [ ] Funnel → conversion por stage
- [ ] Velocity → días por stage
- [ ] Win/loss rate → breakdown correcto
- [ ] Agent leaderboard → ranking de agentes
- [ ] Source breakdown → fuentes de leads
- [ ] AI lead insight → análisis generado por AI

---

## PARTE 6: CITAS Y CALENDARIO 🔴

### 6.1 Servicios
- [ ] CRUD de servicios → crear, editar, eliminar (plan-gated)
- [ ] Location type (in_person/online/hybrid) → guardado correctamente
- [ ] Meeting link + location address → campos funcionales
- [ ] Staff assignment → asignar/desasignar staff a servicio

### 6.2 Disponibilidad
- [ ] Configurar availability slots → guardados
- [ ] Blocked dates → crear, eliminar
- [ ] Check available slots → slots libres calculados correctamente
- [ ] Bookable slots endpoint → considera servicios, staff, calendario, bloqueos

### 6.3 Appointments CRUD
- [ ] Crear cita → conflicto detectado si slot ocupado
- [ ] Editar cita → datos actualizados
- [ ] Cancelar cita → status=cancelled
- [ ] Listar citas → filtros por fecha, status
- [ ] Detalle de cita → toda la información

### 6.4 Recurring Appointments
- [ ] Crear serie recurrente → múltiples instancias creadas
- [ ] Ver serie → todas las instancias listadas
- [ ] Cancelar serie → todas las instancias canceladas

### 6.5 Calendar Integration (Google/Microsoft)
- [ ] Google OAuth → autorización exitosa, calendar conectado
- [ ] Microsoft OAuth → autorización exitosa
- [ ] Sync calendar → eventos sincronizados bidirecccionalmente
- [ ] Auto meeting links → Google Meet/Teams generados para online/hybrid
- [ ] Multi-calendar (plan-gated) → starter:1, pro:3, enterprise:10
- [ ] 3-tier resolution → service-specific → staff-specific → general fallback
- [ ] Disconnect protection → manejo graceful cuando calendar desconectado
- [ ] Reassign + disconnect → citas futuras reasignadas antes de desconectar
- [ ] Watch channel renewal (cron */12h) → push channels renovados

### 6.6 Reminders
- [ ] 24h reminder (cron */15 min) → enviado al canal del contacto
- [ ] 1h reminder (cron 3,18,33,48 min) → enviado
- [ ] Reminder settings → configurable por tenant

### 6.7 Post-Appointment
- [ ] No-show marking (cron 5,35 min) → citas sin asistencia marcadas
- [ ] Auto-complete (cron 20 min) → citas terminadas hace 2h+ completadas
- [ ] CSAT survey (cron 10 min) → encuesta post-cita enviada
- [ ] Attendance confirmation → confirmación via canal de messaging

### 6.8 Public Booking
- [ ] Config → activar/desactivar booking público
- [ ] GET /booking/:tenantSlug/info → info del tenant (público, sin auth)
- [ ] GET /booking/:tenantSlug/services → servicios disponibles
- [ ] GET /booking/:tenantSlug/slots → slots disponibles
- [ ] POST /booking/:tenantSlug/book → cita creada por visitante externo

---

## PARTE 7: AI AGENTS (MULTI-AGENT) 🟠

### 7.1 Agent List
- [ ] Lista de agentes → todos los agentes del tenant
- [ ] Channel assignment status → badges por canal
- [ ] Plan limits → starter:1, pro:3, enterprise:10, custom:unlimited
- [ ] Crear agente → nombre requerido, industry preset opcional
- [ ] Duplicar agente → copia creada
- [ ] Eliminar agente → soft delete

### 7.2 Agent Editor
- [ ] Cargar config del agente → tabs: Persona, Behavior, Schedule, Channels, Capabilities
- [ ] Guided mode vs custom prompt mode → toggle funciona
- [ ] Channel assignment (checkboxes) → canales asignados guardados
- [ ] Save → config_json, channels, is_default actualizados
- [ ] Readiness indicators → servicios y slots de disponibilidad contados
- [ ] Save as template → template creado (plan-gated)

### 7.3 Agent Test Console
- [ ] POST /agent-test/:tenantId/:agentId → respuesta con debug info
- [ ] No persistence → conversación de test no afecta datos reales
- [ ] Debug panel → tokens, provider, latencia, tools llamados

### 7.4 Persona Templates
- [ ] 6 built-in templates → Sales Advisor, Support Agent, FAQ Bot, Appointment Scheduler, Lead Qualifier, Blank
- [ ] User-created templates → listar, eliminar
- [ ] Vertical-specific templates → aparecen primero en lista

### 7.5 Channel-Agent Resolution
- [ ] getPersonaForChannel(tenantId, channelType) → 3-tier fallback: channel match → default → legacy
- [ ] Un agente por canal (hard rule) → no se puede asignar 2 agentes al mismo canal

---

## PARTE 8: KNOWLEDGE BASE 🟠

### 8.1 Documents
- [ ] CRUD documentos → crear, editar, eliminar
- [ ] URL crawling → contenido extraído de URL
- [ ] Bulk import → múltiples documentos
- [ ] Quality scoring → score calculado
- [ ] Categories → categorización funcional
- [ ] Public toggle → documento visible/oculto en portal público
- [ ] AI article suggestions → sugerencias generadas
- [ ] Multi-language → idioma detectado/seleccionado
- [ ] Document versioning → historial de versiones
- [ ] Advanced filtered search → filtros funcionales

### 8.2 KB Portal (Público)
- [ ] GET /kb/:tenantSlug → portal cargado (sin auth)
- [ ] GET /kb/:tenantSlug/:slug → artículo detalle
- [ ] Búsqueda → resultados relevantes via RAG

### 8.3 Embeddings (RAG)
- [ ] generateEmbedding → vector generado y almacenado en pgvector
- [ ] RAG search → documentos relevantes recuperados durante conversación
- [ ] Redis stats → embeddings tracked en `ai:stats:*` keys

### 8.4 FAQs
- [ ] CRUD FAQs → crear, editar, eliminar con categorías
- [ ] Public endpoint → GET /faqs/public/:tenantSlug (sin auth)
- [ ] FAQs integradas en respuestas AI

### 8.5 Auto-recrawl
- [ ] Cron de recrawl → documentos de URL re-crawleados periódicamente
- [ ] Contenido actualizado → embeddings regenerados

---

## PARTE 9: CANALES 🔴

### 9.1 WhatsApp
- [ ] Embedded Signup → onboarding completo via Meta
- [ ] Webhook handling → mensajes procesados
- [ ] Templates → sync con Meta, creación in-app via Meta API
- [ ] Template status polling (cron */30 min) → estados actualizados
- [ ] Mark as read → read receipts enviados

### 9.1.1 BUG CONOCIDO — markAsRead Fire-and-Forget
> **ALTO**: `whatsapp-webhook.service.ts:273` — markAsRead() no awaited en promise chain. Fallos invisibles.
- [ ] Verificar: ¿read receipts (ticks azules) aparecen consistentemente?

### 9.2 Instagram
- [ ] OAuth connect → páginas con permisos de messaging listadas
- [ ] Webhook processing → DMs procesados
- [ ] Token refresh (cron diario 6AM) → tokens con <30 días renovados
- [ ] Media download → imágenes/audio de CDN descargados

### 9.3 Messenger
- [ ] FB SDK connect → token de página intercambiado
- [ ] Webhook processing → mensajes procesados
- [ ] Media download → CDN URLs resueltos

### 9.4 Telegram
- [ ] Bot setup → bot username + token guardados
- [ ] Webhook processing → mensajes con secret token validados
- [ ] File download → file_id → Bot API getFile

### 9.5 SMS / Twilio
- [ ] Connect → phone number + auth configurados
- [ ] Webhook → Twilio HMAC-SHA1 validado
- [ ] Outbound SMS → enviado via Twilio API

### 9.6 Web Chat Widget
- [ ] Config → color, posición, welcome message, pre-chat form
- [ ] Public embed → GET /widget/loader.js (CORS: *, 1h cache)
- [ ] Session creation → rate-limited 5/hr
- [ ] WebSocket real-time chat → mensajes entregados bidirecccionalmente
- [ ] Resume conversation → sesión recuperada con historial

### 9.7 Channel Overview
- [ ] GET /channels/overview → todos los canales con status
- [ ] Agent assignment → channel-agent mapping visible
- [ ] Disconnect → canal desconectado, agente desasignado

### 9.7.1 BUG CONOCIDO — Empty Catch en Channel Assignment
> **MEDIO**: `channel-management.controller.ts:45-59` — catch vacío asume tabla faltante pero traga todos los errores.
- [ ] Verificar: con agent_personas existente, ¿assignments se cargan correctamente?

---

## PARTE 10: BROADCASTS Y CAMPAÑAS 🟠

### 10.1 Campaign CRUD
- [ ] Crear campaña → multi-channel (WA + Email + SMS)
- [ ] Content per channel → template WA, subject+html email, body SMS
- [ ] Listar campañas → con stats
- [ ] Editar campaña → cambios guardados
- [ ] Eliminar campaña

### 10.2 Launch
- [ ] Launch campaign → jobs encolados en BullMQ (80 msg/s rate limit)
- [ ] Smart recipient resolution → WA→Email→SMS fallback según info del contacto
- [ ] Stats per channel → sent→delivered→read→failed por canal

### 10.3 Scheduled Campaigns
- [ ] Crear campaña programada → fecha futura
- [ ] Auto-launch (cron * * * * *) → campaña lanzada a la hora programada

---

## PARTE 11: AUTOMATION 🟠

### 11.1 Rules
- [ ] Crear regla → trigger + conditions + actions (wizard 4 pasos)
- [ ] Listar reglas activas
- [ ] Toggle rule → activar/desactivar
- [ ] Eliminar regla

### 11.1.1 BUG CONOCIDO — JSON Parse Silencioso
> **ALTO**: `automation.service.ts:53-77` — Si `actions_json` tiene JSON inválido, se convierte en `[]` silenciosamente. La regla ejecuta sin acciones.
- [ ] Verificar: crear regla, corromper actions_json en DB → ¿qué pasa?

### 11.2 Execution
- [ ] Trigger por evento → regla ejecutada
- [ ] Actions ejecutadas correctamente
- [ ] Marca de éxito/fallo registrada

### 11.2.1 BUG CONOCIDO — Automation Events Fire-and-Forget
> **ALTO**: `automation.service.ts:24-33` — Query sin error handling. Si falla, evento perdido silenciosamente.
- [ ] Verificar: ¿eventos de automation se procesan consistentemente?

### 11.3 Nurturing Sequences
- [ ] Crear secuencia → pasos definidos con delays
- [ ] Ejecución → mensajes enviados según schedule
- [ ] Auto-resolve stale (cron */6h) → conversaciones de nurturing >72h resueltas
- [ ] Stale conversation detection (cron */2h)

### 11.4 Recall (Re-engagement)
- [ ] Config → activar, configurar criterios
- [ ] Manual trigger → POST /recall/:tenantId/run-now ejecuta sweep
- [ ] Cron diario (9AM) → contactos dormidos re-enganchados

---

## PARTE 12: ANALYTICS Y REPORTES 🟡

### 12.1 Dashboard Analytics (8 tabs)
- [ ] Overview KPIs → 6 KPIs con comparación de período
- [ ] Conversations volume → stacked por canal
- [ ] Response times → mediana + P90
- [ ] AI metrics → resolution rate, containment, cost, model usage
- [ ] Heatmap → volumen por día × hora
- [ ] Realtime → conversaciones activas, agentes, cola
- [ ] Automation metrics
- [ ] Broadcast metrics → funnel de campaña
- [ ] Anomaly detection → Z-score funcional
- [ ] Cohort retention → matrix de retención
- [ ] Appointment metrics
- [ ] CSV export → archivo descargado correctamente

### 12.2 CRM Analytics
- [ ] Overview → KPIs de CRM
- [ ] Funnel → conversión por stage
- [ ] Velocity → tiempo promedio por stage
- [ ] Win/loss → tasa con breakdown
- [ ] Leaderboard → ranking de agentes
- [ ] Sources → fuentes de leads

### 12.3 Agent Analytics (4 tabs)
- [ ] Overview → stats de agentes
- [ ] Agent leaderboard
- [ ] CSAT responses → resultados de encuestas
- [ ] CSAT distribution → distribución de scores
- [ ] Channel stats
- [ ] Time series
- [ ] Agent performance

### 12.4 Report Builder
- [ ] Crear custom report → 16 métricas, 4 tipos de chart
- [ ] Guardar report
- [ ] Editar report
- [ ] Duplicar report
- [ ] Eliminar report

### 12.5 Alerts & Scheduled Reports
- [ ] Crear alert rule → threshold configurado
- [ ] Alert evaluation (cron */15 min) → alertas disparadas cuando threshold excedido
- [ ] Alert history → historial de triggers
- [ ] Scheduled reports → weekly (lunes 8AM), monthly (1ro 8AM) → emails enviados
- [ ] BI API → X-API-Key auth funciona, endpoints devuelven datos

---

## PARTE 13: BILLING Y SUSCRIPCIONES 🔴

### 13.1 Plans
- [ ] GET /billing/plans → planes listados con precios locales (MercadoPago rates)
- [ ] Plan features → limits correctos por plan (agentes, calendarios, propiedades, etc.)

### 13.2 Subscriptions
- [ ] Start trial → subscription creada con status=trialing
- [ ] Upgrade plan → MercadoPago subscription actualizada
- [ ] Cancel subscription → cancelada correctamente
- [ ] Pause subscription → pausada
- [ ] Resume subscription → reanudada
- [ ] Cancel pending downgrade → downgrade programado cancelado
- [ ] Force sync → estado sincronizado con MercadoPago

### 13.3 Payments
- [ ] Update payment method → card tokenizada
- [ ] Invoice generation → PDF generado correctamente
- [ ] Usage stats → mensajes AI, media mostrados correctamente

### 13.4 Webhooks MercadoPago
- [ ] Webhook received → HMAC-SHA256 verificado
- [ ] Idempotency → evento duplicado no procesado
- [ ] Status transitions → trialing→active→past_due→cancelled

### 13.5 Billing Admin (super_admin)
- [ ] List plans with tenant counts
- [ ] Update plan → features actualizadas
- [ ] Invalidate plan cache
- [ ] Refund payment → MercadoPago refund ejecutado
- [ ] Grant comp plan → plan gratuito otorgado
- [ ] Coupons CRUD → crear, editar, desactivar
- [ ] Validate coupon → verificación funcional
- [ ] Redeem coupon → aplicado a subscription

### 13.6 Billing Enforcement
- [ ] Restriction status → tenant restringido cuando past_due
- [ ] Plan quotas → features bloqueadas al exceder limits
- [ ] Media usage bars → 80%/95% threshold warnings + upgrade CTA

### 13.7 Cron Jobs Billing
- [ ] Reconcile past-due (hourly) → suscripciones revisadas
- [ ] Apply pending downgrades (2:30 AM) → downgrades aplicados
- [ ] Trial expiry detector (*/30 min) → trials vencidos → past_due (dedup via billing_events)
- [ ] Grace enforcer (3 AM) → past_due >7d → offboard
- [ ] Full reconciliation (3 AM) → drift detection
- [ ] Trial ending soon (9 AM) → notificaciones enviadas

---

## PARTE 14: SETTINGS 🟡

### 14.1 Profile
- [ ] Editar nombre, teléfono, job title → guardados en API + localStorage
- [ ] Email read-only → no editable
- [ ] Error explícito si falla

### 14.2 Security
- [ ] Cambiar contraseña → contraseña actualizada
- [ ] 2FA management (ver sección 1.2)
- [ ] Trusted devices (ver sección 1.2)

### 14.3 Company / Business Info
- [ ] Editar nombre, website, industry, tamaño, supportEmail, phone → guardados
- [ ] Error handling explícito

### 14.4 Appearance
- [ ] Theme switcher → dark/light/system → aplicado inmediatamente

### 14.5 Localization
- [ ] Timezone → guardado, afecta horarios de citas
- [ ] Language → cambia idioma del dashboard (es/en/pt/fr)

### 14.6 Business Hours
- [ ] Daily schedule → horarios por día guardados
- [ ] 24/7 mode → funciona correctamente

### 14.7 Policies (Versioned)
- [ ] CRUD policies → return, privacy, cancellation, etc.
- [ ] Version history → versiones anteriores accesibles
- [ ] Public endpoint → GET /policies/public/:tenantSlug/:type funciona

### 14.8 Pre-chat Form
- [ ] Builder → campos configurados
- [ ] Toggle → activar/desactivar
- [ ] Form funciona en conversación (datos recolectados antes de AI)

### 14.9 Public Booking Config
- [ ] Activar/desactivar → guardado
- [ ] Config → opciones configurables

### 14.10 Email Templates
- [ ] CRUD → crear, editar, eliminar (plan-gated)
- [ ] 4 defaults → auto-seeded en primer acceso
- [ ] Variable rendering → {{variables}} reemplazadas
- [ ] Test send → email de prueba enviado

### 14.11 Media Library
- [ ] Upload imagen → procesada con sharp→WebP
- [ ] Upload logo → guardado como company logo
- [ ] Listar archivos → tags, metadata
- [ ] Serve file → GET /media/file/:tenantId/:fileName (público, sin auth, CORP header)
- [ ] Delete file → archivo eliminado
- [ ] Storage health → GET /media/health funciona

### 14.12 Macros / Saved Actions
- [ ] CRUD macros
- [ ] Ejecutar macro → acciones ejecutadas en secuencia

### 14.13 Alert Rules
- [ ] Ver sección 12.5

### 14.14 Integrations > CRM
- [ ] External CRM connections (HubSpot/Pipedrive)
- [ ] Bidirectional sync → BullMQ `crm-sync` queue funcional
- [ ] Batch import → BullMQ `crm-import` queue funcional

### 14.15 AI Providers (super_admin)
- [ ] API keys configurables → OpenAI, Anthropic, Gemini, DeepSeek, xAI
- [ ] Health check → GET /health/llm-providers muestra estado por provider

### 14.16 AI Config (super_admin)
- [ ] LLM routing config → task-based routing configurado

### 14.17 Platform Config (super_admin)
- [ ] Maintenance mode → banner activado/desactivado (Redis)
- [ ] GET /platform-status público → estado visible

### 14.18 Billing Settings
- [ ] Ver sección 13

---

## PARTE 15: COMPLIANCE Y LEGAL 🟡

### 15.1 Legal Texts
- [ ] CRUD → crear con nombre, tipo, canales[], agent_ids[], texto
- [ ] 7 tipos → general, privacy_policy, terms_of_service, consent_to_process, ai_disclosure, opt_in_message, opt_out_confirmation
- [ ] Multi-channel → texto diferente por canal
- [ ] Multi-agent → texto asignado a agentes específicos

### 15.2 Consent Records
- [ ] Registrar consentimiento → consent guardado con timestamp
- [ ] Listar consents → filtro por leadId

### 15.3 Opt-outs
- [ ] Lista → con filtro por status, paginación
- [ ] Stats → estadísticas de opt-out
- [ ] Confirmar opt-out → con notas
- [ ] Rechazar opt-out (false positive) → con notas
- [ ] Manual opt-out → registrado desde dashboard

### 15.3.1 BUG CONOCIDO — OptOut Fire-and-Forget
> **ALTO**: `whatsapp-webhook.service.ts:221-226` — Si processOptOut() falla, el mensaje continúa al AI pipeline. Violación de compliance.
- [ ] Verificar: ¿opt-out keyword en WA detiene procesamiento AI?

### 15.4 GDPR / Data Deletion
- [ ] Deletion requests → crear, listar
- [ ] Process deletion → 11 tablas anonimizadas (Art. 17 erasure)
- [ ] GDPR data export → datos del contacto exportados (super_admin)
- [ ] Compliance audit log → acciones registradas

### 15.5 Meta Compliance
- [ ] Data deletion callback → Meta callback procesado
- [ ] Data deletion request → solicitud creada
- [ ] Status check → estado verificable por confirmation code

### 15.6 Compliance Admin (super_admin)
- [ ] Cross-tenant overview → métricas de compliance por tenant

---

## PARTE 16: SUPER ADMIN PLATFORM 🟡

### 16.1 Tenants
- [ ] Lista de tenants → con stats
- [ ] Crear tenant → schema PostgreSQL generado
- [ ] Editar tenant → nombre, industria, idioma, plan
- [ ] Suspend tenant → con razón, servicios deshabilitados
- [ ] Reactivate tenant → servicios restaurados
- [ ] Impersonate → login como tenant (audit trail)
- [ ] Tenant detail → 4 tabs + flags + quotas

### 16.2 Platform Stats
- [ ] Total tenants, users, active, trialing
- [ ] Messages today, pending handoffs
- [ ] Platform health → BullMQ inspection

### 16.3 Financials (5 tabs)
- [ ] Overview → MRR, ARR, ARPU, churn, LTV, quick ratio
- [ ] MRR trend (12 meses)
- [ ] Revenue + churn + cost trends
- [ ] Tenant profitability → per-tenant P&L
- [ ] Trial metrics
- [ ] Infra costs → por categoría
- [ ] LLM usage → drilldown 90 días (Redis)
- [ ] Forecast → regresión lineal 6 meses
- [ ] CSV exports (revenue, costs, tenant profitability)
- [ ] Monthly snapshot generation

### 16.4 AI Usage Dashboard
- [ ] Monthly selector (1/3/6/12 meses)
- [ ] 4 KPI tiles
- [ ] Stacked monthly bar charts
- [ ] Category breakdown con %
- [ ] Provider attribution table
- [ ] Tenant ranking con full breakdown

### 16.5 Offboarding
- [ ] Voluntary cancellation → 7-step pipeline ejecutado
- [ ] Admin suspension → tenant suspendido
- [ ] Reactivate → tenant reactivado
- [ ] Reactivate channels → canales forzados a reconectar
- [ ] Purge → hard-delete (destructivo, super_admin only)
- [ ] Extend trial → trial extendido

### 16.6 Offboarding Crons
- [ ] Trial expiry detector (*/30 min) → expired trials detectados
- [ ] Grace enforcer (3 AM) → past_due >7d offboarded
- [ ] Archive cleaner (4 AM) → schemas inactivos >90d eliminados
- [ ] Stale channel purge (5 AM) → credenciales stale limpiadas

### 16.7 Audit Log
- [ ] Log viewer → acciones registradas y filtradas

### 16.8 Vertical Analytics
- [ ] Cross-industry overview → distribución, activación
- [ ] Per-industry drilldown
- [ ] Per-tenant vertical KPIs

### 16.9 Feature Requests
- [ ] CRUD + voting + comments
- [ ] Similar requests (AI)
- [ ] Status change (super_admin)
- [ ] Merge duplicates (super_admin)
- [ ] Public changelog
- [ ] Recompute ranking (cron 3AM)
- [ ] Extract conversational signals (cron 4AM)

---

## PARTE 17: VERTICALES 🟠

### 17.1 Vacation Rental (Turismo)
- [ ] Properties CRUD → crear, editar, eliminar
- [ ] Property detail (5 tabs) → datos, disponibilidad, calendario, bookings, iCal
- [ ] Availability check → fechas libres calculadas
- [ ] Calendar blocks → bloquear/desbloquear fechas
- [ ] Bookings CRUD → crear, cancelar (restaurar capacidad)
- [ ] iCal feeds → agregar, sync manual, eliminar
- [ ] iCal export → GET /public/ical/:tenantSlug/:propertyId/:token/calendar.ics
- [ ] iCal sync cron (*/30 min) → feeds externos sincronizados
- [ ] AI tools → list_vacation_rentals, check_vacation_rental, get_rental_details, get_check_in_instructions, create_rental_booking
- [ ] Sidebar "Propiedades" visible solo cuando industry='turismo'

### 17.2 Tours (Turismo)
- [ ] Packages CRUD
- [ ] Tour detail → inventory de departures
- [ ] Departure inventory → agregar/eliminar fechas de salida
- [ ] Availability → check slots por fecha + tamaño de grupo
- [ ] Bookings → crear (capacidad decrementada), cancelar (capacidad restaurada)
- [ ] AI tools → search_packages, get_package_details, check_tour_availability, create_tour_booking, cancel_tour_booking, list_my_tour_bookings

### 17.3 Listings (Inmobiliaria)
- [ ] Listings CRUD
- [ ] Search con filtros → tipo, clase, precio, habitaciones, barrio
- [ ] Zone-agent routing → neighborhoods mapeados a agentes
- [ ] AI tools → search_listings

### 17.4 Restaurants
- [ ] Menu categories CRUD
- [ ] Menu items CRUD → con availability
- [ ] Promotions CRUD
- [ ] Orders → crear, listar, status transitions (received→preparing→ready→delivered)
- [ ] Order detail → con items de food_order_items
- [ ] Food orders page → queue de pedidos
- [ ] AI tools → get_menu, get_daily_promotions, place_order, get_order_status, cancel_order, check_order_status, list_my_orders

### 17.5 Gyms
- [ ] Membership plans CRUD
- [ ] Members CRUD → registrar, freeze/unfreeze, check-in
- [ ] Fitness classes CRUD → crear, cancelar
- [ ] Class booking → book member, cancel booking
- [ ] Dashboard pages → /admin/memberships, /admin/classes
- [ ] AI tools → get_gym_plans, get_upcoming_classes, check_gym_membership, book_class, freeze_membership, cancel_class_booking

### 17.6 Education
- [ ] Courses CRUD
- [ ] Cohorts CRUD → con cancel
- [ ] Enrollments → enroll (seats decremented), update, cancel
- [ ] Dashboard page → /admin/courses
- [ ] AI tools → get_courses, get_course_schedule, enroll_student, get_placement_test_link, cancel_enrollment, list_my_enrollments

### 17.7 Insurance
- [ ] Plans CRUD
- [ ] Quotes → crear, status update, cancel
- [ ] Policies → CRUD, lookup by policy number
- [ ] Claims → file, list
- [ ] Dashboard page → /admin/insurance
- [ ] AI tools → get_insurance_plans, calculate_quote, check_policy_status, file_claim, list_my_claims, cancel_quote

### 17.8 Home Services
- [ ] Service requests → crear con urgency, listar, detalle, update
- [ ] Dashboard page → /admin/service-requests
- [ ] AI tools → create_service_request, check_request_status, cancel_service_request

### 17.9 Treatment Plans (Salud)
- [ ] Plans CRUD → con cancel
- [ ] Sessions → add, complete, cancel
- [ ] Dashboard page → /admin/treatment-plans

### 17.10 Pets (Veterinaria)
- [ ] Pets CRUD → registrar, editar, eliminar
- [ ] Vaccinations → add record, delete record
- [ ] Dashboard page → /admin/pets
- [ ] AI tools → list_pets_for_contact, register_pet, get_vaccination_status, triage_pet_emergency, update_pet

### 17.11 Photography
- [ ] Sessions CRUD → crear, editar, mark as delivered
- [ ] Dashboard page → /admin/photo-sessions
- [ ] AI tools → list_photo_packages, check_date_availability, request_photo_quote, cancel_photo_session

### 17.12 Pet Services (Grooming/Daycare/Hotel)
- [ ] List pet services
- [ ] Check daycare availability → checkIn, checkOut, petSize
- [ ] AI tools → list_pet_services, check_daycare_availability

### 17.13 Staff Scheduling
- [ ] Staff CRUD → crear, editar, eliminar (plan-gated)
- [ ] Weekly schedule → set/update
- [ ] Service links → link/unlink services to staff
- [ ] Breaks → add/remove
- [ ] Availability check → considers service links, schedules, breaks, appointments

### 17.14 Vehicle Inventory
- [ ] Vehicles CRUD → crear, editar, eliminar
- [ ] Mark as sold → sold_at, price, buyer registrados
- [ ] Test drives → schedule con conflict detection
- [ ] AI search → budget, category, fuel filters
- [ ] Stats → inventory KPIs

---

## PARTE 18: E-COMMERCE Y CHANNEL MANAGER 🟡

### 18.1 E-commerce
- [ ] Config → Shopify/WooCommerce credentials guardados
- [ ] Sync products → Shopify Admin API / WooCommerce REST API
- [ ] Product list → productos sincronizados
- [ ] AI product search → búsqueda conversacional
- [ ] Cart abandonment tracking

### 18.2 Channel Manager
- [ ] Config → Hostaway OAuth credentials
- [ ] Sync Hostaway → listings y reservaciones sincronizadas
- [ ] Listings CRUD (plan-gated)
- [ ] Reservations → crear, listar, conflict detection
- [ ] Availability calendar → date series generado

---

## PARTE 19: CUSTOMER PORTAL 🟡

### 19.1 Auth (Magic Link)
- [ ] Request access → código 6 dígitos enviado (SMS/email)
- [ ] Verify code → JWT con type:'customer' generado
- [ ] Brute-force protection → max 5 intentos por código
- [ ] Code expiry → 10 min TTL

### 19.2 Portal Endpoints
- [ ] Profile → datos del cliente (read-only)
- [ ] Conversations → historial de conversaciones (read-only)
- [ ] Appointments → citas del cliente (read-only)
- [ ] Orders → pedidos del cliente (read-only)
- [ ] X-Portal-Token header → validado correctamente

---

## PARTE 20: WHITE LABEL 🟢

- [ ] Config CRUD → brandName, logoUrl, colors, customDomain, customCss, hidePoweredBy
- [ ] Plan-gated → solo Custom plan
- [ ] Public lookup by slug → GET /white-label/public/slug/:slug
- [ ] Public lookup by domain → GET /white-label/public/domain?domain=
- [ ] Redis cache → lookup cacheado
- [ ] hidePoweredBy → branding de plataforma removido

---

## PARTE 21: WEBHOOKS 🟡

- [ ] List available events
- [ ] CRUD webhooks (plan-gated)
- [ ] Regenerate secret → nuevo secret generado
- [ ] Delivery history → entregas listadas
- [ ] Test webhook → webhook de prueba enviado
- [ ] Webhook live-tail (super_admin) → GET /webhook-tap eventos recientes

---

## PARTE 22: ORDERS, INVENTORY, CATALOG (HIDDEN) 🟢

### 22.1 Inventory
- [ ] Stock overview
- [ ] Products CRUD
- [ ] Stock adjustment → cantidad ajustada
- [ ] Categories → crear

### 22.2 Orders
- [ ] Orders overview → por tenant
- [ ] Orders by contact
- [ ] Create order
- [ ] Update order status
- [ ] Generate invoice → HTML generado

### 22.3 Catalog
- [ ] Courses → CRUD
- [ ] Campaigns → CRUD
- [ ] Offers → CRUD

---

## PARTE 23: LANDING PAGES 🟢

- [ ] Admin → listar landing pages
- [ ] Crear landing page
- [ ] Public → GET /public/landing/:slug devuelve config
- [ ] Form submission → POST /public/forms/:id/submit captura lead

---

## PARTE 24: INFRASTRUCTURE & HEALTH 🟡

### 24.1 Health Checks
- [ ] GET /health → 200 OK
- [ ] GET /health/llm-providers (super_admin) → status por provider

### 24.2 BullMQ Queues
- [ ] `outbound-messages` → jobs procesados, 3 reintentos
- [ ] `broadcast-messages` → rate limit 80 msg/s respetado
- [ ] `automation-jobs` → 3 reintentos
- [ ] `nurturing` → rate-limited
- [ ] `crm-sync` → bidirectional sync funcional
- [ ] `crm-import` → batch import funcional

### 24.3 Redis
- [ ] noeviction policy → confirmado (`CONFIG GET maxmemory-policy`)
- [ ] Keys TTL → booking (1h), lock (30s), handoff (24h), trusted_device (30d)
- [ ] No memory pressure → keys no evicted silenciosamente

### 24.4 PgBouncer
- [ ] pg_isready → `docker exec parallext-pgbouncer pg_isready -h localhost -p 6432`
- [ ] Transaction mode → funcional con queries individuales (no multi-statement)

### 24.5 Sentry
- [ ] Errores capturados → verificar en dashboard de Sentry
- [ ] instrument.ts cargado antes de todos los módulos

---

## PARTE 25: i18n VERIFICATION 🟡

### 25.1 Dashboard i18n
- [ ] Todas las páginas → strings traducidos en 4 idiomas (es/en/pt/fr)
- [ ] Cambiar idioma → todas las strings cambian
- [ ] Sin strings hardcodeados en español o inglés
- [ ] Páginas con advertencia ⚠️ verificadas:
  - [ ] `/kb/[tenantSlug]` → actualmente hardcoded EN
  - [ ] `/book/[tenantSlug]` → solo en/es
  - [ ] `/admin/settings/notifications` → hardcoded EN
  - [ ] `/admin/conversations` → parcial
  - [ ] `/admin/analytics` (legacy) → parcial

### 25.2 AI Agent Messages
- [ ] Tool result messages en inglés (LLM traduce al idioma del cliente)
- [ ] Booking engine messages → via `msg()` function con 4 idiomas

---

## PARTE 26: BUGS CONOCIDOS A VERIFICAR (CONSOLIDADO)

### Críticos (4)
| # | Archivo | Línea | Problema | Impacto |
|---|---------|-------|----------|---------|
| 1 | whatsapp.controller.ts | 504 | Webhook fire-and-forget con console.error | Mensajes perdidos silenciosamente |
| 2 | whatsapp-webhook.service.ts | 269-278 | markAsRead() no awaited | Read receipts fallan sin log |
| 3 | whatsapp-webhook.service.ts | 221-226 | OptOut fire-and-forget | Violación de compliance |
| 4 | whatsapp-webhook.service.ts | 94-111 | Loop sin try-catch | Mensajes batch post-error perdidos |

### Altos (8)
| # | Archivo | Línea | Problema | Impacto |
|---|---------|-------|----------|---------|
| 5 | llm-router.service.ts | 171,193,231,235 | trackStats().catch(() => {}) | AI usage data perdida |
| 6 | llm-router.service.ts | 95,105 | Redis circuit breaker .catch(() => {}) | Provider failover incorrecto |
| 7 | automation.service.ts | 53-77 | JSON.parse silencioso → [] | Reglas ejecutan sin acciones |
| 8 | automation.service.ts | 24-33 | Query sin error handling | Eventos de automation perdidos |
| 9 | leads.repository.ts | 282-333 | Bulk update reporta éxito parcial | Datos inconsistentes |
| 10 | leads.repository.ts | 73-82 | Empty catch en column check | Leads archivados visibles |
| 11 | channel-management.controller.ts | 45-59 | Empty catch asume tabla faltante | Agent assignments perdidos |
| 12 | conversations.service.ts | 393 | Lock release .catch(() => {}) | Conversaciones temporalmente bloqueadas |

### Medios (8)
| # | Archivo | Problema | Impacto |
|---|---------|----------|---------|
| 13 | Dashboard (múltiples páginas) | Toast-only errors (2-3s auto-dismiss) | Usuario no ve errores |
| 14 | Dashboard inbox | Socket disconnect sin indicador | Datos stale |
| 15 | Dashboard pipeline | Optimistic update sin rollback | UI desync |
| 16 | Dashboard contact detail | Update silencioso sin feedback | Usuario cree que guardó |
| 17 | Dashboard tenants | localStorage pollution (impersonation flag) | Persiste tras logout |
| 18 | Dashboard contact detail | Parallel fetch de custom attrs puede desync | Datos parciales |
| 19 | Dashboard (múltiples) | No reload después de create/bulk action | Lista stale |
| 20 | Dashboard (múltiples) | Missing confirmation en delete/revoke/bulk delete | Acciones destructivas sin confirmar |

---

## PARTE 27: PROTOCOLO DE PRUEBA

### Preparación
1. Tener acceso como `super_admin` para probar todas las funcionalidades
2. Tener al menos 2 tenants de prueba con verticales diferentes
3. Tener WhatsApp, Instagram y Telegram conectados en al menos 1 tenant
4. Tener un teléfono con app de autenticación TOTP (Google Authenticator)
5. Tener acceso a Sentry para verificar errores capturados
6. Tener acceso a Redis CLI para verificar keys

### Ejecución
1. Probar sección por sección en orden de prioridad (🔴 → 🟠 → 🟡 → 🟢)
2. Para cada ítem, verificar:
   - **Happy path** → funciona como se espera
   - **Error path** → error visible y descriptivo (no silencioso)
   - **Edge cases** → datos vacíos, caracteres especiales, valores límite
   - **Persistencia** → datos guardados sobreviven refresh del navegador
3. Documentar bugs encontrados con:
   - Sección y número del checklist
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshot si es visual
4. Marcar cada ítem con `[x]`, `[!]`, o `[-]`

### Verificación Post-Prueba
```bash
# Type checking
cd apps/api && npx tsc --noEmit
cd apps/dashboard && npx tsc --noEmit

# NestJS DI
cd apps/api && npm run test:bootstrap

# Redis health
redis-cli CONFIG GET maxmemory-policy  # debe ser "noeviction"

# PgBouncer health
docker exec parallext-pgbouncer pg_isready -h localhost -p 6432

# BullMQ queues
# Verificar en /admin/health que no hay jobs stuck
```

---

## REGISTRO DE HALLAZGOS

| # | Fecha | Sección | Severidad | Descripción | Status |
|---|-------|---------|-----------|-------------|--------|
| | | | | | |

---

**Total de items de prueba:** ~450+  
**Bugs conocidos pre-existentes:** 20 (4 críticos, 8 altos, 8 medios)  
**Estimación de tiempo:** 3-5 días de testing completo
