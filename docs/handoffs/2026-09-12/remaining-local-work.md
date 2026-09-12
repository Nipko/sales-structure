# Lo que queda, con lo necesario para retomarlo sin volver a investigar

Fecha: 12 de septiembre de 2026.
HEAD al cerrar: `88422e23190d1e9733096e107aa3760c0276ca0e`.
Rango de esta tanda: `c1b94437..88422e23` — 68 commits, 275 archivos, +30.775/−1.680.

Árbol limpio, `git diff --check` limpio, los cuatro artefactos regenerados y
verificados contra este HEAD. Suite API completa: **742 suites, 9.126 casos,
todos en verde, contados una vez.** Typecheck en frío verde en `packages/shared`,
API, dashboard y landing. `test:bootstrap` verde. Build de landing: 39/39 páginas.

**Nada de esto está desplegado, ni empujado, ni activado.** No se encendió
`dispatch.normalOutbox`, no se activó `enforce`, no hubo llamadas reales a Meta
ni a modelos pagos, y no se cambió ningún precio ni contrato.

---

## Cómo está el cierre ahora

`docs/audits/2026-09-09/closure-report.md`, generado desde el código:
**13 aceptadas, 22 bloqueadas, 10 abiertas, 1 diferida** (46 filas).

Las 10 abiertas se reparten en tres grupos, y sólo el tercero es trabajo de
código pendiente de verdad.

### Grupo 1 — un solo número las mantiene abiertas (R0, R4, y detrás M0/M1/M5)

**7 productores cobrables fuera del carril durable** (1 `inline`, 6
`outbound_queue`). Seis son el repliegue de `conversations.service.ts` cuando el
interruptor de despliegue está apagado, y con el interruptor **encendido son
inalcanzables**: la propiedad del lote se decide ANTES de consultarlo y el bloque
legado entero cuelga de que el carril durable haya dicho que no. El séptimo es la
consola humana, que desde este HEAD entrega exactamente un efecto por el
transporte estricto y distingue aceptado / rechazado / desconocido.

**No baja escribiendo código.** Baja encendiendo `dispatch.normalOutbox` para un
tenant piloto, que es una decisión del dueño. Está probado el camino completo del
interruptor: encendido para todos, tenant nombrado en la lista piloto, tenant no
nombrado, lectura imposible, canal sin transporte estricto, y rollback sin
esperar a que expire un caché (`dispatch-rollout-paths.spec.ts`, y la propiedad de
que un lote ya comprometido conserva su respuesta aunque el interruptor se apague
después, en `dispatch-reply-producer.spec.ts`).

### Grupo 2 — esperan una decisión, no una línea de código

- **M4 — precios.** La propuesta completa está escrita y **sin aplicar** en
  `docs/audits/2026-09-12/m4-pricing-proposal.md`: tarifas reales de seis
  mercados derivadas de la tarjeta de octubre, margen (el nuestro no se mueve;
  lo que cambia es qué fracción del gasto del cliente somos: 87 % en Colombia,
  15 % con destinatarios peruanos), los cinco planes uno por uno, escenario
  recomendado (A: no cambiar precios) y alternativas B–E costeadas. §8 enumera
  las cinco decisiones que la cierran; ninguna es código.
- **El techo por contacto** (parte de M4 §5.1 y lo único que le falta al caso R5
  «Bot contra bot y ráfaga de contactos»). El mecanismo está construido y probado
  en los dos sentidos sobre PostgreSQL real. Lo que falta es **elegir el número**.
  Medido para que la decisión tenga datos: con techo agregado y sin techo por
  contacto, un bot que contesta a nuestro bot consume la cuota entera de la
  cuenta y el siguiente cliente real queda sin respuesta; con los dos, el bucle
  se detiene en 3 de 30 intentos y la cuenta conserva 17 de sus 20 entregas.

### Grupo 3 — trabajo local pendiente, todo especificado

Esto es lo que sigue, en orden de valor.

---

## 1. Las 13 correcciones de readiness (fila T2)

**Dónde:** `apps/api/src/modules/verticals/vertical-readiness.service.ts`.

Cada corrección ya está escrita, palabra por palabra, en el registro:
`READINESS_PREDICATE_AUTHORITY[key].divergence.correction` en
`apps/api/src/common/utils/readiness-predicate-authority.util.ts`. Para leerlas
todas de una:

```bash
cd apps/api && node -e "require('ts-node').register({transpileOnly:true,project:'tsconfig.json'});require('tsconfig-paths/register');const m=require('./src/common/utils/readiness-predicate-authority.util.ts');for(const [k,v] of Object.entries(m.READINESS_PREDICATE_AUTHORITY)){if(v.divergence)console.log(k,'->',v.divergence.correction)}"
```

