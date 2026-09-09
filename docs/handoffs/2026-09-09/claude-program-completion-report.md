# Informe de cierre — programa de plataforma y agente

9 de septiembre de 2026. Rango: **`30a79102..HEAD`**. Sin `push`, sin despliegue, sin activación productiva y sin una sola llamada a un proveedor real. Todo lo que toca una base de datos corre contra instancias desechables en loopback (PostgreSQL 55437, PostgreSQL+pgvector 55439, Valkey 55440, PgBouncer 55438); ninguna URL de producción aparece en ningún comando de esta tanda.

Este informe no usa porcentajes para declarar cierre. Lo que está aceptado se nombra aceptado; lo que no, nombra el gate externo exacto que lo detiene.

---

## 1. Lo que esta tanda encontró

La tanda anterior entregó el **ledger durable del turno** como P0 cerrado, y lo era: la tabla existía, la migración existía, sus pruebas unitarias pasaban. Lo que faltaba era comprobar que el runtime pudiera **alcanzarla**.

El arnés de punta a punta —una sola conversación de cliente, desde el webhook firmado hasta un estado de entrega, sobre el controlador real, las dos colas BullMQ reales, el turno real, el outbox real, el escritor único de estados y un socket de navegador real— encontró que no podía. Tres defectos, los tres en junturas que ninguna suite unitaria mira — y detrás de ellos, al correr la suite como corresponde, cuatro más:

**1. El ingreso desplegado de WhatsApp confirmaba con 200 un mensaje que nunca llegó a la cola.** El controlador estaba bien y su propio comentario lo decía: *«Si encolar falla se devuelve 500 A PROPÓSITO: Meta reintenta»*. El servicio debajo se tragaba el fallo del `enqueue`, liberaba la reclamación de idempotencia «para que Meta reintente» y volvía normalmente. Meta reintenta exactamente lo que **no** le confirmamos, así que el 200 garantizaba que ese reintento no vendría: liberar la reclamación no salvaba nada. Una caída transitoria de Valkey no demoraba un turno, lo borraba — en la única de las siete rutas de ingreso que el trabajo de cero-pérdida había dejado atrás. (`bff8d01f`)

**2. `saveMessage` devolvía un duplicado sin `id`.** `ON CONFLICT DO NOTHING` no devuelve fila, y la función respondía `{ duplicate: true }` y nada más. Todo lo durable de un turno reanudado se busca por ese id, así que en una redelivery el turno no tenía ninguno: el ledger no se abría ni se leía (guarda `PERSISTED_ID`), el lote comprometido no se encontraba, y `settle` no se escribía nunca. En concreto: el sobre, el enlace de pago, los adjuntos, los escritores y las fuentes aprendidas del intento interrumpido se perdían; la respuesta salía por la ruta legacy mientras el lote que la poseía se quedaba en `prepared`; y un turno terminado no registraba jamás que había terminado. **El ledger era inalcanzable justo en el intento para el que existe.** (`2685883d`)

**3. El caché de palabras se escribía delante del sobre.** `turn:reply:*` es anterior al ledger y se escribía apenas el modelo respondía. Un corte en esa ventana dejaba al sistema prefiriendo una memoria incompleta a una completa: el reintento repetía el texto y tiraba el enlace, las fotos, los escritores y las fuentes, porque palabras es todo lo que esa clave puede guardar. Movido detrás del `recordResult`, sólo puede ser el respaldo de un turno cuyo ledger no existe, que es el único caso para el que se creó. De paso deja de cachear una respuesta cuya procedencia fue **rechazada**: esa respuesta no sale por ningún camino, y una copia quedaba un día en Redis donde una redelivery podía reproducirla. (mismo commit)

Los dos «defectos conocidos» que el propio arnés había documentado —la respuesta que volvía por la ruta legacy perdiendo el enlace y la foto, y el cliente contestado por segunda vez— eran **síntomas del segundo**. Sus comentarios pedían explícitamente que, si el ledger llegaba a ser alcanzable, las pruebas fallaran y se reescribieran a la afirmación fuerte. Fallaron, y se reescribieron.

Después, correr la suite completa **con las bases conectadas** —no con las suites PostgreSQL auto-omitidas, que es como se habían obtenido los verdes anteriores— destapó dos más, uno tapando al otro:

