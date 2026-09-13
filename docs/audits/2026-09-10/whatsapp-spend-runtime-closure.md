# Cierre local: motor de gasto de WhatsApp, frontera única y ruta de candidato

_Rango: `d720370d..9cb12e24` (14 commits de código y documentación derivada).
Generado a mano a partir de artefactos que sí son derivados; cada número de esta
página se puede reproducir con el comando que aparece junto a él._

Este informe cierra la tanda descrita en
`docs/handoffs/2026-09-10/claude-whatsapp-spend-runtime-continuation.md`. No hubo
push, ni despliegue, ni activación, ni una sola llamada a un proveedor real, ni
un centavo de gasto. Lo único que queda pendiente son gates verdaderamente
externos, enumerados al final con el comando exacto que abre cada uno.

---

## 1. Los commits, uno por línea

| Commit | Qué cierra |
|---|---|
| `77eefb8c` | Toda salida cobrable de WhatsApp pasa por una admisión: los tres sumideros (transporte durable, gateway legado en sus tres carriles, REST inline). Reserva **antes** del POST. `observe` por defecto. |
| `0b577c5c` | El censo se vuelve estructural y CI falla si aparece otro productor fuera de la frontera. Retira `sendTestMessage`, un envío cobrable sin llamadores. Arregla el EOF del generador. |
| `60115d7c` | Cada techo pasa a tener tres alturas: aviso, soft stop (pausa lo que iniciamos nosotros) y techo. La disposición la declara el productor, nunca se infiere del contenido. |
| `155dbfa7` | Un lote declara su techo **antes** del fanout, en entregas, sin depender de tarifario. |
| `0b53027b` | La política de avisos de fallo deja de ser una constante y pasa a ser del tenant, con piso y techo que ninguna configuración puede cruzar. |
| `7fba70fd` | Una ráfaga es un turno, fotos incluidas: texto y adjuntos comparten un buffer ordenado. |
| `6544fb84` | Se deja de pagar por decirle lo mismo a la misma persona: `content_digest` + ventana + cooldown. |
| `1a4c4c92` | Señales que un dueño puede accionar y que no juzgan a nadie: contactos a los que sólo escribimos, categorías y países caros, exposición separada del costo. |
| `6a5cca24` | 131042: se pausa **un número**, no se reintenta, entra todo lo entrante, y la vuelta es verificable. |
| `985f0ac9` | Censo regenerado. |
| `62c737d5` | `timezone_id` numérico mapeado **desde evidencia**, propagado sólo dentro de la misma WABA y el mismo id, con contradicciones reportadas y no promediadas. |
| `05ed786f` | La ruta de candidato se puede lanzar antes del merge, hornea los once `NEXT_PUBLIC_*`, corre la suite, y su manifiesto tiene consumidor. |
| `a4b3899e` | El cobro de Meta se ve dentro del producto que lo produce, en es/en/pt/fr. |
| `0c1277dc` | Dos specs desactivaban una regla de lint con el nombre equivocado. |
| `9cb12e24` | El runbook de cutover dice cómo se arranca y cómo se consume el candidato de verdad. |

---

## 2. El censo derivado, antes y después

Reproducible: `node apps/api/scripts/outbound-producer-inventory.cjs --check`

| | Antes de esta tanda | Ahora |
|---|---:|---:|
| Sitios de llamada que pueden poner un mensaje en un teléfono | 38 | 38 |
| De ellos, cobrables | 37 | 37 |
| Sitios fuera de un carril **durable** | 26 | 26 |
| **Productores WhatsApp cobrables fuera de la frontera económica** | **26** | **0** |
| Salidas al proveedor sin admisión ni camino declarado | *(no existía la medida)* | **0** |

La última fila no tiene columna «antes» porque la medida **no existía**: el
barrido no buscaba salidas al proveedor, sólo primitivas conocidas por nombre.
La primera corrida capaz de medirla encontró cinco —cuatro en el adaptador de
Messenger, hoy declarado camino porque su proveedor no cobra por mensaje, y una
en la consola del agente, hoy con admisión en el propio sitio de llamada—.

Los 26 que esquivan el carril durable siguen siendo 26: esa columna mide
durabilidad, no dinero, y migrar veintiséis productores al outbox era una
reescritura que esta tanda no hizo. Lo que sí cambió es que **ninguno de ellos
puede gastar sin pedir permiso**, porque la frontera se puso en los sumideros —
que son tres — y no en los productores, que son veintiséis.

La clasificación es estructural, no nominal. Para cada sitio se resuelve dónde
sale realmente el mensaje del proceso (el carril lleva al procesador; una llamada
inline se resuelve leyendo el tipo declarado del receptor y buscando esa clase en
el árbol) y se pregunta si **ese archivo** contiene una llamada a la autoridad
económica, con comentarios y plantillas quitados. No hay lista de métodos
aprobados.

