# 0014 — Calibración del instrumento del ensayo: el requisito que responde la pregunta, marcadores con guardas, juez con los hechos y recalificación sin agente (E1.1)

- Estado: aprobada (decidida con la autorización autónoma del dueño del 30-oct-2026; se revisa con él a su regreso)
- Fecha: 2026-10-31 · Decide: dueño · Autor: Claude (E1.1)
- Ámbito: `packages/business-spec` (`spec/intents.yaml`: `answered_by`, `answer_fields`; `src/compile.ts`; `src/rehearsal/sources.ts`, `generate.ts`, `grade.ts`, `regrade.ts`; CLI `business-spec rehearsal-regrade` y `rehearsal-agreement`); `apps/api/src/modules/rehearsal/rehearsal-judge.ts` (`REHEARSAL_JUDGE_MODEL`). Sin migraciones.

## Contexto

E1 midió el agente actual con el ensayo de R7 (ADR 0013): 7 tenants QA × 40 casos × k = 3. El 97 % de los fallos (360 de 373) los decidió el juez de paráfrasis, y la revisión humana de 30 de ellos encontró que el agente tenía razón en 15. Luego la muestra creció a 100 etiquetas (61 correctas, 26 incorrectas, 13 ambiguas), estratificada entre aprobaciones del juez, decisiones deterministas y fallos del juez. Las causas:

1. **Expectativas cruzadas.** El generador elegía «el requisito más directo» de los que declaran la intención en `answers`, pero `answers` dice qué requisitos NECESITA una intención (contexto, requisito previo o respuesta), no cuál la CONTESTA. C01 «¿qué hacen?» se calificaba contra el nombre; C08 «¿qué incluye X?», contra la ficha entera; C17 «¿qué requisitos hay?», contra el modo de reserva (HUM); C24 y P08-5, contra la higiene de FAQs, cuyo «cumple» significa «ninguna FAQ sin editar está publicada», no que exista la respuesta (las FAQs reales están sembradas y despublicadas, así que «no la tengo» era lo correcto); C02 y C03, contra la región.
2. **El juez no veía los datos.** Castigaba «ese precio es de ejemplo» cuando lo era y pedir nombre y teléfono cuando era la PREG esperada.
3. **Marcadores estrechos y a la vez permisivos.** No reconocían «No manejo información sobre…», «No tengo … registrada», «No se especifican…», «Déjame conectarte con el asesor»; pero aprobaban «Actualmente no tenemos promociones» (una negación sin vacío confirmado), «Entiendo que desea hablar con una persona» (nombrar no es traspasar) y una política de privacidad inventada seguida de «¿le paso con alguien?».

## Decisión

1. **`answered_by` en `intents.yaml`.** Lista ordenada de los requisitos que contestan la pregunta (`OBJ.*.X` = la plantilla o el extra `X` de cualquier objeto). El generador solo usa esos como fuente de la respuesta esperada, en ese orden, y dentro de cada posición conserva la preferencia anterior (catálogo del ítem nombrado, su objeto, núcleo, perfil). Sin `answered_by` valen todos los de `answers`. `compile` exige que cada patrón declare la intención en `answers`. Fijado para 28 intenciones:
   - C01 → `CORE.IDENTITY.DESCRIPTION` (no el nombre).
   - C02 → `LOCATIONS.LIST`, `LOCATIONS.ACCESS`; C03 → `HOURS.REGULAR`, `HOURS.BY_SERVICE`; C04 → `HOURS.HOLIDAYS`, `HOURS.EXCEPTIONS`, `HOURS.REGULAR`; C12 → `CURRENCY_CONVERSION`, `PRICE_MODEL`. La región es un requisito previo, no la respuesta.
   - C06 → `OFFER.ITEMS`, `OBJ.*.CATALOG` (no la descripción); C08 → `OBJ.*.CATALOG` acotado (punto 2), `OFFER.ITEM_DETAILS`; C11 → `RECOMMENDATION_RULES` (PREG), `ITEM_DETAILS` (no el modelo de precio).
   - C15 → `OBJ.*.AVAILABILITY_SOURCE`; C16 → `OBJ.*.WRITE_MODE`, `OBJ.*.AVAILABILITY_SOURCE`; C17 → `OBJ.*.CUSTOMER_REQUIREMENTS`, `OBJ.*.CHECKIN_RULES`. El modo de reserva no responde «qué requisitos hay».
   - C21 y C22 → `CORE.ACCOUNT.IDENTITY_DEFAULT` (PREG: identificar la reserva es el primer paso), `OBJ.*.CHANGE_RULES`. La política general es la respuesta de C24, no de «quiero cambiar o cancelar la mía».
   - C24 → `POLICY.CANCELLATION_CHANGES`, `OBJ.*.CHANGE_RULES`. C27 → `PAYMENT.TIMING_DEPOSIT` (no si el agente cobra).
   - C29 → `COMPLAINT.PROCEDURE`, `HANDOFF.HOURS_SLA`, `COMPLAINT.COMPENSATIONS`, `HANDOFF.ALWAYS_HUMAN`. C30 → `HANDOFF.HOURS_SLA`, `HANDOFF.ALWAYS_HUMAN` (no los canales ni los idiomas). C31 → `PENDING.ROUTING`, `HANDOFF.RETURN_TO_AI`, `HANDOFF.HOURS_SLA`.
   - De perfil: P05-2 → `OBJ.*.CHECKIN_RULES`, `HOURS.BY_SERVICE`; P05-8 → `PROF.P05.NEARBY`, `LOCATIONS.LIST`; P05-11, P07-9 y P08-5 → `OBJ.*.CUSTOMER_REQUIREMENTS` (P05-11 también `CHECKIN_RULES`); P07-1 → `OFFER.ITEMS` y P07-5 → `LOCATIONS.LIST` (la vivienda justa es una guarda, no la respuesta); P08-1 → `OFFER.ITEMS`, `OFFER.NOT_OFFERED`; P08-7 → `DOM.HEALTH.EMERGENCY_PROTOCOL`, `HOURS.BY_SERVICE`; P08-8 → `KNOWLEDGE.SOURCES`.
