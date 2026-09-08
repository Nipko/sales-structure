# Runbook: carga, caos y SLOs del despacho durable

Hermano de `dispatch-reconciliation.md`. Aquel explica **cómo se opera** la cola de efectos inciertos; éste dice **qué se midió**, con qué condiciones, qué objetivos se pueden sostener con esos números y **qué alerta vigila cada uno** — incluidos los que hoy no vigila nadie.

Se separó a propósito. El runbook de reconciliación es un procedimiento que un operador abre a las 3 AM; esto es evidencia de ingeniería y contrato de nivel de servicio, y mezclarlos enterraría el procedimiento debajo de tablas de percentiles.

Regla que ordena todo el documento: **un número sin medición detrás no es un SLO, es un umbral inventado.** Cada fila dice si viene de una corrida real y con qué condiciones, o si está declarada sin medir.

## El harness

Dos suites, al lado del código que ejercitan, con el mismo portón que el resto de las suites PostgreSQL: sin las instancias desechables **saltan**, no fallan.

| Archivo | Qué rompe | Requiere |
| --- | --- | --- |
| `apps/api/src/modules/channels/durable-dispatch.load.spec.ts` | Concurrencia sobre las primitivas: ráfagas, contención de fila, borrado durante la entrega, estados duplicados/fuera de orden, efectos de handoff. | `PARALLLY_ISOLATION_TEST_URL` |
| `apps/api/src/modules/channels/durable-dispatch.chaos.spec.ts` | El camino completo con worker, cola y Valkey reales: caída de Valkey a mitad de ráfaga, proveedor que no contesta, worker muerto con el permiso en la mano, borrado en vuelo. | `PARALLLY_ISOLATION_TEST_URL` + `DISPATCH_QUEUE_TEST_REDIS_URL` |

`apps/api/src/common/__fixtures__/load-metrics.ts` es el registrador: percentiles por rango (sin interpolar, así un p95 impreso siempre es una latencia que la corrida vio de verdad) y una tabla al cierre de cada suite.

Decisiones que conviene conocer antes de leer los números:

- **La suite de carga maneja las primitivas directamente**, no `AgentDispatchOutboxStore`. Lo que se disputa es una fila entre transacciones; el store se ejercita entero en la suite de caos. La suite de carga sí toma el mismo cerrojo compartido de privacidad que toma el store antes de cada admisión y cada settle, porque si no, la carrera contra el borrado no sería la que corre en producción.
- **Valkey no se reinicia: se corta.** La suite levanta un portón TCP propio delante de Valkey y destruye lo que haya en vuelo. El contenedor es compartido con lo que sea que esté corriendo en paralelo, y una suite que mata infraestructura de la que dependen sus vecinas es una fábrica de flakes. Del lado del cliente es indistinguible de un reinicio.
- **El corte cae dentro del transporte, en la cuarta llamada.** Permiso confirmado, proveedor llamado, resultado sin escribir: esa ventana es la razón de existir de la tabla, y esperar a que el azar la produzca sería una prueba intermitente.
- **Los vencimientos de lease se adelantan por SQL**, no esperando el reloj. Lo que se prueba es la transición, no que `NOW()` avance.

### Cómo correrlo

```bash
cd apps/api
export PARALLLY_ISOLATION_TEST_URL='postgresql://postgres:...@127.0.0.1:55437/parallly_eval_isolation'
export DATABASE_URL="$PARALLLY_ISOLATION_TEST_URL"
export DISPATCH_QUEUE_TEST_REDIS_URL='redis://127.0.0.1:55440'
export NODE_OPTIONS=--max-old-space-size=6144
npx jest src/modules/channels/durable-dispatch --maxWorkers=2
```

Nunca `--runInBand` (no termina en este repo) y nunca dos invocaciones de jest a la vez. Sin las variables: `2 skipped, 19 skipped` — pero **con** `NODE_OPTIONS`, porque el grafo de módulos que importa la suite de caos revienta el heap por defecto igual que el resto de las suites de integración.

## Condiciones de la medición

Todos los números de abajo son de una corrida del **8 de septiembre de 2026** en la máquina de desarrollo, contra las instancias desechables locales. **No son números de producción** y no deben citarse como tales: la VPS tiene PgBouncer en medio, latencia de red al proveedor y vecinos ruidosos que acá no existen.

