# Relevo a Claude: cierre real del runtime de WhatsApp y candidato

## Mandato

Continúa desde `cee0cd5cc1f48bbf09ce48cdc7a7fa9672bc722a` y cierra **todo el
trabajo local** descrito aquí. No aceptes como autoridad el reporte de cierre de
la tanda: primero lee y reproduce
`docs/audits/2026-09-10/whatsapp-runtime-post-closure-independent-review.md`.

El resultado esperado no es otro plan. Es código, migraciones aditivas, pruebas,
interfaces, documentación y un reporte derivado que deje únicamente gates
externos verdaderos.

Trabaja con commits pequeños e incrementales. No hagas `git add .`, reset,
rebase, squash ni limpieza del árbol. Conserva fuera de tus commits estas cuatro
entradas ajenas:

- `CLAUDE.md`
- `docs/plan-profitability-2026-07.md`
- `.validate-index.cjs`
- `docs/whatsapp-meta-pricing-2026-10.md`

No hagas push, merge, despliegue, activación de `enforce`, llamadas a Meta ni a
modelos con costo. No uses credenciales reales. No declares listo para desplegar
mientras quede un bloqueo local de este documento.

## Regla de diseño

Para cada POST cobrable debe existir exactamente un efecto lógico durable, una
decisión de transmisión y una reserva que cubra todos sus contadores. Un retry no
crea otro efecto ni otro cargo. Un resultado desconocido no dispara otro POST. La
indisponibilidad del medidor no concede permiso: difiere el efecto y genera una
alerta operativa, sin perder el mensaje entrante.

El control económico debe ser una propiedad ejecutable de la ruta, no la
presencia de una palabra o llamada en el mismo archivo.

## Fase 1: corregir la autoridad económica

1. Define una identidad única de envío desde el resolvedor real de conexión y
   úsala en los tres sumideros. Debe incluir tenant, schema, canal, cuenta/número,
   dirección, WABA pagadora, negocio pagador, credencial id/source/estado,
   destinatario anonimizado, mercado ISO, moneda, categoría Meta, disposición,
   efecto lógico y bindings durables.
2. No decidas `payerKind` por la presencia de un parámetro opcional. La autoridad
   debe derivarlo de la conexión ya resuelta y fallar con diagnóstico si la
   evidencia no existe.
3. Obtén y persiste la moneda real de la WABA desde la evidencia de Meta. Añade
   source, observed-at y freshness; no permitas un valor libre sin procedencia.
4. Deriva el país tarifario desde el número **destinatario** antes de anonimizarlo.
   Usa una autoridad versionada, prueba números internacionales y conserva sólo
   el ISO necesario en el ledger. No uses un `billingMarket` fijo por número
   emisor.
5. Resuelve la categoría canónica (`service`, `marketing`, `utility`,
   `authentication`, `authentication_international`) desde la plantilla/ventana y
   su metadata real. Elimina el pseudo-tipo `template` y el default silencioso a
   `service` para mensajes proactivos.
6. Cambia el orden transaccional: reclama/posee el efecto antes de otorgar
   franquicia o modificar contadores. Dos `authorize()` concurrentes con el mismo
   efecto deben dejar una reserva, un conjunto de allocations y un solo cambio de
   contadores.
7. Corrige la aritmética. `released_minor` puede conservarse como acumulado
   histórico, pero no se resta después de haber reducido `reserved_minor`.
   Demuestra el saldo tras liquidación parcial, rechazo total, múltiples releases
   y reintentos.
8. Rediseña `effectKey` alrededor de un `logicalEffectId` durable. Incluye el ID
   estable de dispatch/batch/inbound/task cuando corresponda; contenido idéntico
   en dos campañas distintas no colisiona. La deduplicación semántica queda como
   política aparte.
9. Usa `mayTransmit()` o un contrato equivalente en cada sink. Adoptar una fila
   `settled`, `released`, `pending_reconciliation` o `indeterminate` nunca concede
   otro POST.
10. Inicializa la franquicia mensual por número de manera productiva y configurable
    desde fuente autoritativa. Sólo aplica a categorías elegibles. Prueba el cruce
    de mes en la zona WABA y varios números del mismo tenant.
11. Haz que los fallos de gate/schema/DB difieran el efecto durable. Quita la
    inyección opcional en módulos que pueden enviar WhatsApp y añade bootstrap
    tests que fallen si falta la autoridad.

Commits sugeridos, uno por invariante: identidad y pricing; ownership concurrente;
aritmética; effect key/transmisión; franquicia; fail-closed con defer.

## Fase 2: un POST por efecto y lifecycle completo

1. Separa Flow y fallback de texto en dos efectos. Sólo crea el fallback después
   de un rechazo concluyente que pruebe que el Flow no ocurrió. Timeout, conexión
   perdida o respuesta ambigua quedan `indeterminate` y pasan a reconciliación.
2. Modela `accepted`, `sent`, `delivered`, `read`, `failed`, `priced`,
   `released` e `indeterminate` según la evidencia que realmente existe. Un ACK de
   POST no puede escribirse como `delivered`.
