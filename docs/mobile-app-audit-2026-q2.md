# Informe Exhaustivo: App Móvil Parallly vs. Competidores — Análisis de Producto (Junio 2026)

> Estado: borrador analítico interno. Combina (A) auditoría de código de la app móvil `apps/mobile` (Expo/React Native) y (B) investigación web de apps móviles de ~16 competidores. Toda cifra de competidores proviene de la investigación web adjunta; los niveles de confianza se marcan explícitamente. No se inventan datos: lo incierto se señala como tal.

> **⚠️ Nota de verificación (post-auditoría).** Los 4 bugs marcados "severidad alta" por la auditoría automática fueron revisados manualmente contra el código real. **Dos eran falsos positivos** y se corrigen abajo:
> - ❌ **`moveDeal` "mismatch de contrato"** → **FALSO.** El móvil llama `PUT /pipeline/deals/{tenantId}/{dealId}/move` con `{stageId}`, exactamente igual que el backend (`pipeline.controller.ts:84-90`) y que el dashboard en producción (`apps/dashboard/src/lib/api.ts:207`). El contrato es correcto.
> - ❌ **"Fuga de listeners de socket" en `InboxScreen`** → **FALSO.** El `useEffect` (`InboxScreen.tsx:74-89`) tiene cleanup correcto (`return () => { inbox.off(...); agent.off(...) }`) que remueve las mismas referencias que registró. No hay fuga.
> - ✅ **Deep-link `linking` ausente** → **REAL pero con matiz:** `NavigationContainer` (`App.tsx:44`) no tiene prop `linking`, por lo que las URLs `parallly://` no enrutan; sin embargo el tap de la notificación push **sí** navega de forma imperativa vía `navigationRef`. Severidad real: media, no alta.
> - ⚠️ **Sin fallback Expo push en handoff con app cerrada** → no verificado manualmente; se mantiene como preocupación legítima a confirmar.

---

## 0. Objetivo y estándar de producción (marco rector)

> **Este informe NO evalúa un MVP. El objetivo es una app robusta, madura y lista para producción, al mismo nivel de exigencia que la plataforma Parallly y en sintonía con su avance.** Toda la priorización de abajo se reordena contra esta vara.

**Estándar de referencia = el de la plataforma** (definido en `CLAUDE.md` y la infra de producción):

| Estándar de la plataforma | Estado en el móvil hoy | ¿Bloqueante GA? |
|---|---|---|
| **Sentry** obligatorio (error tracking + profiling; `instrument.ts` antes de módulos) | ❌ **Ausente en el móvil** | **Sí** |
| **Tests** antes de push (`test:bootstrap` + integración real) | ❌ **Cero tests** | **Sí** |
| **i18n 4 idiomas** (es/en/pt/fr) — regla dura, cada pantalla | ❌ **Hardcoded en español** | **Sí** |
| Resiliencia/observabilidad de producción (reintentos, circuit breaker, idempotencia) | ◐ Parcial (socket backoff; sin cola offline ni reintentos de UI) | **Sí** |
| Manejo de errores explícito (sin fallos silenciosos) | ❌ `catch {}` y Promise.all sin manejo en varias pantallas | **Sí** |
| Seguridad de grado producción (la plataforma cifra, rota tokens, audita) | ◐ Sólida en auth; sin cert pinning, errores verbatim, logs de tokens | Recomendado |
| Accesibilidad / pulido consistente | ◐ Diseño consistente; sin labels a11y, touch targets, dynamic type | Recomendado |

**Implicación de marco:** lo que el primer borrador catalogó como "endurecimiento futuro" (tests, i18n, offline, error handling, Sentry, paginación, accesibilidad) **sube de categoría a bloqueante de lanzamiento (GA gate)**. La app tiene amplitud de *features* de producto, pero **aún no la robustez operativa que la plataforma ya exige a sus otros componentes**. Cerrar esa brecha — no añadir más features — es el objetivo central.

**Sincronía con el avance de la plataforma:** el móvil debe (a) consumir los contratos ya endurecidos de la API (LLMRouter, Handoff, OutboundQueue, idempotencia) sin reimplementar lógica; (b) heredar el mismo set de idiomas y observabilidad; (c) versionarse y desplegarse con su propio pipeline (es codebase separado, no entra por `git push` del web), pero **alineado en estándares de calidad y release readiness** con el resto.

### 0.1 Estándar de la industria y principio de alcance — *NO es paridad total con el web*

> **"Producción-ready" se aplica a la ROBUSTEZ, no a la AMPLITUD.** La norma de la industria es que la app móvil de agente es un **compañero enfocado**, no un clon del panel web. Replicar todas las funciones del web en el teléfono es un anti-patrón documentado (empeora la UX). Evidencia de nuestra propia investigación: **Front** recorta a propósito el móvil (sin plantillas/firmas/analytics; filosofía "triage on the go"); **respond.io** móvil sin dashboard/reports/broadcasts/workflows; **Intercom/Crisp/Manychat** dejan los ajustes avanzados solo-web; **HubSpot** limita KB y edición en móvil.

Dos ejes independientes — no confundirlos:

| Eje | ¿Estándar de producción exige…? | Qué significa aquí |
|---|---|---|
| **Robustez / madurez** | **SÍ, completo** | Sentry, tests, i18n, error handling, offline, a11y, push fiable. Es CALIDAD, no features. = **GATE 0**. |
| **Amplitud de funciones** | **NO — subconjunto curado** | Solo los trabajos del agente *en movimiento*, ejecutados excelentemente. El web sigue siendo el centro de control. |

**Principio de alcance del móvil (regla de decisión para "¿esto va en la app?"):**

| En el móvil (núcleo del agente en movimiento) | Solo en el web (centro de control) | Oportunista / diferenciador móvil |
|---|---|---|
| Bandeja unificada + tiempo real + push fiable | Constructor de bots / flujos | **Copiloto de IA en el bolsillo** |
| Responder (texto + media) + canned/quick replies | Reglas de automatización y SLA config | **Takeover del bot con un tap** |
| Asignar / notas / colaboración / takeover | Creación/gestión de plantillas y HSM | **Mover deal + iniciar outbound** (ángulo ventas) |
| Contexto 360° del contacto (vista, no admin) | Analítica profunda / reporting / BI | Escáner de tarjeta → lead |
| Notificaciones configurables + estado/disponibilidad | Admin de tenant, usuarios, billing, integraciones | Quick actions desde la notificación |
| Confirmar/cancelar citas | Edición masiva, broadcasts (autoría), KB authoring | — |

**Conclusión de alcance:** el objetivo es **profundidad y robustez en el subconjunto correcto**, no superficie máxima. Toda feature candidata se filtra por: *¿la necesita el agente con el teléfono en la mano, fuera de su escritorio?* Si no, vive en el web. Esto **reduce** la lista de "features a añadir" y concentra el esfuerzo en el GATE 0 (robustez) + unos pocos diferenciadores móviles.

---

## 1. Resumen ejecutivo

**Veredicto honesto (contra la vara de PRODUCCIÓN, no de MVP): Parallly móvil tiene la *amplitud de features* de un producto maduro y dos ventajas reales (IA-en-el-bolsillo y multicanal), pero NO está aún en estado lista-para-producción según el estándar de la propia plataforma.** Le faltan los pilares de robustez que la plataforma ya exige: observabilidad (Sentry), tests, i18n de 4 idiomas, manejo de errores explícito, resiliencia offline y accesibilidad. Dicho de otro modo: el producto está "feature-complete" pero no "production-ready". Cerrar esa brecha de **madurez operativa** es el objetivo; añadir features es secundario. La buena noticia: el mayor punto de dolor de TODO el mercado (fiabilidad de notificaciones push) es donde Parallly ya empezó a invertir, y donde los competidores fallan de forma crónica — convertirlo en fortaleza probada es parte del gate de producción.

**Hallazgos clave:**

1. **El mercado entero tiene el mismo talón de Aquiles: notificaciones push poco fiables.** Es la queja #1 documentada en Intercom (2.3★), Trengo (deprecó su app nativa), Wati (2.9★ Android), Crisp, Chatwoot (2.0★ Android), Tidio, Front y Treble. Parallly ya añadió indicador de conexión en vivo + socket eager (commits `b3e83df`, `6e99941`). **Esto es un foso competitivo real si se ejecuta bien.** Pero atención: la auditoría indica (pendiente de confirmar en runtime) que la app de Parallly podría no tener fallback automático de Expo push cuando ocurre un handoff con la app cerrada — las alertas en tiempo real serían *local-only*, dependientes de socket vivo. Si se confirma, Parallly hoy comparte el mismo riesgo que critica, y cerrarlo es el P0 de mayor valor.

2. **Parallly ya es AI-native en el bolsillo — eso ya supera a casi todos.** El copiloto (suggest + rewrite con 6 tonos + summary) está implementado y calificado `solid` en la auditoría. Solo respond.io (AI Assist + traducción), Crisp (Hugo) y Chatwoot (AI Assist + traducción inline) tienen algo comparable en móvil; los líderes de soporte (Zendesk, Intercom, Front, Wati, Zenvia) **no** tienen copiloto de IA móvil maduro. Aivo y Landbot, líderes LatAm AI-native, **ni siquiera tienen app nativa de agente**.

3. **Multicanal real (WA/IG/Messenger/Telegram/SMS) es una ventaja genuina en LatAm.** Wati y Treble son WhatsApp-only; Intercom no tiene WhatsApp/IG; Zenvia carece de Telegram/SMS. Parallly empata con Manychat, Chatwoot y Crisp en amplitud de canales — y los supera en integración IA.

4. **Deuda técnica seria que aún no duele pero dolerá a escala:** cero tests automatizados, ningún i18n (la app está hardcodeada en español pese a que el dashboard exige 4 idiomas), sin cola offline, sin paginación de timeline (riesgo de memory leak en conversaciones largas), error handling silencioso transversal, y el **deep-link por URL `parallly://` sin cablear** (`App.tsx:44`, severidad media — el tap de push sí funciona vía `navigationRef`). *(Nota: los supuestos bugs de "fuga de listeners" y "mismatch `moveDeal`" resultaron falsos positivos tras verificación manual — ver nota arriba.)*

5. **El CRM/pipeline móvil es read-mostly.** El contrato de API es correcto (idéntico al dashboard), pero la UI móvil es de solo-lectura: no permite editar lead/stage/tags. Esto es a la vez gap y oportunidad: ningún competidor de soporte (Zendesk, Crisp, Tidio, Chatwoot) ofrece pipeline de ventas serio en móvil. Si Parallly añade **edición** de pipeline en móvil, se diferencia como app de **ventas**, no de soporte.

**Posición competitiva neta por eje:** Parallly lidera en *IA móvil* y *multicanal+ventas*; empata en *bandeja en tiempo real, biometría, colaboración*; va por detrás en *fiabilidad probada, offline, i18n, madurez/QA, paginación*.

---

## 2. Metodología y alcance

**Fuente A (interna):** auditoría estructurada de 8 áreas del código de `apps/mobile` (auth-security, inbox real-time, chat screen, CRM-funnel, appointments, más/analytics, push/deep-link, arquitectura). Cada feature lleva calidad autoevaluada (`solid`/`ok`/`weak`/`stub`) y referencias de archivo verificadas contra el árbol real del repo (los 14 archivos referenciados existen — confirmado vía glob).

**Fuente B (competitiva):** investigación web de 16 productos. Para cada uno: ¿tiene app de agente?, plataformas, features móviles, joya de la corona, fortalezas/debilidades UX, ratings de tienda y relevancia para Parallly. **Niveles de confianza** declarados por la propia investigación: `high` (Intercom, Wati, Manychat, Chatwoot), `med` (Zendesk, Front, respond.io, HubSpot, Kommo, Trengo, Treble, Aivo, Zenvia, Tidio, Crisp, Landbot).

**Limitaciones honestas:**
- La calidad de la app de Parallly se autoevaluó en la auditoría de código; **no se midió comportamiento en runtime** (no hay crash-free rate, no hay métricas de latencia, no hay tests). Las etiquetas `solid` reflejan corrección de código, no estabilidad observada en campo.
- Los ratings de competidores provienen de fichas de tienda y agregadores en la fecha de la investigación; varios tienen volumen bajo de reseñas (iOS de Kommo 12 ratings, respond.io 14, Chatwoot iOS 13) → señal estadísticamente débil, marcada como tal.
- Varias cifras de Google Play no pudieron extraerse (rate-limit / render dinámico). Donde falta, se dice "no confirmado".
- No se probó la app de Parallly contra las de competidores lado a lado; la comparación de UX se infiere de descripciones.

---

## 3. Inventario honesto de la app Parallly (por área)

Leyenda calidad: **solid** = correcto y bien integrado · **ok** = funciona con bordes ásperos · **weak** = frágil/incompleto · **stub** = ausente o esqueleto.

### 3.1 Autenticación y seguridad — calidad global: **ok-a-solid**

| Feature | Calidad | Nota crítica |
|---|---|---|
| JWT access+refresh en `expo-secure-store` | solid | Keychain/Keystore, refresh único en 401 (`api.ts:53-96`). Correcto. |
| Unlock biométrico + relock a 90s | solid | Razonable para consola de agente (`AuthContext.tsx:62-82,162-187`). Sin timeout/fallback si el prompt se congela. |
| 2FA (TOTP/email/backup) + device trust 30 días | solid | Bien estructurado (`LoginScreen.tsx`, `api.ts:143-150`). |
| Google Sign-In | ok | `webClientId` hardcoded en `app.config.ts:64`. |
| Resolución de conflicto de sesión | ok | **Detección por string-match en español** (`'sesión activa'`) → frágil ante cambios de idioma/formato (`AuthContext.tsx:12-13`). |
| Refresh de token en socket | solid | Fresh token en cada reconexión. |

**Gaps de seguridad reales:** sin certificate pinning (riesgo MitM si CA del dispositivo se compromete), mensajes de error del backend mostrados verbatim (info disclosure / enumeración de usuarios, `LoginScreen.tsx:70-71`), device trust persiste tras logout sin "revocar todos los dispositivos", `console.log` de tokens/socket IDs en producción. **Veredicto:** sólido para uso empresarial típico; no alcanza estándar fintech/salud. Aceptable para v1 con HTTPS forzado.

### 3.2 Inbox en tiempo real — calidad global: **solid (con bordes)**

| Feature | Calidad |
|---|---|
| Socket.io dual namespace (`/inbox` + `/agent`), auth fresh, backoff 1.5→8s | solid |
| Lista de conversaciones (4 filtros, búsqueda, pull-refresh, indicador LIVE/OFFLINE, badges handoff/IA/unread) | solid |
| Alertas de handoff/asignación/escalación (notificación local) | solid |
| Detección de colisión (viewers) | ok (push-only, stale 15s si crash) |
| Reconexión y manejo offline | **weak** — sin cola de mensajes offline, sin retry UI |