**4. Una retractación fallaba con 42703 y abortaba la retirada completa del release.** `redactPendingDrafts` actualizaba `conversations` dando por hechas las columnas `metadata` y `updated_at`. Corre dentro de la valla exclusiva de privacidad del llamador, así que el throw no perdía una sentencia: revertía **toda** la retirada. Un solo tenant mal aprovisionado hacía imposible cualquier retractación. (`ce0cc4b5`)

**5. Y debajo de ese fallo, que lo escondía: un `rollback` de operador borraba del historial del cliente.** `rollback` había sido enseñado a llamar a `retireLearningReleases` para que un release retirado no siguiera llegando a nadie por el outbox, el sobre y el borrador pendiente. Correcto: esos tres son material interno de replay. Pero `redactWidgetAgentReplies` no lo es — blanquea la fila de `messages` (`content_type='redacted'`, texto NULL). Un operador que retiraba un release porque no le gustaba el estilo **borraba, del historial de cada cliente, cada respuesta que ese release había producido**. Nadie pidió que se reescribiera esa conversación, y la persona dueña de esas palabras no fue consultada. La suite decía que el contrato se respetaba: lo decía porque el defecto 4 abortaba la transacción antes de llegar ahí. Dos defectos anulándose, en corridas sin base que no podían notarlo. (`9aafb2a9`)

**6. Y un reloj congelado que hacía perder trabajo.** `NOW()` se congela al comenzar la transacción. `claim`, en el store de releases, lo usaba para decidir si una evaluación ya tocaba — y esa sentencia **espera**: toma la valla de privacidad y lee el candidato `FOR UPDATE`, así que bajo carga puede empezar, bloquearse detrás de la transacción que todavía está creando la evaluación, y recién entonces leer un `next_attempt_at` posterior a su propio reloj congelado. El UPDATE no matcheaba nada y `claim` respondía `null` —«no hay trabajo»— por un trabajo que sí tocaba. En el mismo fichero `assertExecutionLease` preguntaba si el lease seguía vivo con `clock_timestamp()` y `checkpoint` con `NOW()`: **el mismo `lease_valid` eran dos preguntas distintas según quién preguntara.** Apareció porque el arnés fue instrumentado para decir por qué un claim devolvió null (`359981d4`), y la primera vez que volvió a pasar imprimió la fila entera. El outbox de despacho conserva `NOW()` a propósito: allí un reloj atrasado lee un lease vencido como vivo, lo cual erra hacia **no soltar nunca** un lease antes de tiempo —demora una recuperación, jamás entrega dos veces— y cambiarle la semántica al camino de entrega es una decisión con su propia revisión. (`67a01566`)

**7. Y un error de tipos que el build incremental venía saltando.** `caller.source.match(re) || []` estrecha el parámetro del filtro a `never`. Fallaba desde que se escribió; ningún `tsc --noEmit` local lo veía porque `apps/api/tsconfig.json` tiene `incremental: true` y reusaba un `.tsbuildinfo` que ya lo había aceptado. Apareció al borrar los cuatro ficheros de build info y typechequear los seis paquetes en frío, que es lo que hace un checkout limpio de CI. (`e43097d3`)

Por último, **el hueco de PgBouncer dejó de ser un hueco**. El arnés lo declaraba como ausencia honesta («no hay imagen de PgBouncer en esta máquina»). La hay: `edoburu/pgbouncer` en modo transacción con un pool de **uno**, de modo que todos los clientes caen en la misma conexión de servidor y el compartir es determinista en vez de probable. Eso convierte tres advertencias en hechos reproducibles: un `SET` plano, una tabla temporal y un candado consultivo **de sesión** viajan de un cliente al siguiente, y ese candado puede ser **liberado por un cliente que nunca lo tomó**. Eso último es por qué `prisma migrate` corre sobre `DIRECT_DATABASE_URL` — un hecho sobre el proxy, no sobre nuestro SQL — y ahora es una prueba y no un párrafo. (`166c90f0`)

---

## 2. Commits del rango

94 commits locales entre `30a79102` (exclusive) y `HEAD`. Los trece de esta tanda, uno por línea de comportamiento:

