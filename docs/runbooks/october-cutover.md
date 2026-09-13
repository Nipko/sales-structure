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
| 3 | `barrier` | Barrera **global**, dos capas: se detiene `parallext-tunnel` —el ingress de verdad: ningún servicio publica puerto, todo entra por el túnel— *y* la base queda en `default_transaction_read_only`, con los backends abiertos terminados. La bandera se **lee de vuelta** en una sesión nueva: que el `ALTER DATABASE` no dé error no es que la próxima sesión se niegue a escribir |
| 4 | `drain` | Espera a que no quede trabajo en vuelo. Aborta si sigue habiendo colas activas a los 180 s |
| 5 | `backup` | El punto de retorno, en el único formato, **leído de vuelta** con `pg_restore --list` y hasheado |
| 6 | `preflight` | Términos acordados, sobre el esquema **viejo**. Aborta si la línea resumen no dice `blocks=0` |
| 7 | `migrate` | `public` y después cada schema de tenant. La barrera de escritura se baja **para la migración y se vuelve a armar al terminar**, salga bien o mal. Aborta sin `MIGRATE_TENANTS_SUMMARY` o con `skipped`/`warnings` distintos de cero |
| 8 | `images` | Recrea los **cinco servicios nombrados** (`worker api whatsapp dashboard landing`) con `--no-deps`, fijados por los cinco digests, **detrás del ingress cerrado**. `tunnel` no está en la lista, y `postgres`/`pgbouncer`/`redis` tampoco |
| 9 | `health` | La API responde **y** los contenedores *son* los bytes aprobados (`--verify`) |
| 10 | `canary` | Los tenants del piloto, por id: cada uno tiene que ser un UUID que nombre un tenant real. **Es una compuerta humana**: abre la ventana del piloto con el ingress todavía cerrado, se detiene, y sólo queda registrada cuando alguien vuelve con `--canary-verified '<quién miró qué y qué vio>'` |
| 11 | `reopen` | **Se abre el ingress** — `parallext-tunnel` arranca y recién ahí puede llegar la primera petición de un cliente. Va último, después de confirmar que los servicios detrás de la puerta están arriba |

### Las dos puertas, y hasta qué paso dura cada una

La barrera tiene dos capas y **no** duran lo mismo. Decir que sí es lo que hacía
falsos a los comentarios del propio archivo:

- La **barrera de escritura** (`default_transaction_read_only`) está baja sólo en
  los dos pasos que no pueden funcionar sin escribir: el 7, donde corre la
  migración —y que la vuelve a armar al terminar—, y del 8 en adelante, donde los
  contenedores arrancan (`widget.service` hace `CREATE TABLE IF NOT EXISTS` desde
  `onModuleInit`, así que un stack levantado contra una base de sólo lectura es un
  stack que falla en cada arranque).
- La **barrera de ingress** —`parallext-tunnel`— está baja del paso 3 al **11**.
  Esa es la capa que significa «no se está sirviendo a ningún tenant», y es la que
  tiene que sobrevivir al canario.

Lo que había antes: el paso 7 encendía las escrituras y nada las volvía a apagar,
el paso 8 corría `up -d --force-recreate` **sin lista de servicios** —así que
volvía toda la superficie pública con él, y `postgres` entraba en el alcance de
`--force-recreate` en mitad de su propia migración—, y el paso 10 se marcaba
hecho solo, de modo que el bucle seguía al 11 en el mismo aliento. La ventana
estaba viva para todos los tenants desde el paso 8, mientras el 11 se titulaba
«las escrituras vuelven al final» y ejecutaba dos no-ops.

Cada paso escribe su estado en `<evidence>/state/<paso>.done`, con la hora, el
**hash del inventario** y el **commit del candidato** contra los que corrió.
Volver a ejecutar el comando reanuda en el primer paso pendiente; `--status` dice
dónde quedó una ventana y marca los pasos que corrieron contra otro inventario.

**El orden no es un consejo:** el paso N se niega a correr si 1…N-1 no están
registrados. Eso es lo que convierte «no arrancar contenedores antes de probar
el restore y abrir la ventana» en una propiedad del programa en vez de una frase
en una página. Comprobado: `--only rehearsal` y `--only images` sin el
inventario terminan en 1 nombrando el paso que falta.

**Y «registrado» no alcanza: registrado *contra qué*.** Los dos campos que cada
`.done` venía guardando —`inventorySha256` y `gitSha`— no los leía nadie: estaban
escritos bajo el comentario «para que una ventana reanudada no continúe en
silencio contra otro estado inicial», y ponerlos en `0` no habría cambiado nada.
Ahora se comparan al reanudar. Si el censo del host cambió, o si esta corrida
lleva otro candidato, el programa se detiene nombrando la diferencia:

```
[cutover] FATAL: this window did not start where it is being resumed:
  · 'inventory' ran against candidate bbbb…; this run carries aaaa…
```

El override existe y **pide un motivo**, que queda escrito en
`<evidence>/changed-start-accepted.txt`:

```bash
october-cutover.sh ... --accept-changed-start "se agregó disco el 2-oct; revisado por N."
```

### El canario es una compuerta, no un aviso

El paso 10 no se marca hecho solo. Abre la ventana del piloto —escrituras
permitidas, **ingress todavía cerrado**— y termina en 1 con el comando exacto que
hay que repetir. Nada debajo corre y el túnel sigue abajo:

```bash
october-cutover.sh --only canary --evidence /opt/parallext-evidence/2026-10 \
  --manifest /opt/parallext-evidence/2026-10/candidate-manifest.json \
  --pilot-tenants <uuid>,<uuid> \
  --canary-verified "N.L. revisó 6 entregas, 0 duplicados, 0 errores de fondeo"
```