| | |
| --- | --- |
| Host | Windows 11 + WSL2 (Ubuntu), 24 vCPU, 30 GB RAM |
| PostgreSQL | 17.11 + pgvector, en Docker, loopback `127.0.0.1:55437`, **sin PgBouncer** |
| Valkey | 8.1.9, `noeviction`, loopback `127.0.0.1:55440`, detrás del portón TCP de la suite |
| Node / BullMQ / pg | v22.20.0 / 5.70.1 / 8.21.0 |
| Pool de la suite de carga | 12 conexiones, `search_path` en el paquete de arranque |
| Proveedor | doble en proceso; **cero llamadas reales**, cero llamadas a LLM |

## Lo que se midió

### Coste real de un turno, sin contención

25 turnos secuenciales, pool libre. Esto es el trabajo en sí, sin cola delante.

| Operación | p50 | p95 | n |
| --- | --- | --- | --- |
| `openTurnLedger` | 1 ms | 2 ms | 25 |
| `recordTurnResult` | 1 ms | 2 ms | 25 |
| `prepareDispatchBatch` (2 efectos + historial) | 5 ms | 6 ms | 25 |
| `admitDispatch` (con cerrojo de privacidad) | 3 ms | 3 ms | 50 |
| `settleDispatch` | 3 ms | 3 ms | 50 |

### Bajo saturación

24 conversaciones × 5 entrantes × **3 intentos compitiendo por cada entrante** = 360 intentos simultáneos sobre 12 conexiones. Los percentiles incluyen la espera por conexión: es lo que siente el operador, no el coste del trabajo.

| Operación | p50 | p95 | n |
| --- | --- | --- | --- |
| `openTurnLedger` | 53 ms | 94 ms | 360 |
| `recordTurnResult` | 98 ms | 101 ms | 360 |
| `prepareDispatchBatch` | 147 ms | 188 ms | 360 |
| `admitDispatch` — concedido | 51 ms | 178 ms | 240 |
| `admitDispatch` — rechazado (lease vivo) | 151 ms | 182 ms | 240 |
| `settleDispatch` | 48 ms | 104 ms | 240 |

**Rendimiento:** 120 turnos y 240 efectos entregados en **671 ms** → 178,8 turnos/s, 357,7 efectos/s. Con el worker, la cola y BullMQ reales y concurrencia 4: 20 efectos en 357 ms → **56 efectos/s**, con latencia de publicación a llamada al proveedor p50 184 ms / p95 275 ms.

**Espera por cerrojo:** con otra transacción reteniendo la fila 400 ms, la admisión disputada volvió a los **406 ms** — esperó la verdad en vez de adivinarla. Nunca devolvió "no disponible".

### Distribución de estados terminales

| Escenario | Resultado |
| --- | --- |
| Ráfaga (240 efectos, 360 intentos) | 240 `sent`, 240 admisiones concedidas, 240 rechazadas por lease vivo, **0 llamadas duplicadas al proveedor** |
| Borrado durante la entrega (10 intentos) | 1 `sent` (el settle ganó), 9 `reconciliation_required`; **0 entregas de palabras borradas**, 10/10 con `payload` nulo |
| Valkey caído 1500 ms a mitad de ráfaga (14 filas) | 13 `sent`, 1 `reconciliation_required` (justo la que no pudo escribir su resultado), 14 llamadas al proveedor, **0 repetidas**, todo terminal 3,15 s después de publicar |
| Proveedor que no contesta (lease 5 s, respuesta 6,5 s) | `reconciliation_required` con `lease_expired_after_admission`, 1 sola llamada, **0 reintentos automáticos** |
| Worker muerto entre admisión y settle | `reconciliation_required`; el mismo trabajo entregado de nuevo a un worker nuevo **no produjo un segundo envío** |

### Coste de las lecturas de operación

`expireDispatchLeases` sobre 20 permisos vencidos: **2 ms**. `readDispatchBacklog` sobre 29 filas: **2 ms**. Listado de reconciliación (límite 200): **2 ms**. `redactDispatchOutbox` por contacto: p50 4 ms / p95 6 ms.

## SLOs

Cinco objetivos. Cada uno dice de dónde sale y **quién lo mira**.

### 1. Pérdida — 0 efectos preparados que nunca alcancen un estado terminal

Un `agent_dispatch_outbox` en `prepared`, `queued` o `failed` con `available_at` en el pasado es una respuesta que el cliente está esperando. **Objetivo: 0 filas con más de 10 minutos en ese estado.** Diez minutos son cinco pasadas de `dispatch-recovery` (`*/2`), suficiente margen para un despliegue.