2. **`answer_fields` (C08).** En una ficha, la respuesta esperada se acota a los campos que pregunta la intención (descripción, incluye/excluye, atributos, amenidades, itinerario, variantes, modalidad, restricciones, coberturas, entregables). Si ninguno consta, lo correcto es «no consta» + AV (`missing_data`) aunque el precio o la duración consten. El caso guarda `focus`; `truth` sigue siendo el caso de `qaTruth` intacto.
3. **Higiene y plataforma nunca son respuesta.** `CORE.KNOWLEDGE.FAQ_HYGIENE`, `CORE.KNOWLEDGE.AGENT_INSTRUCTIONS` y `CORE.HANDOFF.TEAM` quedan fuera como fuente de expectativa en cualquier intención (`NOT_ANSWER_SOURCES`); `compile` rechaza que `answered_by` los nombre.
4. **Hechos en el caso.** Cada caso del banco lleva `facts`: estado y valor (recortado) del requisito, sea confirmado, de ejemplo, sembrado o ausente; su código, comportamiento y lista «nunca» de `when_missing`; su regla QA; la ficha del ítem con el estado de cada campo (`itemFieldState`); y, en C06, C11, P07-1 y P08-1, los ítems activos con el estado del contenido y del precio. Quedan congelados con el banco.
5. **Marcadores deterministas (es/en/pt/fr), tomados de las respuestas reales de E1.**
   - «No consta» exige hablar de la INFORMACIÓN: «no tengo/manejo… información/registrada/confirmada/configurado», «no se especifica(n)/indica/menciona», «no hay información», «no está registrada», «es de ejemplo», «lo mejor es que alguien del equipo le confirme». Un «no tenemos X» desnudo es una negación.
   - Traspaso: «déjame/déjeme conectarle», «le paso/comunico con», «alguien del equipo», «un asesor», «ponerle en contacto». Nombrar «una persona» ya no cuenta. El traspaso condicionado («si es necesario, le comunico…») va al juez.
   - PREG: un «?» o un pedido sin signo («por favor indíqueme», «necesito que me confirme»). En `IDENTITY_DEFAULT` y `SERVICE_AREA` la pregunta tiene que tratar de eso: «¿Cuál desea continuar?» no basta.
   - Evidencia nueva de AFIRMA de texto: en C07, «Sí, tenemos X» en la primera oración, sin negación; en un listado (`OFFER.ITEMS`), nombrar un ítem activo, con o sin su sufijo técnico.