| Commit | Comportamiento |
| --- | --- |
| `bff8d01f` | El webhook propio de WhatsApp deja de confirmar un mensaje que no llegó a la cola |
| `2685883d` | El turno reanudado recibe el id con el que encuentra su propio ledger, su lote y su `settle` |
| `ce0cc4b5` | Una retractación no falla porque no hubiera borrador que retirar |
| `9aafb2a9` | Un `rollback` retira un release; no reescribe la conversación de un cliente |
| `cf2540da` | Un mensaje de cliente, de punta a punta, por la maquinaria real (18 casos) |
| `166c90f0` | Los primitivos de tenant, a través de un PgBouncer real en modo transacción |
| `e43097d3` | Un error de tipos que el build incremental venía saltando |
| `e442c6bf` | El informe de cierre y la bitácora al día |
| `359981d4` | Los dos fallos sensibles al orden explican qué los causó |
| `4120da4b` | Se pregunta por la valla de ESTE tenant, no por todo candado de la base |
| `acbbf2e4` | Las migraciones se aplican mientras el turno sigue escribiendo |
| `67a01566` | Vencimientos y leases se preguntan al reloj que corre, no al que se detuvo en el BEGIN |
| (esta actualización) | `docs`: rango, conteo y verificación finales |

Los 81 anteriores del rango están listados uno por línea de comportamiento en `git log --oneline 30a79102..HEAD`; su detalle por bloque vive en [la bitácora de ejecución](../../agent-platform-implementation-progress.md) y en `docs/audits/2026-09-07/` y `docs/audits/2026-09-08/`.

---

## 3. Estado A1–H3

Ninguna fila se declara aceptada si su cierre depende de ejecutar escenarios contra modelos, de un piloto con proveedor o de personas reclutadas. Donde no está aceptada, se nombra el gate.

| ID | Estado | Qué falta, y de qué gate depende |
| --- | --- | --- |
| A1 | **No aceptado** | Consentimiento y términos de cita ligados al comando y al cobro, probados con PostgreSQL. Términos en las familias restantes e históricos: trabajo local pendiente, no gate. |
| A2 | **No aceptado** | Comando, retención, settlement, avisos durables y revisión sin reenvío implementados. Conciliación con proveedores reales → **gate 1** (credenciales de piloto). |
| A3 | **No aceptado** | Propuesta, consentimiento, aprobación humana y entrega durable probados con PostgreSQL/Socket.IO. Entrega real → **gate 1**. |
| A4 | **No aceptado** | Transacciones, lectores, promoción y restauración única comprobadas. Piloto → **gate 1**. |
| B1 | **Aceptado como runtime; no como piloto** | El turno completo corre de punta a punta sobre PostgreSQL/Valkey/BullMQ/Socket.IO reales, con crash en cada frontera y una erasure en vuelo (`cf2540da`), y los primitivos por un PgBouncer real (`166c90f0`). Entrega con proveedores reales → **gate 1**. |
| B2 | **No aceptado** | Quince writers canónicos con id de inbound compartido con runtime y ledger. Familias restantes bloqueadas a propósito: trabajo local. |
| C1 | **No aceptado** | Árbitro, owner por puerto, consentimiento por misión, corrección y reanudación en cuatro idiomas probados. Lenguaje arbitrario y piloto → **gate 1**. |
| C2 | **No aceptado** | Ciclos de agenda y de mascotas con recibos atómicos comprobados. Históricos y cierres de las demás familias: trabajo local. |
| C3 | **No aceptado** | Contratos MCP y dependencias base implementados; cobertura por tarea depende de la certificación (ver H1). |
| D1 | **No aceptado** | Muestreo, revisión humana con CAS y anotaciones RAG implementados. No se certifica veracidad global; se dice así en el propio informe. |
| D2 | **No aceptado** | CAS, recuperación, fusión de identidad y borrado comprobados con pgvector real. Calidad semántica bajo carga: trabajo local pendiente. |
| D3 | **No aceptado** | Atribución observable y diagnóstico técnico probados; no equivalen a veracidad ni a entailment, y el informe lo dice. |
| E1 | **Aceptado en su propia definición** | 76 perfiles / 268 tareas / 146 transaccionales, **cero sin positivo propio, cero sin negativo propio, cero sin verificador**; 5 `file_claim` deliberadamente sin verificador de efecto. Cero perfiles certificados (ver H1). |
| E2 | **No aceptado** | Núcleo, FAQs/políticas, temporalidad, réplica RAG administrada, jueces y retención integrados. Lectores comerciales congelados y evaluación bajo tráfico: trabajo local pendiente. |
| E3 | **No aceptado** | Outbox durable, transporte estricto, recuperación, Flow por el mismo libro, reconciliación con actor y evidencia, pantalla de operador y alerta real. **El interruptor sigue apagado por defecto.** Encenderlo → **gate 4**; piloto → **gate 1**. |
| F1 | **No aceptado** | Assessment común implementado y probado; su cierre es la certificación de tareas reales (H1). |
| F2 | **No aceptado** | Assist crea contenido con doble paso, digest y relectura (`918b98c1`, `19a0a753`). Resto de superficies: trabajo local pendiente. |
| F3 | **No aceptado** | Tours por tareas verificadas implementados y con pruebas de accesibilidad automáticas. Sesiones moderadas → **gate 2** (personas reclutadas). |
| F4 | **No aceptado** | Un solo vocabulario de seis estados proyectado y mostrado en el tablero. Validación visual con usuarios → **gate 2**. |
| G1 | **No aceptado** | Costo y deadline acotados, deduplicación dentro del split, historial de revisiones leído, objeción del cliente antes del borrado, retractación que alcanza al tenant existente, **calibración del juez** (`c7598409`) y **alcance del rollback** (`9aafb2a9`). Otras salidas/trazas y despacho diferido: trabajo local pendiente. |
| G2 | **No aceptado** | Curación y revisión en cuatro idiomas implementadas. Revisión humana de muestra → **gate 2**. |
| G3 | **No aceptado** | Comparación por runtime y evidencia en seis familias; publicación gradual y retiro implementados. Piloto → **gate 1**. |
| H1 | **No aceptado** | Matriz **calculada**, no transcrita, con los huecos enumerables. **Cero perfiles certificados**: ejecutar 268 tareas × modelo × idioma × canal es trabajo local largo, no un gate — se declara pendiente, no bloqueado. |
| H2 | **No aceptado** | Regresiones desde QA/ledger, linaje, identidad de misión y denominadores implementados; un resultado desconocido conserva ese estado y no se inventa tasa. |
| H3 | **No aceptado** | Carga y caos ejecutados localmente contra el camino durable. Pilotos completos con proveedores → **gate 1**; usuarios nuevos → **gate 2**; comparación con alternativas → **gate 3**. |