`sendTestMessage` no aparece en ninguna de las dos columnas porque se eliminó:
posteaba un texto al número del dueño recién conectado, tenía cero llamadores, y
desde octubre era un envío cobrable sin reserva, sin recibo y sin nadie que lo
contara.

---

## 3. Invariantes del motor, y cómo están probadas

Todo lo de esta sección corre contra un PostgreSQL real y desechable, con
transacciones que compiten de verdad —no llamadas secuenciales, que pasan contra
un diseño sin locks—. El segundo escritor queda **demostrablemente bloqueado** en
el lock de fila cuando el primero hace COMMIT, y lo que lo rechaza es el
predicado reevaluado.

| Invariante | Prueba |
|---|---|
| Dos productores, el último presupuesto | el segundo es rechazado; la suma nunca supera el techo |
| La milésima entrega gratis | se la lleva uno y el otro se cobra; decidir el reparto antes del lock double-grantea |
| Un timeout después de la aceptación | queda contado, **nunca** se libera, y el barredor no lo convierte en liberación |
| Un COMMIT incierto | el reintento encuentra la MISMA reserva por `effect_key`, o descubre que no hay ninguna |
| Liquidar | una sola vez, devolviendo el excedente; un segundo settle se rechaza |
| Liberar | sólo con rechazo probado; un resultado desconocido se retiene |
| Varios techos a la vez | una reserva toca cuenta, negocio, contacto, mes y tarea, y la liberación vuelve a todos |
| Las tres alturas | aviso inclusivo, soft stop que pausa campañas y deja pasar respuestas, techo que para todo |
| Soft stop bajo carrera | dos campañas a 94 % que caben por separado: la segunda es rechazada |
| El techo de un lote | exactamente el número lanzado pasa; dos workers en la última ranura, uno solo entra |
| Repetición | la misma frase por otro productor se rechaza; dos destinatarios distintos no; dos números distintos no; un rechazo probado no cuenta |
| Señales | exposición separada del costo, un rechazo probado desaparece, y nunca se suman monedas |

Conteos reproducibles:

- `spend-ledger.postgres.spec.ts` — **48/48**
- `whatsapp-spend-ledger-schema.postgres.spec.ts` (paridad de las tres
  definiciones) — **33/33**
- `migration-under-load.postgres.spec.ts` — **16 migraciones** aplicadas mientras
  el turno seguía escribiendo, **2.111 escrituras** concurrentes, **0 perdidas**

---

## 4. Resultados completos, con las omitidas contadas

| Gate | Resultado |
|---|---|
| Suite API completa, **todas** las PostgreSQL habilitadas | **640/640 suites, 7.225/7.225 tests, 0 omitidas** |
| Suite dashboard | 70/70 suites, 798/798 tests |
| Playwright completo | **186/186** |
| Typecheck | `packages/shared`, `apps/api`, `apps/dashboard`, `apps/landing`, `apps/whatsapp` — los cinco en verde |
| Build | los cinco en verde |
| Bootstrap DI (`test:bootstrap`) | verde |
| Lint | `apps/api`, `apps/dashboard`, `apps/whatsapp` — los tres en verde |
| `git diff --check` | limpio |
| Generadores `--check` | tarifas, artefactos de cierre e inventario — los tres al día |

Dos notas honestas sobre esos números:

1. **Las nueve omitidas que había desaparecieron al configurarlas, no al
   borrarlas.** `pgbouncer-transaction-pooling.postgres.spec.ts` se saltaba por
   falta de `PARALLLY_PGBOUNCER_TEST_URL` y `PARALLLY_PGBOUNCER_DIRECT_URL`. Con
   PgBouncer real en modo transacción delante de la misma base desechable, sus
   nueve casos pasan. El comando completo está en
   `docs/runbooks/full-api-suite.md`.
2. **Playwright falló una vez y pasó dos.** El caso
   (`locales-and-access.spec.ts` → «gives the page one main landmark and a first
   heading», proyecto `dashboard-mobile`) visita `/admin`, que esta tanda no
   tocó; pasa aislado y pasa en una corrida completa repetida. Se reporta como
   inestabilidad del servidor de desarrollo bajo contención, no como verde.

---

## 5. Defectos que las pruebas encontraron en este mismo trabajo

Se listan porque son la evidencia de que las pruebas sirven para algo:

1. **El barrido de salidas quitaba las plantillas antes de buscar la URL** — que
   vive en una plantilla. Reportaba un árbol limpio contra un archivo que postea
   directo a Meta.
2. **El memo de «archivo con admisión» sobrevivía a los hechos que memorizaba** y
   contestaba la segunda pregunta con la primera respuesta.
3. **`reserveAgainstCounter` pasó de devolver un booleano a devolver un objeto** y
   `if (!allowed)` dejó de dispararse sin que tsc dijera nada.
4. **Un techo de tarea heredaba el soft stop de 950**: una campaña lanzada para
   cien personas paraba en noventa y cinco.
5. **La comparación del soft stop es estrictamente menor**, así que en 1000 el
   techo efectivo quedaba en `cap − 1`.
