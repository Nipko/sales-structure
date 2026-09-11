# Tanda de runtime WhatsApp — informe derivado

**Rango exacto:** `584d15c3..e2d621b0` (18 commits nuevos en esta ejecución;
`584d15c3` era el HEAD al emitir la instrucción).
**Estado:** NO es cierre local. Quedan brechas locales enumeradas abajo.

Este informe se escribe a mano sobre cifras que producen generadores y suites.
Donde una fila dice un número, ese número salió de un comando que está anotado
al lado. Donde no hay comando, la fila dice "sin autoridad ejecutable todavía" y
cuenta como brecha abierta, no como cerrada.

---

## 1. Lo que cerró esta tanda

| # | Commit | Defecto que cerró |
|---|--------|-------------------|
| 1 | `4bbb4890` | Un medidor que no podía contestar **concedía permiso**. `return null` lo leían trece llamadores como "no hay gate, seguí". Ahora difiere: el efecto no sale y no se pierde. La inyección opcional desapareció de los tres sumideros que pueden enviar WhatsApp. Entrante intacto, probado estructuralmente. |
| 2 | `49a8a892` | **Quién paga** se armaba en el call site. `admitBySchema` recibía canal y cuenta y rellenaba el resto: sin pagador, sin credencial. Bajo `enforce` el REST y la consola de agente habrían rechazado todo mientras la cola funcionaba. Se eliminó el método; hay una sola forma de nombrar una conexión y un test estructural lo fija. |
| 3 | `a860117a` | La clave de efecto era **sólo contenido**. Un reintento que re-renderiza el cuerpo pagaba dos veces; dos campañas con el mismo texto colapsaban en un efecto y la segunda nunca salía. Vocabulario de identidad durable por sumidero; bajo `enforce` un efecto sin identidad se rechaza con `effect_identity_missing`; bajo `observe` sigue midiéndose. |
| 4 | `e309c51b` | **Aceptado no es entregado.** El POST sólo puede decir que Meta lo tomó; el cargo cae en la entrega. Los webhooks de estado actualizaban el historial y tiraban el dato económico. Ahora liquidan, liberan o no hacen nada, idempotentes ante duplicado y desorden, con el bloque `pricing` de Meta como única autoridad para liquidar en cero. |
| 5 | `6ae587fd` | El barrido y la reconciliación **no tenían llamador**. Hay un pase cada diez minutos con lease, backoff por tenant, métricas e incidentes; `pending_reconciliation` se cierra al monto reservado tras la gracia; `indeterminate` va a una persona, con motivo obligatorio y endpoint. |
| 6 | `406598af` | **131042** — "este negocio no puede ser cobrado" — lo leían dos de los cuatro caminos. Un lector único para las cuatro formas del rechazo, hook en el gateway, y una salida del bloqueo que no necesita el POST que el bloqueo impide. |
| 7 | `d7c15082` | Los **mil mensajes gratis nunca se otorgaron**: el contador nacía `observe` y el statement busca `deliveries`. Además el presupuesto de lote se tragaba su propio fallo y usaba el mes UTC en vez del mes de la WABA. |
| 8 | `e55d140f` | Un llamador del gateway **podía omitir** la admisión del fallback de Flow. El hook y el argumento son obligatorios; la consola de agente, que era el hueco real, ahora trae el suyo. |
| 9 | `c506efc0` | El censo preguntaba "¿este archivo menciona un gate?". Ahora exige **dominancia y cardinalidad** por call site, y trae la sonda que faltaba: un segundo POST dentro de un sumidero ya marcado en verde. |
| 10 | `6ff75b1d` | `nurturing.executeAttempt2` **decía "plantilla enviada" y mandaba un texto** fuera de la ventana de 24 h, saltándose opt-out, canales permitidos, tope diario y ventana. Tres defectos más en el camino: plantilla que ningún adaptador lee, idioma fijo `es`, número emisor arbitrario; y la fila del historial decía `delivered` antes de enviar. |
| 11 | `3fbdc27d` | Un envío proactivo que no puede nombrar su número **fallaba en silencio**. Ahora levanta una tarea de configuración en el panel del negocio y sigue sin elegir. Y `resolveChannelCredentials` devolvía `{accessToken: ''}`, que los llamadores encolaban. |
| 12 | `aa57d4dd` | El panel mostraba la pausa y **no ofrecía nada**; el dinero trabado era invisible. Botón de reanudación por rol y bloque de "envíos que nadie puede confirmar", en cuatro idiomas. |
| 13 | `4c375f7b` | **`Dockerfile.dashboard` descartaba cinco valores que producción sí pasa**: Instagram (app y redirect), Messenger, VAPID y `META_SOLUTION_ID` (ARG sin ENV). Es producción hoy. Y el `workflow_dispatch` de `candidate.yml` nunca funcionó: leía su propio output todavía no escrito. |
| 14 | `e2d621b0` | El lector del manifiesto aceptaba un **repositorio ajeno con digest válido**, un tag que no nombra su propio commit, un salto de línea que agrega un `command:` al compose, y una versión que no entiende. Allowlist, tag exacto, rechazo de escalares peligrosos y versión por identidad. |

