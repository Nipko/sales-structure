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
