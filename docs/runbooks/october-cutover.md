# El cambio completo de plataforma, sobre el VPS que ya está sirviendo

> **Decisión del dueño, y reemplaza a la anterior:** el destino es el **VPS y el
> entorno operativo existentes**, con activación gradual en los tenants que ya
> están probando. No se contrata otro host. No se mantienen dos versiones.
>
> **Nada de este documento se ha ejecutado contra el VPS todavía.** Lo que
> cambió es que ya no es un documento a seguir a mano: el procedimiento es
> [`infra/scripts/october-cutover.sh`](../../infra/scripts/october-cutover.sh),
> con su orden **impuesto** y su estado en disco. Lo que queda es la ventana, el
> responsable y la autorización.

## Lo que este documento dejó de ser

La versión anterior era una tabla de once pasos. Una tabla no es un
procedimiento, y una revisión independiente reprodujo exactamente lo que hacía
una persona siguiéndola:

| Lo que decía el documento | Lo que pasaba |
|---|---|
| «Paso 0: inventario» y después «Paso 1: construir el candidato» con un `compose up` | Los servicios se **reemplazaban antes** de que existiera punto de retorno. El ensayo de restore y la barrera de escritura estaban más abajo en la página |
| «tomar el dump por el camino que usa el deploy (`pg_dumpall`)» | El deploy escribe `pg_dump --format=custom`; `infra/backup/restore.sh` lee un `.tar.gz`. **Tres formatos y ningún comando** que restaure lo que se tomó |
| «Pausar productores: worker, crons, colas» | La API, el servicio de WhatsApp y cualquier cosa que llegara por Cloudflare **seguían escribiendo** |
| Nada sobre reintentos | Una ventana que fallaba en el paso 7 y se reintentaba desde el 1 **volvía a tomar el backup** sobre una base ya migrada a medias |

## El procedimiento

```bash
sudo -u deploy /opt/parallext/infra/scripts/october-cutover.sh \
  --manifest  /opt/parallext-evidence/2026-10/candidate-manifest.json \
  --evidence  /opt/parallext-evidence/2026-10 \
  --rehearsal-url postgresql://parallext:...@localhost:5432/oct_cutover_rehearsal \
  --pilot-tenants 4f0c…,9a21…
```

Once pasos, en el único orden en que se les permite ocurrir:

| # | Paso | Qué hace y cuándo aborta |
|---:|---|---|
| 1 | `inventory` | Censo de sólo lectura del host vivo, **hasheado y guardado**. Aborta si `unknown_probes` no es cero: una tabla que no se pudo consultar no es un cero |
| 2 | `rehearsal` | Dump → **vaciar** el destino desechable → restore → **comparar esquemas y conteo de filas tabla por tabla**. Cualquier fallo es fatal |
| 3 | `barrier` | Barrera **global**: ingress abajo *y* la base en `default_transaction_read_only` con los backends abiertos terminados |
| 4 | `drain` | Espera a que no quede trabajo en vuelo. Aborta si sigue habiendo colas activas a los 180 s |
| 5 | `backup` | El punto de retorno, en el único formato, **leído de vuelta** con `pg_restore --list` y hasheado |
| 6 | `preflight` | Términos acordados, sobre el esquema **viejo**. Aborta si la línea resumen no dice `blocks=0` |
| 7 | `migrate` | `public` y después cada schema de tenant. Aborta sin `MIGRATE_TENANTS_SUMMARY` o con `skipped`/`warnings` distintos de cero |
| 8 | `images` | El **único** `compose up` del archivo, fijado por los cinco digests |
| 9 | `health` | La API responde **y** los contenedores *son* los bytes aprobados (`--verify`) |
| 10 | `canary` | Los tenants del piloto, por id. Una lista vacía se lee como **todos**, así que es un rechazo |
| 11 | `reopen` | Se levanta la barrera y vuelven los escritores |

Cada paso escribe su estado en `<evidence>/state/<paso>.done`, con la hora y el
**hash del inventario** contra el que corrió. Volver a ejecutar el comando
reanuda en el primer paso pendiente; `--status` dice dónde quedó una ventana.