Los otros tres (`e95b0a37`, `3daa0f8e`, `0ce6984e`) son de la tanda anterior
dentro del mismo rango.

---

## 2. Defectos que encontraron las pruebas mientras se escribían

Se listan porque cada uno estaba en código escrito minutos antes, y porque la
prueba que lo encontró es la que vale:

1. `remote_state` tiene un CHECK y `not_delivered` no es uno de sus valores: una
   resolución manual tumbaba la transacción entera.
2. Un cargo manual por encima de la reserva se truncaba en silencio — la fila
   decía una cosa y la cuenta se movía otra.
3. Un helper de spec cuyo `...over` reemplazaba la identidad completa por
   `{category}`: estaba probando `payer_unknown` en vez del efecto pedido.
4. Dos casos cuya premisa era "un mensaje de servicio se cobra", que dejó de ser
   cierta en cuanto la franquicia empezó a funcionar.
5. Cuatro dobles de test incompletos (`channelToken` sin `resolveSendContext`)
   que pasaban sólo porque el código degradaba en silencio; dos de ellos colgaron
   la suite veinte minutos cuando la degradación se acabó.

---

## 3. Verificación ejecutada

| Capa | Comando | Resultado |
|------|---------|-----------|
| Suite API completa, PostgreSQL + PgBouncer + Valkey | `scratchpad/full-suite.sh` | **662/662 suites, 7452/7452 tests, 0 omitidos** |
| Tres órdenes, una base compartida | suite entera → shard 2/2 + 1/2 → suite entera | 7446 / (3271+4175) / 7446, todas verdes |
| Dashboard | `jest --config jest.config.cjs` | **810/810** en 72 suites |
| Playwright | `npx playwright test` | **186/186** (escritorio + móvil) |
| Bootstrap DI | `jest --testPathPattern=bootstrap` | 1/1 |
| Typecheck ×5 | api, dashboard, landing, whatsapp, mobile | limpio |
| Builds ×5 | api, whatsapp, dashboard, landing, shared | limpio |
| Lint | `eslint "src/modules/**/*.ts"` (api) y dashboard | 0 errores |
| Censo de productores | `outbound-producer-inventory.cjs --check` | 37 call sites, 33 cobrables, **0 fuera de la frontera** |
| Generador A1–H3 | `generate-closure-report.cjs` | 7 aceptadas, 18 bloqueadas por gate externo, 0 abiertas |
| Migración limpia | base nueva + `prisma migrate deploy` | todas aplicadas |
| Migración de tenants | `scripts/test-tenant-migration.js` | exit 0 |
| `git diff --check` | — | limpio |

### Mutación (una prueba que no puede ponerse en rojo no prueba nada)

- Desactivar la siembra de la franquicia: **6 de 12** casos nuevos fallan.
- Quitar un `ENV` del Dockerfile: **2 de 7** casos del contrato fallan.
- Quitar el gate de un sumidero: el censo sale en rojo y nombra el archivo.

---

## 4. Omisiones — lo que NO se verificó

- **`--randomize` (orden dentro de cada archivo)** rompe 9–11 suites
  preexistentes: `durable-dispatch.load`, `agent-test-knowledge-replica`,
  `benchmark.service`, `certification-catalogue`, `isolated-canonical-commands`,
  `isolated-eval-namespace`, `agreed-terms-orphans`, `agreed-terms-preflight`,
  `widget-delivery`. Son secuenciales por construcción. **Ninguna suite escrita
  en esta tanda aparece.** No es una regresión de esta tanda y no se arregló.
- **Migración "upgrade"** (aplicar lo nuevo sobre un estado anterior real) y
  **"bajo carga"**: no ejecutadas. Sólo se ejecutó limpia desde cero.
- **Ningún despliegue, push, activación de `enforce` ni llamada real a Meta.**
  Todo lo de arriba corrió contra instancias locales desechables.

---

## 5. Estado de 76 perfiles y 5 canales