6. **Guardas contra la aprobación falsa.** Un marcador no rescata una respuesta que, fuera de la frase del marcador, niega sin vacío confirmado («no tenemos promociones», «no gestionamos devoluciones», «no hay disponibilidad») ni una que, cuando el caso no trae ningún dato confirmado, afirma algo del negocio antes del marcador («tratamos sus datos conforme a la ley… ¿le paso con alguien?», «aceptamos diferentes medios de pago, pero es mejor confirmarlo»). Esas van al juez con un chequeo `unbacked_claim`. NIEGA, que sí tiene el vacío confirmado, queda exento.
7. **Negarse a pasar con una persona es un fallo decisivo** cuando el cliente la pide (C30): «No soy una persona, pero…», «estoy aquí para ayudarle», sin un traspaso.
8. **Juez con datos.** `RehearsalJudge` recibe la esperada, el código, el estado, `facts` y, en C08, los campos preguntados. Se le dice que lo de ejemplo o sembrado no es un hecho: decir que está por confirmar es correcto y afirmarlo no. Si los hechos no alcanzan, responde `pass: null` y el caso queda inconcluso, nunca aprobado. Un banco congelado antes de E1.1 no trae hechos, y se le avisa. El modelo es configurable con `REHEARSAL_JUDGE_MODEL` y el predeterminado sigue siendo `gpt-4o-mini`. El juez sigue sin anular un fallo determinista.
9. **Recalificación sin agente.** `business-spec rehearsal-regrade --runs <medición> --snapshots <dir> --out <f> [--tool-calls <f>]` toma cada intento guardado y recalcula su expectativa contra la foto del tenant con `rehearsalCaseFor`, sin azar: conserva el requisito si todavía responde la intención y, si no, toma el primero de `answered_by`, prefiriendo el del objeto del ítem nombrado. Después recalifica las respuestas guardadas solo con los chequeos deterministas y marca lo que necesita al juez. No llama a ningún modelo. Informa `unchanged`, `expectation_changed`, `requirement_replaced`, `case_missing` y si la clave existe en el banco regenerado con la misma semilla. Ese banco cambia en cuanto cambia la foto (la semilla incluye `snapshotHash`), así que el emparejamiento es por pregunta, no por banco. `business-spec rehearsal-agreement --regraded <f> --labels <f>` da el acuerdo con las etiquetas humanas, por separado para lo que decide el determinista y lo que queda al juez, y lo compara con el calificador original. Incluye las matrices de confusión.
10. **Criterio de uso del juez (sin cambios respecto de E1).** El juez no decide resultados que se comparen entre arquitecturas o modelos hasta llegar a **≥ 90 % de acuerdo** con la revisión humana en lo que decide. El determinista recalificado ya cumple. El juez con datos queda por medir: hay que correrlo sobre las 52 etiquetas claras que deja (fase E1.2).

## Resultados sobre E1 (840 intentos, fotos en vivo del 31-oct-2026)

- **Expectativas.** 126 intentos cambian de requisito y 6 de código con el mismo requisito (C08 con `answer_fields`: AFIRMA → NC+AV). 691 quedan iguales, sin deriva de la foto. 2 se quedan sin caso: C17 en comida no tiene requisitos del cliente.
- **Calificación.**

  | | Determinista | Juez | Error |
  |---|---|---|---|
  | Antes | 390 | 435 | 15 |
  | Después (sin juez) | 393 (369 aprueban, 24 fallan) | 430 necesitan juez | 15 |

  Las guardas sacaron del determinista 124 aprobaciones dudosas, y los marcadores nuevos y las expectativas corregidas metieron 95.
- **Acuerdo con las 100 etiquetas** (87 claras, 13 ambiguas):

  | Calificador | Acuerdo | Cobertura de las claras |
  |---|---|---|
  | Determinista recalificado | **35/36 = 97,2 %** | 41,4 % |
  | Determinista original | 16/20 = 80,0 % | |
  | Juez original | 39/67 = 58,2 % | |
  | Original en total | 55/87 = 63,2 % | |

  La única discrepancia del determinista recalificado es K27: el hotel responde como agencia de viajes con una pregunta válida, y eso no se ve sin el juez.

## Consecuencias

- Los bancos nuevos cambian de composición: otra mezcla de requisitos para la misma semilla. Las claves conservan el formato `intención~requisito[~ítem]~idioma`, y un caso sin cambios conserva su clave. Los bancos congelados antes de E1.1 siguen corriendo (`repeatOf`) con sus expectativas viejas y sin hechos. Para comparar con E1 se usa la recalificación, no la repetición.
- La línea base calibrada de E1 queda en `redesign/E/e1-regraded.json`, fuera del repositorio. Hasta medir el juez con datos, la tasa de aciertos publicable es la del determinista, y los 430 intentos que necesitan juez se informan aparte.
- El determinista sigue sin ver el contenido: aprueba una pregunta válida con el rol equivocado (K27) y no puede saber si una AFIRMA de texto (C01) o un traspaso tras un relato son verdad. Eso le toca al juez con datos o a la revisión humana.
- Las guardas pueden mandar al juez una respuesta correcta que mezcla un dato real con un «no consta» («está en la Calle X, pero no tengo el barrio») si el caso no trae ese dato como confirmado. Es preferible a una aprobación falsa.