**El orden no es un consejo:** el paso N se niega a correr si 1…N-1 no están
registrados. Eso es lo que convierte «no arrancar contenedores antes de probar
el restore y abrir la ventana» en una propiedad del programa en vez de una frase
en una página. Comprobado: `--only rehearsal` y `--only images` sin el
inventario terminan en 1 nombrando el paso que falta.

### El ensayo de restore, y el defecto que encontró

El paso 2 **no** es «el `pg_restore` no dio error». Eso ya lo decía
`infra/backup/restore.sh`, que reporta un restore fallido como
`WARN: some restore warnings (usually safe)` y sigue. El paso compara el nombre
de cada schema y el **conteo real de filas de cada tabla** en las dos bases.

Escribiendo ese paso apareció un defecto en el propio ensayo: un restore que
traía **sólo `public`** comparaba limpio y decía «8 tables match, row for row»,
porque el destino todavía tenía los schemas de tenant de la corrida anterior. Un
restore que no restaura nada es indistinguible de uno que funciona cuando el
destino ya contiene la respuesta. Por eso el destino se **vacía y se comprueba
vacío** antes; con eso puesto, la misma mutación se pone en rojo nombrando las
seis tablas ausentes.

### Un solo formato

`pg_dump --format=custom`, leído por `pg_restore`. Es lo que ya escribe
`deploy.yml` para su punto de retorno previo a migrar y lo que escribe
`infra/backup/backup.sh` cada noche, así que el rollback de esta ventana y el de
un deploy cualquiera son el mismo archivo leído igual.

Todos los clientes de PostgreSQL corren **dentro** del contenedor
`parallext-postgres`: el host no tiene `postgresql-client`, y llamar a `pg_dump`
en el host es exactamente cómo el backup nocturno llegó a producir dumps de
0 bytes que se veían completos.

## Paso 1 — Construir el candidato, sin fusionar

Hay **dos** maneras de arrancarlo, y cuál sirve depende de si el commit ya está
en `main`.

**Antes de fusionar** —que es el caso para el que existe todo esto— la única que
funciona es la etiqueta sobre el pull request, y **la etiqueta nombra el commit**:

```
Pull request del candidato → Labels → build-candidate-<primeros 12 del SHA de HEAD>
```

`workflow_dispatch` **no aparece** para un workflow que todavía no está en la
rama por defecto. No es un error de configuración: es cómo funciona el
disparador, y es exactamente lo que hacía imposible validar un candidato antes de
fusionarlo. El disparador `pull_request` corre desde la rama del propio PR.

La etiqueta nombra el commit porque la anterior **no lo hacía**. `build-candidate`
se quedaba pegada en el PR y el disparador escuchaba `synchronize`, así que una
aprobación de quien revisó el commit A seguía autorizando B, C… F —cada uno
corriendo el código de la rama con secretos y `packages: write`—. Ahora
`labeled` es el único tipo escuchado, un push nuevo deja la etiqueta vieja sin
valor, y aprobar el commit nuevo es un acto humano nuevo, revisable y con nombre.

Además se comprueban, y no se suponen: que el repositorio es el nuestro, que la
rama **no viene de un fork** (un fork no puede llegar a un job con secretos) y
que quien pidió está en `CANDIDATE_AUTHORIZED_ACTORS`. Esa variable **vacía es un
rechazo**: un control cuyo estado por defecto es «cualquiera» no es un control.

**Después de fusionar**, o para reconstruir un commit cualquiera:

```
Actions → "Candidate images (manual)" → Run workflow
  sha:     <SHA completo de 40 caracteres>
  confirm: candidate
```

### Los tres jobs, y por qué son tres