---

## 4. Matriz de perfiles y tareas

Derivada de las mismas fuentes que usa el runtime, no transcrita: perfiles canónicos, contrato de dominio, pack de evaluación y registro de writers auditados.

| Contador | Valor |
| --- | --- |
| Perfiles | **76** |
| Tareas | **268** |
| Transaccionales | **146** |
| Sin caso positivo propio | **0** |
| Sin caso negativo propio | **0** |
| Sin verificador | **0** |
| Deliberadamente sin verificador de efecto | **5** (`file_claim`) |
| Sin positivo *verificable* bajo la definición estricta del generador | **6** |
| **Perfiles certificados** | **0** |

Los 6 sin positivo verificable son los 5 de `file_claim` más `create_vehicle_rental`, excluidos por la misma razón: son escrituras sensibles con identidad reforzada, y admitirlas significaría concederle a una prueba la identidad verificada de un cliente.

**Resultados por idioma y canal: no existen.** No hay un solo perfil certificado, y ninguno hereda certificación por parecerse a otro. La matriz dice qué tiene cada tarea y qué le falta; no dice que el agente la resuelva. Ejecutar las conversaciones completas contra los modelos soportados, en es/en/pt/fr y por canal compatible, es el trabajo que sigue.

---

## 5. Verificación

| Comprobación | Resultado |
| --- | --- |
| TypeScript, **en frío** (borrando los cuatro `.tsbuildinfo`) | api, dashboard, whatsapp, landing, mobile, shared: **6/6 limpio** |
| Build | shared (tsc), api (nest), whatsapp (nest), dashboard (next), landing (next): **5/5 verde** |
| Bootstrap NestJS (`test:bootstrap`) | **verde** — AppModule compila sin errores de DI |
| Suite completa de la API, con PostgreSQL + pgvector + Valkey + BullMQ + Socket.IO + PgBouncer conectados | **577 suites / 6.316 pruebas, todas verdes, cero omitidas** (232 s, `--maxWorkers=2`) |
| Suite del dashboard | **67 suites / 767 pruebas verdes** |
| Suite del servicio WhatsApp | **4 suites / 26 pruebas verdes** |
| Suites PostgreSQL | ejecutadas, **no auto-omitidas**. Los verdes anteriores del programa (519/55 omitidas) se habían obtenido sin bases conectadas; correrlas es lo que destapó los defectos 4 y 5 |
| pgvector | base 55439 con la extensión creada; suites de conocimiento/aprendizaje ejecutadas contra ella |
| Valkey / BullMQ | colas `inbound-messages` y de salida reales, con workers reales, en el arnés E2E y en el de carga |
| Socket.IO | servidor real, cliente `socket.io-client` real y dos `ConversationsGateway` cableadas como en producción (worker sin `server`, publica por el relay Redis; API dueña del namespace, reemite) |
| PgBouncer | **real**, `pool_mode=transaction`, `default_pool_size=1`, 9 casos verdes |
| Carga y caos | arnés de carga del camino durable ejecutado (`f08b0a70`); tres defectos que encontró, cerrados (`7f9548b9`) |
| **Migración bajo volumen representativo** | las seis migraciones aplicadas **mientras el turno escribe**, sobre 8 schemas de tenant y 6 escritores concurrentes: **2.035 escrituras, 0 fallidas**, la más lenta 30 ms, cada migración entre 6 y 36 ms (`acbbf2e4`) |
| Accesibilidad | pruebas automáticas de render + accesibilidad en dashboard (`2d918fb0`); paridad de claves en los cuatro idiomas (`eacce9b2`) |
| Visual con personas | **no ejecutado** — gate 2 |
| Pilotos con proveedores | **no ejecutados** — gate 1, y ninguna llamada real se hizo |