**Empezar por `faq_content`**, que es la más grave y la única *inejecutable*: el
check filtra `is_active = true` y la tabla `faqs` tiene `is_published`. No existe
esa columna, así que el predicado no puede ejecutarse **para ningún tenant**, y
la rama escrita para una TABLA ausente se traga la COLUMNA ausente y reporta un
cero confiado. Como `faq_content` está en `BASE_READINESS` y `faqs` en
`BASE_TOOLS`, eso excluye `search_faqs` como `readiness_unmet` en todos los
tenants de todas las verticales, mientras la tool contesta al cliente desde la
fila sin problema.

- Corrección: predicado `is_published = true`, `repairRoute`
  `/admin/knowledge/faqs`.
- Además: acotar la rama `/does not exist/i` (≈ línea 296) a `42P01`, para que un
  42703 deje de leerse como tabla ausente.
- **Al aplicarlo se pone roja a propósito** la prueba
  `leaves the readiness blockage standing even though the row exists` en
  `apps/api/src/modules/quality/readiness-predicate-execution.postgres.spec.ts`.
  Está puesta así adrede: quien cierre el hueco tiene que venir a ese archivo y
  decir qué cambió. Reescribirla para afirmar la cadena cerrada (el write
  funciona, readiness limpia, la tool contesta).

**Dos advertencias que ya costaron caro:**

- `service_catalog` **no es un parche, es una decisión.** `duration_type='open'`
  escribe `0` en `duration_minutes`, y la lectura de home-services filtra
  `duration_minutes > 0`. Si readiness adopta ese filtro, un catálogo entero de
  servicios "abiertos" se reporta honestamente como no publicable; si en cambio
  la lectura aprende a manejar `open`, el catálogo publica y responde. Decidir
  **cuál de los dos lados está mal** y cambiar ese, no el otro.
- **No debilitar un check para que coincida con una tool cuyo predicado es el
  equivocado.** `boarding_capacity` (categoría con acentos, y una familia gateada
  que no tiene tool de lectura) y `professional_cases` (CTA que apunta a una
  pantalla de sólo lectura) tienen esa forma. La coincidencia no es el objetivo;
  que los dos lados describan la misma cosa real, sí.

**Y una que verifiqué y NO hay que hacer:** agregar `professionalServices` a
`TOOL_GROUP_READINESS`. La tool es `getCaseStatusTool(schema, contactId)` — un
predicado POR CONTACTO, que contesta correctamente "no tenés ningún caso
abierto" cuando no hay filas. Un gate ahí bloquearía la familia por algo que
ningún tenant puede resolver, que es exactamente lo que el docblock de ese mapa
prohíbe.

## 2. Retirar `petServices.emailConfirmations` (cierra T1)

Es el **único** control que queda sin consumidor, de catorce. No se puede cerrar
cableando nada: la familia no tiene ninguna tool que comprometa al negocio, y el
manifiesto de un tenant de pet-services lleva `pets` **y** `petServices`, así que
ningún consumidor puede saber a cuál de los dos interruptores pertenece una
operación.

El cierre honesto es sacarlo del contrato:

- `packages/shared/src/index.ts` — la clave en `ToolsConfig`;
- `apps/dashboard/src/app/admin/agent/_components/CapabilitiesSection.tsx` — su
  entrada en `slugMap` (hoy `petServices: "petservice_booking_confirmation"`);
- después `node docs/audits/2026-09-11/generate-tool-profile-audit.cjs --write`
  y regenerar el cierre.

Al hacerlo, `apps/api/src/common/utils/tools-programme-rows.spec.ts` se pone rojo
en el pin `expect(t1.open).toBe(1)`. Eso es lo correcto: el pin se mueve sólo con
un cambio real y hay que nombrar el que fue.

## 3. Las dos filas `declared` que ya podrían derivarse (T2 y T6)

Las dos siguen `open: 1` escrito a mano, y las dos tienen ahora una fuente
mecánica. El handoff original pide no aceptar una fila desde prosa.

- **T6 ya está hecha y la fila no lo refleja.** Assist consume
  `AgentContentProposalService.listOperations` como única lista, la copia privada
  que re-derivaba permisos desapareció de `copilot.service.ts`, y el prompt no
  lleva ningún array de capacidades. Derivar la fila de eso — por ejemplo, que
  `copilot.service.ts` no contenga su propio arreglo de capacidades y sí consulte
  el servicio — y la fila se cierra sola.
- **T2** puede derivarse del registro: `open` = cantidad de claves con
  `divergence` sin resolver. Hoy 13; a medida que caigan las correcciones del
  punto 1, baja sola.

Ambas en `docs/audits/2026-09-11/tools-programme-rows.cjs`, junto a T1/T4/T5/T7,
que ya se derivan así.

## 4. El último escenario de R5: «Humano, REST, campaña y recordatorio»

Evidencia que pide: *todos atraviesan admisión; nadie evita el control por
origen*.

