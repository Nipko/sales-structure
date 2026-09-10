# Cierre técnico previo al despliegue: qué intenté romper, qué se rompió y qué quedó

Informe adversarial del trabajo pedido en
`docs/handoffs/2026-09-10/claude-release-closure-after-pr-review.md`. Lo que sigue
está ordenado por lo que se rompió, no por lo que se construyó, porque lo
segundo se lee en el diff y lo primero no.

**Nada se desplegó, nada se mergeó, el PR sigue en borrador y ningún modelo
gastó un centavo.**

---

## 0. El estado, en números

| | |
|---|---|
| `HEAD` | `3b51ab5a7a407e0eac921736c675139e8f070058` |
| Rango | `b1e87c71…3b51ab5a` |
| Commits nuevos vs `origin/main` | 307 |
| Archivos cambiados | 1.028 (+158.088 / −8.759) |
| Suites de API | 610, **0 falladas, 0 omitidas** |
| Pruebas de API | 6.655 |
| Órdenes de suite ejecutadas | 4 (por defecto + semillas 20260910, 777, 31415) |
| Playwright | 186 pruebas × 2 corridas completas (landing + dashboard escritorio + dashboard Pixel 7), 0 falladas |
| Typecheck en frío | 6/6 (api, dashboard, whatsapp, landing, mobile, shared) |
| Builds | 4/4 (api, whatsapp, landing, dashboard) + shared |
| Bootstrap real de Nest | ✅ grafo DI resuelto, `onModuleInit` completo |
| Migraciones | limpio ✅, upgrade desde estado previo ✅, escritores concurrentes ✅ |
| `git diff --check` | limpio |
| Árbol de trabajo | limpio salvo las entradas ajenas preservadas |
| Checks remotos | ninguno ejecutado por mí hasta el push; ver §7 |

---

## 1. Lo que intenté romper, y se rompió

### 1.1 El deploy podía migrar sobre filas que iban a quedar impagables

**Qué estaba mal.** `fb1c1366` cambió tres familias de cobro para leer *lo que el
cliente aceptó* en vez de una columna viva. Es el cambio correcto —cobrar un
número que el cliente nunca vio es peor que no cobrar— y tiene una consecuencia
con fecha: una fila creada antes de ese atado deja de ser cobrable **en el
momento en que el runtime nuevo carga**, con outbox encendido o apagado. El
runbook decía «consultá `GET /tenant-payments/:tenantId/agreed-terms/orphans`
antes», que es una frase aplicada por tenant por quien se acuerde.

**Por qué no bastaba con reusar lo que había.** `countAgreedTermsOrphans` tiene
un `catch` por familia que convierte una tabla ausente, una consulta rota y una
conexión muerta en `orphans: 0`. Y como `commitment_proposals` la crea la
migración de este mismo release, correr **antes** de migrar significa que el
registro de aceptación no existe todavía — lo que hay que reportar como «cada
fila viva está en riesgo», nunca como cero.

**Qué se hizo.** `a10bf87c`: un comando de sólo lectura que deriva los tenants de
la autoridad global sin lista manual, cuenta por familia, distingue
`counted` / `acceptance_store_absent` / `not_provisioned` / `failed`, emite sólo
identificadores y conteos, y sale 1 con filas o errores y 2 si no pudo correr. El
paso vive en `deploy.yml` **entre el backup y las migraciones**, y aborta.

**Cómo sé que sirve.** 22 pruebas (14 unitarias con un doble que distingue
`undefined` de `0`, 8 contra PostgreSQL real con tres schemas de forma distinta),
6 contratos sobre el workflow, y un ensayo del runnable con códigos 0/1/2. La
verificación que importa es la mutación: **mover el paso después de la migración
pública pone 3 de sus 6 contratos en rojo.**

### 1.2 Publicar un agente nunca se había recorrido entero

**Qué estaba mal.** El primitivo transaccional tenía su suite con PostgreSQL
real, y la capa de aplicación una suite unitaria con el store stubbeado. Entre
las dos, nadie había llevado un candidato revisado hasta el agente que atiende
clientes por las rutas que una persona usa, ni mostrado que **el turno siguiente
habla con lo publicado** y, tras la vuelta atrás, con lo que reemplazó.

