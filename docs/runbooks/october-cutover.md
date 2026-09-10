# El cambio completo de plataforma, sobre el VPS que ya está sirviendo

> **Decisión del dueño, y reemplaza a la anterior:** el destino es el **VPS y el
> entorno operativo existentes**, con activación gradual en los tenants que ya
> están probando. No se contrata otro host. No se mantienen dos versiones.
>
> **Nada de este documento se ha ejecutado todavía.** Describe un procedimiento
> preparado, con sus scripts y sus abortos. Lo que queda es la ventana, el
> responsable y la autorización.

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

## Paso 0 — Inventario, antes de decidir la ventana

```bash
docker compose -f infra/docker/docker-compose.prod.yml \
  run --rm api node scripts/vps-inventory.cjs --json /evidence/inventory.json
```

Sólo lectura, y estructuralmente: abre `BEGIN READ ONLY` con
`default_transaction_read_only`, así que **no puede escribir aunque alguien
edite una sección**. Comprobado: un `CREATE TABLE` en esa sesión devuelve 25006.

Lo que hay que leer de su salida antes de fijar nada:

| Dato | Para qué |
|---|---|
| `tenants` por id, slug y schema | Saber **quién** está adentro. No todos los tenants presentes son desechables, ni todos sus contactos aceptaron mensajes de prueba |
| `migrations applied/unfinished` | Desde dónde parte la actualización, y si algo quedó a medias |
| `schema_sizes` y `database.bytes` | Dimensionar backup y restore **con números**, no con una estimación |
| `connections.oldest_transaction_seconds` | Una migración detrás de una transacción larga espera; una ventana que no lo presupuestó se pasa |
| `tenantPending` | Efectos en vuelo que un reinicio interrumpiría |
| `dispatch_rollout` | Si el outbox durable está encendido y para quién |

`unknown_probes` distinto de cero **no es cero**: es una tabla que no se pudo
consultar, y la respuesta correcta es averiguar por qué, no seguir.

Con eso, y **sólo** con eso, se eligen: la ventana, los tenants del piloto (por
id) y los que no participan.

## Paso 1 — Construir el candidato, sin fusionar

```
Actions → "Candidate images (manual)" → Run workflow
  sha:     <SHA completo de 40 caracteres>
  confirm: candidate
```

Lo que hace y lo que deliberadamente no:

- hace checkout **de ese commit** y verifica que `git rev-parse HEAD` coincide;
- corre typecheck y los tres contratos de lint, así que un candidato no sale de
  un árbol que no habría podido fusionarse;
- publica las cinco imágenes con la etiqueta `candidate-<sha>` y **nunca**
  `latest` —el compose de producción cae a `latest`, así que una imagen así
  etiquetada sería lo que arranca un `docker compose up` a mano—;
- publica un **manifiesto de digests**. Una etiqueta con forma de SHA sigue
  siendo una etiqueta: se puede mover. Sólo el digest dice que lo que corrió y lo
  que se aprobó son los mismos bytes. **Todo lo que sigue fija digests.**
- no despliega, y no puede: no tiene paso de host ni credenciales de SSH.

⚠️ **El dashboard hornea `NEXT_PUBLIC_*` en su bundle en tiempo de build.** La
API a la que llama se decide en este paso y no cambia después con un `.env` en el
host. `CANDIDATE_PUBLIC_API_URL` / `CANDIDATE_PUBLIC_WA_URL` tienen que ser las
del entorno donde se va a verificar.

## Paso 2 — Ensayo de backup y restore, en un destino desechable

Antes de tocar el VPS, y con los tamaños del paso 0 en la mano:

1. tomar el dump por el camino que usa el deploy (`pg_dumpall`);
2. restaurarlo en una base **desechable** —`assertDisposableTarget` exige que el
   nombre lo diga y rechaza el nombre productivo—;
3. aplicar sobre ella la migración completa;
4. correr `vps-inventory.cjs` contra el resultado y comparar conteos con el
   original: tenants, schemas y filas por familia.

Si el tamaño real hace inviable el ensayo previsto, **medir y ajustar el
procedimiento antes de tocar el VPS**, no descubrirlo durante la ventana.

**No se construye soporte del binario anterior sobre el esquema nuevo.** El
rollback de este cambio es de datos e imágenes juntos, antes de admitir
escrituras nuevas (paso 6), no un binario viejo hablando con un schema nuevo.