| Job | Permisos | Qué puede hacer |
|---|---|---|
| `authorize` | **ninguno** | Decide quién pidió y qué commit. No hace checkout ni lee secretos, así que no hay nada que una rama preparada pueda robarle |
| `verify` | `contents: read`, **sin secretos** | Corre el código del PR: stack real, suites, typechecks, builds, generadores. **No puede escribir en el registro** |
| `publish` | `contents: read` + `packages: write`, detrás de un **environment protegido** | Construye y publica las cinco imágenes y el manifiesto. Sólo arranca si `verify` terminó en verde |

El `environment` es la puerta: sus revisores, su restricción de rama y sus
secretos están en la configuración del repositorio, así que la aprobación para
escribir en el registro queda registrada **fuera** de este archivo y no se
concede editándolo.

### Qué prueba el candidato

`verify` levanta **PostgreSQL 17**, **PgBouncer en modo transaction** (fijado por
digest) y **Valkey**, y afirma las tres cosas en vez de configurarlas y confiar:
la versión del servidor, el `pool_mode` leído de la consola de administración y
la política de expiración leída de vuelta.

Eso importa porque cada suite respaldada por PostgreSQL, PgBouncer o Valkey **se
salta a sí misma** cuando su variable no está puesta, y la versión anterior de
este workflow corría `npx jest --ci` sin ninguna base: el motor de gasto, el
outbox durable, las migraciones y la semántica de pooling estaban todos omitidos,
y la corrida era verde.
[`assert-no-skipped-tests.cjs`](../../infra/scripts/assert-no-skipped-tests.cjs)
lee el informe JSON de Jest y rechaza una corrida con una sola prueba omitida, y
**cada** informe que el workflow escribe es juzgado —no sólo el último—.

Además: cinco typechecks (shared, api, dashboard, whatsapp, landing), cinco
builds, el bootstrap de DI de Nest —que `tsc` no puede ver—, la suite del
Dashboard, los recorridos de navegador (escritorio y móvil) y los tres
generadores en modo `--check`.

⚠️ **El dashboard hornea `NEXT_PUBLIC_*` en su bundle en tiempo de build.** La
API a la que llama se decide en este paso y no cambia después con un `.env` en el
host. Son **once** valores, no dos: además de `CANDIDATE_PUBLIC_API_URL` y
`CANDIDATE_PUBLIC_WA_URL`, el build necesita los ids de Meta (app, config,
solution), el de Google, el de Messenger, los de Instagram, la versión y la clave
VAPID. Un `NEXT_PUBLIC_*` ausente **no falla el build**: hornea una cadena vacía,
y el candidato sale con el Embedded Signup que no abre, el botón de Google que no
entra y las notificaciones que no se suscriben. El workflow los verifica todos
antes de construir nada y se detiene nombrando los que falten.

### El manifiesto: qué ata, y qué se niega a leer

El manifiesto es **versión 3** y ata cuatro cosas:

1. el **commit**, 40 caracteres;
2. la **verificación**: qué run lo probó y que concluyó `success`;
3. los **inputs del bundle**: las dos URLs tal cual —porque la pregunta más útil
   sobre un dashboard candidato es contra qué API lee, y un digest no la
   contesta— y un SHA-256 de cada id o clave, que alcanza para probar que lo
   verificado y lo aprobado se construyeron con los mismos valores y no alcanza
   para ser ninguno de ellos;
4. los **cinco digests**, completos.

`apply-candidate-manifest.cjs` rechaza el archivo si falta cualquiera de las
cuatro, si la verificación concluyó otra cosa, si la verificación no nombra un
run que alguien pueda abrir, o si un servicio nombra el repositorio equivocado.
Esto último era real: el lector comprobaba cada repositorio contra una **lista**
de los cinco, así que un manifiesto donde `api` nombraba la imagen del dashboard
y `dashboard` la de la API se aceptaba y generaba

```yaml
api:       image: ghcr.io/nipko/parallext-dashboard@sha256:14c2…
dashboard: image: ghcr.io/nipko/parallext-api@sha256:66cd…
```

con código de salida 0. Ninguna otra comprobación podía verlo: los dos digests
son reales, los dos repositorios son nuestros, y la etiqueta esperada se deriva
**del** repositorio, así que también coincidía. Hoy cada servicio tiene **un
solo** repositorio del que puede arrancar.