3. Liga los status webhooks de WhatsApp al efecto/reserva por provider message id.
   Actualiza idempotentemente el ledger y los recibos del historial.
4. Implementa el reconciliador económico y un scheduler PostgreSQL/BullMQ
   operable. Ejecuta `sweep()` de forma real, con lease, backoff, auditoría,
   métricas, alerta y resolución manual para lo que Meta no permita reconciliar.
5. Define retries por estado. Una reserva retenida no se retransmite hasta una
   decisión explícita y auditable; un rechazo probado puede liberar o abrir un
   intento nuevo con identidad propia.
6. Conecta 131042 en strict, loose, REST y agent console. Pausa sólo el número
   afectado, detén retries cobrables, conserva inbound y expón una acción de
   verificación/reanudación. Evita el deadlock en el que la única forma de limpiar
   la pausa es lograr un POST que la propia pausa impide.
7. Haz que el presupuesto de lote sea fail-closed y use el mismo mes local que
   cada worker. Un fanout no comienza si su techo no quedó confirmado.

No cierres esta fase sin pruebas de timeout después de aceptación, webhook
duplicado/desordenado, COMMIT incierto, crash antes/después del POST y
reconciliación repetida.

## Fase 3: remitente exacto y durabilidad

1. Añade selector obligatorio de conexión WhatsApp a la UI de reglas y a cada
   productor proactivo que no herede una conversación WhatsApp inequívoca.
2. En tenants multinúmero, ausencia o ambigüedad devuelve una tarea de
   configuración; nunca el número más viejo. IDs de Instagram, Messenger,
   Telegram o widget no pueden convertirse en `phoneNumberId` de WhatsApp.
3. Corrige `nurturing.executeAttempt2`: una plantilla debe conservar tipo,
   categoría y nombre reales y pasar por los mismos controles de consentimiento,
   opt-out, ventana, frecuencia, cuenta, presupuesto, outbox y recibo.
4. Lleva a cero los 26 productores fuera del carril durable, o registra cada
   excepción temporal con dueño, fecha de retiro, garantía equivalente y feature
   flag apagado. El objetivo de esta entrega es cero excepciones cobrables.
5. Refuerza el censo para demostrar dominancia por call site y cardinalidad entre
   POST y admisión. Añade una sonda con un segundo POST sin gate dentro de un sink
   ya marcado y una sonda Flow+fallback.

## Fase 4: candidato y cutover ejecutables

1. En `candidate.yml`, usa `inputs.sha` en `workflow_dispatch`.
2. Liga la autorización por etiqueta al SHA revisado. No ejecutes código mutable
   de una PR con secretos y `packages: write` por conservar una etiqueta. Usa
   environment protegido/aprobación por SHA, valida repositorio/actor y limita
   permisos por job.
3. Añade y propaga en `Dockerfile.dashboard` los cuatro build args faltantes:
   Messenger config, Instagram app, Instagram redirect y VAPID. Crea un test que
   cruce los once valores del workflow, Dockerfile, build y manifiesto.
4. Endurece el consumidor: exige `version === 2`, SHA completo, repositorios de
   allowlist, tag exacto `candidate-<sha>`, digest completo y serialización YAML
   segura. Rechaza `#`, espacios, saltos, esquemas y repositorios inesperados.
5. No publiques artefactos consumibles de un run rojo, o marca su estado de forma
   que el runbook los rechace. El manifiesto debe ligar el SHA con CI release
   verde y registrar todos los inputs públicos sin exponer secretos.
6. Ejecuta en candidate las suites PostgreSQL/PgBouncer, Dashboard y Playwright,
   además de API, typecheck, lint y builds. El runbook no puede llamar “completa”
   a una matriz que omite esas capas.
7. Reordena el runbook para que nada se reemplace antes de inventario, ensayo de
   restore, ventana y backup. Añade una barrera global de escritura que cubra API,
   webhooks, WhatsApp, workers, crons, queues y túnel/ingreso.
8. Haz persistente `/evidence` o escribe a un bind mount existente; crea el
   directorio y verifica el hash del inventario.
9. Unifica el formato real de backup y restore. Proporciona comandos exactos,
   fail-closed, para el `pg_dump --format=custom` que se genera, o cambia ambos
   lados a un formato probado. Ensaya restore de public y todos los schemas,
   conteos y tiempos.
10. Corrige cwd/rutas de compose, fija `GIT_SHA` al manifiesto y verifica los cinco
    contenedores por digest después de arrancar.

No ejecutes el workflow ni el VPS todavía; deja ambos caminos verificables con
fixtures y contratos locales. La primera ejecución real queda como gate externo.

## Fase 5: producto y configuración comprensibles

1. Corrige el panel para usar mes calendario WABA y desglose por número. No
   compares la suma de varios números con una franquicia única.
2. Separa estados `loading`, `unavailable`, `empty`, `reserved`, `retained`,
   `settled` y `released`. No llames “entregado” a held/indeterminate.