## Paso 3 — La ventana: parar de escribir antes de fotografiar

Un preflight es una fotografía. Los procesos anteriores siguen sirviendo y
escribiendo entre la inspección y la sustitución, así que una fila con formato
viejo puede nacer justo en esa ventana. El orden existe para cerrarla:

| # | Acción | Aborta si |
|---:|---|---|
| 1 | Anunciar la ventana a los tenants del piloto | — |
| 2 | **Pausar productores**: worker, crons, colas entrantes | quedan jobs `active` tras el drenaje |
| 3 | Drenar o conservar lo pendiente que el inventario contó | un efecto quedaría sin recibo |
| 4 | **Backup previo** (punto de retorno) | el dump falla → no se migra |
| 5 | **Preflight de términos huérfanos** | exit ≠ 0 o la línea resumen no dice `blocks=0` |
| 6 | Migración `public` | Prisma falla |
| 7 | Migración de schemas de tenant | no imprime `MIGRATE_TENANTS_SUMMARY` |
| 8 | Migraciones de transformación manuales, si las hay | ver «Migraciones a mano» |
| 9 | Recrear contenedores con los **digests** del paso 1 | el digest en ejecución no es el aprobado |
| 10 | Salud de la API | no responde en 3 min |
| 11 | Reanudar productores | — |

Los pasos 4 y 5 son los mismos que ya corre `deploy.yml`, en el mismo orden y con
el mismo carácter fail-closed. El preflight cambió de significado: ahora cuenta
**lo mismo que la caja rechaza** —metadata NULL, `serviceTerms` nulo o vacío,
precio no numérico, moneda ausente, propuesta aceptada sin importe—, así que
puede dar un número mayor que la semana pasada. Eso no es una regresión: es lo
que estaba sin contar. Ver
[`agreed-terms-preflight.md`](agreed-terms-preflight.md).

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

## Paso 4 — Verificar con los tenants del piloto

Con los ids del paso 0, no «los que parezcan de prueba».

- entrega y duplicados: un efecto, un recibo;
- costos y reservas inciertas: `retainedExposure` distinto de cero es trabajo
  pendiente, no un problema resuelto;
- errores de financiación (131042 y posteriores a aceptación) pausan la cuenta
  correspondiente sin perder entradas;
- resolución de tareas y latencia.

El piloto del outbox durable, si se enciende, pasa por
`assessPilotScope`: **lista de tenants vacía significa todos**, y un canal sin
transporte estricto se descarta en silencio. Las dos cosas parecen éxito desde
afuera, así que las dos son un rechazo antes de escribir, y el valor se relee
después para saber que aterrizó.

## Paso 5 — Abrir el resto de las cuentas

Según criterios fijados **antes**, no improvisados. Y con el calendario de Meta
en la cabeza: el cambio tarifario del 1 de octubre afecta a cualquier cuenta que
siga enviando, estén o no encendidas nuestras funciones nuevas. Un canario de
pocos tenants no protege a los demás. Hace falta el inventario de preparación de
**todas** las cuentas activas, y resolver las que falten.

## Paso 6 — Recuperación, según el momento

| Momento | Qué se hace |
|---|---|
| Antes de admitir escrituras nuevas | Restaurar el conjunto consistente de datos **e** imágenes del punto de retorno |
| Después de admitirlas | **No** restaurar a ciegas: se perderían operaciones posteriores. Detener los efectos afectados y corregir hacia adelante, o ejecutar una reversión de datos probada |

En los dos casos: no se borran efectos pendientes, historial ni reservas. Se
concilian. Y **los cambios irreversibles del proveedor no se revierten cambiando
la imagen**: un mensaje entregado se entregó.

## Lo que este procedimiento todavía no demuestra

- No se ha ejecutado contra ningún host.
- No hay medida real de tamaño, de duración de la ventana ni del restore.
- Ninguna cuenta de canal real ha enviado nada.
- 0 de 76 perfiles certificados con un modelo real.

## Lo que falta de afuera

1. Acceso y capacidad del VPS, inventario actual, responsable y **ventana
   acordada**.
2. Los ids de los tenants del piloto y de los que no participan.
3. Cuenta/número de prueba elegible, método de pago del negocio, destinatario
   con consentimiento y presupuesto autorizado.
4. `CANDIDATE_PUBLIC_API_URL` y `CANDIDATE_PUBLIC_WA_URL` para el build del
   candidato.
5. Aprobación explícita del candidato y de la activación.
