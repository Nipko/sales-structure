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

**9 hallazgos, 2 de ellos P0.** Los dos P0 son fallas de servidor que devolvían 500 en
funciones centrales y que la app mostraba como "no pasa nada" — ninguna era visible sin
mirar los logs. Ambas están corregidas; una ya desplegada y la otra pendiente de deploy.

El patrón que las une vale más que los bugs sueltos: **la app pide algo, la API devuelve
500, y el usuario no ve ningún error**. El GATE 0 (G0.2) daba esto por cerrado. Está
cerrado para los `Alert` de falso-éxito, pero no para los errores que ocurren con un
`Modal` abierto ni para los que la UI traduce como "lista vacía".

| # | Severidad | Hallazgo | Estado |
|---|---|---|---|
| 1 | 🔴 P0 | Crear un lead fallaba **siempre** con 500 (columnas fantasma) | ✅ `ab3e5cbc`, desplegado y verificado |
| 2 | 🔴 P0 | Filtro **"Mías"** del inbox devuelve 500 (`assigned_to` VARCHAR vs `::uuid`) | ✅ `07596083`, **falta desplegar** |
| 3 | 🟠 P1 | `getAgentStats` cuenta la carga activa con el mismo cast inválido | ✅ `07596083`, **falta desplegar** |
| 4 | 🟠 P1 | Los errores lanzados con un `Modal` abierto son **invisibles** | ◐ Corregido en la hoja de lead; el patrón sigue en otros modales |
| 5 | 🟠 P1 | Los leads nuevos no llegan al **Embudo** (`Lead · 0`) | ❌ Sin corregir |
| 6 | 🟡 P2 | La lista del CRM queda obsoleta tras crear un lead | ❌ Sin corregir |
| 7 | 🟡 P2 | Pestaña "Deal" vs encabezado "Agenda" | ✅ `e268912b` |
| 8 | 🟡 P2 | Dos controles sin etiqueta de accesibilidad en la fila del inbox | ❌ Sin corregir |
| 9 | 🟡 P2 | El filtro del inbox persiste y un filtro vacío parece un inbox vacío | ❌ Sin corregir |

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

Un agente **no puede ver sus propias conversaciones**. En la app no se ve un error: se
ve un inbox vacío.

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

> El recorrido se interrumpió con el teléfono en uso. Lo que falta es más de la mitad de
> la superficie, e incluye las áreas donde históricamente aparecieron los problemas
> (copiloto, multimedia, offline, push). **No debe leerse como "el resto está bien".**