| Dimensión | Autoridad | Estado |
|-----------|-----------|--------|
| 5 canales | `channel-certification-matrix.ts` + `channel-certification-runtime.ts` | Derivado por el generador A1–H3; sin cambios en esta tanda |
| 76 perfiles (18 verticales × subtipos) | `task-competence-matrix.ts` | Derivado por el generador A1–H3; sin cambios en esta tanda |

Esta tanda no tocó ninguna de las dos matrices. Lo que sí cambió para los cinco
canales es que **sólo WhatsApp** entra al libro de gasto: los otros cuatro
atraviesan el gate y salen marcados `notBilled`, y los recibos de entrega de los
cuatro no llegan al ledger — verificado por test.

---

## 6. Brechas locales que siguen abiertas

Esto es lo que impide declarar cierre local. Cada una es trabajo local, no un
gate externo:

1. **Los 26 productores fuera del carril durable.** El gate es universal (censo:
   0 fuera de la frontera), pero la DURABILIDAD no: un productor que no pasa por
   el outbox no tiene fila propia que sobreviva a un reinicio. Migración
   pendiente.
2. **`candidate.yml` / cutover, ítems 2 y 5–10:** autorización ligada al SHA con
   environment protegido y permisos por job, no publicar artefactos consumibles de
   un run rojo, correr PostgreSQL/Dashboard/Playwright en candidate, reordenar el
   runbook con barrera global de escritura, `/evidence` persistente, unificar
   `pg_dump`/restore con comandos exactos fail-closed, y fijar cwd/compose/
   `GIT_SHA`/cinco digests. Cerrados: ítem 1 (dispatch SHA), ítem 3 (los once
   build args, más los cinco que el Dockerfile descartaba) e ítem 4 (manifiesto
   endurecido: versión estricta, allowlist de repos, tag exacto y rechazo de
   `#`, espacios, comillas, saltos de línea y esquemas).
3. **Producto, ítems restantes:** recorrido guiado completo, accesibilidad,
   landing, manuales y `apps/api/kb/assistant/{es,en,pt,fr}`. El panel por número
   y mes WABA existe; la reanudación y el bloque de "nadie puede confirmar" se
   agregaron; el resto no.
4. **M0–M6/R0–R6 no están en el generador de cierre.** El generador produce
   A1–H3 y nada más, así que el informe derivado todavía **no** puede incluirlos.
   Esta es la brecha que hace que este documento sea manual.
5. **Identidad por usuario (BSUID/BISU)** y **control del agente externo de Meta**:
   no implementados.
6. **Cifra del canario** (204 casos / 612 llamadas / US$1,08): no verificada
   contra el generador autoritativo en esta tanda.

---

## 7. Gates externos que quedan (cada uno por nombre)

Ninguno de estos se puede cerrar desde acá, y ninguno se intentó:

1. **Método de pago en la WABA del tenant, en Meta, antes del 30-sep-2026.** Sin
   él Meta deja de entregar el 1-oct y el agente queda mudo para ese tenant.
   Nadie de Parallly puede agregarlo.
2. **Moneda real de la WABA desde evidencia de Meta.** La autoridad de moneda
   exige procedencia; hasta que una WABA real reporte la suya, todo efecto de esa
   cuenta se reserva con `basis: 'unknown'`.
3. **Primera ejecución real de `candidate.yml`.** Publica imágenes a GHCR y
   necesita `packages: write` y secretos del repositorio.
4. **Primera ejecución real del cutover en el VPS**, con ventana, backup y
   restore ensayado.
5. **Activación de `enforce` por tenant.** Es una decisión del dueño del negocio
   sobre su propio dinero, no un flag técnico.
6. **Llamadas reales a Meta** (plantillas aprobadas, webhooks de estado con
   `pricing` real, 131042 real) — todo lo probado usa fixtures.
7. **Credenciales/variables del candidate** (`CANDIDATE_PUBLIC_API_URL`,
   `CANDIDATE_PUBLIC_WA_URL`) que no existen todavía en el repositorio.
8. **Modelos pagos**: ninguna prueba de esta tanda llamó a un proveedor real.

---

## 8. Árbol de trabajo

Fuera de los commits, tal como se pidió: `CLAUDE.md`,
`docs/plan-profitability-2026-07.md`, `.validate-index.cjs` y
`docs/whatsapp-meta-pricing-2026-10.md`.

`docs/audits/2026-09-10/outbound-producer-inventory.md` se regeneró con su
generador y se commiteó con las tandas correspondientes, no como cambio ajeno.