El artefacto se publica con `if: success()`, nunca `always()`. Publicarlo desde
una corrida roja era publicar un manifiesto consumible para un candidato que
nadie avaló —y el primer paso del cutover es descargar exactamente ese archivo—.

### Consumir el manifiesto

El paso 8 del script lo hace solo. A mano, para inspeccionarlo:

```bash
node infra/scripts/apply-candidate-manifest.cjs \
  --manifest candidate-manifest.json \
  --out infra/docker/docker-compose.candidate.yml

node infra/scripts/apply-candidate-manifest.cjs \
  --manifest candidate-manifest.json --verify
```

El segundo comando es el que vuelve honesto al primero. Un override generado
prueba que se escribió un archivo; la verificación prueba que los contenedores
que atienden peticiones son los bytes que se aprobaron. Un contenedor cuya imagen
no tiene digest de registro cuenta como **discrepancia y no como desconocido**.

## Migraciones a mano, cuando sean el camino más directo

Permitidas, y con las mismas obligaciones que un script:

1. **Alcance** — qué filas, con la consulta que las selecciona;
2. **Conteo previo** — cuántas son, guardado;
3. **Transformación** — la sentencia exacta, en una transacción;
4. **Comprobación posterior** — el mismo conteo, más la verificación de que la
   caja ahora las lee;
5. **Recuperación** — cómo se deshace, o por qué no se puede.

Lo que **no** habilita una migración manual: borrar datos válidos, fabricar un
consentimiento, alterar un cobro acordado ni repetir un efecto externo. Esas
obligaciones son de los datos del negocio y no dependen de qué versión del código
corra.

## Recuperación, según el momento

| Momento | Qué se hace |
|---|---|
| Antes de admitir escrituras nuevas (antes del paso 11) | Restaurar el conjunto consistente de datos **e** imágenes del punto de retorno: `<evidence>/return-point.dump`, con su `.sha256` y su `.toc` |
| Después de admitirlas | **No** restaurar a ciegas: se perderían operaciones posteriores. Detener los efectos afectados y corregir hacia adelante, o ejecutar una reversión de datos probada |

En los dos casos: no se borran efectos pendientes, historial ni reservas. Se
concilian. Y **los cambios irreversibles del proveedor no se revierten cambiando
la imagen**: un mensaje entregado se entregó.

**No se construye soporte del binario anterior sobre el esquema nuevo.** El
rollback de este cambio es de datos e imágenes juntos, antes de admitir
escrituras nuevas, no un binario viejo hablando con un schema nuevo.

## Lo que sí se ejecutó, y dónde

Contra la instancia desechable de PostgreSQL 17 en loopback, sobre el HEAD de
esta rama:

| Prueba | Resultado |
|---|---|
| Migración **limpia** (base vacía → HEAD) | 63 migraciones aplicadas, 0 sin terminar, 0 revertidas |
| Migración de **schemas de tenant** sobre esa base | `MIGRATE_TENANTS_SUMMARY ok=1 skipped=0 warnings=0`, 238 tablas en el schema |
| **Upgrade desde el estado anterior** (39 migraciones previas aplicadas a mano con los checksums reales, filas escritas por el código viejo) | 63 aplicadas, 0 sin terminar, las filas previas intactas |
| Migración **bajo carga representativa** (`migration-under-load.postgres.spec.ts`) | 23 migraciones mientras corrían 2.038 escrituras en 8 schemas; la más lenta 35 ms; 0 fallidas |
| **Ensayo de restore** del paso 2 | Dump, vaciado, restore y comparación: 8 tablas coinciden fila por fila |
| Guardas de orden | `--only rehearsal` y `--only images` sin inventario terminan en 1 nombrando el paso que falta |
| Destino no desechable | Rechazado por nombre antes de tocar nada |

## Lo que este procedimiento todavía no demuestra