Una prueba que llama a `AgentPublicationStore.publish` y lee la fila que acaba de
escribir prueba la fila. No puede probar que la cadena de guardas deje pasar a
quien corresponde, que el servicio aporte las comprobaciones vivas que el
primitivo se niega a inventar, que la caché que lee el runtime se borre, ni que
la resolución por conexión conteste ahora por un canal por el que no contestaba
hace un minuto.

**Qué se hizo.** `31395c64`, en dos niveles:

- `agent-publication-walk.postgres.spec.ts`: guardas reales sobre controladores
  reales, dos schemas desechables construidos con el DDL que se despacha,
  borrador → candidato aprobado → publicación con el par CAS → recibo durable →
  `PersonaService.resolvePersonaForChannel` (la llamada exacta que hace el turno)
  → `ConversationsService.generateResponse` con el ensamblador de prompt real →
  vuelta atrás → otro turno. 13 pruebas.
- `apps/e2e/tests/dashboard/agent-publication.spec.ts`: la mitad que le toca al
  navegador — que la decisión nunca sea un solo clic, que lo que sale sea
  exactamente lo que la pantalla acababa de leer, que un conflicto deje de
  ofrecer la acción y pida releer, y que la vuelta atrás se ofrezca sólo cuando
  puede salir bien. 9 pruebas, en dos viewports.

**Mutación.** Emitir la notificación en un replay idempotente, saltar la
comprobación del manifiesto, sacar `@Roles` de la ruta de publicación, publicar
el ruteo sin las instrucciones, quitar el paso de confirmación, aplanar un
conflicto en un error genérico, ofrecer rollback sobre una configuración
divergida y construir la solicitud con una versión recordada: **cada una pone en
rojo la prueba que le corresponde.**

### 1.3 Un byte nulo habría hecho que el guardián de staging aprobara todo

Éste es el hallazgo que más me gusta, porque pasó toda la suite unitaria.

**Qué estaba mal.** En `sha256(salt + " " + value)`, el separador que escribí no
era un espacio sino `\0`. Las pruebas unitarias comparaban `secretDigest` contra
sí misma —el valor de staging y el de producción calculados por la misma
función— así que estaban de acuerdo entre ellas **cualquiera fuera la fórmula,
incluida una equivocada**. El otro lado de la comparación es un script que corre
una persona en su máquina (`print-production-secret-digests.cjs`) y calcula el
digest de forma independiente. Nunca habrían coincidido: **todos los secretos de
producción habrían leído «no compartido», para siempre** — exactamente el falso
verde que el guardián existe para impedir.

**Cómo apareció.** No lo encontró una prueba. Lo encontró ensayar el runnable de
punta a punta contra un digest calculado por afuera. Ahora la receta está fijada
a un literal y a un cálculo independiente, y el comentario del test dice por qué.

### 1.4 El sembrador de staging cortaba una sentencia SQL a la mitad

Copié el partidor de sentencias en vez de usar el que se despacha, y cortó una
sentencia en dos: PostgreSQL contestó `syntax error at end of input`, que no
nombra ni la sentencia ni el partidor. Ahora usa
`PrismaService.splitSqlStatements` — el mismo que construye cada schema de tenant
real. Una segunda implementación de «dónde termina esta sentencia» es una segunda
cosa que puede estar mal.

### 1.5 Dos contratos de workflow que no contrataban nada

La mutación encontró dos huecos **en mis propias pruebas**:

- afirmar el orden de las líneas `echo` dejaba abierta la puerta obvia: agregar
  un segundo `prisma migrate deploy` arriba del preflight con otra etiqueta, y
  todos los marcadores siguen en orden mientras el schema ya se movió. Ahora la
  afirmación es sobre **todos los comandos que migran**;
- una ventana de ancho fijo alrededor del paso «apagar el piloto» alcanzaba al
  paso siguiente, que también dice `if: always()` — así que quitarle la guarda al
  paso correcto dejaba la prueba en verde. Ahora la ventana es exactamente ese
  paso.

---

## 2. Lo que intenté romper y aguantó

- **El aislamiento por tenant de la publicación.** Un administrador de otro
  tenant es frenado por `TenantGuard` al nombrar un tenant ajeno, y **otra vez**
  por el schema cuando nombra el propio: el agente no existe ahí. No depende de
  la guarda sola.
- **La idempotencia.** Dos clics con la misma clave, y cinco a la vez, producen
  una sola publicación y un solo evento durable. Un replay además **no** repite
  la notificación, para no gastar el presupuesto de evaluación del tenant dos
  veces.