- **Base:** medido indirectamente. En las cinco corridas de caos ninguna fila quedó fuera de un estado terminal; el corte de Valkey de 1500 ms se recuperó por completo en 3,15 s incluyendo la pasada. No se midió el comportamiento con la pasada de recuperación caída.
- **Quién lo vigila: NADIE.** `checkDispatchBacklog` cuenta **sólo** `reconciliation_required`. `queue:outbound-messages:*` mira la profundidad de BullMQ (warn 500 / crit 2000), que es otra cosa: una fila sin job publicado es invisible para las dos. Es el hueco de observabilidad más grande del camino, y es exactamente el modo de fallo que el outbox existe para volver recuperable. **Cerrarlo pide una consulta análoga a `readDispatchBacklog` sobre los estados disponibles con `available_at < NOW() - 10 min`.**

### 2. Duplicación — 0 efectos remotos repetidos

**Objetivo: cero.** No admite umbral: la segunda copia ya llegó al cliente.

- **Base:** medido. 240 efectos con 3 intentos simultáneos cada uno → 240 llamadas, 0 repetidas. 14 filas con Valkey desapareciendo a mitad → 14 llamadas, 0 repetidas. Worker muerto + trabajo reentregado → 1 llamada. Borrado en vuelo × 10 → 1 llamada por fila.
- **Quién lo vigila: NADIE, y no puede vigilarlo nadie desde dentro.** El sistema no puede contar los envíos que hizo el proveedor; sólo cuenta los permisos que concedió. La garantía es estructural (`attempts` se incrementa en la transacción de admisión, que confirma antes de la llamada) y lo que la prueba es este harness, no una métrica de producción. El sustituto operativo es la cola de reconciliación: **cada fila ahí es un caso donde el sistema eligió no arriesgar un duplicado.**

### 3. Backlog de reconciliación — < 20 filas en toda la plataforma

- **Objetivo:** el que ya está codificado, `dispatchReconciliation.backlog = 20` (editable desde el panel de alertas).
- **Base:** **no medido contra volumen de producción.** Sale del razonamiento que está escrito en `alert-config.service.ts` (un puñado es la tarde de una persona; veinte a la vez es algo sistémico), no de una serie histórica. El harness sí midió que **el coste de leerlo es despreciable** (2 ms sobre 29 filas), así que bajar el umbral no cuesta nada del lado del monitor.
- **Quién lo vigila:** `dispatch:reconciliation:backlog` en `platform-monitor.service.ts`, cron `11,26,41,56 * * * *` (cada 15 min), severidad *warning*.

### 4. Edad de reconciliación — ninguna fila por encima de 1 hora

- **Objetivo:** `DISPATCH_RECONCILIATION_SLA_SECONDS = 3600`, con umbral de alerta en **la primera** fila que lo cruce (`overdue: 1`).
- **Base:** el plazo de una hora es una decisión de producto, no una medición. Lo que sí se midió es el tramo mecánico: desde la publicación hasta que la fila queda en `reconciliation_required` pasaron **5,6 s** con un lease de 5 s y una pasada de recuperación forzada. En producción ese tramo está acotado por el lease de 120 s más el cron `*/2`, es decir **hasta ~4 minutos**; el resto de la hora es tiempo humano y **no está medido**.
- **Quién lo vigila:** `dispatch:reconciliation:overdue`, mismo cron, severidad **critical** (está en `CRITICAL_KEYS`).

### 5. Latencia — p95 de admisión y settle por debajo de 500 ms

- **Objetivo:** p95 < 500 ms para `admit` y para `settle`, medido dentro del worker.
- **Base:** medido, con margen deliberado. Sin contención: 3 ms. Con 360 intentos simultáneos sobre 12 conexiones: 178 ms y 104 ms de p95. Los 500 ms dejan sitio para PgBouncer y para una VPS más chica que estas 24 vCPU; **no está medido a través de PgBouncer**, que es la diferencia más grande entre esta máquina y producción.
- **Quién lo vigila: NADIE.** No hay métrica de latencia de despacho. Lo más cercano es `pgbouncer` (`warnSec 5 / critSec 20`), que mide otra cosa, y la profundidad de `outbound-messages`, que sube *después* de que la latencia ya se degradó. **Un contador de duración alrededor de `admit`/`settle` en `OutboundQueueProcessor` sería el camino más barato.**

### Resumen de cobertura

| SLO | Objetivo | ¿Medido? | Alerta |
| --- | --- | --- | --- |
| Pérdida | 0 filas > 10 min sin estado terminal | Indirecto | **ninguna** |
| Duplicación | 0 | Sí (harness) | **ninguna** — garantía estructural |
| Backlog de reconciliación | < 20 | No (razonado) | `dispatch:reconciliation:backlog` |
| Edad de reconciliación | < 1 h | Tramo mecánico sí, tramo humano no | `dispatch:reconciliation:overdue` (critical) |
| Latencia admisión/settle | p95 < 500 ms | Sí (sin PgBouncer) | **ninguna** |