**Corrección (verificado manualmente):** el supuesto "bug de fuga de listeners" es un **falso positivo** — `InboxScreen.tsx:74-89` registra los listeners con `.on()` y los remueve en el cleanup del `useEffect` con `.off()` usando las mismas referencias, que es el patrón correcto. **Bug real (severidad MED):** el token no se reaplica al socket vivo si expira a mitad de sesión (queda con auth stale hasta la siguiente reconexión).

**Gaps:** cero tests, sin paginación de timeline (riesgo memory leak >1000 msgs), sin optimistic updates (UX laggy), búsqueda O(n) local-only, sin typing indicators, errores silenciosos (`catch {}` noop).

### 3.3 Pantalla de chat — calidad global: **ok (1.0 con bordes afilados)**

Camino feliz completo: timeline (mensajes+notas), action bar (asignar/devolver-IA/resumir/nota/resolver), composer rico (canned + macros + AI suggest/rewrite/summary), Contacto 360°, colisión. Todo `solid`/`ok`.

**Debilidades reales:** sin subida de media saliente (solo recibe imágenes/audio; el agente **no puede enviar** foto/audio desde el dispositivo) · `errorStates` calificado **weak** (fallos de API/copilot fallan en silencio, sin toasts) · `mediaUrl` con cadena de fallback frágil · sin persistencia de borrador (back = pierde lo escrito) · sin reintento en envío fallido · media capada a 200x200 sin lightbox · sin read receipts · sin typing · accesibilidad nula.

### 3.4 CRM / funnel — calidad global: **funcional pero read-only MVP**

Leads list + búsqueda (solid), Lead 360° (solid), Pipeline kanban (ok). **Pero:**

- **El contrato de API es CORRECTO (corregido vs auditoría).** `api.moveDeal()` hace `PUT /pipeline/deals/{tenantId}/{dealId}/move` con `{stageId}` — idéntico al backend (`pipeline.controller.ts:84-90`) y al dashboard que funciona en producción (`apps/dashboard/src/lib/api.ts:207`). Igual para `getKanban`/`getStages`. El supuesto "mismatch" era falso positivo.
- **Limitación real: CRM de solo-lectura.** Sin edición de lead/stage/tags desde móvil, sin error handling, sin offline. Score 0-100 mostrado sin contexto (¿45 es bueno?).
- Colores de etapa **hardcoded en español** (`nuevo/contactado/respondio`) → rompe con terminología/slugs custom del tenant.
- *(A verificar, fuera de alcance móvil: la semántica deals vs opportunities del endpoint `/pipeline/kanban` es la misma que consume el dashboard; no es un bug específico del móvil.)*

### 3.5 Citas (appointments) — calidad global: **minimal, ok**

Lista 14 días + confirmar/cancelar (solid). **Pero tres `stub`:** sin sync real-time (no escucha sockets, inconsistente con Inbox), sin integración de calendario (Google/MS solo en dashboard), sin booking UI (no se pueden crear citas). Sin error handling en confirm/cancel. Expone ~5% del módulo backend de appointments.

### 3.6 Más / Analytics — calidad global: **minimal, ok**

4 KPIs (30 días hardcoded) + toggle disponibilidad + logout. Adaptación vertical de etiqueta de tab (`Citas→Reservas/Pedidos`) — `solid` en infra. **Debilidad:** `analyticsErrorHandling` calificado **weak** (Promise.all falla en silencio → KPIs null sin aviso); toggle de disponibilidad optimista sin rollback; sin trend/comparación pese a que el backend lo soporta.

### 3.7 Push & deep-linking — calidad global: **parcialmente funcional, INCOMPLETO**

Push Expo end-to-end (tap→conversación) y cold-start funcionan (solid). **Bug severidad ALTA:** `scheme='parallly'` declarado en config pero **`NavigationContainer` sin prop `linking`** → links `parallly://` **no funcionan** (`App.tsx:44`). Cold-start con `setTimeout(600ms)` hardcoded (frágil en dispositivos lentos, race con auth context). Backend cuenta tokens *enviados*, no *entregados*. **Alertas en tiempo real son local-only: si la app está cerrada, no hay fallback automático que dispare un Expo push en el handoff** — este es el riesgo central que comparte con los competidores.

### 3.8 Arquitectura — calidad global: **solid para su alcance**

Navegación limpia (stack+tabs typesafe), Context para estado, API client espejo del web, socket dual correcto, biometría pulida, adaptación vertical de terminología. **Deuda transversal:** 70+ usos de `any`, sin error boundary, sin caché (React Query/SWR), sin i18n, sin persistencia local de datos, keyExtractor con fallback a índice.

---

## 4. Gaps y deuda técnica priorizados

