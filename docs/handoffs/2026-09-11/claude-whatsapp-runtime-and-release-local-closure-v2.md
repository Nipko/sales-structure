# Directiva para Claude: cierre local completo de WhatsApp, producto y release

## Punto de partida y mandato

Trabaja desde el HEAD que contiene la revisión independiente
[`whatsapp-runtime-independent-review-fd09179a.md`](../../audits/2026-09-11/whatsapp-runtime-independent-review-fd09179a.md).
El código funcional auditado termina en `fd09179a`; el commit siguiente sólo
añade esa revisión.

**No entregues otra tanda parcial como cierre.** Continúa de manera autónoma,
fase por fase, hasta que no quede una brecha local implementable. Si una prueba
encuentra otro defecto, corrígelo y continúa. Puedes informar progreso, pero el
handoff final sólo ocurre al terminar todo lo local.

Haz commits incrementales y pequeños, uno por invariante comprobable. No uses
`git add .`. Conserva intactas y fuera de todos tus commits estas cuatro entradas
ajenas:

- `CLAUDE.md`
- `docs/plan-profitability-2026-07.md`
- `.validate-index.cjs`
- `docs/whatsapp-meta-pricing-2026-10.md`

No hagas push, merge, deploy, activación de `enforce`, llamadas reales a Meta,
uso de modelos pagos ni gasto. Prepara todo para que esas acciones sean el último
paso revisable.

## Regla de evidencia

Una prueba que inspecciona si un archivo contiene una palabra no demuestra que
el runtime usa la dependencia. Cada cierre debe probar el camino que ejecuta la
aplicación: controller/processor/sink real, argumentos exactos, escrituras en
PostgreSQL y número de POSTs. Para cada P0 añade al menos una mutación breve:
quita el wiring o cambia el estado crítico y demuestra que la prueba se pone
roja. No compartas la misma función defectuosa entre el oráculo y el sistema
probado.

## Fase 1 — corregir los P0 económicos antes de ampliar producto

### 1. Receipt extremo a extremo

Une el camino real:

`apps/whatsapp webhook job → internal/channel-delivery-status → conversación +
ledger + pausa por funding`.

Condiciones de cierre:

1. El worker conserva `status.pricing` completo dentro del contrato normalizado.
2. El controller pasa realmente `spendLedger` al helper y aplica los códigos de
   financiación tardíos, incluido `131042`, sobre el número exacto.
3. Si la conversación se actualiza y el ledger no puede hacerlo, el receipt
   económico queda durable para reintento; no se confirma y se pierde. Evita una
   transacción distribuida fingida: usa inbox/outbox idempotente por receipt y
   estado, o una frontera equivalente demostrable.
4. Prueba el controller real y el job real para `sent`, `delivered`, `read`,
   `failed`, `billable:false`, pricing ausente y `131042`.
5. Duplicados, desorden y dos workers no mueven dinero ni pausa dos veces.

### 2. Separar aceptación, entrega y conciliación

- Renombra/elimina la semántica `delivered_unpriced` en el ACK de los tres
  sumideros. Un `wamid` deja el efecto en `accepted`, con exposición retenida.
- Sólo `delivered/read` permite liquidar; `failed` libera; `billable:false`
  liquida cero.
- Una fila sin precio autoritativo puede conservar una estimación o cota, pero
  no puede pasar a gasto `settled/charged` sólo por cumplir 72 horas.
- La conciliación debe consumir evidencia real y versionada del proveedor o
  dejar el caso como estimado/pendiente para una persona. La UI debe distinguir
  reservado, estimado, confirmado, liberado e incierto.
- Corrige comentarios, métricas y nombres para que no llamen “cargo real” a una
  cota superior.

### 3. Derecho exclusivo de transmisión y crash recovery

- Un lease `claimed` vencido puede volver a `idle`: prueba crash antes del POST.
- Un lease `in_flight` vencido nunca puede ser reclamado automáticamente: pasa a
  incertidumbre/reconciliación sin segundo POST.
- Prueba `claim` directo contra `in_flight` vencido, dos conexiones PostgreSQL y
  carrera claim/sweeper.
- Prueba el pase completo de mantenimiento, no helpers aislados. Al recuperar
  `claimed`, renueva o armoniza el lease de reserva para que el segundo barrido
  del mismo pase no lo convierta inmediatamente en `indeterminate`.

### 4. Franquicia de entregas

La franquicia se consume por entrega, no por intento. Modela una asignación
provisional con estas transiciones:

- authorize/accepted: retiene un cupo sin confirmarlo;
- delivered/read: lo confirma una sola vez;
- rejected/failed/crash-before-POST: lo devuelve;
- in-flight incierto: lo retiene hasta resolución;
- duplicado y concurrencia: nunca conceden dos veces.