### Una fragilidad de aislamiento, dicha en voz alta

En una de las corridas completas, dos suites de simulación (`agent-release.postgres.spec.ts` e `isolated-canonical-commands.spec.ts`) fallaron; **ambas pasan en aislamiento y pasan juntas con las suites nuevas**. `--maxWorkers=2` contra UNA sola base compartida hace que el orden de ejecución importe. No es un defecto de producto y no se presenta como uno: es una fragilidad del arnés que merece su propia investigación, y queda registrada aquí en vez de promediada dentro de un número verde. Y esa instrumentación **ya rindió**: la vez siguiente que falló, el mensaje traía la fila entera y con ella el defecto real —un `NOW()` congelado decidiendo si un trabajo ya vencía (§1.6, `67a01566`)—, así que parte de lo que se leía como fragilidad del arnés era producto. Lo que sí se hizo es que la próxima vez sea evidencia y no un encogimiento de hombros (`359981d4`): un `claim` nulo informa el estado del candidato y de la evaluación que lo produjo, y la corrección de mascota fija en la misma aserción cuál fue el último entrante que leyó la compuerta. Aparte, una de las dos aserciones de candados consultivos preguntaba por **toda** la base y por eso llegó a ver el candado que la suite de PgBouncer toma a propósito; ahora pregunta por la valla de su propio tenant (`4120da4b`).

---

## 6. Migraciones, dry-run, rollback y runbooks

Seis migraciones aditivas en el rango, todas expand-contract (sólo `ADD COLUMN` nullable, `CREATE TABLE`, `CREATE INDEX`; ningún `RENAME` ni `DROP`):

- `20260908180000_add_agent_turn_ledger`
- `20260908190000_add_agent_handoff_effects`
- `20260908200000_add_dispatch_resolution_ledger`
- `20260908210000_provision_learning_tables`
- `20260908220000_bound_learning_evaluation_cost_and_deadline`
- `20260908230000_add_agent_content_proposals`

**Paridad de tres vías comprobada** —constante de bootstrap perezoso, `prisma/tenant-schema.sql` y migración— por `dispatch-schema-parity.postgres.spec.ts` y `learning-schema-parity.postgres.spec.ts`, que aplican las tres definiciones a tres schemas y las comparan columna por columna. **Dry-run y rollback** ejercitados localmente contra la base desechable, incluida la comprobación de idempotencia al reaplicar.

Runbooks: `docs/runbooks/dispatch-reconciliation.md` y `docs/runbooks/dispatch-load-and-slo.md` (SLOs escritos contra mediciones reales, con el vigilante que los lee nombrado).

**Aplicadas bajo volumen representativo** (`acbbf2e4`): los seis ficheros, verbatim, mientras seis escritores hacen lo que hace un turno —insertar el mensaje del cliente, tocar la conversación, releer el historial— sobre ocho schemas de tenant. Ninguna escritura en vuelo falló, ninguna fila escrita durante la migración se perdió, ningún schema quedó a medias, y reaplicarlas no cambió nada: un deploy que reintenta tras un hipo de red no puede convertirse en otro deploy. El camino de lectura anterior a la migración se vuelve a ejercitar después, que es la otra mitad de expand-contract. Esa suite corre contra **su propia base de datos**, porque los ficheros recorren `public.tenants` y tocarían cada schema nombrado allí.

**Aplicarlas en un entorno de despliegue autorizado y observarlas ahí sigue pendiente → gate 4.**

