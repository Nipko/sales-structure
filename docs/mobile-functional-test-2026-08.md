# Prueba funcional de la app móvil — ago 2026

> Recorrido completo por la app manejándola en un **Samsung SM-S938B (Android 16)** con
> la cuenta de revisión (`architerin@gmail.com`, tenant `Test Business`, vertical
> `technology`/saas), previo a la publicación en Google Play.
>
> **Build bajo prueba:** `versionCode 3` (build local de `gradlew`, firmado
> `CN=Android Debug`). No incluye los arreglos de `e268912b` (Deal/Agenda) ni de
> `ab3e5cbc` (creación de leads) del lado móvil — sí corre contra la API con el arreglo
> ya desplegado. Lo que ya está arreglado se marca como tal.

## Cómo leer esto

| Severidad | Significado |
|---|---|
| 🔴 **P0** | Rompe una función central o el revisor de Google se lo topa. Corregir antes de publicar |
| 🟠 **P1** | Falla real con impacto en el uso diario. Corregir pronto |
| 🟡 **P2** | Defecto menor, cosmético o de pulido |
| ✅ | Verificado funcionando |

---

## Resumen

**11 hallazgos, 3 de ellos P0**, en poco más de media app recorrida. Los tres P0 estaban
del lado del servidor y **ninguno era visible desde la app**: dos devolvían 500 y el
tercero omitía un campo. Los tres están corregidos; uno desplegado, dos pendientes.

El patrón que los une vale más que los bugs sueltos: **la app pide algo, el servidor
responde mal, y el usuario ve una pantalla plausible**. Un 500 al crear un lead se ve
como un botón muerto; un 500 en el filtro "Mías" se ve como un inbox vacío; un campo
faltante se ve como "seguís sin tomar la conversación". Ninguno se manifiesta como un
error.

El GATE 0 (G0.2) daba esto por cerrado. Está cerrado para los `Alert` de falso-éxito,
pero no para los errores que ocurren con un `Modal` abierto, ni para los que la UI
traduce como "lista vacía", ni para los campos que el contrato promete y no entrega.

Consecuencia práctica: **no alcanza con recorrer la app mirando la pantalla.** Los tres
P0 salieron de leer logs del servidor y de contrastar el contrato con el código. Conviene
correr el resto de la cobertura con los logs de producción a la vista.

| # | Severidad | Hallazgo | Estado |
|---|---|---|---|
| 1 | 🔴 P0 | Crear un lead fallaba **siempre** con 500 (columnas fantasma) | ✅ `ab3e5cbc`, desplegado y verificado |
| 2 | 🔴 P0 | Filtro **"Mías"** del inbox devuelve 500 (`assigned_to` VARCHAR vs `::uuid`) | ✅ `07596083`, desplegado y **verificado** |
| 3 | 🟠 P1 | `getAgentStats` cuenta la carga activa con el mismo cast inválido | ✅ `07596083`, desplegado |
| 4 | 🟠 P1 | Los errores lanzados con un `Modal` abierto son **invisibles** | ◐ Corregido en la hoja de lead; el patrón sigue en otros modales |
| 5 | 🟠 P1 | Los leads nuevos no llegan al **Embudo** (`Lead · 0`) | ❌ Sin corregir |
| 6 | 🟡 P2 | La lista del CRM queda obsoleta tras crear un lead | ❌ Sin corregir |
| 7 | 🟡 P2 | Pestaña "Deal" vs encabezado "Agenda" | ✅ `e268912b` |
| 8 | 🟡 P2 | Dos controles sin etiqueta de accesibilidad en la fila del inbox | ❌ Sin corregir |
| 9 | 🟡 P2 | El filtro del inbox persiste y un filtro vacío parece un inbox vacío | ❌ Sin corregir |
| 10 | 🔴 P0 | "Tomar control" **nunca** se refleja: el detalle no devuelve `assignedAgentId` | ✅ `60c578d0`, desplegado y **verificado** |
| ~~11~~ | — | ~~El resumen del hilo alucina~~ | ❌ **RETIRADO — era un falso positivo** (ver abajo) |
| 12 | 🟡 P2 | La política de privacidad abre en inglés con la app en español | ❌ Sin corregir |
| 13 | 🟡 P2 | Un chat de Telegram ofrece acción "WhatsApp" sobre un ID que no es teléfono | ❌ Sin corregir |
| 14 | 🟠 P1 | Las **automatizaciones no corren** en ningún mensaje entrante (22P02 silencioso) | ✅ Corregido |
| 15 | 🟠 P1 | Las **alertas de analytics** y los **reportes programados** mueren con 42883 | ✅ Corregido |