La atestación queda en `<evidence>/canary-verified.txt`. Y la lista de tenants
dejó de ser decorativa: antes sólo se escribía en un archivo que no leía nadie,
mientras el rechazo de la lista vacía afirmaba una semántica —«una lista vacía se
lee como TODOS»— que ningún consumidor implementaba. Hoy cada id tiene que ser un
UUID y existir en `public.tenants`; un id con una errata es un canario que no
verificó nada y un archivo que dice que sí.

### El ensayo de restore, y el defecto que encontró

El paso 2 **no** es «el `pg_restore` no dio error». Durante mucho tiempo eso era
todo lo que decía `infra/backup/restore.sh`: reportaba un restore fallido como
`WARN: some restore warnings (usually safe)` y seguía. Ya no — hoy corre con
`--exit-on-error`, cuenta cada fallo y sale distinto de cero, y verifica contra
la tabla de contenidos del archivo que cada schema que el archivo crea exista
después (ver «El punto de retorno se restaura ENTERO»). Este paso va más allá y
compara el nombre de cada schema y el **conteo real de filas de cada tabla** en
las dos bases.

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

### El punto de retorno se restaura ENTERO, y el script lo dice

`return-point.dump` —igual que el `predeploy_*.dump` que toma `deploy.yml`— es
**un solo `pg_dump --format=custom` sin filtro `--schema`**: la base completa,
todos los schemas, en un archivo.

`infra/backup/restore.sh` lo copiaba a `public.dump` y lo restauraba con
`--schema=public`, así que `pg_restore` **descartaba todos los objetos
`tenant_*` del archivo**. El bucle de tenants de más abajo buscaba
`tenant_*.dump`, no encontraba nada, no corría nunca, y el contador de fallos se
quedaba en cero. Reproducido con un `pg_restore` simulado:

```
[2] Restoring database...
  Restoring public schema...
  OK — public schema
  OK — all schemas restored
Restore complete!                        (exit 0)
```

Es decir: volver atrás una migración mala dejaba `tenants`,
`billing_subscriptions`, `billing_payments` y `audit_logs` en el punto de retorno
**y todos los schemas de tenant en su estado post-migración** —las dos mitades de
una base en dos momentos distintos— y lo certificaba como completo.

Ahora el archivo se restaura **según lo que es**: un dump de base completa no
lleva filtro, y sólo los dumps por-schema del tarball nocturno lo llevan. Y lo
que el archivo *contiene* se lee de su propia tabla de contenidos
(`pg_restore --list`) y se compara contra los schemas que existen después. Esa
comprobación positiva es la única que podía ver el defecto original, porque el
defecto no era un error: un filtro que excluye todo termina en 0 sin haber hecho
nada. Un restore al que le falta un schema **no imprime OK y no termina en 0**.

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
| Migración **limpia** (base vacía → HEAD) | 93 migraciones aplicadas, 0 sin terminar, 0 revertidas |
| Migración de **schemas de tenant** sobre esa base | `MIGRATE_TENANTS_SUMMARY ok=2 skipped=1 warnings=0` para activo/retenido/schema ausente; la colisión 23505 posterior dejó `ok=1 skipped=2 warnings=1` y preservó las filas |
| **Upgrade desde `main`** (sus 50 migraciones aplicadas con sus checksums, evidencia previa escrita) | `GLOBAL_UPGRADE_REHEARSAL base=main baseline=50 current=93 unfinished=0 evidence=preserved` mediante `scripts/rehearse-global-upgrade.cjs` |
| Migración **bajo carga representativa** (`migration-under-load.postgres.spec.ts`) | 53 migraciones mientras corrían 2.217 escrituras en 8 schemas; migración más lenta 47 ms, escritura más lenta 29 ms; 0 fallidas |
| **Ensayo de restore** del paso 2 | Dump, vaciado, restore y comparación: 8 tablas coinciden fila por fila |
| Guardas de orden | `--only rehearsal` y `--only images` sin inventario terminan en 1 nombrando el paso que falta |
| Destino no desechable | Rechazado por nombre antes de tocar nada |

Y contra el propio programa, con `docker` y `pg_restore` simulados —sin tocar
ningún host, que es todo lo que estas guardas necesitan para demostrarse—:

| Prueba | Resultado |
|---|---|
| Punto de retorno (dump suelto) restaurado por `restore.sh` | Un solo `pg_restore`, **sin** `--schema`; antes era `--schema=public` y el bucle de tenants no corría |
| Los schemas del archivo no están después del restore | `FAILED — … contains schema(s) that are NOT in the database`, salida **1**, sin «Restore complete!» |
| Tarball nocturno completo | Sin cambios: `public.dump` con `--schema=public`, cada `tenant_*.dump` con el suyo, y la verificación en verde |
| Tarball al que le faltó un dump de tenant | Rechazado por `full_backup.dump`, que es lo que esa noche se respaldó de verdad |
| Ventana reanudada con el censo cambiado | Termina en 1 nombrando los dos hashes; con `--accept-changed-start '<motivo>'` sigue y lo deja escrito |
| Ventana reanudada con otro candidato | Termina en 1 nombrando los dos commits |
| Corrida completa sin atender, pasos 1-9 ya registrados | Se detiene en `canary` con salida 1; `reopen` **no** corre y el túnel **no** se levanta |
| `canary` con la atestación | Queda registrado en `<evidence>/canary-verified.txt` y el paso 11 se vuelve alcanzable |
| `canary` con un id de piloto que no nombra tenant | Rechazado antes de abrir nada |

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