- **Las expectativas vencidas.** Una huella obsoleta, una versión de candidato
  obsoleta, una evidencia movida y la fila de aprobación borrada: las cuatro
  publican nada, y el borrador sobrevive al rechazo.
- **El backup fail-closed.** Sigue delante del preflight, así que el preflight no
  es nunca el único guardián.
- **Las once migraciones nuevas.** Ni un `INSERT`, `UPDATE`, `DELETE`, `DROP`,
  `RENAME` ni `TRUNCATE` en 1.046 líneas: puramente estructurales y aditivas.
  Verificado aplicándolas sobre una base limpia y sobre el estado de
  `origin/main` con filas previas sembradas, que siguen ahí.
- **La suite, contra el orden.** Cuatro órdenes distintas, tres con semilla,
  mismo resultado.

---

## 3. Lo que se construyó, en una línea cada uno

| Commit | Qué |
|---|---|
| `a10bf87c` | preflight de términos huérfanos, automático y fail-closed, en `deploy.yml` |
| `31395c64` | el recorrido de publicación y su vuelta atrás, API y navegador |
| `3b51ab5a` | staging preparado: workflow, guardas, scripts, runbook |
| _este_ | inventario del PR, canario de certificación y este informe |

---

## 4. La compuerta de calidad, corrida sobre este HEAD

| Verificación | Resultado |
|---|---|
| Artefactos generados reflejan el código | ✅ (`verify-artifacts.cjs`) |
| Typecheck en frío ×6 | ✅ (cachés `tsbuildinfo` borradas antes) |
| Builds ×4 + shared | ✅ |
| Bootstrap real de Nest | ✅ |
| Suite completa de API, 4 órdenes | ✅ 610 suites / 6.655 pruebas, **0 omitidas** |
| Playwright completo ×2 | ✅ 186 × 2, en los tres proyectos (landing, dashboard escritorio, dashboard Pixel 7) |
| Migraciones: limpio / upgrade / concurrentes | ✅ / ✅ / ✅ |
| `git diff --check` | ✅ |
| Contratos de lint (api, dashboard, whatsapp) | ✅ |
| Contrato de claims de la landing | ✅ |

Detalle de las migraciones: 39 migraciones de `origin/main` sobre una base
limpia, luego las 11 nuevas encima con filas previas sembradas —tenant, contacto,
conversación y mensaje siguen ahí—, `_prisma_migrations` termina en 50 con 0 sin
terminar y 0 revertidas, y `migrate-tenants.js` corre dos veces con el mismo
resultado.

**Sobre `closure-report.json`:** su revisión guardada sigue siendo `b5363620`
aunque el HEAD avanzó. No es un descuido: `--check` compara **contenido**, no la
etiqueta, precisamente porque un generador nunca puede grabar el commit que aún
no existe cuando corre. Lo que quedaría obsoleto es el contenido, y no lo está.
El hash no se toca a mano.

---

## 5. Staging: preparado, no hecho

`3b51ab5a` deja en código el workflow manual con entorno `staging`, el contrato
de 16 variables con rechazo explícito de valores y hostnames de producción, la
semilla sintética, el smoke de las cuatro superficies, el recorrido de
publicación, el piloto de outbox acotado a un tenant sintético y apagado con
`always()`, la captura sin PII y el rollback con criterio verificable. Ensayado
contra la base desechable en doce casos, con sus códigos de salida.

**Nada de eso corrió contra un host, porque no hay host.** El runbook
(`docs/runbooks/staging-environment.md`) abre diciéndolo y termina con la lista
de siete condiciones que hay que cumplir antes de poder decir que staging está
cerrado. Mientras tanto, la frase honesta es «staging está preparado».

---

## 6. El canario de certificación: con precio, sin ejecutar

`plan-certification-canary.cjs` planifica un perfil, cuatro idiomas, chat web,
k=1: **204 casos, 408 llamadas, techo US$0,76 con `gpt-4o-mini`**, ~41 minutos.
El 0,3% de la matriz completa con el mismo modelo. El script no abre conexión, no
lee credencial y no tiene cliente de proveedor. Detalle en
`docs/audits/2026-09-10/certification-canary.md`.

Una corrección de vocabulario que conviene sostener: **no existe «el costo de
certificar»**. Existe un costo por modelo, y del más barato al más caro hay un
factor de 21×. Cualquier cifra sin el nombre del modelo al lado se va a citar mal.

---

## 7. `vertical-quality.yml`: qué corrí y qué no, y por qué