### Auditoría completa de la familia de errores

Los hallazgos 2, 3, 14 y 15 son **el mismo error** repetido: un `::uuid` puesto donde el
tipo real no lo admite. Se auditó la familia entera en vez de ir caso por caso.

`apps/api/scripts/audit-uuid-casts.js` cruza los **1.020 casts `::uuid`** del SQL crudo
contra el tipo real de cada columna, leyendo el esquema de sus **tres** fuentes: el
schema por tenant, las migraciones (las tablas globales) y los `CREATE TABLE` que viven
dentro del código (tablas creadas en runtime). Sale con código 1 si encuentra un
desajuste, así que puede colgarse de CI.

Un detalle que costó: `schema.prisma` **no sirve** como fuente de verdad. Declara los ids
como `String @id @default(uuid())` sin `@db.Uuid` — hay un solo `@db.Uuid` en todo el
archivo — mientras el DDL real de las migraciones los crea como `UUID`. Indexar desde
Prisma producía **63 falsos positivos** (tenants.id, users.id, channel_accounts.tenant_id…).
Con las migraciones como fuente, quedan **6 desajustes reales**, todos corregidos.

El auditor se validó reintroduciendo un bug a propósito: lo detecta y falla.

Matiz que respeta a propósito, para no "arreglar" lo que funciona: `UPDATE t SET col =
$1::uuid` sobre una columna de texto **sí** funciona, porque hacia tipos texto Postgres
aplica un cast de **asignación**. Lo que no existe es el operador de **comparación**. Los
tres `UPDATE` que había se normalizaron igual, para que nadie replique el patrón en un
`WHERE`.

---

## Hallazgos

### 1. 🔴 P0 — Crear un lead fallaba siempre con 500

Detalle completo en `docs/play-store-publish-checklist.md` §7-bis. Resumen: la whitelist
de columnas del repositorio nombraba cinco campos inexistentes; la app manda
`source: 'mobile'` en cada lead, así que el INSERT moría con **42703** el 100% de las
veces. Sumado a que el `toast` de error se dibuja detrás del `Modal`, se veía como un
botón muerto.

**Corregido** en `ab3e5cbc`, desplegado y verificado creando 6 leads reales.

### 2. 🔴 P0 — El filtro "Mías" del inbox devuelve 500

```
GET /api/v1/agent-console/inbox/:tenantId?filter=mine&agentId=… → 500
Raw query failed. Code: 42883.
ERROR: operator does not exist: character varying = uuid
  at AgentConsoleService.getInbox (agent-console.service.js:72)
```

`conversations.assigned_to` es **`VARCHAR(255)`** (guarda el id de usuario como texto),
pero el filtro comparaba contra un parámetro casteado a `::uuid`. Postgres no tiene
operador `varchar = uuid` → la consulta entera muere.

Un agente **no puede ver sus propias conversaciones**.

> **Corrección a una versión anterior de este informe.** Se afirmó que el fallo se veía
> como un inbox vacío, sin señal de error. Es **falso**: reproducido en un equipo limpio,
> la app muestra correctamente *"No se pudo cargar la bandeja."* con un botón
> **Reintentar**. Los estados de error del inbox (G0.7) funcionan. La afirmación previa
> venía de un sondeo automatizado mal parseado, no de una observación real.
>
> La severidad no cambia — la función sigue rota — pero este hallazgo **no** es un caso
> de falla silenciosa.

Matiz que importa para no "arreglar de más": los `UPDATE … SET assigned_to = $n::uuid`
**no** son un bug. Hacia tipos texto Postgres aplica un cast de asignación y funcionan;
lo que no existe es el operador de comparación. Y los casts sobre
`conversation_assignments.agent_id` y `appointments.assigned_to` **sí** corresponden,
porque esas columnas realmente son UUID.

El patrón correcto ya vivía en el repo: `agent-availability.service` compara
`active.assigned_to = u.id::text`, y `automation-jobs.processor` usa
`SET assigned_to = $1` con un comentario explícito de que la columna es VARCHAR.

**Corregido** en `07596083` con 3 tests de regresión, uno de los cuales evita el
sobre-arreglo (verifica que el cast legítimo sobre `agent_id` siga estando).

### 3. 🟠 P1 — `getAgentStats` arrastra el mismo cast inválido

`SELECT COUNT(*) … FROM conversations WHERE assigned_to = $1::uuid` — misma causa que el
hallazgo 2, en el conteo de carga activa del agente. Corregido en el mismo commit.

### 4. 🟠 P1 — Los errores con un `Modal` abierto son invisibles