- No se ha ejecutado contra ningún host. El ensayo del paso 2 corrió contra una
  base de laboratorio, no contra el tamaño real del VPS.
- No hay medida real de tamaño, de duración de la ventana ni del restore.
- Ninguna cuenta de canal real ha enviado nada.
- 0 de 76 perfiles certificados con un modelo real.
- **El workflow del candidato no se ha corrido en GitHub.** Existe en el archivo
  y está fijado por contratos de test que parsean el YAML —no lo grepean—, pero
  su primera ejecución real será la primera vez que un PR lleve la etiqueta. No
  se puede ensayar antes sin empujar.
- **Producción corre PostgreSQL 16** (`pgvector/pgvector:pg16` en
  `docker-compose.prod.yml`) mientras el candidato se prueba sobre **17**. Eso es
  una divergencia deliberada de esta tanda, no un descuido: subir el major del
  motor de producción es una migración de datos con su propia ventana, y no se
  mete de contrabando en el mismo cambio. Decidir si esta ventana la incluye es
  parte de la autorización.

## Lo que falta de afuera

1. Acceso y capacidad del VPS, inventario actual, responsable y **ventana
   acordada**.
2. Los ids de los tenants del piloto y de los que no participan.
3. Cuenta/número de prueba elegible, método de pago del negocio, destinatario
   con consentimiento y presupuesto autorizado.
4. Los **once** `NEXT_PUBLIC_*` del build del candidato: `CANDIDATE_PUBLIC_API_URL`
   y `CANDIDATE_PUBLIC_WA_URL` como variables de repositorio, y los secretos
   `META_APP_ID`, `META_CONFIG_ID`, `META_SOLUTION_ID`, `GOOGLE_OAUTH_CLIENT_ID`,
   `MESSENGER_FB_LOGIN_CONFIG_ID` y `VAPID_PUBLIC_KEY`.
5. El **environment protegido** `candidate-images` creado en la configuración del
   repositorio, con sus revisores. Sin él, `publish` no arranca.
6. La variable de repositorio **`CANDIDATE_AUTHORIZED_ACTORS`** con los logins
   que pueden autorizar un candidato. Vacía, el workflow se niega.
7. **Node en el host del VPS.** El consumidor del manifiesto es un script Node y
   reimplementar sus comprobaciones en shell es cómo los dos se separan; el
   script lo comprueba al arrancar (`NODE=/ruta/a/node` si no está en el PATH) y
   se detiene **antes** de abrir la ventana, no durante.
8. Una base desechable para el paso 2 cuyo nombre **diga** que lo es
   (`*_eval_isolation` o `*rehearsal*`), alcanzable desde dentro del contenedor
   `parallext-postgres`.
9. Aprobación explícita del candidato y de la activación.

## Por qué ya no hay staging

Había un workflow de staging con siete defectos reproducidos —el rollback
esquivaba el guard, el compose ejecutaba una base distinta de la validada, la
comparación de secretos aprobaba con cero digests, las rutas de salud no
existían, la evidencia se escribía en un contenedor que se borraba, el piloto
nombraba un canal sin transporte, y no había forma de construir imágenes de un
candidato sin fusionar a `main`—.

Seis de los siete se cierran **retirando el componente**, porque el producto dejó
de necesitarlo: el destino es este VPS. El séptimo no: «construir el candidato
antes de fusionar» sigue haciendo falta y ahora existe como
[`.github/workflows/candidate.yml`](../../.github/workflows/candidate.yml).

Tres ideas del workflow retirado sí sobreviven, porque siempre fueron sobre el
host operativo y sólo parecían asuntos de staging:

| Idea | Dónde vive ahora |
|---|---|
| Un script destructivo prueba que su destino es desechable | `apps/api/src/common/utils/disposable-target.ts` |
| Un piloto nombra un tenant y un canal que el transporte sirve | `packages/shared/src/dispatch-pilot-scope.ts` |
| La evidencia de un host vivo no lleva personas dentro | `apps/api/src/common/utils/operational-evidence.ts` |