Leí los disparadores y los jobs antes de tocar nada.

| Nivel | Jobs que corre | Veredicto |
|---|---|---|
| `contract` | `contract` | sin secretos, sin llamadas externas. **Corre en cada PR ya.** |
| `integration` | `contract` + `integration` | contenedores de servicio **del propio runner**, `OPENAI_API_KEY: sk-ci-dummy-key`, cero `secrets.*` en el job. No toca producción. |
| `release` | los tres, incluido `weekly` | **inyecta `secrets.VERTICAL_EVAL_OPENAI_API_KEY`, `secrets.VERTICAL_RELEASE_DATABASE_URL` y `secrets.VERTICAL_RELEASE_REDIS_URL`, con `REQUIRE_EXTERNAL_GATES: true`.** Es credencial real y gasto real. |

Así que el nivel `release` **no** cumple la condición del encargo y no lo
disparé. Corrí lo que sí la cumple. Lo que falta para `release`, con nombre y
apellido:

- `VERTICAL_EVAL_OPENAI_API_KEY` (secreto) — credencial de modelo;
- `VERTICAL_RELEASE_DATABASE_URL` y `VERTICAL_RELEASE_REDIS_URL` (secretos) — un
  destino que no sea producción, que hoy no existe: es el mismo hueco que §5;
- `VERTICAL_RELEASE_EVIDENCE_JSON` (secreto) y las ocho variables
  `VERTICAL_*_READY`;
- la autorización explícita del dueño para gastar.

---

## 8. Las compuertas externas, abiertas y honestas

Ninguna es código y ninguna la puedo cerrar yo.

1. **Modelo, credencial y techo de gasto** para certificar 76 perfiles. El
   canario de §6 es el primer paso barato.
2. **Cuentas de prueba** de WhatsApp, Instagram, Messenger y Telegram.
3. **5–8 participantes nuevos** y una persona con lector de pantalla.
4. **Cuentas de competidores** y revisores ciegos.
5. **Host y secretos separados para staging** (§5), que además desbloquea §7.
6. **Aprobación humana** del PR, del merge, del despliegue y de la activación
   gradual.

---

## 8bis. Cinco categorías que no son la misma, y no deben leerse juntas

La confusión entre ellas es la forma más fácil de convertir un informe honesto en
uno que engaña. Van separadas a propósito:

| Categoría | Qué significa | Estado hoy |
|---|---|---|
| **Construcción local** | el código existe, compila y su forma está fijada por pruebas | ✅ |
| **Evidencia ejecutada** | corrió de verdad, contra PostgreSQL, Valkey, BullMQ, PgBouncer o un navegador reales, y dejó números | ✅ (§4) |
| **Certificación real** | el agente midió su comportamiento contra un modelo real, por perfil, idioma y canal | ❌ **0 de 76** |
| **Staging** | el release corrió en un host separado con datos sintéticos | ❌ preparado, sin host (§5) |
| **Activación en producción** | desplegado y con las palancas encendidas para tenants reales | ❌ nada desplegado |

Una fila verde en la primera columna no dice nada sobre las tres últimas, y este
informe no la deja decirlo.

## 9. Lo que este PR no demuestra

- **0 de 76 perfiles certificados con un modelo real.** Los ejecutores existen y
  se ensayan sin proveedor; eso no es certificación.
- **Ningún canal probado con una cuenta real.**
- **Ninguna corrida en staging.**
- **Ningún despliegue, ninguna migración en producción, ninguna activación.**

«Cero filas abiertas» en la tabla A1–H3 significa que ninguna fila tiene una
condición local sin cumplir. **No significa producto certificado ni listo para
publicar**, y no debe leerse así.

---

## 10. Estado de entrega

| Condición del encargo | Estado |
|---|---|
| Preflight de huérfanos automático y fail-closed | ✅ |
| Publicación y vuelta atrás recorridas de punta a punta | ✅ |
| Verificaciones locales repetibles verdes sobre el HEAD final | ✅ |
| Staging preparado en código, faltando sólo infra y secretos | ✅ |
| PR revisable, actualizado y todavía en borrador | ✅ |
| Ningún defecto local conocido pendiente | ✅ |
| Lo único que resta son las compuertas externas enumeradas | ✅ |

El candidato queda preparado. **No mergear, no desplegar.** Queda esperando el
tema funcional nuevo del dueño antes de pedir aprobación final.