En Android un `<Modal>` es **su propia ventana nativa**. El `ToastProvider` renderiza un
`View` con `position: 'absolute'` dentro del árbol de la app, así que cualquier
`toast.error()` disparado mientras hay un modal abierto se dibuja **detrás** de él.

Consecuencia: toda falla ocurrida dentro de un modal es indistinguible de "el botón no
hace nada". Es lo que ocultó el hallazgo 1 y lo que hizo que el diagnóstico inicial
apuntara, equivocadamente, a un problema de automatización.

Corregido en la hoja de creación de lead mostrando el error **dentro** de la hoja.
**Pendiente**: auditar el resto de los modales de la app y resolverlo de raíz —
por ejemplo, renderizando el toast dentro de un `Modal` propio.

### 5. 🟠 P1 — Los leads nuevos no llegan al Embudo

Se crearon 6 leads en etapa `lead`. El tablero muestra `Lead · 0` incluso tras
pull-to-refresh; el único deal visible (`Demo · 1`) es preexistente. La cadena
lead → opportunity → deal → tablero se corta en algún punto.

No frena la revisión de Google, pero le deja el tablero vacío al revisor. Registrado
como tarea aparte con las hipótesis a descartar.

### 6. 🟡 P2 — La lista del CRM queda obsoleta tras crear un lead

Al crear un lead la app navega al detalle. Al volver, la lista **no se recarga**: los 6
leads existían en el servidor y no se veían hasta hacer pull-to-refresh. Da la impresión
de que la creación falló.

### 7. 🟡 P2 — Pestaña "Deal" vs encabezado "Agenda"

Ver `play-store-publish-checklist.md` §7-bis. Corregido en `e268912b`.

### 8. 🟡 P2 — Controles sin etiqueta en la fila del inbox

El volcado de accesibilidad muestra dos elementos `clickable=true` sobre la fila de
conversación, en `[713,596][896,786]` y `[897,596][1080,786]`, **sin `text` ni
`content-desc`**. Un lector de pantalla los anuncia como botones sin nombre. El resto de
la app sí tiene etiquetas (se cerró en G0.8), así que estos dos quedaron fuera.

### 9. 🟡 P2 — El filtro del inbox persiste y confunde

La selección de filtro sobrevive a salir y volver a la pantalla. Combinado con que un
filtro sin resultados se ve como un inbox vacío, es fácil creer que se perdieron las
conversaciones. Se notó al volver al Inbox y encontrarlo "vacío" cuando en realidad
seguía aplicado un filtro de un paso anterior.

### 10. 🔴 P0 — "Tomar control" nunca se refleja en la pantalla

Al tocar **Tomar control**, el banner pasa por un instante a "vos estás atendiendo" y
enseguida vuelve a **"Esperando atención humana"**, con el botón "Tomar control" todavía
ofrecido. El agente no tiene forma de saber si tomó la conversación o no.

Causa: `ConversationScreen` decide quién atiende con

```js
const assignedToMe = !!(conv?.assignedAgentId && user?.id && conv.assignedAgentId === user.id);
```

pero el endpoint de detalle (`GET /agent-console/conversation/:tenantId/:id`)
**no devuelve `assignedAgentId`**. La interfaz `ConversationDetail` declaraba un
`assignedAgent?: {id, name}` anidado que **nada poblaba y nada leía**, mientras el
cliente pedía el `assignedAgentId` plano que la lista del inbox sí devuelve. El campo
del que dependía la pantalla nunca llegaba, así que `assignedToMe` era **siempre false**
y el modo `'you'` era inalcanzable.

La asignación sí ocurre en el servidor; lo que está roto es que el agente nunca lo ve. El
comentario del propio código dice que ese banner existe para resolver *"job #2: takeover
ambiguity"* — el defecto lo reintroduce por completo.

**Corregido** en `60c578d0`: el detalle devuelve `assignedAgentId`, y se reemplazó el
campo muerto por el que el cliente realmente consume. 2 tests de regresión.

### 11. 🟠 P1 — El resumen del hilo alucina

Conversación real, completa:

| | |
|---|---|
| Cliente | `/start` |
| IA | "Hola, soy Diego. ¿Estás evaluando nuestra solución para tu equipo? Cuéntame brevemente sobre tu empresa." |
| Cliente | "Hola" |
| IA | "¡Hola! ¿Cómo estás? Para poder ayudarte mejor, ¿me cuentas brevemente sobre tu empresa y qué estás buscando?" |

Resumen devuelto por **Resumir**:

> "El cliente pregunta sobre los servicios ofrecidos por la empresa, y el agente responde
> enumerando los servicios disponibles."

Nada de eso pasó: el cliente nunca preguntó por servicios y el agente nunca enumeró
ninguno. El resumen no está anclado en el hilo.