3. Devuelve la pausa 131042 desde readiness y muestra causa, número, impacto,
   acción y última verificación.
4. Implementa funding readiness con `primary_funding_id` o evidencia vigente
   equivalente: source, timestamp, freshness y relectura al volver de Meta. La
   tarjeta siempre se gestiona en Meta; Parallly no captura ni almacena sus datos.
5. Añade API/UI auditada para aviso, soft stop, hard cap y transición gradual
   `observe -> enforce` por tenant/número. Muestra moneda, mes, estimación,
   exposición incierta y quién cobra cada concepto.
6. Construye el recorrido guiado completo: conectar número, confirmar pagador,
   abrir Meta para método de pago, volver y verificar, elegir límites, hacer
   canario consentido y leer recibo/costo. Debe funcionar por teclado, móvil y en
   es/en/pt/fr.
7. Actualiza landing, manual de usuario, referencia de capacidades y
   `apps/api/kb/assistant/{es,en,pt,fr}` desde las mismas claves/contratos. Assist
   debe detectar cada blocker, explicar por qué importa, abrir la pantalla exacta
   y releer el estado después de la acción.
8. Localiza la guía de zona horaria y corrige el copy comercial: Meta cobra los
   mensajes elegibles según su tarifa y excepciones; Parallly cobra su plan; el
   método de pago de Meta es separado y permanece en Meta.

## Fase 6: programa completo del agente

1. Incorpora M0-M6/R0-R6 al generador de cierre. No permitas que “0 abiertas”
   ignore requisitos nuevos ni que una declaración humana sustituya un contador
   o artefacto cuando el código pueda derivarlo.
2. Cierra M0 con inventarios de identidad, modelos, media, RAG, Assist,
   certificación, planes y una exportación sanitizada de configuración runtime por
   tenant/conexión.
3. Cierra M4/M5: propuesta comercial y planes versionados, migración/paridad,
   propósito/origen de mensajes WhatsApp dentro de learning y detección/control
   de un agente externo de Meta para evitar respuestas dobles.
4. Implementa la identidad por usuario que exija el contrato vigente de Meta
   cuando aplique (BSUID/BISU o equivalente), con fallback y diagnóstico
   documentados; no inventes el requisito desde prosa histórica.
5. Corrige la cifra documental del canario: 244 casos, 724 llamadas y techo
   US$1,24, salvo que el generador autoritativo produzca otra cifra.

## Pruebas de aceptación obligatorias

- PostgreSQL real: autorización concurrente del mismo efecto; efectos distintos
  en el último centavo; liquidación parcial seguida de otra reserva; release
  repetido; franquicia 999/1000/1001; cambio de mes y zonas horarias; multi-WABA,
  multinúmero y multidestino.
- E2E de transporte: una reserva/POST/recibo; timeout Flow sin fallback; rechazo
  concluyente con fallback como nuevo efecto; retry después de cada estado;
  131042 en los cuatro caminos; webhook duplicado y fuera de orden.
- Migraciones limpias, upgrade y bajo carga en todos los schemas, con PgBouncer en
  modo transacción y `DIRECT_DATABASE_URL` para migrar.
- Tests de seguridad del candidate con SHA cambiado después de etiqueta, fork,
  actor no permitido, tag/repo/YAML malicioso, run rojo y build args ausentes.
- Dashboard unit/e2e y Playwright de onboarding económico en escritorio/móvil,
  teclado y cuatro idiomas.
- Suite completa API con PostgreSQL/PgBouncer habilitados, cero fallos y cero
  omitidos; Dashboard, Playwright, typecheck, lint, bootstrap y builds de las cinco
  apps; `git diff --check`; todos los generadores en `--check`.
- Tres órdenes de suite contra una base compartida con `--maxWorkers=2` para
  detectar sensibilidad al orden.

Las pruebas que calculan ambos lados con el mismo helper no prueban una fórmula.
Incluye oráculos independientes para dinero, effect keys, digests y manifiestos.

## Definición de terminado local

La tanda termina sólo cuando:

- no queda ningún P0/P1 local de la auditoría;
- cada POST cobrable está dominado por una decisión durable y uno solo;
- `observe` registra una reserva válida y `enforce` permite casos válidos sin
  bloquear toda la plataforma;
- contadores y panel concilian después de settle/release/retry;
- los 26 productores no durables llegan a cero o están apagados con garantía
  equivalente explícita;
- selector, funding, tours, Assist, landing y manuales están completos en cuatro
  idiomas;
- candidate y cutover son ejecutables y sus pruebas adversariales pasan;
- el reporte derivado incluye A1-H3 y M0-M6/R0-R6, enumera cero brechas locales y
  separa por nombre cada gate externo;
- el árbol sólo conserva las cuatro entradas ajenas indicadas al inicio.

Al terminar, informa rango exacto de commits, defectos encontrados durante la
implementación, matrices ejecutadas, omisiones, gates externos, estado de 76
perfiles y 5 canales, y un veredicto honesto de deploy. No conviertas “preparado”
en “probado” ni “aceptado por el proveedor” en “entregado/cobrado”.