| # | Issue | Área | Severidad | Esfuerzo | Impacto |
|---|---|---|---|---|---|
| 1 | ~~Mismatch de contrato `moveDeal`~~ → **FALSO POSITIVO** (verificado: idéntico al dashboard en prod) | CRM | — | — | Sin acción |
| 2 | ~~Fuga de listeners socket en InboxScreen~~ → **FALSO POSITIVO** (verificado: cleanup correcto) | Inbox | — | — | Sin acción |
| 3 | **Deep-link URI scheme no cableado** (`linking` ausente en NavigationContainer) — URLs `parallly://` no enrutan; tap de push sí funciona vía `navigationRef` | Push | **Media** | S | Med (links `parallly://` muertos) |
| 4 | **Sin fallback Expo push en handoff con app cerrada** (alertas local-only) — *a confirmar en runtime* | Push | **Alta** | M | Alto (= el fallo #1 del mercado) |
| 5 | Token no reaplicado a socket vivo si expira a mitad de sesión | Inbox/Auth | Alta/Med | M | Med (auth stale) |
| 6 | **Cero tests automatizados** (socket, refresh, error paths) | Todo | Med | L | Alto a escala |
| 7 | **Sin i18n** (app hardcoded ES; dashboard exige es/en/pt/fr) | Todo | Med | L | Alto (bloquea no-LatAm) |
| 8 | Sin paginación de timeline (>1000 msgs render completo) | Chat | Med | M | Med (perf/leak) |
| 9 | Error handling silencioso transversal (sin toasts en fallos API/copilot/macro/cita) | Todo | Med | M | Med (confianza del agente) |
| 10 | Sin subida de media saliente (agente no envía foto/audio) | Chat | Med | M | Med (gap funcional) |
| 11 | Sin cola offline / caché local | Todo | Med | L | Med (LatAm conectividad variable) |
| 12 | Sin certificate pinning; errores backend verbatim; device trust no revocable | Auth | Med | M | Med (seguridad/info disclosure) |
| 13 | Colores/terminología de etapa hardcoded en español | CRM | Med | S | Med (rompe vertical/custom) |
| 14 | Appointments sin sync real-time ni booking UI | Citas | Med (stub) | M | Med |
| 15 | Sin optimistic updates / sin retry en envío fallido | Chat/Inbox | Med | M | Med (UX laggy) |
| 16 | 70+ `any`, sin error boundary, sin caché | Arquitectura | Med | M | Med |
| 17 | `console.log` de tokens en prod; sin validateEmail | Auth | Low | S | Bajo |
| 18 | Sin paginación en sheets de canned/macros; sin badge count | Chat/Push | Low | S | Bajo |

Esfuerzo: S=días · M=1-2 semanas · L=>1 sprint.

---

## 5. Investigación competitiva: ficha por competidor

> Confianza entre corchetes. Ratings tal cual reportados por la investigación.

### Cluster A — Incumbentes de soporte (web-first, móvil como compañero)

**Intercom — Conversations app · [confianza ALTA]**
- App de agente: **sí, básica**. iOS/Android.
- Features: inbox unificado (Me/Unassigned) in-app+email+SMS, notas+@mention, asignar, tags, saved replies (las *acciones* de macro NO se ejecutan en móvil), adjuntar imágenes/GIF, perfil de cliente inline, push configurable.
- **Joya:** el concepto de inbox multicanal con split Me/Unassigned + contexto de cliente inline. "Joya por intención, no por ejecución".
- Fortalezas UX: triage Me/Unassigned, colaboración móvil, saved replies en composer.
- Debilidades: **en modo mantenimiento** (sin features nuevas), **2.3★ iOS y Android**, "embarrassingly neglected", macros rotas en móvil, notificaciones intermitentes, no se puede copiar una sola palabra.
- Relevancia: **robar el concepto, no la ejecución.** El split Me/Unassigned es el modelo correcto. Su abandono es una cuña competitiva enorme.

**Zendesk — Support/Agent app · [confianza MED]**
- App de agente: **sí, fuerte**. iOS/Android/iPad.
- Features: gestión de tickets, Agent Workspace que unifica email + mensajería social en vivo (WhatsApp, Messenger, IG DM, LINE, WeChat, X DM), push granular por evento + feed 30 días, perfiles/CRM ligero, @mentions, foto/adjuntos, vistas de manager (workload, performance), Dark Mode.
- **Joya:** Agent Workspace omnicanal real (ticket+mensajería) en el teléfono con push fiable.
- Fortalezas: **~4.5★ ~4.2K ratings** (madurez/confianza), push granular, omnicanal genuino, herramientas de manager móvil.
- Debilidades: "menos pulida que la web", confusión enviar/guardar (paper-airplane), badges bugueados, English-first sin foco LatAm.
- Relevancia: valida la tesis multicanal-en-móvil. Modelo a igualar en push granular + vista de manager. Hueco LatAm/ventas explotable.

**Front · [confianza MED]**
- App: **sí, fuerte**. iOS 15.6+/Android.
- Features: triage multi-selección (archive/snooze/assign/tags/merge), composer con send-later/send&snooze, comentarios internos + estado de lectura de participantes, **quick actions desde la notificación** (comentar/leído/archivar sin abrir), DND, **acceso offline 30 días**, omnicanal (email/SMS/chat/WhatsApp+plantillas/IG/Messenger).
- **Joya:** quick actions desde el push + multi-selección de triage. Filosofía explícita "triage on the go".
- Debilidades: **3.5★ iOS ~163 ratings**, "buggy desde hace meses", crashes al escribir (iPad), updates recientes la hicieron MÁS LENTA, móvil deliberadamente recortado (sin templates/signatures/analytics), notificaciones de chat en vivo poco fiables.
- Relevancia: **quick actions desde notificación = alto ROI** para vendedores reaccionando a leads. Acceso offline valioso para LatAm. Lección: priorizar estabilidad sobre features.

### Cluster B — Messaging / conversational (más cerca de Parallly)

**Respond.io — Inbox · [confianza MED, rating iOS débil 14 votos]**
- App: **sí, fuerte, NATIVA**. iOS 16+/Android 10+.
- Features: inbox unificado (All/Mine/Unassigned/Blocked), **llamadas en el hilo (WhatsApp+VoIP)**, **AI Assist (redacción + traducción en tiempo real por mensaje)**, **takeover de IA con un tap (pausa el bot al instante)**, notas de voz, comentarios internos, dark mode, estados online/busy.
- **Joya:** calidad nativa publicitada (99.939% crash-free, -54.2% latencia) + **takeover de IA con un tap**.
- Debilidades: **4.1★ iOS solo 14 ratings**, "real time no sincroniza", una imagen a la vez, recortada (sin dashboard/reports/broadcasts/workflows), versiones desincronizadas iOS 3.1 vs Android 2.34.
- Relevancia: **el competidor más alineado.** Copiar takeover-IA-un-tap (encaja con HandoffService de Parallly), AI Assist móvil, y publicitar métricas crash-free.

**Wati · [confianza ALTA]**
- App: **sí, fuerte**. iOS/Android.
- Features: Team Inbox compartido, asignar a operador/equipo, estados Solved/Pending, tags, quick replies, **broadcasts de WhatsApp desde el móvil**, horario laboral + Out of Office por agente, roles Operator/Admin, multi-idioma.
- **Joya:** operar la bandeja colaborativa WhatsApp Business API + lanzar broadcasts on-the-go.
- Debilidades: **~2.9★ Play, 3.7★ iOS (21 votos)**, **bug crónico: hay que cambiar de pestaña para refrescar**, notificaciones poco fiables, mensajes que desaparecen, **WhatsApp-only** (IG/Messenger limitados, sin Telegram/SMS), plantillas no editables en móvil.
- Relevancia: **multicanal real es la cuña vs Wati.** Su bug de refresco valida la inversión de Parallly en socket robusto + indicador live.

**Kommo (amoCRM) · [confianza MED]**
- App: **sí, fuerte**. iOS/Android/iPad.
- Features: inbox unificado (WA/IG/Messenger/TikTok/email/llamadas), **pipeline/CRM completo móvil** (mover etapa, deal cards), **push selectivas configurables**, llamadas con caller ID, **escáner de tarjetas de visita**, dashboard analítico en vivo, Salesbot, IA (sugerencias, resúmenes).
- **Joya:** inbox unificado nativo + escáner de tarjetas (feature único).
- Debilidades: "App crashes all the time" (2025), **~3.1★ Android**, curva de aprendizaje pronunciada, reporting básico, soporte lento, paywalls.
- Relevancia: valida paridad funcional desktop↔móvil **incluyendo pipeline**. Escáner de tarjetas = quick win de alto "wow". Estabilidad como ventaja (Parallly tiene Sentry).

**Zenvia (Converter, ex-Sirena) · [confianza MED]**
- App: **sí, fuerte, mobile-first (legado Sirena)**. iOS/Android.
- Features: bandeja con cola + filtro por llegada, multicanal (WA/IG/Messenger), transferencia, quick replies, notas internas, recordatorios, media completa, **notificaciones con tono propio + DND**, **asignación automática de leads**.
- **Joya:** app de ventas conversacionales mobile-first estilo WhatsApp con auto-asignación.
- Debilidades: inestabilidad (mensajes que tardan ~1 día, outages en Brasil), Messenger "no funciona en móvil", iOS percibido inferior, **pobre como CRM, sin threading de mensajes**, búsqueda deficiente. Capterra producto 4.1★ ~359 reseñas.
- Relevancia: valida mobile-first para vendedores LatAm. **Su falta de threading (reply/quote) es hueco explotable.** Tono propio + DND = quick win.

### Cluster C — AI-native / no-code (peers de tesis)

**Manychat · [confianza ALTA]**
- App: **sí, fuerte**. iOS 17+/Android.
- Features: inbox omnicanal (IG/Messenger/WhatsApp/Telegram/SMS/TikTok), push, asignar, filtros Open/Closed + búsqueda por tag/nombre, perfil con tags/custom fields/sequences + notas, **canned responses**, flows. Inbox Pro (pago): auto-assignment + analítica de agentes.
- **Joya:** bandeja omnicanal completa en el bolsillo (no solo lectura).
- Debilidades: ajustes avanzados solo-web, **paridad móvil/web inconsistente** (leads en Contacts pero no en Live Chat), bugs ("an error has occurred"), **4.4★ iOS / 4.03★ Android**.
- Relevancia: empata en amplitud de canales. Lección: definir claramente qué vive solo en web pero garantizar 100% del flujo del AGENTE en móvil.

**Aivo (Aivo Live / Engageware) · [confianza MED]**
- App de agente: **NO / limitada**. Solo web (Chrome/Edge). Las apps "Aivo" en stores son de terceros (agro, TTS).
- **Joya:** copiloto de IA del agente + workspace omnicanal con contexto persistente — **pero todo en web**.
- Debilidades: **sin app nativa de agente**, notificaciones de nueva sesión documentadas como problemáticas, enterprise/caro.
- Relevancia: **OPORTUNIDAD CLARA.** Líder LatAm sin app móvil. Parallly diferencia fuerte con app nativa + push fiable + copiloto IA en el bolsillo.

**Landbot · [confianza MED]**
- App de agente: **NO / limitada**. Web responsive; **pop-ups de notificación solo Desktop**.
- **Joya:** sin joya móvil real. Builder no-code + inbox web.
- Debilidades: sin app nativa, **notificaciones solo desktop = fatal para móvil**, layouts apretados en teléfono, text-only.
- Relevancia: **OPORTUNIDAD CLARA.** Peer AI-native sin push móvil de handoff. Posicionar "cierra deals desde tu teléfono" lo supera de plano.

### Cluster D — Open-source / all-in-one

**Chatwoot · [confianza ALTA]**
- App: **sí, fuerte, open-source RN**. iOS 13.4+/Android 6+/self-hosted.
- Features: shared inbox + snooze, sync cross-device real-time, push + notification inbox, asignar + @mention + notas, **quick replies + macros (one-tap)**, media, **búsqueda unificada (paridad web)**, **AI Assist en composer**, **traducción inline (long-press)**, multi-cuenta/multi-server.
- **Joya:** app open-source que conecta a cualquier server + AI Assist + traducción inline en el composer.
- Debilidades: **push poco fiable/retrasado especialmente en background** (talón de Aquiles), notificación genérica ("conversation #8 assigned"), **datos stale al abrir desde notificación**, **no se puede crear contacto/iniciar conversación desde móvil**, CRM móvil delgado, **2.0★ Android (224 reseñas)** / 4.1★ iOS (13 votos).
- Relevancia: **el más comparable arquitectónicamente** (RN, multicanal, AI Assist, macros). Atacar sus 3 fallos: push fiable, contenido rico de notificación, fix stale-data. **Creación de lead/conversación outbound desde móvil = gap claro de ventas.**

**HubSpot · [confianza MED]**
- App: **sí, fuerte (generalista CRM)**. iOS 17+/Android 10+.
- Features: shared inbox, filtros, comentarios+@mention, cerrar/reasignar/bloquear/mover inbox, snippets+KB+forward, **labels de SLA en preview**, push + sync instantáneo, contexto CRM completo en el reply, llamadas+SMS con logging, **escáner de tarjetas**, **Breeze AI en la app**, pipeline kanban.
- **Joya:** shared inbox omnicanal atado al record CRM completo, con awareness de SLA y sync bidireccional.
- Fortalezas: **4.7★ ~15.000 ratings iOS** (pulido/confianza).
- Debilidades: **Android lento/laggy** (freeze al responder email, lag de teclado), KB solo legacy en móvil, **notification flooding**, drift de plataforma (editar ticket solo Android), inbox no es deleite.
- Relevancia: **SLA en preview = quick win barato y valioso.** Contexto CRM en el reply (Parallly ya lo tiene). Lección: paridad iOS/Android, push deduplicado, performance Android (crítico LatAm).

**Tidio · [confianza MED]**
- App: **sí, fuerte**. iOS 9+/Android 4.1+.
- Features: inbox unificado (chats+tickets+canales), **push con centro de auto-diagnóstico que corrige settings del SO**, quick replies one-tap, **live visitor tracking** (página/país/device), departamentos+routing+cola Unassigned, email-to-ticket.
- **Joya:** inbox all-in-one + **troubleshooter de notificaciones auto-diagnóstico**.
- Debilidades: queja recurrente "**no se puede responder desde móvil**, hay que abrir browser", notificaciones ~50% del tiempo, **lag de teclado 5-10s/letra**, sin CRM/pipeline de ventas móvil.
- Relevancia: el troubleshooter de notificaciones es patrón a copiar. Lección crítica: garantizar que **siempre** se pueda responder desde móvil + teclado ligero.

**Crisp · [confianza MED]**
- App: **sí, fuerte**. iOS/Android/desktop/Vision.
- Features: shared inbox multicanal (WA/Email/IG/Messenger/Telegram/Line), sub-inboxes, asignar, notas privadas, saved replies+borradores, **traducción inline**, edición de mensaje, llamadas audio/video, **Automated Inbox con Hugo AI** (bandeja dedicada IA con marcado de transparencia IA-vs-humano), working hours que silencian fuera de turno.
- **Joya:** Automated Inbox con Hugo — separa conversaciones IA vs humano con transparencia, en móvil.
- Fortalezas: **~4.4★ iOS (517 ratings) / ~4.6★ Android**, UI moderna.
- Debilidades: **push poco fiable (#1)**, móvil recortado del web, sin acciones masivas, límites bajos de archivo, crashes ~cada 60min, cache que ralentiza el dispositivo.
- Relevancia: **el patrón Automated Inbox (IA vs humano transparente) es directamente replicable** y encaja con el modelo handoff de Parallly. Working hours/DND = quick win.

### Cluster E — PWA / sin app nativa

**Trengo · [confianza MED]:** **DEPRECÓ su app nativa → PWA** (Google Play 404). Notificaciones poco fiables, móvil recortado. **Validación fuerte de la apuesta nativa de Parallly: un incumbente se retiró a PWA y fue castigado.**

**Treble.ai · [confianza MED]:** **PWA, WhatsApp-only**, sin stores ni ratings. Push solo si NO estás conectado en otro dispositivo. Permite usar línea corporativa desde celular personal + HSM móvil + sync HubSpot/Salesforce. **Multicanal real + app nativa de Parallly lo supera.**

---

## 6. Matriz comparativa por dimensiones móviles clave

Escala: ● fuerte/maduro · ◐ parcial/con bordes · ○ ausente/débil/stub · — sin app nativa. "Líder" = mejor ejecución del eje según la investigación.

| Dimensión | Parallly | Intercom | Zendesk | Front | respond.io | Wati | Kommo | Zenvia | Manychat | Chatwoot | HubSpot | Tidio | Crisp | Aivo | Landbot | **Líder** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bandeja tiempo real | ● | ◐ | ● | ◐ | ◐ | ◐ | ● | ◐ | ● | ◐ | ● | ◐ | ● | — | — | **Zendesk / Kommo** |
| Chat + media | ◐ (sin envío media) | ◐ | ● | ◐ | ◐ | ◐ | ● | ● | ● | ● | ◐ | ◐ | ● | — | — | **Crisp / Zenvia** |
| CRM móvil (ventas/pipeline) | ◐ (read-only, bug) | ○ | ◐ | ○ | ○ | ○ | **●** | ○ | ◐ | ○ | ● | ○ | ○ | — | — | **Kommo / HubSpot** |
| **IA en el bolsillo** | **●** | ○ | ○ | ○ | ● | ○ | ◐ | ○ | ○ | ● | ◐ (Breeze) | ○ | ● (Hugo) | — (web) | — | **Parallly / Crisp / respond.io** |
| Push + deep-link | ◐ (sin fallback handoff, deep-link roto) | ○ | ● | ● (quick actions) | ◐ | ○ | ● (selectivas) | ◐ (tono+DND) | ◐ | ○ | ◐ (flooding) | ◐ (troubleshooter) | ○ | ○ | ○ | **Zendesk / Front** |
| Offline | ○ | ○ | ◐ | ● (30 días) | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | — | — | **Front** |
| Biometría/seguridad | ● (sin pinning) | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | **Parallly** |
| Multicanal real | ● (WA/IG/Msgr/TG/SMS) | ○ (sin WA/IG) | ● | ● | ● | ○ (WA-only) | ● | ◐ (sin TG/SMS) | ● | ● | ◐ | ◐ | ● | ◐ (web) | ◐ (web) | **Parallly / Zendesk / Manychat** |
| Vertical/terminología | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ○ | **Parallly** |
| Multi-idioma (i18n app) | ○ (hardcoded ES) | ◐ | ◐ | ◐ | ◐ | ● | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | **Wati** |
| UX/pulido (madurez probada) | ◐ (sin tests) | ○ (2.3★) | ● (4.5★) | ◐ (3.5★) | ◐ (pocos votos) | ○ (2.9★) | ◐ (3.1★ And) | ◐ | ● (4.4★) | ◐ (2.0★ And) | ● (4.7★ iOS) | ◐ | ● (4.4-4.6★) | — | — | **HubSpot / Zendesk** |

**Lectura:** Parallly **lidera o co-lidera** en IA-en-el-bolsillo, biometría, multicanal real, vertical. **Empata** en bandeja tiempo real. **Va por detrás** en push fiable (a pesar de la inversión, falta el fallback), offline, i18n, CRM-pipeline maduro y, sobre todo, **UX/pulido *probado*** (no tiene tests ni ratings de tienda que validen estabilidad).

---

## 7. Diagnóstico: dónde estamos a la par, por detrás, y dónde ya somos mejores

### Ya somos mejores (ventajas defendibles)
1. **IA-en-el-bolsillo madura.** Suggest + rewrite (6 tonos) + summary `solid` en móvil. Supera a Zendesk, Intercom, Front, Wati, Zenvia, HubSpot, Tidio (que no lo tienen o es naciente) y a Aivo/Landbot (que no tienen app). Solo respond.io, Crisp y Chatwoot compiten aquí.
2. **Multicanal real (5 canales) en una bandeja.** Vence a Wati/Treble (WA-only), Intercom (sin WA/IG), Zenvia (sin TG/SMS).
3. **Adaptación vertical de terminología** (Citas→Reservas/Pedidos/Consulta). Ningún competidor lo hace.
4. **Biometría + 2FA + device trust + relock 90s** integrados — más completo que el promedio.
5. **Inversión temprana en fiabilidad de conexión** (indicador live + socket eager) — ataca el dolor #1 del mercado.

### A la par (paridad real)
- Bandeja en tiempo real, colaboración (notas/asignación/colisión), canned responses/macros, Contacto 360° inline, dark theme, estados de disponibilidad. Esto es paridad sólida con Zendesk/Manychat/Crisp/Chatwoot.

### Por detrás (riesgos)
1. **Pulido y madurez probados:** cero tests, sin ratings de tienda, sin crash-free rate medido. (Los bugs de "severidad alta" de la auditoría automática resultaron mayormente falsos positivos; el real pendiente es el deep-link por URL y, a confirmar, el fallback de push.) HubSpot (4.7★/15K) y Zendesk (4.5★/4.2K) tienen confianza ganada que Parallly aún debe construir.
2. **Push verdaderamente fiable end-to-end:** el fallback de Expo push en handoff con app cerrada **falta** — hoy Parallly comparte el riesgo que critica.
3. **Offline:** Front ofrece 30 días offline; Parallly nada.
4. **i18n:** Wati y los incumbentes soportan multi-idioma; Parallly está hardcoded en español pese al requisito de 4 idiomas del producto.
5. **CRM/pipeline móvil maduro:** Kommo y HubSpot permiten cerrar el ciclo (editar, mover, crear); Parallly es de **solo-lectura** en móvil (el contrato de API es correcto, pero la UI no permite editar stage/tags/lead). Falta la capa de edición.
6. **Envío de media saliente y reply/quote:** ausente (Zenvia carece de threading, pero la mayoría envía media).

---

## 8. Roadmap priorizado — orientado a PRODUCCIÓN

> Reordenado contra el objetivo de la sección 0: **primero el gate de producción (robustez al nivel de la plataforma), luego paridad, luego diferenciación.** Ninguna feature nueva debe anteponerse al gate.

### GATE 0 — Production-readiness · BLOQUEANTE de GA (no se lanza sin esto)

| Acción | Tipo | Esfuerzo | Por qué es bloqueante |
|---|---|---|---|
| **Integrar Sentry** (crash + perf + release tracking) | Observabilidad | S/M | La plataforma lo exige; hoy estamos ciegos a crashes/latencia en campo. Sin esto no se puede *afirmar* madurez |
| **Suite de tests** (Jest + RN Testing Library; Detox para flujos críticos: auth, socket, push, refresh, error paths) | Calidad | L | Regla de la plataforma (no se hace push sin verificación). Sin tests, cada fix arriesga regresiones invisibles |
| **i18n completo (es/en/pt/fr)** alineado con el dashboard | Paridad de plataforma | L | Regla dura del producto; hoy la app está hardcoded en español |
| **Manejo de errores explícito** (toasts globales, retry UI, eliminar `catch {}` y Promise.all sin manejo) | Robustez | M | Fallos silenciosos = no apto para producción; rompe confianza del agente |
| **Confirmar + cerrar el fallback de Expo push en handoff con app cerrada** + contenido rico de notificación | Fiabilidad | S/M | Es el fallo #1 del mercado; un agente que no recibe el aviso = lead perdido. Núcleo del valor |
| **Resiliencia offline/red** (cola de envío, reintentos, caché local, estado de reconexión accionable) | Robustez | L | LatAm = conectividad variable; sin esto la app falla en el uso real |
| **Reaplicar token a socket vivo** en refresh + cablear `linking` (`parallly://`) | Bug fix | S | Bugs reales confirmados (auth stale; deep-link por URL) |
| **Baseline de seguridad** (cert pinning, sanitizar errores backend, revocar device trust, quitar `console.log` de tokens) | Seguridad | M | Estándar de producción de la plataforma |
| **Baseline de accesibilidad** (labels screen-reader, touch targets ≥44px, dynamic type, contraste) | Inclusión | M | Requisito de pulido/madurez; bloquea tiendas/enterprise |
| **Paginación de timeline + estados (carga/vacío/error) en todas las pantallas** | Robustez/UX | M | Evita leaks y pantallas en blanco; señal de inmadurez si falta |

*Salida del gate = criterio de "Definition of Done para producción". El detalle UX de cada punto se amplía en la Parte 2.*

### P1 — Paridad competitiva (post-gate)

| Acción | Tipo | Impacto | Esfuerzo |
|---|---|---|---|
| **Subida de media saliente** (foto/audio) + reply/quote | Paridad | Med | M |
| **Optimistic updates + retry en envío fallido** | UX | Med | M |
| **CRM editable en móvil** (stage/tags/notas) + colores/terminología desde config del tenant | Paridad ventas | Med | M |
| **Notificaciones configurables por agente** (tono/DND/working hours, estilo Zenvia/Crisp/Wati) + troubleshooter estilo Tidio | Paridad+ | Med | M |
| **SLA / overdue badge en preview de inbox** (estilo HubSpot) | Quick win | Med | S |
| **Quick actions desde el push** (responder/asignar/leído sin abrir, estilo Front) | Diferenciador | Med | M |
| **Caché local / React Query + error boundary** | Robustez | Med | M |

*(Nota: i18n, tests, paginación, error handling, cert pinning, caché y offline se promovieron al GATE 0 por ser bloqueantes de producción según la sección 0.)*

### P2 — Apuestas grandes para SUPERAR (post-paridad)

| Acción | Por qué supera, no solo iguala |
|---|---|
| **"Automated Inbox" estilo Crisp/Hugo pero AI-native de fábrica:** bandeja que separa visualmente conversaciones manejadas por IA vs escaladas a humano, con transparencia | Parallly es AI-native; puede hacerlo mejor que Crisp porque la IA es el core, no un add-on |
| **Takeover de IA con un tap** (pausar bot e intervenir, estilo respond.io) atado al HandoffService/WebSocket existente | Diferenciador directo para ventas conversacionales; encaja con la arquitectura ya construida |
| **Copiloto AI-native ampliado:** "resumen de conversación" + "siguiente mejor acción de venta" + "redactar en es/pt" + traducción inline (estilo Chatwoot) | Aprovecha PromptAssembler+LLMRouter ya existentes; ningún incumbente de soporte lo tiene en móvil |
| **Crear lead + iniciar conversación outbound (HSM/plantilla WhatsApp) desde móvil** | Chatwoot NO puede; Treble sí en web. Para una app de VENTAS es crítico — "cierra deals desde el teléfono" |
| **Mini-pipeline + métricas de agente + mover etapa en móvil** | Supera a Zendesk/Crisp/Tidio (soporte-first, sin pipeline) y empata a Kommo/HubSpot con foco LatAm |
| **Escáner de tarjetas de visita → crea lead** (estilo Kommo/HubSpot) | Feature de bajo coste y alto "wow" para ventas de terreno LatAm; Parallly no lo tiene |
| **Cola offline + acceso a histórico 30 días** (estilo Front) | LatAm tiene conectividad variable; foso real vs PWAs (Trengo/Treble/Landbot) |
| **Publicitar métricas crash-free/latencia** (Sentry ya integrado) como respond.io | Convierte la estabilidad en argumento de venta y de confianza |

**Narrativa de posicionamiento sugerida:** *"La única app de agente AI-native, multicanal y mobile-first para vendedores LatAm — copiloto en el bolsillo, takeover del bot con un tap, y notificaciones que de verdad llegan."* Explota directamente: Aivo/Landbot sin app, Intercom abandonado (2.3★), Trengo en PWA, Wati WhatsApp-only, y el dolor universal de push.

---

## 9. Riesgos y supuestos

**Supuestos clave (a validar):**
- La calidad `solid`/`ok` de la auditoría refleja corrección de código, **no estabilidad runtime probada**. Sin tests ni crash-free rate medido, la confianza en "pulido" es menor a la que sugieren las etiquetas. **Recomendación:** instrumentar Sentry + medir crash-free antes de comunicar madurez.
- El supuesto bug de contrato `moveDeal` **fue verificado y descartado** (coincide con el backend y el dashboard en producción). Lección: las etiquetas de "severidad alta" de la auditoría automática deben verificarse contra el código antes de accionarse — 2 de 4 eran falsos positivos.
- Se asume que HTTPS está forzado en producción (la ausencia de certificate pinning solo es aceptable bajo este supuesto).

**Riesgos de la investigación competitiva (confianza web):**
- **Confianza ALTA:** Intercom, Wati, Manychat, Chatwoot — ratings y features de fuentes primarias (fichas de tienda, docs oficiales).
- **Confianza MED:** Zendesk, Front, respond.io, HubSpot, Kommo, Trengo, Treble, Aivo, Zenvia, Tidio, Crisp, Landbot — algunos con volumen de reseñas bajo (Kommo iOS 12, respond.io 14, Chatwoot iOS 13 → estadísticamente débiles), o cifras de Google Play no extraíbles (rate-limit). **No tratar estos ratings como definitivos.**
- Varios productos cambian rápido (respond.io reescribió composer en mayo 2026; Breeze de HubSpot se fusiona el 30 jun 2026; Crisp v6.8.3 añadió diagnóstico de notificaciones). El panorama puede haber cambiado desde la captura.
- "Aivo no tiene app de agente" y "Landbot solo desktop notifications" son inferencias bien soportadas por docs oficiales pero **no 100% verificables** (señal contraria: phrasing ambiguo de agregadores).

**Riesgos de ejecución del roadmap:**
- Sin tests, cada fix de P0 puede introducir regresiones invisibles. **Mitigación:** añadir tests al menos para socket/auth/push antes de tocar esas áreas.
- El fallback de Expo push depende de infraestructura backend (push-listener); coordinar con el equipo de API para no contar tokens enviados como entregados (bug ya detectado en `push.service.ts`).
- i18n es esfuerzo L y bloquea expansión no-LatAm; priorizarlo según mercado objetivo real.

---

**Conclusión de una línea:** Parallly móvil tiene la *visión correcta y features adelantadas* (IA + multicanal + ventas + vertical) que ningún incumbente combina, pero juega con la *robustez de un MVP*; cerrar los 4 bugs P0 y entregar push verdaderamente fiable convierte una paridad arriesgada en liderazgo defendible en el cluster AI-native/LatAm.

---

Archivos relevantes (rutas relativas al repo, para seguimiento):
- `apps/mobile/App.tsx:44` — **bug real:** falta prop `linking` en `NavigationContainer` (deep-links por URL).
- `apps/mobile/src/lib/push.ts` y `src/navigation/RootNavigator.tsx` — **a confirmar:** alertas local-only / fallback de Expo push en handoff con app cerrada.
- `apps/mobile/src/lib/socket.ts:13-15` — **bug real (med):** token stale en socket vivo si expira a mitad de sesión.
- `apps/mobile/src/lib/api.ts:219` — `moveDeal` (contrato **correcto**, verificado vs `apps/dashboard/src/lib/api.ts:207`).
- `apps/mobile/src/screens/InboxScreen.tsx:74-89` — listeners de socket (cleanup **correcto**, sin fuga).

> Trazabilidad: bugs reales confirmados = deep-link `linking` (med) y token-stale en socket (med). Falsos positivos descartados = `moveDeal` y fuga de listeners. Pendiente de runtime = fallback de push en handoff.


---

# PARTE 2 — UX, USABILIDAD E INTERACCIÓN

> Addendum generado por auditoría UX dedicada (heurísticas Nielsen, flujos JTBD, estados, accesibilidad). **Alineado al objetivo de producción (sección 0):** los hallazgos de fallo silencioso, falta de estados offline/error y accesibilidad ausente **no son cosméticos — son criterios del GATE 0**. El veredicto UX (nivel 2/5 'funcional pero frágil') es coherente con 'feature-complete pero no production-ready'.

# Auditoría App Móvil — Parte 2: UX, usabilidad e interacción

> Addendum al informe `mobile-app-audit` (Parte 1 = inventario de features). Este documento **no** repite el inventario; se centra exclusivamente en UX, usabilidad e interacción de la app móvil Expo/React Native (`apps/mobile/src`, 8 pantallas + navegación). Fecha: 2026-06-02.

---

## 1. Resumen UX

**Veredicto de madurez: nivel 2 de 5 — "Funcional pero frágil".** La app cubre el núcleo reactivo de un agente (inbox en tiempo real, responder con copilot, asignarse/resolver, mover deals, gestionar citas) con un diseño visual limpio, coherente con el sistema de temas y bien espaciado. Donde la app es **sólida**: estética minimalista (Nielsen #8 sin hallazgos críticos en ninguna pantalla), el patrón de copilot IA en el composer (sugerir/reescribir por tono) y el deep-link push→conversación de 2 taps. Pero la base de **fiabilidad percibida es débil**: el manejo de errores es silencioso de forma transversal, no hay estado offline real en ninguna pantalla, no hay optimistic UI ni feedback háptico, y varios *jobs* core de venta proactiva simplemente no existen (adjuntar archivos, reasignar a otro agente, crear lead/cita). La accesibilidad está esencialmente ausente (cero `accessibilityLabel` en toda la app).

La conclusión honesta: la app se siente buena en una demo con buena red, pero castiga al agente real de campo de LatAm (3G variable, una sola mano, en movimiento) exactamente donde más duele.

### Top 5 problemas más severos (por heurística)

| # | Heurística | Problema | Severidad | Alcance |
|---|-----------|----------|-----------|---------|
| 1 | #9 Recuperación de errores | **Fallo silencioso transversal.** Casi todas las llamadas API (send, assign, resolve, moveDeal, setAvailability, cancelAppointment, copilot) no tienen try-catch ni feedback. El agente cree que la acción funcionó cuando falló. | 4 | Todas las pantallas |
| 2 | #5 Prevención de errores | **Cancelación de cita sin protección.** Botón "X" diminuto (26px, sin padding) directamente destructivo; el único freno es un `Alert` descartable. Fat-finger en movimiento = cita perdida sin undo. | 4 | AppointmentsScreen |
| 3 | #1 Visibilidad del estado | **Sin estado offline real ni optimistic UI.** El socket trackea conexión pero no se usa para degradar la UI; mensajes enviados sin red se pierden, sin cola de reintento. | 4 | Transversal (Conversation/Inbox) |
| 4 | #3 Control y libertad | **Sin undo en acciones destructivas** (resolver, cancelar, reescritura IA que pisa el borrador, logout sin confirmación). Una vez disparada la acción, solo recargar ayuda. | 3 | Conversation, Appointments, More |
| 5 | Accesibilidad (transversal) | **Cero soporte de lectores de pantalla.** Ningún `accessibilityLabel` en inputs/botones/iconos; estados solo por color; targets táctiles bajo 44px. | 3-4 | Todas las pantallas |

---

## 2. Evaluación heurística por pantalla

| Pantalla | Nº hallazgos | Severidad máx | Problema principal |
|----------|:---:|:---:|--------------------|
| **LoginScreen** | 16 | 2 | Sin recuperación de contraseña; LockGate sin "cambiar usuario"; errores 2FA genéricos |
| **InboxScreen** | 15 | 3 | Fallo silencioso de `getInbox()`; sin loading en cambio de filtro; búsqueda solo local |
| **ConversationScreen** | 27 | 2-3* | Sin manejo de errores en TODOS los async; sin offline/draft; botón IA contextual no-obvio |
| **CrmScreen / LeadDetail** | 10 | 3 | Sin estados de error; búsqueda sin clear/feedback; quick-actions enterradas (2 taps para llamar) |
| **PipelineScreen** | 22 | 3 | Move sin error handling ni undo; sin gesto drag; misma-etapa no filtrada |
| **AppointmentsScreen** | 11 | 4 | Cancelación accidental (target 26px + sin doble confirmación); sin crear/reprogramar |
| **MoreScreen** | 21 | 3 | Logout sin confirmación; disponibilidad arranca "online" hardcodeada; sin refresh |
| **Navegación (RootNavigator/App)** | 10 | 3 | Pipeline escondido tras icono; sin badge de no leídos en tabs; deep-links solo conversación |

\* Los `top3_fixes` de ConversationScreen marcan severidad 4 para error-handling y offline aunque los hallazgos individuales se listan como 2-3; los tratamos como 4 por su impacto agregado.

---

## 3. Top hallazgos heurísticos accionables (severidad 3-4)

| # | Pantalla | Heurística | Hallazgo | Fix | Ref |
|---|----------|-----------|----------|-----|-----|
| H1 | Appointments | #5 Prevención | Botón cancelar "X" 26px sin padding, solo `Alert` descartable → cancelación accidental en movimiento | Target ≥48×48dp (`paddingHorizontal:12, paddingVertical:10`); doble confirmación con modal destructivo rojo; deshabilitar si status ∈ {completed, cancelled} | AppointmentsScreen.tsx:116-118 |
| H2 | Conversation | #9 Recuperación | `getAiSuggestion`/`copilotRewrite`/`copilotSummary`/`sendMessage`/`assign`/`resolve` sin try-catch → spinner muere, sin feedback | Envolver todo async en try-catch; toast con "Reintentar"; estado de error inline | ConversationScreen.tsx:152-185, 159-165 |
| H3 | Conversation/Inbox | #1 Visibilidad | Estado de socket trackeado (socket.ts:26) pero nunca mostrado en Conversation; sin optimistic UI en envío | Banner de conexión persistente; mensaje optimista con estado "Enviando…/Falló·Reintentar" | ConversationScreen (sin status bar), socket.ts:26-39 |
| H4 | Conversation | #3 Control | Sin undo de reescritura IA (pisa borrador) ni de mensaje enviado; macros irreversibles sin confirmación | Guardar borrador previo y ofrecer "Restaurar"; confirmar macros con side-effects; cancelar durante `aiBusy` | ConversationScreen.tsx:176-185, 290-295 |
| H5 | Inbox | #9 Recuperación | `load()` no captura errores (solo loguea); pull-to-refresh falla en silencio; lista queda stale | Banner dismissible "No se pudieron cargar las conversaciones. ¿Reintentar?" con onRetry | InboxScreen.tsx:64-70 |
| H6 | Inbox | #1 Visibilidad | Cambio de filtro dispara fetch async sin loading → datos viejos hasta que llega respuesta | `setFilterLoading(true)` + dimming/skeleton de la lista durante refetch | InboxScreen.tsx:58, 64-70 |
| H7 | Inbox | #7 Flexibilidad | Búsqueda solo local sobre items cargados, sin debounce ni paginación → no escala a 500+ convos | Búsqueda server-side debounced 300ms + infinite scroll | InboxScreen.tsx:91-94 |
| H8 | Pipeline | #9 + #1 | `api.moveDeal()` sin error handling; `setBusy(false)` corre pase lo que pase → "lo moví" pero el server no | try-catch + toast "Falló. ¿Reintentar?"; mantener modal abierto para reintentar | PipelineScreen.tsx:54-60 |
| H9 | Pipeline | #5 + #3 | Modal muestra la etapa actual entre las opciones; sin confirmación ni undo tras mover | Filtrar etapa actual; toast "Movido a [etapa]" con Undo 5s | PipelineScreen.tsx:97-109 |
| H10 | Pipeline | #7 Flexibilidad | Solo tap-modal para mover; sin drag, sin búsqueda dentro de etapa (50+ deals = scroll infinito) | Long-press + swipe izq/der para ciclar etapas; search bar cuando >20 items | PipelineScreen.tsx:85-93 |
| H11 | CRM/Lead | #3 + #6 | Quick-actions (llamar/email) enterradas en detalle = 2 taps; secundaria de fila inconsistente (company OR phone OR email) | Iconos llamar/email en la fila; swipe-derecha = llamar; normalizar texto secundario | CrmScreen.tsx:64, 68; LeadDetail.tsx:43,48 |
| H12 | CRM/Lead | #9 Recuperación | Sin diferenciar "sin resultados" de "error de red"; "Sin leads." y "No encontrado." genéricos | Mensajes contextuales; botón Retry; toast en fallo de `Linking` con fallback | CrmScreen.tsx:62; LeadDetail.tsx:26 |
| H13 | More | #3 Control | Logout sin confirmación → un tap accidental cierra sesión | `Alert.alert('¿Cerrar sesión?', …, [Cancelar, Cerrar sesión])` | MoreScreen.tsx:87-90 |
| H14 | More | #9 + #1 | `load()` y `setAvailability()` sin try-catch; disponibilidad arranca "online" hardcodeada ignorando server | Cargar estado real al montar; try-catch con revert + toast; offline detection | MoreScreen.tsx:25, 42-45, 27-38 |
| H15 | Nav | #4 + #6 | Pipeline escondido tras icono git-branch en header sin label; inconsistencia de headers entre stacks | Tab dedicada o long-press en CRM; estandarizar headers vía config compartida | RootNavigator.tsx:56-58, 37/84 |
| H16 | Nav | #1 + feature | Sin badge de no leídos en tab de Inbox; sin banner offline global; deep-links solo conversationId | `tabBarBadge` con unreadCount; `<OfflineIndicator/>` global; deep-links a lead/cita/etapa | RootNavigator.tsx:88-93, 112-122 |
| H17 | Login | #3 Control | Sin flujo de recuperar contraseña; usuario sin opción más que contactar soporte | Link "¿Olvidaste tu contraseña?" → pantalla/WebView de reset | LoginScreen.tsx:133-141 |
| H18 | Login | #3 Control | LockGate cubre toda la pantalla sin "cambiar usuario"; en dispositivo compartido el agente queda atrapado | Link "Cambiar usuario" → `logout()`; fallback "Usar contraseña" | App.tsx:24-38 |

---

## 4. Matriz de cobertura de estados

Estados evaluados por pantalla: **Carga · Vacío · Error · Offline · Feedback de éxito**. (✅ present · 🟡 partial · ❌ missing · — n/a)

| Pantalla | Carga | Vacío | Error | Offline | Feedback éxito |
|----------|:---:|:---:|:---:|:---:|:---:|
| LoginScreen | ✅ | — | 🟡 | ❌ | 🟡 |
| InboxScreen | ✅ | ✅ | ❌ | 🟡 | ❌ |
| ConversationScreen | ✅ | 🟡 | ❌ | ❌ | ❌ |
| CrmScreen / LeadDetail | ✅ | 🟡 | ❌ | ❌ | ❌ |
| PipelineScreen | ✅ | 🟡 | ❌ | ❌ | ❌ |
| AppointmentsScreen | ✅ | ✅ | ❌ | ❌ | ❌ |
| MoreScreen | 🟡 | ❌ | ❌ | ❌ | ❌ |
| Navegación (global) | ✅ | 🟡 | 🟡 | ❌ | 🟡 |
| **Cobertura** | **8/8** | **3/8** | **0.5/8** | **0/8** | **0.5/8** |

### Diagnóstico

- **Error handling silencioso transversal (el problema #1 de la app).** 0 de 8 pantallas muestran un estado de error real. Las llamadas fallan, el spinner para, y el agente no se entera. Esto erosiona la confianza más que cualquier bug visible.
- **Offline inexistente (0/8).** Hay infraestructura (`socket.ts` trackea connecting/connected/disconnected; InboxScreen lo muestra parcialmente como dot+texto) pero **nunca se usa para degradar la UI, cachear ni encolar acciones**. Crítico para campo en LatAm con 3G variable.
- **Feedback de éxito casi nulo (0.5/8).** Sin toasts, sin checkmarks, sin haptics. Las acciones se sienten "a ciegas".
- **Vacío parcial-bueno (3/8 completo).** Inbox y Appointments tienen empty state, pero genéricos ("No hay conversaciones." sin distinguir filtro-vacío de error). MoreScreen no tiene empty state para KPIs.
- **Carga: única dimensión sólida (8/8)** pero monótona: `ActivityIndicator` genérico sin contexto ni skeletons en todas partes.

---

## 5. Mapa de fricción por flujo / JTBD

| Job (JTBD) | Soportado | Pasos | Fricción clave | Fix |
|-----------|:---:|:---:|----------------|-----|
| **1. Responder lead nuevo <10s** | 🟡 | ~2 taps | Push con app cerrada depende de EAS/FCM aún no terminado; sin orden por SLA/urgencia; envío optimista sin estado de fallo | Completar EAS+FCM; badge "tiempo de espera" + heads-up; manejar `success:false` con reintento |
| **2. Takeover del bot IA** ⚠️ | 🟡 | variable | **No hay acción explícita "Pausar IA/Tomar control"**; "Devolver IA" solo aparece en handoff; sin banner de quién responde | Toggle "Tomar control/Devolver a IA" siempre visible + banner persistente de estado |
| **3. Mover deal por embudo** | ✅ | 4-5 taps | No edita valor/score/notas; sin tablero arrastrable; sin crear deal nuevo | Editar deal en modal; drag; endpoint POST crear lead/deal |
| **4. Agendar/confirmar/cancelar cita** 🔴 | 🟡 | 1-2 taps | **No se puede CREAR ni REPROGRAMAR** (solo confirm/cancel); horizonte 14 días hardcodeado; sin ligar a contacto | Crear cita (servicio+slot) + reprogramar (PUT start_at); vista calendario |
| **5. Encontrar conversación/contacto pasado** | 🟡 | 1 tap + texto | Búsqueda Inbox SOLO local sobre lo cargado; sin paginación; sin búsqueda dentro del hilo | Búsqueda server-side (como CRM); infinite scroll; buscar en el thread |
| **6. Cambiar disponibilidad** ⚠️ | 🟡 | 2 taps | **Arranca "online" hardcodeada** ignorando server → estado mentiroso; optimista sin manejo de error | Cargar estado real al montar; revertir en fallo de API |
| **7. Enviar foto/cotización/documento** 🔴 | ❌ | — | **No existe.** Composer solo texto; sin ImagePicker/DocumentPicker/cámara/FormData en todo el código | Botón adjuntar (expo-image-picker + cámara) + upload multipart + mensaje tipo image/document |
| **8. Manejar varios canales** | 🟡 | — | **Sin filtro por canal** (solo all/mine/unassigned/handoff); badge de canal 9px decorativo | Segmento/filtro por canal en Inbox |
| **9. Contexto 360° del contacto** | 🟡 | 1 tap | Conversación↔lead son vistas separadas sin navegación cruzada; sin deals/citas en el panel; solo lectura | Unificar conversación↔lead; mostrar deals/citas; editar tags |
| **10. Reasignar/escalar a otro agente** 🔴 | ❌ | — | **"Asignarme" siempre hardcodea user.id**; sin selector de agentes; sin escalar a supervisor | Selector de agentes (GET agentes del tenant); acción de escalar |
| **11. Quick-replies/macros/IA copilot** | ✅ | 1-2 taps | Canned/macros sin feedback si vacíos; IA reemplaza sin confirmación ni undo | Deshacer/editar sugerencia antes de insertar |

### Jobs core rotos o de fricción alta (prioridad de negocio)

🔴 **Críticos para una app de VENTAS** (no soportados): **(7) adjuntar archivos** — un agente no puede enviar una cotización/foto sin salir a WhatsApp nativo y perder el registro; **(10) reasignar/escalar** — imposible pasar un lead a un colega; **(4) crear/reprogramar citas** — solo confirm/cancel; y crear lead/deal nuevo (API móvil read-only para CRM).

⚠️ **Fricciones de fiabilidad que generan desconfianza**: **(6) disponibilidad mentirosa** (arranca "online" siempre), **(2) takeover ambiguo** (el agente no sabe si está silenciando al bot).

---

## 6. Funcionalidades necesarias faltantes (óptica del agente en movimiento)

Priorizadas por impacto en el job-to-be-done de ventas de campo:

| Prioridad | Funcionalidad | Por qué (agente en movimiento) |
|:---:|---------------|-------------------------------|
| **P0** | **Adjuntos salientes** (foto/cámara/documento) | Cerrar una venta exige mandar cotización/foto. Hoy obliga a salir a WhatsApp nativo y perder el hilo. |
| **P0** | **Toggle explícito Tomar control / Devolver a IA** + banner de quién responde | Gesto conversacional core; hoy es ambiguo si enviar un mensaje pausa al bot. |
| **P0** | **Manejo de error + reintento global (toast/snackbar)** | Sin esto el agente confía en acciones que fallaron en silencio. Tabla de apuestas. |
| **P0** | **Estado offline + cola de envío** (cachear hilos recientes, reintentar al reconectar) | 3G variable en LatAm; mensajes hoy se pierden sin red. |
| **P1** | **Reasignar a otro agente / escalar a supervisor** (selector de agentes) | Trabajo de equipo en piso de ventas; imposible hoy. |
| **P1** | **Crear/reprogramar cita** (selector servicio + slot) | No-show reduction y captura en campo. |
| **P1** | **Crear lead/deal desde el móvil** (POST) | Captura de prospecto en persona; API hoy read-only. |
| **P1** | **Cargar disponibilidad real del server** + auto-away/working-hours | Estado actual miente; flooding fuera de turno. |
| **P1** | **Filtro por canal** en Inbox + filtro "no leídos" | Triaje multicanal; hoy imposible ver solo WhatsApp. |
| **P1** | **Badge de no leídos en tab + payload rico de push** (nombre+canal+preview) | Priorización al vistazo; evita pantalla en blanco al abrir. |
| **P2** | **Recordatorios de cita al cliente** (SMS/WhatsApp 30min antes) | Reducción de no-shows. |
| **P2** | **Navegación cruzada conversación↔lead** + editar tags/datos | Contexto 360° fragmentado en vistas separadas. |
| **P2** | **Búsqueda server-side + paginación** (Inbox y dentro del hilo) | No escala a 500+ conversaciones. |
| **P2** | **Recuperación de contraseña** + "cambiar usuario" en LockGate | Bloqueos sin salida en dispositivo compartido. |
| **P3** | **Editar valor/score/notas del deal** en el modal de movimiento | Pipeline hoy es mover-etapa-y-nada-más. |
| **P3** | **Reply/quote estilo WhatsApp** en el timeline | Desambiguar hilos rápidos multicanal. |

---

## 7. Micro-interacciones y feedback

La app es **plana**: las acciones cambian de estado instantáneamente, sin transición, sin tacto, sin recompensa visual. Recomendaciones concretas:

| Área | Estado actual | Recomendación |
|------|--------------|---------------|
| **Haptics** | Ausente en toda la app | `Haptics.selectionAsync()` en cambio de filtro/tap de fila; `notificationAsync(Success)` al enviar/asignar/resolver/mover; `notificationAsync(Error)` en fallo. Crítico para agente con manos ocupadas/ambiente ruidoso. |
| **Optimistic UI** | Inexistente; se espera a la API y se recarga | Enviar mensaje → aparece inmediatamente como "Enviando…" → confirma o "Falló·Reintentar". Mismo patrón en assign/resolve/move. Esto solo arregla ~60% de la lentitud percibida. |
| **Toasts/Snackbar** | No existe sistema global | Componente compartido `<Toast/>` para éxito y error en TODAS las pantallas. Hoy unas usan `Alert.alert`, otras fallan en silencio. |
| **Undo** | Ausente | Toast con "Deshacer" (5s) tras resolver, cancelar cita, mover deal, logout. Requiere soft-delete/rollback en backend para algunas. |
| **Transiciones** | Swaps abruptos (Login↔2FA, tabs, modales) | Fade/slide entre Login y 2FA; transición de tab con highlight animado; sheets con reveal suave + swipe-down para cerrar. |
| **Skeletons** | Solo `ActivityIndicator` genérico | Skeleton shimmer que imita el layout (filas de inbox, grid de KPIs, burbujas). |
| **Estado de error visual** | Texto rojo estático | Shake en error de código 2FA; pulse en el banner de handoff para llamar la atención. |
| **Pull-to-refresh** | Funciona pero sin recompensa | Animación de "Soltá para actualizar" + checkmark/toast al completar + haptic. |
| **Press feedback** | Solo cambio de color en algunos | `Pressable` con scale/opacity en chips de filtro, filas, botones. |
| **Scroll-to-bottom** | Sin indicador de mensajes nuevos | Botón flotante "↓ nuevos mensajes" cuando llega mensaje fuera de vista. |

---

## 8. Accesibilidad

**Estado: crítico — la app es esencialmente inutilizable con lector de pantalla.** Esto es un riesgo legal y de inclusión, no solo un "nice-to-have".

| Dimensión | Estado | Fix |
|-----------|:---:|-----|
| **Labels para lectores de pantalla** | ❌ Cero `accessibilityLabel` en inputs, botones, iconos en TODAS las pantallas | Añadir `accessibilityLabel`/`accessibilityHint`/`accessibilityRole` a cada elemento interactivo. Prioridad: 2FA en Login, action bar de Conversation, botones confirm/cancel de Appointments. |
| **Anuncios de estado/error** | ❌ El texto de error cambia pero no se anuncia | `accessibilityLiveRegion="polite"` en banners de error y resultados de búsqueda; en ActivityIndicator `accessibilityLabel="Cargando…"` + `role="progressbar"`. |
| **Targets táctiles** | 🟡 Varios bajo 44px (X de búsqueda Inbox ~24px; iconos cita 26px; logout 18px; dots de etapa 10px) | Mínimo 44×44dp (WCAG AAA / Apple HIG). Envolver iconos en `TouchableOpacity` con padding. |
| **Contraste** | 🟡 `theme.text` sobre `bgCard` ~12:1 (OK), pero `theme.textSecondary (#9898b0)` sobre `bg (#0a0a12)` ~3.5:1 — **falla WCAG AA** para texto pequeño | Subir el secundario o aumentar tamaño; verificar avatar 33% alpha (~2.5:1, falla). |
| **Color como único indicador** | ❌ Estado de conexión (dot verde/rojo), badges de etapa, badges de cita, error 2FA — todo por color | Añadir icono + texto: checkmark/hourglass en badges; texto en dot de estado. Daltónicos no distinguen hoy. |
| **Dynamic Type** | ❌ Tamaños fijos en px, no escalan con ajuste del sistema | Usar escala relativa / respetar `fontScale`. |
| **Estructura semántica** | ❌ Sin landmarks; FlatList sin `accessibilityRole="list"`; modales sin `role="dialog"` | Marcar listas, diálogos y secciones; gestionar foco al abrir pantallas/sheets. |
| **Reduced motion** | ❌ Sin check de `prefers-reduced-motion` | Respetar la preferencia antes de animar scroll/modales. |

---

## 9. Arquitectura de información y navegación

- **Pipeline está escondido y es un usability trap.** Vive tras un icono `git-branch` en el header de CRM (RootNavigator:56-58), sin label, sin tooltip. Para un flujo CRM-céntrico de ventas, el agente no lo descubre. → Tab dedicada (o long-press en la tab CRM como quick-action).
- **"Más" es un cajón de sastre que no escala.** Mezcla disponibilidad (crítico, frecuente), KPIs (secundario) y logout (peligroso) con igual peso visual. → Jerarquía: separar disponibilidad arriba con más whitespace; mover KPIs a su sección; confirmar logout.
- **4 tabs en el límite de usabilidad** (Inbox/CRM/Citas/Más) en pantallas de 5.4". Aceptable pero probar en SE/dispositivos pequeños para que no se corten.
- **Sin badge de no leídos en tabs** — el agente debe abrir Inbox para saber si llegó algo. Estándar móvil ausente.
- **Inconsistencia de headers entre stacks** (stacks anidados tienen header; MainTabs `headerShown:false`). Estandarizar vía config compartida.
- **Vistas que deberían estar enlazadas no lo están**: conversación↔lead CRM del mismo contacto, cita↔contacto. El agente no puede saltar entre contextos del mismo cliente.
- **Sin persistencia de estado de navegación** ni de filtros de búsqueda al cambiar de tab. Si la app crashea, vuelve a login en lugar de retomar.
- **Deep-links solo soportan `conversationId`** (RootNavigator:112-122); no hay a lead/cita/etapa, limitando shortcuts y compartir.

---

## 10. Patrones de competidores a adoptar

| Patrón | De quién | Por qué (para Parallly) | Esfuerzo |
|--------|----------|-------------------------|:---:|
| **Quick-reply / mark-read / assign desde la notificación push** | Front | Responder a lead caliente desde la pantalla de bloqueo en 1-2s, sin cold-start ni pantalla en blanco. El JTBD de mayor ROI para agente móvil LatAm. Encaja con OutboundQueueService + Expo push. | M |
| **Toggle "Tomar control / Devolver a IA" en la conversación** | Respond.io, Kommo, Landbot | Cierra el hueco crítico del job #2 (takeover ambiguo). La arquitectura handoff/persona ya existe; solo falta el control móvil + endpoint para flipear el estado. | M |
| **Tab "Inbox Automatizado" (IA vs humano) + badge de autoría por mensaje** | Crisp (Hugo) | Surfacea el flag `isAiHandled` ya existente; transparencia y triaje; muestra el posicionamiento AI-native. | M |
| **Swipe-actions en filas del inbox (assign/resolve/tag) + optimistic + toast** | Front, Chatwoot/Manychat | Triaje rápido y táctil; ataca directamente el gap de "sin optimistic UI" señalado en la auditoría. | M |
| **Notificaciones por-agente: tono, toggles por evento, DND/horario** | Zenvia, Kommo, Crisp | Hoy se hace broadcast de handoff a todos sin importar disponibilidad; combate fatiga de notificaciones respetando off-shift. Barato sobre el token Expo + toggle de disponibilidad existente. | M |
| **Payload rico de push: nombre + icono de canal + preview** | Chatwoot (su debilidad), HubSpot | El agente decide si actuar antes de abrir; reduce el problema de pantalla-en-blanco-al-tap. Cambio pequeño en el send del push. | S |
| **Troubleshooter de notificaciones auto-diagnóstico** | Tidio | Detecta permisos OS mal configurados/token no registrado/socket caído con deep-link a ajustes. Previene el silent-miss que hunde ratings. Casi todo client-side. | S |
| **Indicador SLA / respuesta vencida en la fila del inbox** | HubSpot | Triaje por urgencia al vistazo; refuerza la propuesta de velocidad de respuesta. Badge client-side con timestamps que la app ya recibe. | S |
| **Split "Para mí" vs "Sin asignar"** | Intercom, Tidio | Modelo de triaje probado; mapea sobre multi-agent + handoff-to-pool. Casi todo client-side sobre datos ya cargados. | S |
| **Reply/quote estilo WhatsApp en el chat del agente** | Zenvia (su debilidad #1) | Desambigua a qué mensaje responde el cliente; matchea el modelo mental WhatsApp de LatAm. | M |
| **AI Assist inline en composer + traducción on-device** | Respond.io, Chatwoot, HubSpot Breeze | Mejora discoverability del copilot (hoy no-obvio) y suma traducción aprovechando LLMRouter + i18n es/en/pt/fr. | M |
| **Scanner de tarjeta de visita (OCR → lead)** | Kommo (amoCRM) | "Wow" diferenciador para venta de campo presencial LatAm; crea contacto/deal y arranca outbound. | L |
| **Crear contacto/lead + iniciar outbound + enviar plantilla HSM** | Chatwoot (no puede), Treble.ai | App es read-only para CRM; poder crear lead e iniciar conversación (y reabrir ventana 24h con HSM) es un wedge concreto. | L |
| **Acceso offline a hilos recientes + cola de envío con reintento** | Front (offline 30 días) | Previene la pérdida silenciosa de mensajes sin red — el fallo que hunde ratings de competidores. Necesita persistencia local (AsyncStorage/SQLite) + flush al reconectar. | L |

---

## 11. Backlog UX priorizado

### Quick wins — esfuerzo S, alto impacto (sprint 1-2)

| # | Item | Pantalla(s) | Impacto |
|---|------|-------------|---------|
| QW1 | **Confirmación de logout** (`Alert.alert` con Cancelar/Cerrar sesión) | MoreScreen | Previene cierre accidental — gap catastrófico, fix de minutos |
| QW2 | **Agrandar target de cancelar cita a ≥48px + doble confirmación** | Appointments | Elimina el hallazgo severidad-4 más grave |
| QW3 | **Cargar disponibilidad real del server al montar** (eliminar "online" hardcodeado) | MoreScreen | Deja de mentir sobre el estado del agente |
| QW4 | **Filtro "no leídos" + filtro por canal** (chips adicionales) | Inbox | Triaje multicanal, gap de job #8 |
| QW5 | **Badge de no leídos en tab de Inbox** (`tabBarBadge` con unreadCount) | Navegación | Estándar móvil ausente |
| QW6 | **Botón Pipeline visible** (tab o long-press CRM) en vez de icono escondido | Navegación | Descubribilidad |
| QW7 | **Clear button persistente + spinner durante debounce + conteo de resultados** en búsqueda | CRM | Feedback de búsqueda |
| QW8 | **Empty states contextuales** ("Sin resultados para X / Cambia el filtro" vs "sin datos") | Inbox, CRM, Pipeline | Distinguir vacío de error |
| QW9 | **Haptics en acciones clave** (`Haptics.selectionAsync`/`notificationAsync`) | Transversal | Confirmación táctil, librería ya disponible en Expo |
| QW10 | **Link "¿Olvidaste tu contraseña?"** | Login | Recuperación de cuenta |
| QW11 | **Indicador SLA/espera** en fila del inbox (badge por timestamp) | Inbox | Triaje por urgencia |

### Estructural — esfuerzo M/L (roadmap)

| # | Item | Esf. | Impacto |
|---|------|:---:|---------|
| ST1 | **Sistema global de Toast/Snackbar + try-catch en TODOS los async** con "Reintentar" | M | Arregla el problema #1 (fallo silencioso, 0/8 error states). Base para todo lo demás. |
| ST2 | **Optimistic UI** en envío de mensaje, assign, resolve, moveDeal (con estado pending/error) | M | Arregla ~60% de la lentitud percibida + feedback de éxito |
| ST3 | **Offline real**: cachear hilos recientes (AsyncStorage/SQLite) + cola de envío con reintento al reconectar + banner offline global | L | Tabla de apuestas para campo LatAm; previene pérdida de datos |
| ST4 | **Adjuntos salientes** (expo-image-picker + cámara + upload multipart + mensaje image/document) | L | Desbloquea job #7 (vender = mandar cotización) |
| ST5 | **Toggle Tomar control / Devolver a IA siempre visible + banner de autoría** | M | Desbloquea job #2 (takeover) |
| ST6 | **Reasignar a otro agente + escalar a supervisor** (selector de agentes vía GET tenant) | M | Desbloquea job #10 (trabajo de equipo) |
| ST7 | **Crear/reprogramar cita** (selector servicio+slot) + **crear lead/deal** (POST) | L | Desbloquea jobs #4 y captura de campo; convierte la app de read-only a productiva |
| ST8 | **Búsqueda server-side + paginación** (Inbox y dentro del hilo) | M | Escala a 500+ conversaciones |
| ST9 | **Swipe-actions + undo toast** en filas de inbox/cita/pipeline | M | Ergonomía móvil-nativa |
| ST10 | **Remediación de accesibilidad** (labels, roles, live regions, targets, contraste, dynamic type) | M | Inclusión + riesgo legal; transversal |
| ST11 | **Quick-actions desde notificación push + payload rico** | M | El JTBD de mayor ROI (responder <10s desde lock screen) |
| ST12 | **Drag/swipe para mover deals** en Pipeline + búsqueda dentro de etapa | M | Eficiencia de campo (una mano) |
| ST13 | **Navegación cruzada conversación↔lead + editar tags/datos del contacto** | M | Contexto 360° unificado |
| ST14 | **Skeletons + transiciones** (fade/slide entre pantallas y sheets) | M | Pulido percibido |

**Secuencia recomendada**: ST1 (toasts+error handling) es prerequisito de casi todo y debe ir primero junto con los Quick Wins QW1-QW3 (fixes de seguridad/confianza de minutos). Luego ST2 (optimistic) y ST3 (offline) que juntos resuelven la fragilidad de fiabilidad. Después los desbloqueos de jobs core (ST4-ST7). Accesibilidad (ST10) puede correr en paralelo como tarea transversal continua.

---

Archivos fuente auditados (todos en `C:\Users\Nipko-lab\Desktop\projects\sales-structure\apps\mobile\src\`): `screens\LoginScreen.tsx`, `screens\InboxScreen.tsx`, `screens\ConversationScreen.tsx`, `screens\CrmScreen.tsx`, `screens\LeadDetailScreen.tsx`, `screens\PipelineScreen.tsx`, `screens\AppointmentsScreen.tsx`, `screens\MoreScreen.tsx`, `navigation\RootNavigator.tsx`, `App.tsx`, `lib\socket.ts`, `lib\push.ts`, `lib\api.ts`, `contexts\AuthContext.tsx`.


# PARTE 3 — COBERTURA PLATAFORMA → MÓVIL

> Addendum generado por un mapeo capacidad-por-capacidad de **TODOS** los dominios de la plataforma Parallly (conversaciones, IA/conocimiento, handoff/consola, CRM, pipeline, citas, plantillas/media/campañas, analítica/BI, facturación/planes/offboarding, canales/onboarding, admin/verticales, notificaciones tiempo real) contra su relevancia para el agente **en movimiento**. **Alineado al objetivo de producción (sección 0):** esto NO es paridad total con el web — el web sigue siendo el centro de control. La pregunta que responde esta parte es concreta: *de todo lo que hace la plataforma, ¿qué necesita el agente en el teléfono y qué ya está cubierto?*

---

> **⚠️ Corrección tras verificación en código (jun 2026).** Tres gaps que este mapeo automático marcó como faltantes/parciales resultaron **ya implementados y cableados** al revisar el código real: (1) **Estado de agente** existe y funciona (`MoreScreen.tsx:9-13,42-44` → `api.setAvailability`, URL correcta; estados online/away/offline); (2) **Copiloto** está cableado de verdad (`ConversationScreen.tsx:154,171,180`), no es stub; (3) **Acciones de cierre** (assign/resolve/return-a-IA) llaman APIs reales (`ConversationScreen.tsx:125,131,137`). El bloqueante real **no es construir estas features sino su robustez** (ninguna tiene manejo de error: muestran éxito aunque la API falle). Refuerza la tesis: el GATE 0 es endurecimiento, no construcción. Checklist ejecutable en `docs/mobile-gate0-checklist.md`.

## 1. Resumen de cobertura

**Veredicto honesto:** la app cubre **bien lo que más importa** (el núcleo de conversación en tiempo real: inbox, hilo, responder, asignar, resolver, push, sync, auth, contexto 360°), pero el resto del valor móvil-relevante está mayormente **a medias** — el dato existe en el backend y a veces se muestra, pero la *acción* del agente o la *superficie de UI* falta. No hay un agujero arquitectural grande: hay muchas integraciones de "última milla" sin cablear.

De **141 capacidades clasificadas como `core-mobile`** en los 12 dominios:

| Estado en móvil | Capacidades core-mobile | % | Lectura |
|---|---:|---:|---|
| **`yes` (sólida)** | 37 | 26% | El núcleo de conversación/notificaciones/auth está aquí y aguanta producción para su alcance. |
| **`partial` (a medias)** | 78 | 55% | El backend lo provee; el móvil lo muestra parcialmente o no expone la acción. **Aquí vive casi toda la deuda accionable.** |
| **`no` (ausente)** | 26 | 18% | Capacidad relevante para campo que el móvil no toca todavía. |

- **Cobertura de valor ponderada** (`yes`=1, `partial`=0.5): **~54%** del valor móvil-relevante de la plataforma ya está cubierto. El 46% restante es trabajo de **cableado y acción**, no de arquitectura nueva.
- **Foco en lo bloqueante (GATE):** de las **40 capacidades core marcadas `gate`**, **21 están sólidas (`yes`)**, **16 a medias** y **3 ausentes** → **~72% del valor del gate ya cubierto**. Lo `partial`/`no` del gate es exactamente lo que el GATE 0 de la Parte 1 ya enumera (manejo de errores, push fiable end-to-end, status del agente, toma de control).
- **Matiz importante sobre los `partial`:** una porción grande de los `partial` (canales, IA, normalización de mensajes) son "transparentes" — el backend ya entrega el resultado al móvil vía WebSocket y el agente lo consume sin saber el canal/modelo. Eso **no es deuda**: es la arquitectura correcta (móvil = consumidor del resultado). La deuda *real* son los `partial`/`no` donde falta una **acción del agente** o un **indicador visible** (status, toma de control, mover etapa, plantillas HSM, badges SLA/canal).

**Conclusión:** el alcance está bien elegido. No falta "media plataforma" en el móvil; falta **rematar el subconjunto correcto** y subir ~30 capacidades de `partial`→`yes`. El esfuerzo de producción se concentra en el GATE 0 (robustez) + un puñado de acciones de campo, no en clonar el web.

---

## 2. Matriz maestra de cobertura

Una fila por capacidad **core-mobile** y **oportunista**. Las **web-only** se agrupan al final por dominio (resumen) para no inflar la tabla — su detalle vive en el JSON de mapeo y en la sección 4.

Leyenda estado: ✅ `yes` sólida · 🟡 `partial` a medias · ⬜ `no` ausente · ⭐ oportunista (diferenciador).

### 2.1 Conversaciones / mensajería + IA-conocimiento (núcleo del agente)

| Capacidad | Relev. | Estado | Gap que importa |
|---|:---:|:---:|---|
| Inbox con filtros (all/mine/unassigned/handoff) | core | ✅ | — (sólido). Falta solo paginación server-side a escala |
| Detalle de conversación (hilo + notas + metadata) | core | ✅ | — |
| Enviar mensaje (outbound vía canal) | core | ✅ | — |
| Nota interna | core | ✅ | — |
| Asignarme conversación | core | ✅ | Falta selector de otro agente / reasignar |
| Resolver conversación | core | ✅ | — |
| Push + WebSocket tiempo real (sync/notif) | core | ✅ | — (core del valor, sólido) |
| Auth + sesión (JWT refresh, device trust, 2FA) | core | ✅ | — |
| Contacto 360° (tel/email/LTV/tags + acciones) | core | ✅ | — |
| Respuestas rápidas (canned) | core | ✅ | UX del modal mejorable |
| Macros (acciones multi-paso) | core | ✅ | UX mejorable |
| Copiloto: sugerir / reescribir tono / resumen | core | ✅/🟡 | En conversaciones implementado; en algunas pantallas el endpoint no se llama (labels hardcoded) |
| Composición + tonos IA del borrador | core | ✅ | — |
| Búsqueda/filtro de inbox | core | ✅ | Es client-side; falta búsqueda server-side >100 items |
| Detección de colisión (viewers simultáneos) | core | 🟡 | Implementado en conversación; útil sobre todo vs web |
| ConversationsService (orquestación) | core | 🟡 | Backend-only por diseño (mutex, idempotencia, 3-fase). Móvil pasivo = correcto |
| HandoffService (escalada skill-based) | core | 🟡 | Móvil recibe el handoff; falta ver razón/árbol y reasignar |
| Identidad unificada (perfil cross-canal) | core | 🟡 | Muestra el perfil; falta ver canales y sugerir/aprobar merge |
| BookingEngine (estado de reserva) | core | 🟡 | Móvil ve el estado; no puede editar/saltar pasos (backend-only ok) |
| Manejo de media entrante (img/audio/doc) | core | 🟡 | Muestra; falta **subir** media saliente (cámara/galería) |
| Integración CRM en el contexto del chat | core | 🟡 | Falta ver score calculado y "mover a etapa" desde el chat |
| Reapertura por respuesta del cliente | core | 🟡 | No hay listener `conversation:reopened` |
| **Estado del agente (online/away/DND)** | core | ⬜ | **No existe toggle**; sin él el routing auto-asigna a agentes no disponibles |
| Reabrir conversación resuelta | core | ⬜ | No hay botón reopen |
| Snooze conversación | ⭐ | ⬜ | Diferenciador: snooze con fecha/hora nativa |

### 2.2 Handoff / consola de agente

| Capacidad | Relev. | Estado | Gap que importa |
|---|:---:|:---:|---|
| Resumen IA del handoff (tema/contexto/razón) | core | 🟡 | El agente no debe leer 50 mensajes; mostrar arriba colapsable |
| Razón de handoff (frustración/explícito/timeout) | core | 🟡 | Badge de color para context-switch emocional |
| Historial de mensajes (recientes + paginado) | core | 🟡 | Recientes ok; falta "cargar más" |
| Conciencia de canal (WA/Email/SMS/Telegram) | core | 🟡 | Falta indicador de canal + composer adaptado (contador SMS) |
| Lead score + atributos CRM en el perfil | core | 🟡 | Mostrar score + 2-3 custom fields inline |
| Eventos WebSocket (handoff/escalation/collision) | core | 🟡 | Conectado; faltan handlers cableados a UI/badges |
| Escalada SLA a supervisor (>5min) | core | 🟡 | Badge + sonido; backend ya dispara el evento |
| Asignar (skill-based + override manual) | core | 🟡 | Falta one-tap "tomar" + reasignar a colega (supervisor) |
| Devolver a IA (return-to-bot) | core | 🟡 | Endpoint existe; sin UI |
| Acceso por rol (agente vs supervisor) | core | ⬜ | UX de supervisor (ver equipo + badge SLA) no diferenciada |
| Reabrir conversación resuelta | core | ⬜ | Edge case común en chat |
| Sugerencia IA de respuesta (copilot draft) | ⭐ | 🟡 | Endpoint existe; sin UI de "aceptar sugerencia" |
| Toma de control / ver "X está viendo" (collision) | ⭐ | ⬜ | Raro en móvil (1 agente=1 pantalla); nice-to-have |

### 2.3 CRM + pipeline de ventas

| Capacidad | Relev. | Estado | Gap que importa |
|---|:---:|:---:|---|
| Lista + búsqueda de leads | core | ✅ | — |
| Kanban de oportunidades (ver + mover deal) | core | ✅ | Mover por modal (sin drag nativo); aceptable |
| Lead 360° (datos, opps, tags) | core | 🟡 | Falta timeline, custom attrs, desglose de score |
| **Cambiar etapa del lead** (pipeline) | core | 🟡 | Pipeline muestra deals, no leads; falta cambiar etapa desde Lead Detail |
| Editar tags del lead | core | 🟡 | Muestra pero no edita; selector de chips |
| Identidad/contacto 360° (canales + merge) | core | 🟡 | Mostrar canales; opción merge |
| Notas de lead (crear) | core | ⬜ | Falta nota rápida con timestamp |
| Tareas / follow-ups (crear + marcar done) | core | ⬜ | Lista de tasks del agente + notificación |
| Timeline de actividad del lead | core | ⬜ | Scrollable en Lead Detail |
| Archivar / restaurar lead | core | ⬜ | Swipe-to-archive nativo |
| **Crear deal** (desde chat/contacto) | core | ⬜ | Modal de creación rápida |
| **Detalle de deal** (contexto completo) | core | ⬜ | Al tocar card: actividades, score, historial, notas |
| Asignar deal a agente | core | ⬜ | Picker en deal detail |
| Resolver deal (ganado/perdido + razón) | core | 🟡 | Diálogo de razón de pérdida rápido |
| SLA: violaciones / at-risk / countdown | core | ⬜ | Badges rojo/amarillo + "⏱ 3h 24m" en card |
| Reglas de transición de etapa (validación) | core | ⬜ | Mostrar diálogo cuando una regla falla |
| Conversación↔deal vinculados | core | 🟡 | Tap para saltar al hilo origen |
| Info de contacto en card (tel/email/última act.) | core | 🟡 | Tel visible con botón llamar/WhatsApp |
| Notas de deal | core | ⬜ | Campo de texto en detail |
| Fecha estimada de cierre (picker) | core | ⬜ | Date picker nativo |
| Sync deal desde conversación (auto) | core | 🟡 | Backend lo hace; mostrar toast "Deal creado" |
| Notas/edición de deal, probabilidad, días-en-etapa, tags | ⭐ | ⬜ | Diferenciadores de detalle (slider, badges, OCR recibo) |
| Quick actions desde card (call/WA/oferta) | ⭐ | ⬜ | Botones flotantes (Linking) |
| Crear/editar lead inline, scoring inline, AI insight, leaderboard, segmentos (lectura) | ⭐ | ⬜ | Captura de campo + gamificación + copiloto CRM |

### 2.4 Citas / calendario

| Capacidad | Relev. | Estado | Gap que importa |
|---|:---:|:---:|---|
| Listar citas próximas | core | ✅ | — |
| Confirmar cita | core | ✅ | — |
| Cancelar cita con razón | core | ✅ | — (subir target táctil — ver Parte 2) |
| Detección de doble-booking (al reprogramar) | core | 🟡 | Lógica server; móvil la consume vía slots |
| Ver detalle de cita | core | 🟡 | Expandir cliente/servicio/ubicación/notas |
| Reprogramar a otro horario | core | ⬜ | Listar slots libres + validar + confirmar |
| Ver disponibilidad de slots | core | ⬜ | Esencial para reprogramar/confirmar hora |
| Verificar slots (tool AI reutilizada) | core | ⬜ | Misma llamada que el bot, para el agente humano |
| Crear cita manual, ver serie recurrente, eventos calendario externo, link Meet/Teams | ⭐ | ⬜/🟡 | Diferenciadores (crear en movimiento, ocupaciones en vivo, compartir link) |

### 2.5 Plantillas / media / canales

| Capacidad | Relev. | Estado | Gap que importa |
|---|:---:|:---:|---|
| Recepción/ingesta de media de clientes | core | ✅ | — (pasivo, ya funciona) |
| **Enviar plantilla WhatsApp (HSM)** | core | 🟡 | Falta UI select+preview+params dinámicos en 3 taps |
| **Enviar media saliente** (cámara/galería) | core | 🟡 | Endpoint existe; móvil no lo usa |
| Enviar texto por canal | core | 🟡 | Responde por UI; no integra endpoint específico de canal |
| Enviar ubicación (GPS nativo) | core | 🟡 | Diferenciador: compartir punto de encuentro |
| Descarga/servido de media en el hilo | core | 🟡 | Muestra thumbs; depende de URL hardcoded |
| Estado del canal (conectado/calidad/tier) | core | 🟡 | Indicador en un dashboard de "mis canales" |
| Recepción IG/Messenger/Telegram/SMS/Email | core | 🟡 | Transparente; falta diferenciar canal en UI |
| Enrutamiento por canal / coexistencia multicanal | core | 🟡 | Móvil ve el resultado; no el canal específico |
| Mensaje interactivo (botones/listas), transcripción/visión, salud de canal | ⭐ | ⬜ | Diferenciadores (builder simple, transcripción inline, alertas de token) |

### 2.6 Analítica / facturación / admin-verticales / notificaciones

| Capacidad | Relev. | Estado | Gap que importa |
|---|:---:|:---:|---|
| KPIs overview (resolución IA, verificada, convs) | core | 🟡 | Muestra 3 de 6; falta comparación de período |
| AI metrics (resolución, contención, **costo/día**) | core | 🟡 | Mostrar costo + alerta si supera presupuesto |
| Resolución verificada (calidad) | core | 🟡 | Ya en MoreScreen; añadir trend 7d |
| Tasa resolución IA + trend por canal | core | 🟡 | Trend simple "hoy vs ayer" |
| Real-time (convs activas, agentes online, queue) | core | 🟡 | Badge "queue: 3 pending, 2 agents online" |
| Agent overview / ranking propio | core | 🟡 | "Tú: rank 2/5, 84%" — self-aware, motivacional |
| Estado de suscripción / restricción (past_due/expired) | core | 🟡 | Banner soft-lock; no hard-block mid-conversación |
| Uso de cuota de plan (mensajes IA/agentes/media) | core | 🟡 | Barra de uso al acercarse al límite + sugerir upgrade |
| Gating por plan / state machine de suscripción / período de gracia | core | 🟡/⬜ | Detectar tier y degradar UI con gracia |
| Terminología vertical (Pacientes/Reservas/Propiedades) | core | 🟡 | verticalConfig cargado; labels de nav y CRM aún hardcoded |
| Labels de navegación dinámicos por vertical | core | 🟡 | `Navigation.tsx` no usa `useVerticalTerms()` |
| KPIs de dashboard adaptados al vertical | core | 🟡 | MoreScreen muestra stats genéricos |
| Skill tags / capacidad del agente (lectura) | core | 🟡 | Ve capacidad; no edita (web-only ok) |
| Etapas de pipeline / config vertical (lectura) | core | 🟡 | Lee etapas; falta color/reorder (reorder = web) |
| Timezone / horario de negocio (contexto) | core | 🟡 | Usado en render; sin banner "cerrado, respondemos 9am" ni override |
| Push handoff/SLA/mensaje + tokens + dedup + deep-link + routing por rol/usuario + status socket + circuit-breaker token | core | ✅ | Núcleo de notificaciones **sólido** |
| Notif. de cita agendada / suscripción dinámica del socket | core | 🟡 | Recibe; no abre AppointmentsScreen ni hay reminders en móvil |
| Notif. local en foreground; AI usage dashboard; vacation rental / staff scheduling / vehicle inventory; company card; CSAT; appointment analytics; response-time SLA en vivo; broadcast funnel; notif. deal-moved/score-change | ⭐ | 🟡/⬜ | Diferenciadores de campo (ver §5) |

### 2.7 Resumen de capacidades **web-only** (fuera de alcance a propósito)

No van al móvil por diseño; el web es el centro de control. Agrupadas por dominio (conteo aproximado de capacidades web-only mapeadas):

| Dominio | Web-only (qué queda en el web) |
|---|---|
| **Conversaciones / IA** | LLM Router, fallback, circuit breaker, PromptAssembler (3 capas), contract layer, PersonaService, RAG/pgvector + ingesta, intent interpreter, language detector, tool executor, pre-chat, mutex/idempotencia, turn-context, usage/cost tracking, provider-health dashboard, agent-test, business-hours injection, timezone SQL |
| **Handoff / consola** | Estadísticas profundas de agente, archivo/cleanup, snooze (init), email de handoff |
| **CRM** | CRUD/reorder de etapas, scoring config, custom-attributes (definiciones), import/export CSV, todas las analíticas (overview/funnel/velocity/win-loss/sources), external CRM sync, bulk update, deal approval, dynamic-segment refresh |
| **Pipeline** | CRUD de etapas, automation rules (builder), multi-pipeline, analytics por etapa, bulk actions, sync opportunity↔deal (backend) |
| **Citas** | CRUD servicios/staff, OAuth Google/MS, conectar/desconectar/sincronizar calendarios, disponibilidad/bloqueos, reservas públicas (widget), recordatorios (config + crons), recurrencias, plan-gating, resolución 3-tier, BookingEngine |
| **Plantillas/media/campañas** | Sync/creación/submit de plantillas Meta, almacén de media (asset mgmt), broadcasts (autoría/launch/stats), A/B testing, email templates (CRUD), automatizaciones/drip/nurturing, biblioteca de templates |
| **Analítica / BI** | Volumen, heatmap, export CSV, anomalías, cohortes, automation/broadcast stats, channel breakdown, 7 endpoints BI-API (X-API-Key), alert rules CRUD + history, scheduled/saved reports, 13 endpoints legacy, financials, crons |
| **Facturación / offboarding** | Todo el ciclo de suscripción (planes, upgrade/downgrade, cancel/pause/resume), métodos de pago, cupones, webhooks, reconciliación, financials super-admin, offboarding (7 pasos), purge, refund, comp-plan, adapters MercadoPago/Stripe |
| **Canales / onboarding** | Embedded Signup v4, OAuth IG/Messenger, conexión Telegram/SMS/Email, business profile/foto, disconnect/test, router de webhooks, validación HMAC, cifrado/rotación de tokens, asignación de canal a agente, onboarding checklist, outbound queue |
| **Admin / verticales** | Bootstrap vertical, registry de industrias, seeding (FAQs/servicios/stages/persona), enablement de tools, multi-agent setup, persona authoring, user/role mgmt, sub-type selection, wizard, merging JSONB, backfill, cache mgmt |

---

## 3. Gaps core-mobile que faltan o están a medias (accionable)

Lo siguiente es lo realmente accionable: capacidades de la plataforma que el agente **necesita en movimiento** y que aún no tiene bien. Priorizado **gate / P1 / P2**. (Conteo: ~19 gaps `gate`, ~69 `P1`, ~16 `P2` entre `partial`+`no`; aquí se consolidan los que cambian el resultado, no los transparentes.)

### GATE — bloqueantes de GA (sin esto no es producción)

| # | Gap | Dominio | Estado→meta | Por qué bloquea |
|---|---|---|:---:|---|
| G1 | **Toggle estado del agente (online/away/DND)** | conversaciones/handoff | ⬜→✅ | Sin él, el routing skill-based auto-asigna a agentes ausentes → handoffs muertos. Botón grande arriba del inbox |
| G2 | **Manejo de errores end-to-end** en TODAS las acciones (enviar/asignar/resolver/mover) | transversal | 🟡→✅ | Fallo silencioso = no apto producción (coincide con GATE 0 §8 de Parte 1) |
| G3 | **Resumen + razón de handoff visibles arriba del hilo** | handoff | 🟡→✅ | El agente no lee 50 mensajes; sin contexto, la toma de control es ciega |
| G4 | **Cablear handlers WebSocket /agent a UI** (handoff/escalation/collision a badges) | handoff/notif | 🟡→✅ | El socket conecta pero los eventos no pintan UI; el valor en vivo se pierde |
| G5 | **Detalle de deal + mover etapa con feedback de reglas** | pipeline | ⬜→✅ | El kanban mueve deals pero sin contexto ni validación visible de reglas |
| G6 | **Indicador/banner de canal en conversación** | canales | 🟡→✅ | El agente debe saber si responde por WA/SMS/Email (límites y formato difieren) |

### P1 — alto valor, post-gate

| # | Gap | Dominio | Estado→meta |
|---|---|---|:---:|
| P1.1 | **Enviar plantilla WhatsApp (HSM)** select+preview+params en 3 taps | plantillas | 🟡→✅ |
| P1.2 | **Subir media saliente** (cámara/galería → mensaje img/doc) | media | 🟡→✅ |
| P1.3 | **CRM editable**: cambiar etapa de lead, editar tags, nota rápida, archivar | CRM | 🟡/⬜→✅ |
| P1.4 | **Tareas/follow-ups del agente** (crear + marcar done + notificación) | CRM | ⬜→✅ |
| P1.5 | **Crear deal / asignar deal** desde chat o contacto | pipeline | ⬜→✅ |
| P1.6 | **SLA badges + countdown** en cards de inbox y pipeline | pipeline/handoff | 🟡/⬜→✅ |
| P1.7 | **Reasignar a colega / devolver a IA / reabrir** | handoff | 🟡/⬜→✅ |
| P1.8 | **Navegación cruzada** conversación↔lead↔cita del mismo contacto | transversal | 🟡→✅ |
| P1.9 | **Costo IA / uso de cuota + restricción de plan** (banner soft-lock past_due) | analítica/billing | 🟡→✅ |
| P1.10 | **Terminología + KPIs por vertical** cableados (`useVerticalTerms()` en nav/CRM) | admin | 🟡→✅ |
| P1.11 | **Lead 360° completo** (timeline, custom attrs, desglose de score, canales) | CRM/identity | 🟡→✅ |
| P1.12 | **Copiloto consistente** (llamar suggestions/summary/rewrite en todas las pantallas) | IA | 🟡→✅ |

### P2 — diferenciadores y pulido

| # | Gap | Dominio | Estado→meta |
|---|---|---|:---:|
| P2.1 | Reprogramar cita + ver disponibilidad de slots | citas | ⬜→✅ |
| P2.2 | Detalle de cita expandido + crear cita manual | citas | 🟡/⬜→✅ |
| P2.3 | Listener `conversation:reopened` + reabrir | conversaciones | 🟡/⬜→✅ |
| P2.4 | Snooze con fecha/hora nativa | handoff | ⬜→✅ |
| P2.5 | Enviar ubicación (GPS) / mensaje interactivo (botones) | canales | 🟡/⬜→✅ |
| P2.6 | Quick actions desde card de deal (call/WA/oferta) | pipeline | ⬜→✅ |
| P2.7 | Banner de horario de negocio + timezone override | admin | 🟡→✅ |
| P2.8 | Company card (dirección/tel/redes) en More/Inbox | admin/business-info | ⬜→✅ |

---

## 4. Explícitamente fuera de alcance (web-only) — NO es deuda

Lo siguiente **NO va al móvil a propósito**. El web es el centro de control y de autoría; clonarlo en el teléfono es un anti-patrón (sección 0). Que falte en móvil **no cuenta como gap ni como deuda**.

- **Toda configuración y autoría:** builders de bots/personas/prompts (PromptAssembler 3 capas, contract layer), reglas de automatización/SLA/drip/nurturing, plantillas Meta/email (creación y submit), CRUD de etapas de pipeline, scoring config, custom-attributes (definiciones), reservas públicas (widget), disponibilidad/bloqueos/recurrencias, multi-agent setup, user/role management, sub-type/vertical bootstrap.
- **Conexión y administración de canales:** Embedded Signup v4, OAuth IG/Messenger/Google/MS, conexión Telegram/SMS/Email, business profile, disconnect/test/sync, asignación de canal a agente.
- **Infraestructura de backend (nunca UI de agente):** LLM Router + fallback + circuit breaker, RAG/pgvector + ingesta, intent/language detection, tool executor, mutex/idempotencia, outbound queue (BullMQ), webhooks + validación HMAC + cifrado/rotación de tokens, todos los crons, normalización transparente de mensajes.
- **Analítica profunda y BI:** dashboards de volumen/heatmap/cohortes/anomalías/funnel/velocity/win-loss/sources, channel breakdown, export CSV, BI-API (X-API-Key), alert rules, scheduled/saved reports, financials super-admin, 13 endpoints legacy.
- **Facturación y offboarding completos:** planes/upgrade/downgrade/cancel/pause/resume, métodos de pago (PCI), cupones, webhooks de pago, reconciliación, refunds, comp-plans, suspensión/purge/reactivación (7 pasos), adapters MercadoPago/Stripe.
- **Operaciones masivas:** bulk update de leads/deals, import/export CSV, broadcasts (autoría + A/B testing), deal approval workflow.

> Nota: algunas web-only **emiten notificaciones** que sí llegan al móvil (trial expiry, payment failed, broadcast lanzado). Eso es consumo de notificación, no autoría — y entra como oportunista (§5), no como paridad.

---

## 5. Diferenciadores oportunistas (capacidades de NUESTRA plataforma que en móvil nos harían superar)

Capacidades que ya existen en el backend de Parallly y que, expuestas **bien en el móvil**, nos ponen por delante de la competencia (cruzar con los patrones de la Parte 2 §10 y P2 §8).

| Diferenciador | Capacidad de plataforma que lo habilita | Por qué supera |
|---|---|---|
| **Copiloto AI-native en el bolsillo** (sugerir respuesta + resumen + reescribir tono + traducir es/pt) | CopilotService + LLMRouter + PromptAssembler ya existentes | Ningún incumbente de soporte tiene copiloto real en móvil; Parallly es AI-native de fábrica |
| **Toma de control del bot con un tap** (pausar IA / devolver a IA) | HandoffService + WebSocket + persona ya construidos | Cierra el job #2 (takeover ambiguo); diferenciador directo para venta conversacional |
| **Crear lead + iniciar outbound (HSM) desde el teléfono** | OutboundQueue + plantillas WhatsApp + identity | Convierte la app de read-only a productiva; reabre ventana 24h. Chatwoot NO puede |
| **Mover deal + SLA countdown + forecast en la card** | pipeline.service (slaDeadline, forecast, daysInStage) ya calculados | Supera a soporte-first (Zendesk/Crisp/Tidio sin pipeline); foco LatAm de ventas |
| **Quick actions desde card/notificación** (call/WhatsApp/ubicación GPS) | Linking RN + WhatsApp location endpoint + Expo push | Responder/actuar en <10s desde lock screen; el JTBD de mayor ROI en campo |
| **Snooze "hasta mañana 9am" con date picker nativo** | snooze.service + cron de re-inserción | UX móvil-nativa que el web no puede igualar |
| **Transcripción de audio + descripción de imagen inline** | media-processing (Whisper + vision) ya procesa al ingerir | El agente no escucha el audio; lo lee. Accesibilidad + velocidad en takeover |
| **Terminología + KPIs por vertical** (Pacientes/Propiedades/Reservas) | verticalConfig + useVerticalTerms() | Localización por industria que la mayoría de apps genéricas no hacen |
| **Costo IA / cuota de plan proactivo** ("AI cost hoy: $X", "te acercas al límite") | LLMRouter usage tracking + TenantThrottle | Transparencia única; ningún competidor lo surface en móvil |
| **Vacation rental / staff scheduling / vehicle inventory en campo** | módulos verticales (properties/staff/vehicles) — endpoints por exponer | Lookup de disponibilidad/vehículo + booking desde el teléfono para verticales específicos |
| **Escáner de tarjeta de visita → lead** (OCR) | createLead + outbound (requiere OCR client-side) | "Wow" de venta presencial LatAm; Parallly no lo tiene aún |

---

## 6. Alcance móvil curado y definitivo

La lista corta de lo que la **app de PRODUCCIÓN** debe cubrir **bien**, derivada de NUESTRA plataforma (no de competidores). Es el subconjunto que pasa el filtro: *¿lo necesita el agente con el teléfono en la mano, fuera del escritorio?*

### 6.1 Núcleo obligatorio (debe estar sólido = `yes`)

1. **Bandeja unificada en tiempo real** + filtros (mine/unassigned/handoff) + búsqueda — *ya sólido; falta paginación a escala.*
2. **Conversación**: leer hilo + media entrante + notas + responder (texto) — *ya sólido.*
3. **Acciones de ticket**: asignar / resolver / nota interna — *ya sólido; añadir reasignar, devolver-a-IA, reabrir.*
4. **Push fiable end-to-end + deep-link** (handoff/SLA/mensaje) — *ya sólido; cerrar el caso app-cerrada (GATE 0).*
5. **Auth + sesión** (JWT refresh, device trust, 2FA) — *ya sólido.*
6. **Contexto 360° del contacto** (ver, no admin) — *ya sólido; enriquecer con score, canales, timeline.*
7. **Estado/disponibilidad del agente** (online/away/DND) — **falta (G1).**
8. **Manejo de errores + estados (carga/vacío/error) + optimistic** en todo — **a medias (G2).**

### 6.2 Acciones de campo de alto valor (subir a `yes` post-gate)

9. **Responder con media saliente** (cámara/galería) + **enviar plantilla HSM**.
10. **CRM editable**: cambiar etapa, tags, nota rápida, archivar, **crear/asignar deal**, **tareas**.
11. **Toma de control del bot** (pausar IA / devolver) + resumen/razón de handoff visibles.
12. **SLA visible** (badges + countdown) en inbox y pipeline.
13. **Citas**: ver detalle + reprogramar + disponibilidad de slots (además de confirmar/cancelar ya sólidos).
14. **Navegación cruzada** + **terminología/KPIs por vertical**.

### 6.3 Diferenciadores móviles (post-paridad, §5)

15. **Copiloto en el bolsillo** · **quick actions desde push** · **crear lead + outbound HSM** · **snooze nativo** · **transcripción inline** · **costo IA proactivo** · **OCR de tarjeta**.

### 6.4 Encaje con el GATE 0 de robustez

> **Regla de oro (sección 0):** el GATE 0 (robustez) **precede** a toda ampliación de §6.2/§6.3. La cobertura ponderada actual (~54% del valor móvil-relevante; ~72% del valor `gate`) confirma que **el subconjunto correcto ya está mayormente elegido y a medio construir** — el trabajo es rematar, no expandir.

| Capa | Qué exige | Cómo se relaciona con esta Parte 3 |
|---|---|---|
| **GATE 0 (robustez)** | Sentry, tests, i18n es/en/pt/fr, manejo de errores, offline/red, push fiable, seguridad, a11y, paginación/estados | Es **prerequisito** de subir cualquier `partial`→`yes`. G1–G6 de §3 son las capacidades-gate que coinciden con el GATE 0 de Parte 1. **No se lanza GA sin esto.** |
| **Núcleo §6.1** | Las 8 capacidades obligatorias sólidas | 6 ya están en `yes`; G1 (estado agente) y G2 (errores) cierran el gate |
| **Campo §6.2** | Edición CRM, media saliente, HSM, takeover, SLA, citas | P1 de §3 — **solo después del gate** |
| **Diferenciación §6.3** | Copiloto, push-actions, outbound, OCR, etc. | P2 de §3 — **solo después de paridad** |

**Definition of Done para producción (alcance móvil):** §6.1 completo y sólido + GATE 0 superado. Todo §6.2/§6.3 es roadmap incremental sobre una base robusta — no condición de GA.

---

*Fuente: mapeo capacidad-por-capacidad de 12 dominios de plataforma (conversaciones, IA-conocimiento, handoff-consola, CRM, pipeline-ventas, citas-calendario, plantillas-media-campañas, analítica-BI, facturación-planes-offboarding, canales-onboarding, admin-ajustes-verticales, notificaciones-tiempo-real) contra el código de `apps/mobile/src/` y los `docs/` de la plataforma. Conteo base: 141 capacidades core-mobile (37 `yes`, 78 `partial`, 26 `no`), 40 de ellas marcadas `gate`.*