---

## 7. Decisiones de producto, con evidencia

1. **Un `rollback` de release no borra historial de cliente.** Retira lo que todavía no llegó a nadie —outbox, sobre, borrador pendiente—; la erasure de lo ya entregado le pertenece a la persona dueña de los datos, por `withdrawSource`. Evidencia: `redactWidgetAgentReplies` blanquea la fila de `messages`; el resto de la retractación no toca historial. (`9aafb2a9`)
2. **Nunca confirmar lo que no se guardó; siempre tragarse lo que no se puede procesar.** Un cuerpo estructuralmente inválido se descarta con `return` porque el proveedor lo redelivraría en bucle; un mensaje que no llegó a la cola sale como error para que **sí** lo redelivre. `InboundNotDurableError` es lo que distingue los dos casos en el borde. (`bff8d01f`)
3. **Redis es caché, nunca autoridad — también en el orden.** El caché de palabras se escribe detrás del sobre. (`2685883d`)
4. **Seis tareas se quedan sin positivo verificable a propósito.** Son escrituras sensibles con identidad reforzada; admitirlas sería darle a una prueba la identidad verificada de un cliente.
5. **El interruptor del outbox de salida normal sigue apagado.** Encenderlo es una decisión con piloto detrás, no un efecto colateral de esta tanda.
6. **Un vencimiento se pregunta al reloj que corre.** `clock_timestamp()` para «¿ya toca?» y «¿venció el lease?»; `NOW()` sólo para escribir el vencimiento. En el camino de **entrega** se conserva `NOW()` a propósito, porque allí errar es errar hacia no soltar un lease antes de tiempo. (`67a01566`)
7. **La calibración del juez informa lo que se puede medir y nombra lo que no.** El juez es una compuerta: nadie puede aprobar lo que reprobó, así que una celda de la matriz de confusión no existe y un «precision/recall» sería un número con medio denominador ausente. (`c7598409`)

---

## 8. Lo que queda: los cuatro gates externos

1. **Credenciales, cuentas y destinatarios de prueba de proveedores** para los pilotos (WhatsApp/Meta, Instagram, Messenger, Telegram, correo). Todo el código, los fixtures, los transportes estrictos, la reconciliación, los runbooks y las alertas ya existen; falta con qué llamar.
2. **Personas nuevas reclutadas** para la prueba moderada de onboarding, tours y accesibilidad. Los recorridos, la comprobación de meta por tour y las pruebas automáticas de accesibilidad ya están.
3. **Cuentas autorizadas de alternativas** para ejecutar el benchmark. El arnés local ya se niega a resumir lo que no es una comparación (`0a5cd070`).
4. **Aprobación explícita de push, deploy, migración y activación** de piloto o de producción.

Fuera de esos cuatro, lo que queda **no está bloqueado, está pendiente**: ejecutar las 268 tareas contra modelo/idioma/canal para certificar perfiles (H1), las familias de writers todavía bloqueadas (B2, C2), los lectores comerciales congelados (E2), el despacho diferido y las salidas/trazas restantes (G1) y la fragilidad de aislamiento de la §5.

---

## 9. `git status --short`

```
 M CLAUDE.md
 M apps/api/src/modules/automation/automation.module.ts
 M apps/api/src/modules/whatsapp/whatsapp.module.ts
 M docs/plan-profitability-2026-07.md
?? .validate-index.cjs
?? docs/whatsapp-meta-pricing-2026-10.md
```

**Las seis entradas son ajenas a esta tanda y se preservaron intactas.** Ninguna se stageó: cada commit del rango se armó con rutas explícitas, nunca con `git add .` ni `git add -A`.

- `CLAUDE.md` (+2/−1) y `docs/plan-profitability-2026-07.md` (+2): ediciones de otra sesión.
- `automation.module.ts` y `whatsapp.module.ts`: aparecen como modificados pero `git diff` no devuelve nada — llevan sólo diferencia de fin de línea, sin cambio de contenido.
- `.validate-index.cjs` (1,8 KB) y `docs/whatsapp-meta-pricing-2026-10.md` (52 KB): sin seguimiento, de otra sesión.

Lo único que esta tanda quitó del árbol fue `docs/audits/2026-09-07/competence-matrix.json`, un volcado generado de 2,2 MB sin seguimiento; sus dos formas revisables (`.csv` y `.md`) sí están versionadas y el propio documento explica cómo regenerarlo con `generate-competence-matrix.cjs --json`.