**El `missing` que tiene escrito hoy es incorrecto y hay que corregirlo al
escribir la prueba.** Dice que "la prueba fallaría porque siete productores
siguen fuera del carril durable" — eso confunde dos propiedades, exactamente
como lo hacía el contador de R6 antes de corregirlo. El carril legado **sí** pasa
por la admisión (`gateOrSuppress`, última admisión en
`outbound-queue.processor.ts`); lo que le falta es la FILA antes del POST, que es
lo que cuentan R0 y R4.

Los cuatro orígenes y dónde admiten hoy:

| Origen | Camino | Dónde admite |
|---|---|---|
| Consola humana | `sendAgentMessage` | `admitAgentSend` antes del POST; y si el canal es cobrable y no hay transporte estricto, **rechaza antes de la admisión** |
| API REST | `whatsapp.controller.ts::dispatchRest` | `ProactiveDispatchService.send` → fila durable → el procesador admite antes del POST; se niega explícitamente a caer al POST inline |
| Campaña | `broadcast-queue.processor.ts:205` | igual, vía `proactive.send` |
| Recordatorio | recordatorios de turno | igual, con autoridad de política |

La prueba que falta ejecuta un envío de cada uno y afirma que cada uno llega a la
MISMA admisión antes de cualquier POST. El molde a copiar es
`proactive-lane-semantics.postgres.spec.ts`, que ya maneja el procesador real con
un medidor que registra lo que le preguntaron y después se niega a contestar.
Cuando exista, `covered` acepta una LISTA de lugares (agregado en esta tanda),
así que los cuatro orígenes pueden nombrarse en sus propios archivos.

## 5. Huecos menores, ya diagnosticados

- **`vehicles.emailConfirmations` era inalcanzable** y se arregló, pero quedan
  **14 plantillas de correo sembradas que no consume nadie** (lista completa en
  el reporte del agente T1; entre ellas `realestate_visit_confirmation` y
  `veterinary_appointment_confirmation`, que el editor prometía y el código no
  renderizaba — eso ya está corregido apuntando a la plantilla real). Decidir por
  cada una: consumirla o sacarla del seed.
- **`home-services.service.ts::updateRequest` no emite evento**, así que una
  solicitud creada `pending` y agendada después por una persona nunca produce
  confirmación. Un `emit` de una línea, documentado en el listener.
- **`check_availability` default de 30 minutos vs `createAppointment` que lanza
  si falta la duración** (`ai-tool-executor.service.ts:2762` vs `:3198`): se
  ofrece un turno y después la reserva falla.
- **`/admin/cases` es de sólo lectura** y es el CTA de reparación de
  `professional_cases`; el único escritor es `/admin/pipeline`.

## 6. Lo que quedó afuera de esta tanda y por qué

- **Los 76 perfiles no están certificados, ni los 5 canales.** Sigue en 0/76 y
  0/5, y la landing lo dice. Certificar necesita credenciales reales, llamadas a
  modelos pagos y gasto autorizado: es gate externo, no trabajo local.
- **`hreflang` en la landing, deliberadamente no agregado.** Los cuatro idiomas
  comparten un documento y el locale sale de una cookie; cuatro alternates le
  dirían a un crawler que existen cuatro URLs indexables cuando existe una. El
  build ahora **falla** si alguien agrega `hreflang` o un `xhtml:link` en el
  sitemap mientras las rutas por locale no existan. El arreglo real (segmento de
  locale, `LangProvider` por ruta, sitemap derivado, redirects) está escrito en
  `apps/landing/drafts/legal-commercial-review-2026-09-12.md` y es una sesión
  propia.
- **Siete componentes de landing no montados en ninguna página**
  (`MultiChannelShowcase`, `ProblemSection`, `HowItWorks`, `FeaturesGrid`,
  `ComparisonTable`, `VibeSellingBand`; `TestimonialsSection` está desmontado a
  propósito). Sólo se montó `StatsCounter`, porque lleva el "0 de 5 certificados"
  que el mandato exige publicar. Montar los demás es una decisión de diseño.

---

## Dos cosas que hay que saber antes de tocar nada

1. **Un archivo se perdió y se reconstruyó.** Un subagente corrió
   `git stash` / `git clean` sobre un árbol sucio y destruyó
   `docs/whatsapp-meta-pricing-2026-10.md`, que nunca había sido comiteado y que
   diecisiete documentos citan. Está reconstruido desde la evidencia preservada
   y **dice en su encabezado que es una reconstrucción**: su plan F0–F3 y las
   decisiones del dueño que registraba no se reconstruyeron porque no hay
   artefacto del que derivarlos. Si el original decía algo que ese archivo no
   dice, el original tenía razón.
   **Ningún agente debe correr `git stash`, `clean`, `checkout --`, `restore`,
   `reset`, `rm`, `add`, `commit` ni `worktree` mientras el árbol esté sucio.**
2. **Nunca dos corridas de jest a la vez.** Las bases desechables se recrean por
   corrida y el guard rechaza la segunda. Y la VM de WSL se apaga sin una sesión
   sosteniéndola, lo que se ve como un localhost intermitente y no como lo que
   es.