Incluye frontera 999/1000/1001, cambio de mes WABA, dos workers, fallo y replay.

### 5. Otros P0/P1 del motor

- Si Meta rechaza el Flow y el fallback no se autoriza, libera el efecto original
  como rechazo concluyente. Cuenta POSTs y reservas.
- Aísla moneda por contador o rechaza una transición de moneda dentro del
  período con migración explícita. Nunca sumes minor units COP a un contador USD.
- Separa modo de observación de disponibilidad contable: `observe` puede medir
  qué habría bloqueado un tope, pero todo POST cobrable conserva identidad
  durable, intento y reserva/exposición. Un fallo de infraestructura, pagador,
  timezone o identidad no se convierte en permiso.
- Haz obligatorio `logicalEffectId` para todo efecto cobrable nuevo. La lectura
  legacy sólo recupera filas previas; no crea más deuda técnica.

No continúes a la siguiente fase hasta que una prueba de integración del camino
desplegado deje cada ACK, delivery, failure, allowance y pausa en el estado
correcto de BD.

## Fase 2 — conexión, credencial, WABA y remitente

1. La caché por cuenta nunca debe saltarse la autoridad de revocación. Diseña
   invalidación/versionado barato y fail-closed: desconexión, offboarding,
   rotación, expiración y token-health invalidan todas las claves afectadas.
2. Un cambio de System User/BISU tenant-wide invalida los números hermanos, no
   sólo el que completó la reconexión.
3. Al escoger un representante por WABA, filtra primero conexiones utilizables.
   Un número desconectado no puede ocultar uno activo.
4. Template seed/sync/status, recordatorios y resolución de categoría deben
   quedar ligados a la WABA/canal exactos. Dos WABAs con el mismo nombre de
   plantilla no se contaminan.
5. Unifica el DTO REST de sender (`phoneNumberId` o un único nombre canónico) en
   text/template/interactive/media/location y conserva compatibilidad explícita
   sólo si existe contrato publicado.
6. Corrige el límite Telegram según la longitud que el proveedor define después
   de interpretar entidades, con casos `&`, emojis y límites exactos.
7. Un fallo de infraestructura en `ProactiveSendConnection` deja trabajo
   durable/reintentable; un rechazo de configuración deja una tarea accionable.
   Ninguno desaparece tras un log.

## Fase 3 — durabilidad universal de las salidas

El censo actual tiene 25 productores fuera del carril durable y cero fuera del
gate económico. Lleva los 25 a un outbox común o demuestra una primitiva durable
equivalente con las mismas garantías:

- identidad lógica estable;
- decisión y payload antes del efecto remoto;
- un solo propietario del POST;
- ACK separado de delivery;
- retry seguro, COMMIT incierto y recuperación tras reinicio;
- receipt ligado al mensaje/historial;
- erasure y procedencia de aprendizaje;
- configuración del número pagador sin elección por antigüedad.

Actualiza el generador para distinguir claramente: call sites totales, capaces
de WhatsApp, cobrables por Meta, dentro del gate y dentro del carril durable.
El objetivo es **0 productores cobrables no durables**. Corrige la cifra obsoleta
26 → 25 mediante el generador, no editando la salida a mano.

## Fase 4 — control operable y experiencia del negocio

### Funding y tarjeta Meta

- Estado persistente por WABA/número con fuente y frescura: listo, ausente,
  restringido, desconocido/error y revisión pendiente.
- Probe del recurso correcto y lectura de `primary_funding_id` cuando aplique;
  403/timeout no equivalen a “sin tarjeta”.
- Assist guía al dueño a Meta, nunca recoge PAN/CVV, vuelve a consultar y sólo
  marca éxito por autoridad real.
- Separa visual y conceptualmente: suscripción Parallly, facturación de mensajes
  por Meta y cobros del negocio a sus clientes.
- La reanudación por 131042 requiere un probe o intento controlado y auditable;
  no una mera declaración que vacíe una cola vieja.

### Límites y panel

- API/UI para aviso, soft stop y techo por cuenta, número, contacto y tarea.
- Selector de conexión obligatorio en reglas, campañas, nurturing,
  recordatorios y demás productores proactivos cuando haya varios números.
- Resumen por número y mes calendario de su WABA, no “últimos 30 días” agregado.
- Estados de UI separados: cargando, sin datos, no disponible, error, estimado,
  pendiente y confirmado. Nunca conviertas un error de API en cero gasto.
- Estimador previo de campaña por país/categoría y aceptación explícita del
  presupuesto. Mantén respuestas entrantes durante soft stop; detén proactivos.

### Onboarding, Assist y contenido

Completa el recorrido guiado en móvil y escritorio, teclado y lector de pantalla,
en es/en/pt/fr. El negocio debe poder:

1. entender qué paga a Parallly y qué paga directamente a Meta;
2. conectar la cuenta y elegir número/WABA;
3. completar/verificar financiación en Meta;
4. elegir límites y remitentes proactivos;
5. probar el agente y leer qué falta;
6. activar sólo las tareas para las que está listo.

Alinea landing, manuales, ayuda contextual y
`apps/api/kb/assistant/{es,en,pt,fr}` con la evidencia ya investigada. No publiques
“mejor”, “más barato” ni diferencias absolutas frente al agente Meta sin
benchmark comparable. Explica el valor en tareas resueltas, herramientas,
continuidad multicanal, control humano, trazabilidad y costo total.

## Fase 5 — identidad Meta y coexistencia de agentes

- Implementa BSUID como identidad opaca de canal con teléfono opcional y
  procedencia; no lo normalices como E.164. Cubre webhook, CRM, conversación,
  tools, Flow, outbox, humano, aprendizaje, auditoría y borrado.
- Inventaría y valida BISU/System User por cliente, app, activos, scopes,
  expiración y revocación. El nombre de una columna no prueba el tipo real del
  token y no se permite fallback global silencioso.
- Modela control/handover/standby del agente externo de Meta para evitar doble
  respuesta. Estado, dueño del hilo, transición y recuperación deben ser
  durables y probados. Déjalo bajo feature flag hasta una cuenta real elegible.

## Fase 6 — candidato y cutover seguros

1. Reemplaza la etiqueta persistente por una autorización ligada al SHA y a un
   environment protegido; valida actor y repositorio. Separa permisos por job y
   concede `packages:write` sólo al job que publica.
2. Mapea cada servicio a su repositorio exacto en el lector del manifiesto.
   Añade mutación que intercambia API/Dashboard y debe fallar.
3. Publica artefactos consumibles sólo tras run verde. El manifiesto debe ligar
   SHA, conclusión release, inputs del bundle y cinco digests completos.
4. Candidate levanta PostgreSQL 17, PgBouncer transaction mode y Valkey
   noeviction; corre suites API sin omitidas, Dashboard y Playwright, además de
   los cinco typechecks/builds y generadores.
5. Convierte el cutover en un comando/script ejecutable y reanudable: inventario
   persistente y hasheado → restore desechable probado → barrera global de
   escritura → drenaje → backup → preflight → migraciones → imágenes por digest
   → salud → canario → reapertura.
6. Unifica formato de dump/restore. Todo fallo de restore es fatal y la prueba
   compara conteos/esquemas antes de tocar el VPS.
7. Fija cwd, proyecto compose, `GIT_SHA`, cinco digests y rutas absolutas. Ningún
   `compose up` aparece antes de completar restore y entrar en la ventana.
8. Ejecuta localmente migración limpia, upgrade desde estado anterior y bajo
   carga representativa sobre el HEAD final.

## Fase 7 — autoridad de cierre y validación final

Extiende `generate-closure-report.cjs` para que M0–M6 y R0–R6 sean filas
derivadas con condiciones ejecutables, artefactos y gates externos concretos.
No permitas que una declaración humana cierre código pendiente.

El número del canario debe salir de su generador: casos, llamadas y techo por
modelo. Corrige documentos divergentes automáticamente.

En el HEAD final ejecuta y registra:

- suite API completa con PostgreSQL/PgBouncer/Valkey, cero omitidas;
- al menos tres órdenes/shards sobre base compartida;
- Dashboard, Playwright desktop/móvil, typecheck y build de las cinco apps;
- bootstrap DI, lint, `git diff --check` y todos los `--check` de artefactos;
- migración limpia, upgrade, bajo carga y restore fail-closed;
- tests adversariales/mutaciones de cada P0;
- censo con cero cobrables fuera de gate y cero cobrables fuera de durabilidad;
- reporte M0–M6/R0–R6 generado desde el mismo SHA.

El reporte final debe decir con exactitud:

1. rango y commits;
2. defectos reproducidos y commit que los cerró;
3. resultados ejecutados, sin mezclar reportes de un HEAD anterior;
4. brechas locales restantes, que deben ser cero;
5. gates externos restantes, sólo los enumerados abajo;
6. árbol de trabajo y confirmación de las cuatro entradas ajenas intactas.

## Únicos gates externos permitidos en el handoff final

- push/PR y ejecución GitHub del candidato en el SHA final;
- variables/secretos reales;
- acceso, responsable y ventana del VPS existente;
- cuenta WABA/número/moneda/tarjeta/funding/permisos/plantillas reales;
- destinatario consentido, presupuesto y autorización de llamadas Meta;
- credencial/presupuesto de modelo, usuarios y revisores reales;
- aprobación explícita para migrar, desplegar y activar `enforce`.

Todo lo demás es trabajo local y debe quedar cerrado antes de devolver el
relevo.
