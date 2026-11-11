# 0025 — Regresiones de E2w: «si» condicional, ítems de plantilla en la verdad QA y horario sin confirmar en el prompt

- Estado: aprobada (decidida con la autorización autónoma del dueño; se revisa con él a su regreso)
- Fecha: 2026-11-07 · Decide: dueño · Autor: Claude
- Ámbito: `apps/api` (`informational-detour.ts`, `conversations.service.ts`), `packages/business-spec` (`qa/truth.ts`).

## Contexto

E2w (tras #401) bajó los fallos de 68 a 57, pero C07, C10, C03 y C17 empeoraron respecto de E2v. El análisis caso a caso:

- **C07 / C10 en salon y dental**: el banco regenerado eligió servicios de la plantilla del alta (`content_status = seeded`, `origin = platform_seed`, `price_status = example`) donde E2v había elegido «Corte y estilo» (confirmado). No es una regresión del código, sino dos problemas que el cambio de banco dejó ver:
  1. **C10, motor de reservas**: «Si pido 3 de Manicure y pedicure, ¿cuánto sería en total?» empezaba por «si» sin tilde y se leía como un «sí»: la misión tentativa se volvía real y el motor contestaba «Perfecto, agendaremos…» sin dar el total. Además `PRICE_TOPIC` no reconocía «cuánto sería» ni «en total».
  2. **C07, verdad QA contra runtime**: la ADR 0006 (punto 4) decía que una fila con `price_status` deja «por confirmar» solo el precio y afirma el resto. La opción B del dueño (06-nov) y el runtime (`catalogContentStatus`) dicen que un ítem de plantilla nunca se presenta como oferta confirmada. El banco pedía AFIRMA de «¿Tienen Color y tratamiento?» y el agente, correctamente, no lo afirmaba.
- **C03 en salon**: con el horario sembrado, el estado ya era `unknown`, pero el prompt seguía listando el horario de la plantilla, y el modelo dijo «No tengo confirmado el horario… Los domingos está cerrado».
- **C17 (inmobiliaria) y C07 (viajes)**: frases del modelo («No hay información de financiación disponible», «No hay salidas programadas») que el juez lee como negación. Casos aislados de redacción; no se tocan aquí.

## Decisión

1. **«Si» condicional no es un sí.** `isConditionalSi`: «si» sin tilde, sin pausa después, seguido de su condición y de una pregunta (cuánto, qué, cómo…). No cuenta como sí en `informationalTopic`, `bookingActKind`, `isPushingToBook` ni `answerToOffer`. `PRICE_TOPIC` reconoce «cuánto sería / saldría / quedaría», «en total», «how much would» y sus equivalentes en pt y fr.
2. **El marcador de precio solo prueba revisión si confirma el precio.** En `qaTruth`, `priceMarker` hace afirmable el resto de la ficha solo cuando `priceStatus !== 'example'`. Un `price_status = example` lo escribe la plantilla junto con el ítem; ese ítem queda entero «por confirmar» (NC+AV), como lo lee el runtime. Esto acota el punto 4 de la ADR 0006, que se escribió antes de la opción B.
3. **Un horario que el contrato no confirma no se muestra.** Si el contrato del turno no tiene CORE.HOURS.REGULAR entre sus hechos, el prompt recibe `UNKNOWN_INFORMATIONAL_HOURS` (estado `unknown` más la instrucción de «no consta») en lugar del horario de la plantilla.

## Consecuencias

- La equivalencia antes/después de la migración de procedencia (R3 #3) se mantiene: la regla nueva es la misma con procedencia real o heurística.
- En salon y dental, las preguntas por servicios de plantilla esperan «por confirmar + AV». El agente puede nombrar el servicio, pero no lo ofrece como confirmado.
- Un tenant cuyo horario esté sembrado o ausente ya no ve su horario en el prompt. El dueño lo confirma en la preparación y vuelve a aparecer.

## Alternativas descartadas

- **Dejar la ADR 0006 punto 4 tal cual y hacer que el runtime afirme los servicios con `price_status`.** Contradice la opción B, decidida después por el dueño.
- **Distinguir la procedencia real de la heurística (`legacyRule === null`).** Rompía la equivalencia de la migración: el mismo ítem tendría dos verdades según la ruta de lectura.

## Adenda (E2x, 2026-11-07): C01 con servicios de plantilla

E2x confirmó C07, C10 y C03 (3 de 3), pero C01 bajó de 72% a 61%: ante «¿qué es lo que hacen?», salon y dental listaban la coloración, la manicura o las consultas de la plantilla como oferta real. `list_services` ya marcaba esos servicios (`contentStatus`) y la proyección la conservaba, pero `<available_services>` no la mostraba.

Decisión: el servicio de plantilla lleva `content_status="seeded|example"` en `<available_services>`, y el bloque trae una sola `<note>` (`SEEDED_SERVICES_NOTE`): al describir el negocio se omite o se nombra como pendiente de confirmar, sin dar su descripción, duración ni precio como hechos. Sin servicios de plantilla, el bloque queda igual que antes.

## Adenda 2 (E2y, 2026-11-07): C01 en dental

Con #403, C01 subió a 81% y salon dejó de fallar. Dental siguió recitando «consulta general, especializada y control»: su descripción confirmada (`companies.about`) no nombra servicios, y los tres del catálogo son de plantilla. Seguían entrando al prompt por dos vías sin marca:

1. `projectedCatalogFacts` convertía la duración de cada servicio de `<available_services>` en un hecho citable (`<fact_tokens>`) sin mirar `contentStatus`. Ahora un servicio de plantilla no genera hechos: su duración y su precio no constan.
2. `<catalogue_authority>` listaba los servicios como `<offered>` («la lista completa de lo que ofrece el negocio»). Ahora el ofrecido de plantilla lleva `content_status="seeded"` y el bloque trae la misma nota (`SEEDED_SERVICES_NOTE`), una sola vez por prompt.

## Adenda 3 (E2z, 2026-11-07): P07-4, un servicio no es un inmueble

Con #404, C01 subió a 90% y dental pasó los 3 intentos. Apareció un caso nuevo en inmobiliaria: «¿Cuántos metros y habitaciones tiene Avalúo comercial?» (un servicio de plantilla) fallaba 3 de 3. El agente respondía «corresponde a un apartamento de 80 m² con 2 habitaciones», los datos del único inmueble del tenant.

Las palabras de inmueble («metros», «habitaciones») hacían que `listingQuestionOperation` forzara `search_listings` sin filtros, y el modelo atribuía el resultado al servicio.

Decisión:
1. Si el mensaje nombra un servicio de `<available_services>` (`namedCatalogService`), no se fuerzan las lecturas `listing_info` ni `find_listing`.
2. Todo resultado de `search_listings` con inmuebles trae `subjectNote` (`LISTING_SUBJECT_NOTE`): un servicio no es un inmueble, y sus metros, habitaciones o precio nunca se atribuyen a un servicio.

## Adenda 4 (E2aa, 2026-11-07): C10 con stock corto y C01 en dental

Con #405, P07-4 pasó 3 de 3 y los fallos bajaron de 40 a 30. Quedaron dos casos de producto:

1. **C10 en electrónica (3 de 3)**: «Si pido 3 de Audífono QA Aurora, ¿cuánto sería en total?» con 2 en stock recibía el precio por unidad y el stock, pero nunca el total. `quantityTotalNote` callaba a propósito cuando la cantidad superaba el stock (F4300-37 le dejaba ese caso a `stockShortfallNote`). Decisión: si el cliente pregunta el precio o el total (`PRICE_TOPIC`), el total se dice igual, «Por 3 unidades serían 359.700 COP (3 × 119.900 COP)», y el stock va al lado, como pide la regla 22a. Sin pregunta de precio, el caso sigue siendo de la nota de stock.
2. **C01 en dental (5 de 6 respuestas entre E2z y E2aa)**: con la marca y la nota de las adendas 1 y 2, el modelo seguía listando «consultas generales, consultas especializadas y controles» como oferta confirmada. Decisión: un guard de salida (`pendingServicesNote`) agrega que están pendientes de confirmar por el negocio cuando la respuesta nombra dos o más servicios de plantilla y ninguna de sus frases lo dice. Con un solo servicio (una cita o una pregunta por nombre) no actúa, para no tocar las confirmaciones de reserva.

**E2ab:** C10 pasó 3 de 3, pero C01 en dental falló 3 de 3 y el guard nuevo no se activó ni una vez. En dental la reserva no está autorizada (C16, «modo ausente»), así que `<available_services>` queda vacío. El modelo toma los servicios de `<catalogue_authority>` o de `list_services`. Decisión: el guard reúne los servicios de plantilla del turno de las tres fuentes (`templateServicesOfTurn`): `<available_services>`, `catalogueAuthority.pending` y las lecturas `list_services` del turno.

**E2ad:** C01 en dental siguió fallando 3 de 3 con gpt-4o-mini, y el guard no actuó ni una vez. Con las filas reales, la cadena (`catalogContentStatus` → `templateServicesOfTurn` → `pendingServicesNote`) agrega la nota. La causa era la condición de entrada: el guard se saltaba todo turno con `directive`, y con la reserva en modo ausente (C16) el motor deja un `directive` en cada turno de dental, «¿qué hacen?» incluido. Decisión: el guard ya no depende de `directive`. Solo deja intacto el texto del motor cuando se envía tal cual como respuesta (`engineReplyText`). El log pasa a `warn` para que se vea en los runners de medición.

**E2ae (dental, tras #409):** el guard ya actúa en C01, pero solo 1 de 3 respuestas guardadas trae la nota. En los otros dos intentos el log muestra que el guard actuó y que la nota no llegó a la respuesta final: un paso posterior la descartó. El candidato es el verificador de evidencia (D1b), que quita frases sin respaldo; el log no dice cuál fue. Decisión: la nota se vuelve a aplicar sobre la respuesta compuesta después del verificador. Es idempotente, así que no se repite si ya está. Además, si la respuesta ya dice en cualquier parte que algo está pendiente de confirmar, no se agrega: «aunque están pendientes de confirmación:» seguido de una lista con viñetas ya lo dice, aunque esa frase no nombre los servicios.

## Adenda 5 (E2ag, 2026-11-10): línea base con gpt-6-luna

E2ag es la primera medición completa con el catálogo de la ADR 0029: el agente responde con gpt-6-luna y el verificador de evidencia usa gemini-3.5-flash-lite. En el ensayo, el campo `model` de cada caso guarda el modelo de la última llamada del turno, que suele ser el verificador. Las llamadas facturadas del periodo fueron 1.326 de gpt-6-luna y 1.559 de gemini-3.5-flash-lite: no hubo caída de proveedor.

Frente a E2ad, en los 5 tenants comunes pass^3 bajó de 93 % a 87 %. Los 7 tenants quedaron en 770 de 835 aciertos (92 %). gpt-4o-mini no consultaba las lecturas propias ni prometía traspasos; gpt-6-luna sí lo hace, y eso destapó tres fallos de fondo:

1. **C19/C20 (22 fallos).** «¿Cuántas reservas tengo?» llama a `list_my_*`, la lista vuelve vacía y el agente niega: «No tiene reservas registradas». Esas herramientas solo leen lo vinculado al contacto de este chat. Decisión: una lectura propia vacía lleva `scope: this_chat_contact` y una instrucción (`own-records-scope.ts`, aplicada en `AIToolExecutorService.execute`): no se niega, se dice que no se ve nada vinculado a este chat y se pide el dato con el que reservó o se ofrece una persona.
2. **C30 (5 fallos).** «¿Me comunicas con alguien del equipo?» no contaba como pedido de una persona, porque no nombra ninguna palabra del paquete («asesor», «una persona»). La promesa de traspaso del modelo se leía como no pedida y, sin persona disponible, quedaba «No tengo ese dato confirmado en este momento.». Decisión: pedir que lo comuniquen, lo pasen o lo conecten con alguien, o hablar con alguien del equipo, es `request_human` (`PUT_THROUGH_TO_SOMEONE` en `intent-normalizer.ts`). «¿Qué pasa con alguien que llega tarde?» y «¿alguien me dice el precio?» no lo son.
3. **C13/P02-5 (7 fallos).** `get_promotions` vacía decía «No active promotions at this time.», y el agente afirmaba que no hay promociones. Decisión: `get_promotions` y `list_active_offers` vacías dicen que no hay promociones publicadas, sin negar que existan (D1j).

Además, `publishedForSelection`, la selección correctiva de FAQ (#303), pasaba la relación congelada como `$3` en una consulta que solo tenía `$2`. En el ensayo fallaba siempre (216 veces en E2ag); en producción no se usa la relación congelada. Ahora usa `$2`.

Quedan abiertos, sin cambio en esta adenda:
- disponibilidad de hotel afirmada sin fuente (C15, P05-5);
- check-in sembrado (P05-2);
- «dura 4 hours»: el modelo copia `durationType`;
- «Reservaremos…» en C16, que sigue pendiente de la decisión del dueño sobre el modo de escritura.

## Adenda 6 (E2ah, 2026-11-10): resultado de #419

Es la medición de 7 tenants con el mismo banco que E2ag, después de desplegar #419.

| Indicador | E2ag | E2ah |
|---|---|---|
| Aciertos | 92 % (770/835) | 94 % (786/834) |
| pass^3 | 87 % (240/275) | 91 % (249/274) |

Por intención, las tres correcciones funcionaron:
- **C19:** 48 % → 76 %.
- **C20:** 76 % → 100 %.
- **C30:** 76 % → 100 %.
- **C13:** 81 % → 100 %.

Subieron hotel (85 % → 92 %), viajes (88 % → 94 %), electrónica (94 % → 98 %) y comida (93 % → 98 %).

Regresión nueva: **inmobiliaria bajó de 97 % a 90 %**. El agente lee los campos vacíos de la propiedad como una negación:
- «no tiene amenidades registradas»;
- «Parqueaderos: 0»;
- «financiación no disponible».

Además, en C06 dijo dos veces que no hay catálogo cuando sí hay una propiedad confirmada. Es la misma clase de error que «lecturas vacías que niegan», ahora en los campos de una ficha; queda como siguiente corrección. C16 sigue en 67 %.


## Adenda 7 (E2ai y E2aj, 2026-11-10): ficha inmobiliaria y datos del dueño hacia el agente

**E2ai** se midió después de #422. La ficha inmobiliaria ya no niega con defaults de columna: parqueaderos 0, financiación `false` y amenidades vacías sin confirmar llegan como desconocidos (`unconfirmedFields`), igual que en la opción B de la preparación. Inmobiliaria subió de 90 % a 95 % (pass^3 88 % → 92 %).

El dental bajó de 95 % a 81 %. E2ai sumó casos AFIRMA del dental (128 → 188 intentos AFIRMA en total) porque el dueño confirmó datos en el panel, y esos datos no llegaban al agente. Hubo tres causas:

1. **Políticas.** Ninguna plantilla activaba la familia `policies`, así que `get_policy` no se ofrecía y el agente no leía `CORE.POLICY.*`.
2. **Documentos.** Todas las plantillas sembraban `rag.similarityThreshold: 0.75`. Las puntuaciones reales del documento de la clínica estaban entre 0,55 y 0,68, y `search_knowledge_base` volvía vacía.
3. **Regla de plantilla.** «NUNCA pidas cédula» llevaba al agente a negar un requisito que el negocio sí declara.

Decisión (#423):
- `policies: { enabled: true }` va en todas las plantillas.
- El umbral es 0,35, el mismo `KB_RELEVANCE_THRESHOLD` de la plataforma.
- En el dental, la regla de documento cede ante lo que declaran los documentos o las FAQ del negocio.

Los agentes ya creados se actualizaron en la base: el umbral en los 24 y `policies` en 22 (los dos de `tenant_ioffi` no tienen bloque de herramientas). Hay respaldo previo en el VPS. Las demás plantillas con «NUNCA pidas cédula» (seguros, inmobiliaria, tienda y cotizaciones) no cambian: eso es una decisión de privacidad aparte.

**E2aj** se midió después de #423. Al final de la medición se agotó el crédito de la cuenta de OpenAI. El dental era el último tenant y 69 de sus 120 intentos dieron 429, así que no se puede decir si se recuperó.

| Indicador (6 tenants sin dental) | E2ai | E2aj |
|---|---|---|
| Aciertos | 95 % (676/711) | 94 % (669/710) |
| pass^3 | 90 % (208/231) | 91 % (209/230) |

- Inmobiliaria llegó a 98 %, con C06 al 100 %.
- Electrónica bajó de 97 % a 93 %, con 8 tiempos agotados de `automatic_search_faqs`.
- En los intentos del dental que sí se calificaron:
  - `get_policy` ya responde la cancelación;
  - persisten la omisión del documento en los datos para la cita (P08-4/5);
  - «no tengo el dato» sobre medios de pago confirmados (C14);
  - una negativa de teleconsulta sin respaldo (P08-9).

Queda pendiente repetir el dental cuando haya crédito.

## Adenda 8 (2026-11-10): correcciones sin medir (OpenAI sin crédito)

Estas correcciones salen de los fallos de E2ai y E2aj. Se desplegaron sin medición porque la cuenta de OpenAI no tenía crédito. La próxima medición debe repetir el dental completo.

1. **Datos confirmados del dueño (#430, C14 y P08-4/5).**
   - **Problema:** el agente solo leía `RUNTIME_FACT_IDS`, es decir horario, identidad y políticas. Además, el guardia F4300-58 cambiaba «aceptamos tarjeta» por «No consta…», porque solo contaban como respaldo las lecturas de herramientas.
   - **Decisión:**
     - Los requisitos `always_in_context` y `read_on_intent` llegan al agente en el bloque `<confirmed_business_facts>`, con una lista derivada de la especificación que excluye seguridad, traspaso, datos sensibles, modo de escritura y catálogo.
     - Solo entran valores confirmados y vigentes; lo sembrado nunca entra (opción B).
     - Se sellan en `contextInputs` como campo opcional.
     - Cuentan como respaldo para el guardia de pagos, el verificador de evidencia y `policy-grounding`.
2. **Búsqueda automática de FAQ (#427).**
   - **Problema:** el selector correctivo (hasta 2,5 s) cabía en el mismo plazo de 3 s que las lecturas. En una sesión, el error cortaba el turno.
   - **Decisión:** el plazo de la búsqueda automática de FAQ es el del selector más 3 s. Las demás lecturas automáticas siguen en 3 s.
   - Los tiempos agotados de lecturas obligatorias (hotel) se deben al entorno de medición: VPS de 2 CPU con el medidor compitiendo con la API. No hay cambio de código.
3. **C16 (#428).**
   - **Problema:** «Reservaremos {service}» y «agendaremos {service}» eran variantes fijas del motor de reservas al elegir el servicio.
   - **Decisión:** elegir el servicio no promete nada; la promesa queda para el resultado de la escritura.
   - `readiness.writeModeCapability` sigue en sombra: no registró ninguna diferencia, así que forzarla no cambiaba el caso.
4. **Documento de identidad en plantillas (#429).**
   - El piso L1 sigue prohibiendo pedir o recibir documentos por chat.
   - Cada regla «NUNCA pidas cédula» de las 6 plantillas añade: si el negocio declara que se necesita un documento, el agente informa cuál y cuándo se presenta, y nunca dice que no se necesita.
   - Se actualizaron los dos agentes de QA que tenían la regla vieja: dental y moda.