6. **`Number(null)` es cero y cero es finito**: un `episodeMinutes` sin
   configurar se leía como «cero minutos» y se recortaba al piso de un minuto.
7. **La spec de paridad aplicaba UNA migración nombrada**, comparando un esquema
   nuevo contra uno migrado a medias.
8. **Un caso de señales compartía número con los demás** y pasaba contra una fila
   que había escrito otro caso.
9. **Una secuencia de escape ANSI** había quedado escrita dentro de un comentario
   en `spend-ledger.ts`, en lugar de una palabra.

---

## 6. Cada gate externo, y el comando exacto que lo abre

Ninguno se puede cerrar desde acá. Los cinco son de afuera.

1. **Ventana, acceso y responsable del VPS.** Sin eso el cutover se prepara y no
   se ejecuta. Abre con: la ventana acordada y el inventario del paso 0 del
   runbook.
2. **Los `NEXT_PUBLIC_*` del candidato.** `CANDIDATE_PUBLIC_API_URL` y
   `CANDIDATE_PUBLIC_WA_URL` como variables de repositorio; `META_APP_ID`,
   `META_CONFIG_ID`, `GOOGLE_OAUTH_CLIENT_ID`,
   `MESSENGER_FB_LOGIN_CONFIG_ID` y `VAPID_PUBLIC_KEY` como secretos.
   `META_SOLUTION_ID` queda vacío para el camino directo de Tech Provider y
   sólo se configura si existe una solución multi-socio aceptada. Abre con:
   configurarlos y poner la etiqueta `build-candidate` en el PR del candidato.
3. **Método de pago en la WABA del negocio.** Lo gestiona el dueño en la
   superficie de Meta; la plataforma nunca recibe ni guarda datos de tarjeta.
   Abre con: la tarjeta cargada, y se comprueba sola —la primera aceptación de
   Meta levanta la pausa por `provider_accepted`, sin que nadie lo declare.
4. **Destinatario con consentimiento y presupuesto autorizado del canario.**
   Abre con: número de prueba elegible, destinatario consentido, tope de gasto y
   autorización explícita.
5. **Credencial de modelo real para certificar perfiles.** 0 de 76 certificados.
   Abre con: la clave y el presupuesto; el ejecutor ya existe y ya reserva.

Dos cosas más que quedaron preparadas y **no** ejecutadas, por decisión y no por
olvido:

- El disparador por etiqueta existe en el archivo y está fijado por un contrato
  de test, pero **nunca corrió en GitHub**: no se puede ensayar sin empujar.
- El consumidor del manifiesto **sí** se ensayó localmente —genera el override,
  fija los cinco digests y termina en 1 nombrando cada servicio que no
  coincide— pero no contra los contenedores del VPS.

---

## 7. Evidencia de que no pasó nada de lo prohibido

- **Sin push**: el trabajo está en `claude/agent-platform-finalization-20260909`,
  62 commits por delante de su propio remoto. Ningún `git push` corrió en esta
  tanda.
- **Sin despliegue**: `deploy.yml` y `release.yml` sólo disparan con push a
  `main`. Ni esta rama es `main`, ni hubo push — así que ni siquiera empujarla
  habría desplegado nada.
- **Sin activación**: la admisión sale en `observe` por defecto, por tenant, y
  nadie la cambió.
- **Sin proveedor real**: las únicas instancias usadas son desechables y de
  loopback — PostgreSQL 55437, PgBouncer 55438, pgvector 55439, Valkey 55440 —, y
  cada spec rechaza una base cuyo nombre no termine en `_eval_isolation`.
- **Sin gasto**: no hay una sola llamada saliente a Meta en ningún test; el
  transporte se dobla o se detiene en la admisión.

**Cambios ajenos, preservados sin tocar**: `CLAUDE.md`,
`docs/plan-profitability-2026-07.md`, `.validate-index.cjs` (sin seguimiento) y
`docs/whatsapp-meta-pricing-2026-10.md` (sin seguimiento). Ninguno entró en
ningún commit de este rango.

---

## 8. Lo que sigue abierto, dicho sin adornos

No se declara «listo para desplegar». Lo que falta y depende de nosotros:

- **Selector obligatorio de conexión** en reglas y productores proactivos para
  tenants multinúmero (§7 del handoff). El panel de gasto y la lectura de
  readiness están; el selector en las pantallas de automatización no.
- **Recorridos guiados** desde la conexión hasta una prueba económica segura.
- **Landing, manuales y KB de Assist** actualizados desde las mismas fuentes de
  verdad. La KB de Assist vive en `apps/api/kb/assistant/{es,en,pt,fr}` y no se
  tocó en esta tanda.
- **Identidad por usuario** exigida por las políticas vigentes de Meta, cuando
  aplique, antes de activar el envío.

Ninguno de los cuatro impide que el motor sea correcto; los cuatro impiden decir
que la experiencia está completa.