Importa más de lo que parece: el resumen es lo que lee un agente al recibir una
conversación escalada, para no hacer repetir al cliente. Un resumen inventado es peor que
no tener resumen. Hay que revisar qué contexto se le manda al modelo y si el hilo llega
realmente en el prompt.

> **No es un bug** (verificado en código): "Próxima acción" devuelve *"Sin sugerencia
> disponible"* porque está **gateado a propósito** — sin una evaluación de outcome
> vigente no se llama al modelo (`agent-console.service.nba-readiness.spec.ts`). Es el
> estado correcto, no una falla.

---

## Cobertura

| Área | Estado |
|---|---|
| Inbox: lista, filtros (los 6), estado en vivo | ✅ Recorrido — hallazgos 2, 8, 9 |
| CRM: lista, alta de lead, detalle, refresco | ✅ Recorrido — hallazgos 1, 4, 6 |
| Embudo | ✅ Recorrido — hallazgo 5 |
| Conversación: envío, copiloto IA, acciones de cierre, multimedia | ⏳ **Sin probar** |
| Operación vertical (Agenda): alta, reprogramar, cancelar | ⏳ **Sin probar** |
| Más: estado de agente, idioma, notificaciones, cuenta | ⏳ **Sin probar** |
| Sesión: persistencia, bloqueo biométrico, logout | ⏳ **Sin probar** |
| Offline: cola de salida, caché del inbox | ⏳ **Sin probar** |
| Push con app cerrada | ⏳ **Sin probar** — es el pendiente histórico del GATE 0 |
| Deep links `parallly://` | ⏳ **Sin probar** |
| Búsqueda de conversaciones y de leads | ⏳ **Sin probar** |
| Escáner de tarjetas de visita | ⏳ **Sin probar** |

> Lo que falta es alrededor de la mitad de la superficie, e incluye áreas donde
> históricamente aparecieron problemas (multimedia, offline, push con app cerrada).
> **No debe leerse como "el resto está bien".**

## Verificación post-deploy de los arreglos

Contra el SM-S918B, con el APK universal derivado del AAB de EAS instalado limpio y la
API ya desplegada:

| Antes | Después |
|---|---|
| "Mías" → *"No se pudo cargar la bandeja."* + Reintentar (500 / 42883 en los logs) | **Lista la conversación asignada** |
| Banner: *"Esperando atención humana"*, con "Tomar control" todavía ofrecido | Banner: **"Tú tienes el control"**, "Tomar control" desaparece y quedan "Devolver IA" y "Reasignar" |

Que la conversación aparezca bajo "Mías" confirma además algo que hasta ahora era una
inferencia: la asignación **sí se estaba guardando** en el servidor todo el tiempo. Lo
único roto era leerla — el filtro moría con 42883 y el detalle no exponía el campo.

## Verificado funcionando

Contrastado contra los logs de producción, no sólo contra la pantalla.

| Función | Evidencia |
|---|---|
| Instalación limpia del artefacto de EAS | APK universal derivado del AAB instalado en un SM-S918B sin la app previa: `Success`, `versionCode 3` |
| Login con la cuenta de revisión | Entra al inbox del tenant `Test Business` |
| Registro de push | `POST /push/expo-subscribe` → **201** en el primer arranque |
| WebSocket en vivo | `ConversationsGateway` y `AgentConsoleGateway` autentican al agente; el indicador "EN VIVO" es real |
| Inbox por defecto | `GET /agent-console/inbox/…` (sin filtro) → **200** |
| Estados de error del inbox | El 500 de "Mías" se muestra como *"No se pudo cargar la bandeja."* + **Reintentar** |
| Estado de disponibilidad | Cambiar a "Ausente" persiste tras salir y volver a la pantalla (cierra G0.3) |
| Resumen del hilo (copiloto) | Responde — pero ver hallazgo 11 sobre su contenido |
| Próxima acción (copiloto) | Devuelve vacío **por diseño**, gateado por readiness |
| Enlaces legales exigidos por Play | Privacidad y eliminación de datos abren el navegador y cargan |
| Alta de leads | 6 leads creados end-to-end contra la API ya corregida |
| `business-info` | 200 |

Dos observaciones sin conclusión, anotadas para no perderlas:

- En ~90 s los logs muestran **varios ciclos de conexión/desconexión** del WebSocket. Puede
  ser el ciclo normal de background de Android o un bucle de reconexión. No se investigó.
- La sección CUENTA muestra el rol **`tenant_admin`**. El checklist pedía un
  `tenant_agent`. No es un problema para la revisión (un admin ve más), pero conviene
  decidirlo a propósito y no por accidente.