## Hallazgos abiertos que encontró el harness

Se registran acá tal como se midieron; **no se corrigieron en esta tanda** y las pruebas afirman el comportamiento observado, no el pretendido, para que el harness no finja que un invariante se cumple cuando no.

### H1 — Un `failed` concurrente sí degrada `delivered` (P0)

`applyDispatchProviderStatus` toma `FOR UPDATE OF d` sobre la fila del outbox, pero decide con el `messages.status` que trajo **esa misma sentencia**, leído del snapshot anterior al cerrojo. Dos webhooks del mismo recibo en vuelo a la vez se serializan bien y después deciden sobre un valor ya viejo: el `failed` tardío ve `sent`, pasa el rango y escribe `failed` sobre un `delivered` confirmado. Reproducido 8/8 en la sonda y de forma determinista en la suite.

En producción se alcanza cuando hay dos cuerpos de webhook simultáneos para un recibo: reintentos de Meta, o la API y la app WhatsApp aplicando estados a la vez. `channel-delivery-status` serializa los eventos **dentro de un cuerpo**, que es la razón por la que ninguna prueba existente lo veía.

Segunda cara del mismo mecanismo: diez copias concurrentes de un `delivered` idéntico informan `applied` las diez. Ahí no cuesta nada — las escrituras son iguales — pero es el mismo síntoma barato del mecanismo caro de arriba.

**Arreglo:** cerrar `messages` con la misma sentencia (`FOR UPDATE OF d, m`) o releer el estado después de conceder el cerrojo. Prueba que lo fija: `FINDING: a rejection concurrent with an acceptance does degrade `delivered``.

### H2 — Un efecto de handoff con lease vencido nunca llega a `unknown` (P1)

`admitHandoffEffect` escribe la transición a `unknown` y **acto seguido lanza** desde la misma transacción. `handoff.service.ts:394` lo llama dentro de `transactionInTenantSchema`, así que Prisma revierte la escritura junto con el rechazo: la fila se queda en `admitted` detrás de un lease muerto, para siempre.

El outbox de despacho se niega a hacer esto a propósito — `admitDispatch` lleva un comentario explícito de "deliberately no write here" y deja la transición a `expireDispatchLeases`. **Para los efectos de handoff no existe esa pasada**, y `readUncertainHandoffEffects` no tiene ningún llamador en producción: sólo lo referencian las pruebas.

Lo que sí se cumple: no hay segundo mensaje de Slack ni segundo SMS pago; toda admisión posterior se rechaza. Lo que no: nadie se entera nunca de que el efecto quedó incierto. Y como la fila nunca sale de `admitted`, el titular del lease vencido todavía puede escribir su resultado — el lease acota quién puede intentar, no hasta cuándo vale una respuesta.

La suite existente no lo veía porque maneja un `Client` de `pg` en autocommit, donde la escritura sobrevive al `throw`.

**Arreglo:** no escribir dentro del rechazo (como el outbox), y agregar una pasada de vencimiento equivalente a `expireDispatchLeases` más un consumidor real de `readUncertainHandoffEffects`.

### O1 — El recibo de una aceptación tardía se descarta (observación)

Cuando el lease vence con la petición en el aire, `settleDispatch` rechaza el lease que la fila ya no tiene (`dispatch_lease_lost`) y el recibo que el proveedor sí devolvió no se escribe en ningún lado. Es coherente con el diseño — la fila ya es de la reconciliación —, pero deja al operador buscando a mano en WhatsApp Manager el dato que el proceso tuvo en la mano. Verificado en `leaves the row uncertain when the lease lapses mid-request`.

## Lo que este harness NO cubre

Decirlo importa tanto como los números:

- **PgBouncer.** Todo corre contra PostgreSQL directo. El modo transacción y su cola de espera son la diferencia más grande contra producción y no están medidos.
- **Proveedores reales.** El transporte es un doble en proceso. Cero llamadas a Meta y cero llamadas a LLM: esta máquina no tiene credenciales.
- **Volumen representativo de un tenant real.** 120 turnos y 240 efectos ejercitan las carreras; no dicen nada sobre 10.000 filas ni sobre el plan de la consulta de backlog a esa escala.
- **Migración bajo volumen.** La migración de las tablas a tenants existentes está en `dispatch-reconciliation.md`; no se corrió con carga encima.
- **El tramo humano de la reconciliación.** Cuánto tarda una persona en cerrar una fila no se puede medir sin un piloto.
