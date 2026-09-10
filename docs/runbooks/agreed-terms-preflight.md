# El deploy se detuvo por filas que nadie aceptó

Si llegaste acá es porque el deploy abortó con

```
::error::Deploy blocked by the agreed-terms pre-flight (exit 1).
```

No se corrió ninguna migración y no se recreó ningún contenedor. La versión
anterior sigue sirviendo. No hay nada que revertir.

## Qué está diciendo

Tres familias de cobro dejaron de leer una columna viva y pasaron a leer **lo que
el cliente aceptó**. Es el cambio correcto —cobrar un número que el cliente nunca
vio es peor que no cobrar— y tiene una consecuencia con fecha: una fila creada
antes de ese atado deja de ser cobrable en el momento en que el runtime nuevo
carga, esté el outbox encendido o apagado.

El preflight cuenta esas filas **antes** de que eso ocurra. Si encontró alguna, un
cliente de ese tenant tiene —o va a tener— un enlace de pago que no va a
funcionar.

## Cómo leer la salida

```
  tenant=<uuid> family=appointments outcome=counted orphans=3
  tenant=<uuid> family=property_bookings outcome=acceptance_store_absent orphans=4
AGREED_TERMS_PREFLIGHT tenants=12 families=41 orphans=7 errors=0 blocks=1
```

Sólo identificadores y conteos: ni nombres, ni teléfonos, ni importes. Un registro
de deploy no es lugar para una lista de clientes.

| `outcome` | Qué significa | Qué hacer |
|---|---|---|
| `counted` | El registro de aceptación existe y estas filas no tienen una | Revisar fila por fila (abajo) |
| `acceptance_store_absent` | El registro de aceptación todavía no existe en ese schema, así que **ninguna** fila viva de esa familia tiene una | Lo mismo, pero son todas: es un tenant que aún no migró |
| `not_provisioned` | Ese tenant no tiene esa familia (una clínica no tiene menú) | Nada. No aparece como hallazgo |
| `failed` | La inspección no se pudo hacer | **No es cero.** Ver «cuando falla» |

`errors=0 blocks=0` es lo único que deja pasar el deploy.

## Qué hacer con cada fila

Abrí el detalle por tenant, que sí trae ids de fila y estados:

```
GET /tenant-payments/:tenantId/agreed-terms/orphans
```

Para cada una hay exactamente tres salidas honestas, y ninguna es «arreglarla
desde un script»:

1. **Está muerta en la práctica** — un pedido de hace ocho meses que nadie va a
   pagar. Llevala a un estado terminal (`cancelled`, `expired`) por el camino
   normal de la aplicación. Deja de ser viva y deja de contar.
2. **Está viva y se va a cobrar** — hay que volver a acordar con el cliente por el
   camino que sí registra la aceptación: rehacer la reserva/el pedido desde la
   pantalla, que escribe la propuesta aceptada.
3. **Se acepta el rechazo a conciencia** — el negocio decide que esas filas no se
   cobran y quedan como historial. Escribilo en el ticket del deploy; el preflight
   las seguirá contando hasta que cambien de estado, y ese es el punto.

Lo que **no** hay que hacer: escribir un `serviceTerms` o una fila en
`commitment_proposals` para que el conteo baje. Un número en una columna es
evidencia de que alguien lo calculó, no de que una persona lo aceptó. Inventar la
aceptación es exactamente el daño que este control existe para impedir, y ni el
comando ni el deploy pueden hacerlo: sólo emiten `SELECT`.

## Cuando falla en vez de contar

```
::error::agreed-terms preflight could not complete for N family inspection(s)
```

o

```
::error::Deploy blocked by the agreed-terms pre-flight (exit 2). 
```

`exit 1` con `errors>0` significa que alguna inspección no se pudo hacer;
`exit 2` significa que el control ni siquiera arrancó (sin cadena de conexión, sin
poder conectar, sin poder enumerar tenants, o un `schema_name` inusable).

En los dos casos el deploy se detiene, y es deliberado: **«no sabemos» no es
permiso para avanzar**. Un control que redondea lo desconocido a cero es peor que
no tener control, porque además da confianza.

Los códigos que vas a ver son de PostgreSQL (`42P01` relación inexistente,
`42703` columna inexistente, `ECONNREFUSED`). El mensaje del driver no viaja a
propósito: lleva el texto de la consulta, y el texto de la consulta lleva valores.

## Correrlo a mano

Dentro de la imagen candidata, con la conexión directa (no PgBouncer: esto lee a
través de todos los schemas y el pooling por transacción entregaría cada
statement a la conexión que esté libre):

```bash
docker compose -f infra/docker/docker-compose.prod.yml run --rm \
  api node scripts/preflight-agreed-terms.cjs
```

Con el detalle completo en un archivo:

```bash
... api node scripts/preflight-agreed-terms.cjs --json /tmp/preflight.json
```

Salidas: `0` limpio, `1` hay filas o falló una inspección, `2` el control no
corrió.

## Dónde vive

| Qué | Dónde |
|---|---|
| Las reglas por familia | `apps/api/src/modules/tenant-payments/agreed-terms-preflight.ts` |
| El comando | `apps/api/scripts/preflight-agreed-terms.cjs` |
| El paso del deploy | `.github/workflows/deploy.yml`, entre el backup y las migraciones |
| Que siga estando ahí | `agreed-terms-preflight-workflow.spec.ts`, que falla si alguien lo mueve |

El orden no es casual: el backup primero, porque es el punto de retorno; el
preflight después, porque es el que decide si vale la pena gastar la migración; y
las migraciones al final. Un control puesto **después** del cambio que pretende
proteger no es un control.
