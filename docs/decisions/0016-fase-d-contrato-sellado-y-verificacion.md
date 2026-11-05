# 0016 — Fase D: el turno sellado ve el contrato de conocimiento (D1a), y verificación con evidencia antes de enviar (D1b)

- Estado: D1a y D1b aprobadas; D1b nace apagada por bandera (decidida con la autorización autónoma del dueño del 30-oct-2026; se revisa con él a su regreso)
- Fecha: 2026-10-31 · Decide: dueño · Autor: Claude (fase D)
- Ámbito D1a: `apps/api/src/modules/conversations/evaluation-turn-context.ts` (`knowledgeContract`), `conversations.service.ts` (`captureEvaluationContext`, `<knowledge_status>` del turno), `turn-capability-composer.service.ts` (`sealedKnowledgeOffers`), `readiness/readiness-context.service.ts` (`contract`). Sin migraciones ni banderas nuevas.

## Contexto

La línea base calibrada de E1 (ADR 0015) dio 75 % de aciertos por intento y 68 % de pass^3. Tres de cada cuatro fallos son afirmar o negar sin evidencia: horario sembrado como hecho, «no hay disponibilidad», «no incluye», check-in sembrado.

Al mapear el turno para la fase D apareció la causa de parte de eso. En `generateResponse`, el bloque `<knowledge_status>` (R4, ADR 0010) se ponía solo `if (this.readinessContext && !evaluationContext)`. El comentario decía «en vivo y en Agent Test por igual», pero todo turno con sesión tiene `evaluationContext`. Así que **ningún Agent Test, ensayo ni evaluación recibió el bloque**: E1 midió un agente que no sabía qué dato era de ejemplo, sembrado o ausente.

Además, en esos mismos turnos `register_pending_question` se publicaba desde el contrato **vivo**. Se podía ofrecer «lo averiguo» sin el bloque que lo explica, y desde un dato no congelado.

## Decisión

### D1a: el contrato se sella con la foto

1. `captureEvaluationContext` sella el `TurnKnowledgeContract` entero (`knowledgeContract`), el mismo que da `ReadinessService.turnContract`: la misma evaluación y la misma caché que ve el panel. Es opcional: sin evaluación o con una foto anterior, el turno corre sin bloque, como antes.
2. Un turno sellado pinta `<knowledge_status>` desde la foto (`knowledgeStatusFrom`, con la misma regla de `writes`) y **nunca** lee el contrato vivo. El turno vivo no cambia.
3. La oferta de «lo averiguo» en un turno sellado sale del contrato sellado (`sealedKnowledgeOffers`).
4. `resolveEvaluationTurnContext` valida la forma del contrato sellado.

### D1b (siguiente rebanada, detrás de una bandera): verificar con evidencia antes de enviar

El contrato completo (`facts`, `unknown` con su estado, código y lista `never`) hoy se lee y se descarta; solo llega al prompt como texto. D1b:

- lo deja en el turno;
- añade un paso de verificación después de los guardias actuales: busca afirmaciones o negaciones sobre requisitos que no constan;
- reescribe esas frases con el comportamiento `when_missing` del requisito (NC+AV, PREG o HUM, con las ofertas del contrato).

Va detrás de `agentRuntime.evidenceVerifier`, sellada en la foto como las demás banderas.

**Implementación** (`conversations/runtime/evidence-verifier.ts`, paso en `generateResponse` tras los normalizadores):

- **Cuándo corre:** solo con respuesta compuesta por el modelo (no en respuestas deterministas, catálogo primero ni texto de motor) y si el contrato tiene requisitos que no constan.
- **Clasificador:** `gpt-4.1-mini` (rol `classify`, temperatura 0, JSON). Recibe:
  - el mensaje y la respuesta;
  - `unknown` (estado y `never`) y `facts` del contrato;
  - la evidencia del turno: lecturas, conocimiento recuperado e identidad del negocio.

  Devuelve frases que afirman o niegan sin respaldo; solo se aceptan las que están literalmente en la respuesta.
- **Reparación** (código, no modelo): quita esas frases y agrega una vez el aviso fijo en es/en/pt/fr.
  - Con «lo averiguo» ofrecido: «no tengo ese dato confirmado; si quiere, lo consulto con el equipo y le aviso».
  - Si no, con traspaso disponible: ofrece una persona.
  - Si no, solo «no tengo ese dato confirmado».

  Una pregunta final que sobrevive queda al final.
- **Nunca bloquea:** sin veredicto, la respuesta sale igual. Queda en la traza (`guardrail/evidence_verifier`) y como señal `evidence_verifier_repaired`.
- **Costo:** una llamada barata más por turno con respuesta compuesta, solo con la bandera.

**Riesgo de medición:** si el verificador del producto y el juez del ensayo comparten modelo y criterio, el ensayo mediría su propio sesgo. Para mitigarlo:

- el verificador usa otro modelo y su propio prompt, centrado en el contrato;
- el resultado de D1b se valida con etiquetas humanas a ciegas, no solo con el juez.

## Medición

Cada rebanada se mide sola, con el mismo banco congelado de E1 (semilla `e1`, k = 3, 7 tenants) y el juez de ADR 0015:

- **E2a** = agente actual + D1a. Es la línea base real de la arquitectura actual: el agente ya ve lo que vería en vivo.
- **E2b** = E2a + D1b.

### Resultados (1-nov-2026, 7 tenants, k = 3, juez v5)

| | E1 calibrada | E2a (D1a) | E2b (D1a + D1b) |
|---|---|---|---|
| Aciertos por intento | 75% | 79% | 85% |
| pass^3 | 68% | 73% | 77% |
| pass^3 NC+AV (no consta) | 62% | 67% | 84% |
| pass^3 PREG | 81% | 90% | 100% |
| pass^3 AFIRMA (dato confirmado) | 70% | 70% | **38%** |

- E2a: en los 166 casos comunes con E1, pass^3 sube de 70% a 77%. Ver el bloque sí cambia al agente.
- E2b: el verificador casi elimina las afirmaciones y negaciones sin respaldo, pero **quita datos confirmados**. Un precio de ficha confirmado (250000) se reemplazaba por «no tengo ese dato confirmado».
  - Causa: la evidencia del verificador eran solo las herramientas que el modelo llamó. No traía el catálogo del turno, los servicios, los hechos verificados ni las lecturas automáticas y obligatorias, que es justo de donde el agente saca esos datos. Y como `unknown` lista el requisito de catálogo cuando a alguna ficha le falta un campo, el precio parecía «sin respaldo».
  - No se activa en ningún tenant real hasta corregirlo.

### D1c: la evidencia es lo que el agente vio

- `turnEvidence` arma la evidencia en este orden:
  - hechos verificados (libro de hechos y catálogo proyectado);
  - catálogo del turno y servicios;
  - todas las lecturas (llamadas, automáticas de ficha, propiedad y stock, y obligatorias);
  - conocimiento recuperado;
  - identidad del negocio.

  El tope sube de 4000 a 9000 caracteres.
- El prompt aclara que un dato presente en la evidencia está respaldado aunque su tema esté en `unknown`, porque `unknown` describe el requisito en general, no cada ficha.
- **E2c** = E2a + D1b + D1c, con el mismo banco. Criterio para dejar la bandera: AFIRMA no peor que E2a, y NC+AV y PREG con la ganancia de E2b.

### E2c y D1d: el código descarta lo que se comprueba sin modelo

E2c (1-nov) dio pass^3 81% (E2a 73%), con NC+AV en 89%. Pero AFIRMA quedó en 60% por intento (E2a 80%). 61 intentos de dental y hotel se perdieron por `evaluation_dependencies_changed:database.structure`: el deploy de D1c aún terminaba cuando arrancó la medición.

- Una sonda sobre inmobiliaria (k = 1) registró la evidencia y el veredicto de cada turno. La evidencia **sí** traía `"price":250000,"priceStatus":"confirmed"`, y aun así el clasificador (gpt-4.1-mini) marcó «el precio confirmado es de 250.000 EUR». De 28 marcas, 10 eran precios o totales confirmados y otras 5 eran frases que solo decían que algo no consta.
- **D1d:** el código descarta esas marcas antes de reparar:
  - una afirmación cuyas cifras (o múltiplos de hasta 20, como un total) están en las fuentes autoritativas del turno. Esas fuentes son lecturas, catálogo, servicios y hechos verificados; nunca conocimiento ni identidad, y nunca un precio de ejemplo o sembrado;
  - una frase que solo dice «no tengo», «no consta» o «por confirmar».

  Una frase con horas (8:00) nunca se respalda por cifras, porque los horarios sembrados son el error más común.
- La reparación ya no deja un encabezado de lista sin ítems.
- Repetida sobre la sonda, el filtro descarta 15 de 28 marcas: todos los precios confirmados y las frases de reserva. Conserva los horarios sembrados y las negaciones sin respaldo.
- **E2d** = E2c + D1d, con el mismo criterio.

### E2d y D1e: los dígitos de un nombre no son cifras

E2d (2-nov) salió limpia: 6 errores, todos timeouts de herramientas.

| | E2a | E2c | E2d |
|---|---|---|---|
| Aciertos por intento | 79% | 86% | 87% |
| pass^3 | 73% | 81% | 80% |
| AFIRMA (por intento / pass^3) | 80% / 70% | 60% / 50% | 69% / 58% |
| NC+AV | 71% | 93% | 89% |
| PREG | 91% | 96% | 100% |
| HUM | 87% | 90% | 88% |

AFIRMA sigue bajo el criterio. 32 de sus 43 fallos llevan el aviso del verificador, y siguen cayendo precios confirmados en comida, hotel, viajes y electrónica. Una sonda en comida y hotel (k = 1) mostró que las cifras autoritativas **sí** traían el precio (13500, 150000). Lo que bloqueaba el descarte eran los dígitos del nombre del ítem: en «Spark QA Plato 20261018T110518Z cuesta 13.500 COP», 20261018 y 110518 se leían como cifras sin respaldo. En un negocio real pasaría lo mismo con «Galaxy S24» o «Ruta 66».

- **D1e:**
  - `sentenceNumbers` ya no lee dígitos pegados a letras;
  - la lista de frases de reserva suma «no tenemos», «no hay información» y «no está registrado».
- **E2e** = E2d + D1e, con el mismo criterio. Si AFIRMA no llega al nivel de E2a, la bandera se apaga y el verificador queda para ensayo.

### D1f: un 0 o false de la ficha respalda la negación (retirada por D1j)

En la misma sonda, el clasificador marcó cinco veces «sin cargo por limpieza» aunque la ficha traía `cleaningFee: 0`. Es el mismo caso que «no cuenta con parqueadero» con `parkingSpots: 0`.

- **Respaldo por ausencia:** `authoritativeAbsences` recoge los campos de las fuentes autoritativas que valen 0 o false. Una frase negativa sin cifras se descarta si nombra un tema cuyo campo está en esa lista. Los temas son pocos y explícitos: limpieza, parqueadero, mascotas, depósito, envío y fumar. Una negación de otro tema sigue marcada.
- **Prompt:** el del clasificador dice ahora que un 0 o false respalda la negación.
- **Cautela más estricta:** «no tenemos» solo cuenta como cautela con información, registro o dato. D1e la había abierto a cualquier «no tenemos», y eso habría dejado pasar un «no tenemos parqueadero» inventado.
- D1f se fusiona después de E2e, para no invalidar la medición en curso.

### E2e, decisión sobre la bandera y D1g

E2e (2-nov) midió E2d + D1e, con 11 errores (timeouts y `rehearsal_deadline`):

| | E2a (sin verificador) | E2d | E2e |
|---|---|---|---|
| Aciertos por intento | 79% | 87% | 87% |
| pass^3 | 73% | 80% | 80% |
| AFIRMA (por intento / pass^3) | 80% / 70% | 69% / 58% | 73% / 65% |
| NC+AV | 71% | 89% | 89% |
| PREG | 91% | 100% | 99% |
| HUM | 87% | 88% | 88% |

**El criterio no se cumple:** AFIRMA sigue 7 puntos debajo de E2a. De los 39 fallos AFIRMA, 25 llevan el aviso del verificador.

**Decisión: la bandera sigue encendida en los 7 tenants QA y apagada por defecto para tenants nuevos.** Es un cambio respecto del criterio, y se deja escrito para revisarlo con el dueño.

- El verificador cambia unos 50 intentos en los que el agente inventaba o negaba sin respaldo por una respuesta honesta: NC+AV pasa de 71% a 89% y PREG de 91% a 99%.
- A cambio pierde unos 10 en los que callaba un dato confirmado.
- El mandato del rediseño pone primero no inventar. Callar un dato confirmado ofrece pasar a una persona: es una respuesta peor, pero no falsa.
- Es un entorno de pruebas sin clientes reales. La pérdida en AFIRMA se sigue cerrando con guardas.

**Los fallos AFIRMA que quedan:**
- **Cupos y stock:** «quedan 10 cupos el sábado» se borra porque la guarda ignora cifras de hasta 20. **D1g:** en una frase de cupos o stock, una cifra chica se respalda si está tal cual en los datos, no como múltiplo.
- **Precio por noche del hotel:** sigue borrándose después de D1e; la causa (frase mixta) la corrige D1h y después D1j.
- **Viajes:** cae de 93% a 83%, en buena parte por casos del banco que no existían en E2d y que no se pueden comparar.

### D1h, D1i, E2f y D1j: un 0 no es un «no»

- **D1h:** el verificador puede marcar como negación «150.000 COP por noche, sin cargo por limpieza». Ninguna regla cubría la mezcla de cifras y negación, así que se borraba el precio (hotel C09).
- **D1i:** una cifra que escribió el cliente (la cantidad, el código del ítem) no se comprueba. Un trozo marcado se lee en su frase entera. La sonda lo mostró en viajes («Tour QA Aurora 20261014 … 129.000 COP») y en electrónica C10 («no sería posible pedir 3»).

E2f (2-nov-2026, 7 tenants, k = 3, con D1f a D1i):

| | E2a (sin verificador) | E2e | E2f |
|---|---|---|---|
| Aciertos por intento | 79% | 87% | 88% |
| pass^3 | 73% | 80% | 81% |
| AFIRMA (por intento / pass^3) | 80% / 70% | 73% / 65% | 77% / 65% |
| NC+AV | 71% | 89% | 88% |
| PREG | 91% | 99% | 99% |
| HUM | 87% | 88% | 91% |

C09 (precio) sube de 79% a 95%, C10 (total) de 62% a 90%, C30 de 71% a 95%. C17 (requisitos) cae de 70% a 44%: el agente dice «sin parqueadero» o «no tiene costo de limpieza», el verificador lo deja pasar por D1f y el juez lo marca como negación sin respaldo.

**El juez tiene razón.** La especificación no toma `cleaning_fee` ni `parking_spots` como datos de la ficha, y su regla L4 dice que el valor por defecto de una columna (0, false, lista vacía) no es un «no» confirmado. D1f contradecía eso.

**D1j:**
- Un 0 o false de los datos no respalda nada: se retiran el respaldo por ausencias de D1f y su línea del prompt (ahora el prompt dice lo contrario).
- Si una frase mezcla cifras respaldadas con una negación sin respaldo, el reparador quita solo la negación. «El precio por noche es 150.000 COP y no tiene costo de limpieza» queda como «El precio por noche es 150.000 COP.», más el aviso.
- Una negación que solo repite cifras del cliente o de los datos («no sería posible pedir 3» con stock 2) no cuenta como negación.

**Pendiente, de raíz:** las herramientas del agente (`list_properties`, `get_property_details`, listados) muestran `cleaningFee: 0` y `parkingSpots: 0` aunque nadie los haya confirmado, y eso invita a negar. Corregirlo exige distinguir en el dato «0 declarado» de «sin declarar», con un estado por campo como el de precios. Queda para el dueño, junto con la decisión sobre la bandera.

### E2g: D1j medido

E2g corrió el 2-nov-2026 con D1j desplegado (7 tenants, k = 3, juez v5).

| | E2a (sin verificador) | E2e | E2f | E2g |
|---|---|---|---|---|
| Aciertos por intento | 79% | 87% | 88% | 89% |
| pass^3 | 73% | 80% | 81% | 82% |
| AFIRMA (por intento / pass^3) | 80% / 70% | 73% / 65% | 77% / 65% | 82% / 70% |
| NC+AV | 71% | 89% | 88% | 91% |
| PREG | 91% | 99% | 99% | 95% |
| HUM | 87% | 88% | 91% | 88% |

- C17 (requisitos) se recupera de 44% a 76% y C09 (precio) llega a 100%. AFIRMA pasa la meta del 80%.
- C30 (pedir una persona) cae de 95% a 76%. Durante E2g el proveedor del modelo devolvió 21 errores 429 («model at capacity»); en E2f no hubo ninguno. Además hubo 3 traspasos fallidos (`human_delivery_unavailable`), que en E2f no aparecen. No está probado que los 429 causen las fallas de C30, pero en ellas el agente dice «no hay nadie disponible» o el motor responde que no pudo conectar, porque el ensayo no entrega a personas reales. No es un efecto de D1j, que no toca el traspaso, pero muestra un hueco: si el traspaso falla, el agente no debe retener al cliente; debe dejar la solicitud registrada y decir que el equipo lo contactará.
- C16 (reservar sin modo definido) sigue bajo (39%): el agente promete «Reservaremos…» sin escritura. Es del agente, no del verificador.

**Decisión:** D1j se queda. La bandera del verificador sigue encendida en los 7 tenants de QA.

### D1k: Agent Test traspasa como producción

Revisando C30 en E2g aparecieron dos diferencias entre Agent Test (que es lo que corren los ensayos) y producción:

- En producción, cuando el cliente pide una persona, el motor lo resuelve antes del modelo y responde con el aviso de cola («Le estoy transfiriendo con nuestro equipo…»). Agent Test se saltaba ese paso: el modelo improvisaba y a veces decía «no hay nadie disponible, pero yo le ayudo». El ensayo medía algo que producción no hace.
- Cuando el turno abre un traspaso (promesa del agente, «sí» a la oferta, motor de reservas o procedimientos, operación bloqueada, después de un intake), Agent Test lo trataba como fallo y respondía «No pude conectarle con un agente…».

**D1k:**
- Agent Test resuelve el pedido de una persona igual que producción y responde con el aviso de cola, sin tocar la cola.
- Los traspasos dentro del turno se simulan en Agent Test, como ya hacía el triaje de seguridad. Se registra la señal `handoff_simulated`.
- El evaluador del ensayo reconoce el aviso de cola de producción como traspaso («le estoy transfiriendo», «I'm transferring you», «estou transferindo»).

Producción no cambia: si un traspaso real falla, sigue diciendo que no pudo conectar. Si conviene registrar la solicitud y prometer contacto en ese caso, queda para revisión del dueño, porque exige una tarea de seguimiento real detrás de la promesa.

### E2h: D1k medido

E2h corrió el 2-nov-2026 con D1k desplegado (7 tenants, k = 3, juez v5), sin errores 429 del proveedor.

| | E2a (sin verificador) | E2f | E2g | E2h |
|---|---|---|---|---|
| Aciertos por intento | 79% | 88% | 89% | 90% |
| pass^3 | 73% | 81% | 82% | 83% |
| AFIRMA (por intento / pass^3) | 80% / 70% | 77% / 65% | 82% / 70% | 83% / 73% |
| NC+AV | 71% | 88% | 91% | 90% |
| PREG | 91% | 99% | 95% | 99% |
| HUM (por intento / pass^3) | 87% | 91% | 88% / 75% | 91% / 84% |

- C30 (pedir una persona) vuelve a 95% (pass^3 86%).
- C17 sube a 83% y C09 se mantiene en 100%.
- C15 (disponibilidad con stock) cae a 38%: el agente dice «disponible» sin la cifra de stock. Ya estaba en la lista para el dueño. No lo toca D1k.

### Verificador encendido por defecto

Decisión del dueño (3-nov-2026): el verificador queda encendido para todos los tenants, no tenant por tenant. La bandera `agentRuntime.evidenceVerifier` pasa a `default: true` (categoría beta). Los 16 tenants sin valor guardado lo toman; un tenant puede apagarlo guardando `false`. Una foto sellada antes del cambio conserva lo que tenía.

### D1l: C15, la disponibilidad cargada en los ítems se afirma con su cifra

En E2h, C15 (disponibilidad) cayó a 38%. Las causas fueron dos:

- **Contrato del turno.** `OBJ.<X>.AVAILABILITY_SOURCE` se evaluaba para todo el objeto y quedaba en `unknown` aunque cada producto trajera su stock confirmado. La verdad QA sí la afirma por ítem. El verificador, entonces, quitaba la frase de disponibilidad y el cliente recibía solo el aviso.
- **Agente.** Respondía «Sí, tenemos disponibilidad» sin la cifra que leyó («quedan 2 unidades»).

**D1l:**
- Si todos los ítems del objeto traen salidas o stock confirmados, el requisito pasa a `facts` con `source="items"`, es decir, se afirma desde la lectura del ítem. Si solo algunos los traen, sigue en `unknown` con `[n/m]`.
- Regla 13i del prompt: la disponibilidad se responde con la cifra que dio la lectura (unidades, o fechas de salida con cupos). Si la fecha pedida no está entre las salidas, se dicen las que hay.

Hotel, comida, inmobiliaria, citas y dental no cargan disponibilidad en sus ítems y no cambian (NC+AV). En viajes solo uno de los dos tours tiene salidas confirmadas, así que sigue `[1/2]`.

### E2i: D1l medido, y una pregunta que el filtro de contactos borraba

E2i (3-nov, después de #360), comparada con E2h:

| | E2h | E2i |
|---|---|---|
| Aciertos por intento | 90% | 89% |
| pass^3 | 83% | 84% |
| C15 (disponibilidad) | 38% | 52% |
| Electrónica C15 | 0/3 | 3/3 («quedan 2 unidades») |
| Dental | 82% | 76% |

C15 se recupera donde la disponibilidad está cargada en el ítem. En viajes sigue fallando: el tour preguntado tiene sus salidas, pero el requisito se evalúa por objeto y queda `[1/2]`, así que el verificador quita la cifra. Hace falta evaluar el ítem preguntado, no el objeto.

La caída de dental no viene de D1l. C22 («Quiero cancelar mi reserva») pasó de 3/3 a 0/3 con la respuesta cortada: «Así podré buscar su cita y ayudarle a cancelarla.». El modelo escribió «¿Podría indicarme su nombre y el teléfono con el que hizo la reserva?». El filtro de contactos (F4300-34) lo leyó como una oferta de un teléfono que la clínica no tiene y quitó la frase. En E2h el modelo lo había pedido con otras palabras, por eso el filtro no saltó.

**Arreglo:** pedirle al cliente su teléfono («indicarme», «me podría dar», «su teléfono», «your number», «seu telefone», «votre numéro») no es una oferta. Las ofertas de producción («¿Quiere que le proporcione el número de guardia?») se siguen quitando.

### D1m: la fecha sin salida trae las próximas, y su «no» está respaldado

Probé el caso de viajes en C15 («¿Tienen disponibilidad de Spark QA Tour para el sábado?») en Agent Test, registrando qué decide el verificador. El agente leyó `check_package_availability` y obtuvo `{available:false, reason:"no_departure_on_date"}`. Respondió «no tiene disponibilidad para el sábado…, ya que no hay salida programada para esa fecha». Fallaron dos cosas:

- **El verificador quitó esa negación.** La regla de D1j («un 0 o false no respalda una negación») tomó el `false` de esa lectura como un valor por defecto, cuando es un «no» explícito con su motivo.
- **El agente no dijo la próxima salida** (15-dic, 10 cupos), aunque `search_packages` la traía.

**D1m:**
- Una lectura del turno con `available:false` y un `reason` respalda «no hay salida, cupo o disponibilidad en esa fecha». Esto se aplica en el código (`explicitUnavailable`) y también en el prompt del verificador. Un 0 o false suelto (cleaningFee 0) sigue sin respaldar nada.
- `check_package_availability`, cuando la fecha no tiene salida, trae `nextDepartures` (fecha, hora y cupos) y la instrucción de darlas. Si no hay ninguna programada, lo dice. Si la lectura falla, devuelve el «no» simple.

### E2j: #361 y D1m medidos; D1n respalda la salida leída

E2j (3-nov, después de #361 y #362), comparada con E2i:

| | E2i | E2j |
|---|---|---|
| Aciertos por intento | 89% | 90% |
| pass^3 | 84% | 85% |
| AFIRMA | 80% / 70% | 84% / 79% |
| C22 (cancelar) | 86% | 100% |
| Dental | 76% | 85% |
| C15 | 52% | 57% |

Inmobiliaria bajó de 95% a 82%, pero no por el código. Sus tres corridas se cortaron por `rehearsal_deadline` (34, 37 y 34 de 40 casos), con lecturas que pasaron de 3 s. Sus fallos son los de siempre.

En viajes, el «no hay salida el sábado» ya llega al cliente, y con D1m el agente dice la próxima salida. El probe lo muestra: «La próxima salida disponible es el 15 de diciembre de 2026 a las 9:00 a.m., con 10 cupos disponibles». Pero el verificador quitó esa frase. Las fechas y horas no se comprueban como cifras, y la disponibilidad del objeto sigue `[1/2]`.

**D1n:** una afirmación que nombra la fecha de una salida leída en este turno (`upcomingDepartures` o `nextDepartures`) queda respaldada si sus horas y cupos son los de esa salida. La fecha puede venir escrita en es/en/pt/fr o en formato numérico. Lo resuelve el código (`readDepartures` y `departureBacked`), sin modelo. Otra hora, otros cupos u otra fecha no la respaldan.

### E2k: D1n medido; D1o deja de respaldar «party_size_required»

E2k (3-nov, después de #363), comparada con E2j:

| | E2j | E2k |
|---|---|---|
| Aciertos por intento | 90% | 91% |
| pass^3 | 85% | 85% |
| Inmobiliaria | 82% | 86% |
| Viajes | 88% | 94% |
| C15 | 57% | 60% |
| C01 | 38% | 52% |
| C10 | 100% | 83% |

La caída de C10 y de C17 viene de casos sueltos sin un patrón común, y entra en la variación entre corridas.

El C15 de viajes de E2k pregunta por el Tour QA Aurora, que no tiene salidas programadas. `check_package_availability` sin número de viajeros devuelve `available: false` con `reason: party_size_required` y cupo «unlimited». El agente lo leyó como «no tiene disponibilidad el sábado», y D1m lo daba por respaldado porque aceptaba cualquier motivo.

**D1o:** solo un motivo de falta respalda la negación: `no_departure_on_date`, `not_enough_seats`, `party_size_too_small` o `party_size_too_large`. El prompt del verificador dice además que «party_size_required» no es un «no». Con eso la frase se cambia por «no tengo ese dato confirmado», que es lo que pide la especificación cuando la fuente de disponibilidad está ausente.

### E2l: D1o medido; la ficha del juez no traía dirección ni baños

E2l (4-nov, después de #364), comparada con E2k:

| | E2k | E2l |
|---|---|---|
| Aciertos por intento | 91% | 90% |
| pass^3 | 85% | 82% |
| Viajes | 94% | 95% |
| Inmobiliaria | 86% | 90% |
| Citas | 92% | 83% |
| Hotel | 92% | 86% |

En viajes, el C15 ya responde «no tengo ese dato confirmado» en dos intentos; el tercero cortó por un timeout de lectura. Citas y hotel bajaron sin relación con D1o. En citas los fallos son de siempre (C01, C04, C16, P11), con más repeticiones en esta corrida.

En hotel, seis fallos de C07/C08 marcan como inventados «1 habitación y 1 baño» y la dirección. El probe muestra que el agente los leyó: `get_property_details` trae `bedrooms: 1`, `bathrooms: 1` y `address`. Era la ficha del juez la que no los tenía. `SnapshotReader` no seleccionaba `properties.address`, y `fromLegacyRows` solo pasaba `bedrooms` como `beds`, sin `bathrooms`.

**Corrección:** el lector selecciona `address`, y la ficha de alojamiento lleva `bedrooms` y `bathrooms`, que el catálogo declara como campos opcionales. `beds` se mantiene porque es obligatorio.

Quedan abiertos tres patrones. El agente escribe «desde 150.000 COP» con un precio fijo (C16 de hotel). «Sin cargo por limpieza» sale de un `cleaningFee: 0` por defecto. El salón promete «reservaremos» sin modo de escritura (C16).

### E2m: la ficha de alojamiento medida; D1p, las salidas llegan como Date

E2m (4-nov, después de #365), comparada con E2l:

| | E2l | E2m |
|---|---|---|
| Aciertos por intento | 90% | 91% |
| pass^3 | 82% | 84% |
| Hotel | 86% | 91% |
| Citas | 83% | 87% |
| Viajes | 95% | 90% |

En hotel, C07 y C08 dejaron de fallar. En viajes, el C15 del Spark QA Tour (AFIRMA) falló las tres veces: el verificador quitó «La próxima salida disponible es el 15 de diciembre de 2026 a las 9:00, con 10 cupos». D1n nunca había funcionado en producción. El probe con `dropBackedViolations` enganchado muestra `departures: []` aunque la lectura sí trae la salida. En el turno, las lecturas llevan los `Date` de Prisma, no el texto ISO que ve el modelo y que usaban las pruebas, y `readDepartures` solo aceptaba texto.

**D1p:** `readDepartures` lee la fecha y la hora sean texto o `Date`. La prueba de D1n ahora usa también `Date`.

Siguen abiertos el «1 a 10 personas» de viajes (C08 y C17: el agente da `minPartySize`/`maxCapacity`, que la ficha del juez no trae) y el «desde» del precio de hotel.

### Decisión del dueño: el modo de reserva por defecto es una alarma de salud

En el salón (C16), el agente dice «agendaremos» aunque el negocio no declaró cómo se reserva. La evaluación de salud ya lo sabía: `config.objects` muestra `appointment · direct_commit (por defecto)`. Pero solo aparecía como uno más de 11 bloqueantes.

Decisión (4-nov): el agente sigue como está, y la falta se vuelve una alarma para el tenant. Cuando un objeto habilitado actúa con su modo por defecto (`direct_commit` o `request_to_business`) sin modo declarado, `evaluate` agrega un aviso: «Tu agente ya confirma citas directamente con el modo por defecto de la plataforma, sin que lo hayas decidido. Elige cómo se reservan.» Además pone ese hueco primero entre los bloqueantes, para que la tarjeta de Inicio lo muestre siempre.

### E2n y decisión del dueño: el agente medido es el de todos los tenants

E2n (4-nov, después de #366): 92% de aciertos por intento y 87% pass^3, la mejor medición hasta ahora. Ningún tenant baja más de 4 puntos de pass^3 respecto de E2m.

Al revisar las banderas aparece una brecha. El registro de hechos, la ficha renderizada, «el catálogo manda sobre las FAQ» y las lecturas obligatorias por rubro estaban encendidos solo en los 7 tenants de QA. Los otros 16 usaban el agente anterior. El verificador ya venía encendido por defecto desde E2h.

**Decisión (dueño, 4-nov):** esas 9 banderas quedan encendidas por defecto en el registro. Un tenant que apague una de forma explícita la mantiene apagada.

Siguen apagados por defecto:
- `readiness.goLiveGate`: los 23 tenants están en `go_live_state = off`, y encenderlo dejaría a todos sin respuestas de la IA en canales reales;
- `readiness.writeModeCapability`;
- `agentRuntime.safetyTriage`, que requiere revisión clínica.

Las pruebas del turno que dan por hecho las banderas apagadas usan ahora un `agentTurnFixture` cuyo tenant las tiene apagadas salvo que la prueba las encienda.

### Decisión del dueño: la salud se evalúa sola en todos los tenants

El 4-nov, 16 de los 23 tenants nunca habían tenido una evaluación de salud. La evaluación solo corría al abrir el panel, al conversar o al guardar un dato, así que nadie les avisaba qué les faltaba.

Decisión: `ReadinessScheduler` evalúa cada tenant activo cada 6 horas, con trigger `scheduled` y con candado de cron. El historial sigue guardando una fila solo cuando el resultado cambia. Un tenant que falla no detiene a los demás.

El control de salida (`readiness.goLiveGate`) sigue apagado. Se enciende cuando cada negocio haya visto sus faltantes y tenga un periodo de aviso.

### D1q (#375): el mínimo y el máximo del grupo respaldan la respuesta

El probe del 4-nov sobre la imagen de #367 mostró que el verificador seguía borrando «mínimo 1 y máximo 10 personas». Esto pasaba aunque `get_package_details` traía `minPartySize: 1` y `maxCapacity: 10` en ese mismo turno. #367 llevó esos campos a la ficha de salud y al juez, pero no al verificador en tiempo real. La comprobación de cifras chicas de D1g solo corría en frases de cupos o stock.

Decisión: una frase de tamaño de grupo («personas», «huéspedes», «mínimo», «máximo», «capacidad», y sus equivalentes en EN y PT) también pasa por esa comprobación. La regla no cambia: cada cifra chica tiene que estar tal cual en los datos del turno, sin contar múltiplos.

### E2o: #367, #368, #369 y D1q medidos (parcial)

E2o corrió el 4-nov de 15:48 a 17:50 UTC sobre la imagen de #375. Las 21 corridas se detuvieron al llegar al límite de 2 horas, con 30 a 37 de los 40 casos hechos; E2n se había completado. Es una lectura indicativa: 238 casos y 695 intentos, de los cuales 201 casos coinciden con E2n.

| | E2n | E2o |
|---|---|---|
| aciertos por intento | 92% | 92% |
| pass^3 | 87% | 87% |
| hotel | 92% | 96% |
| citas | 89% | 96% |
| inmobiliaria | 96% | 89% |

C16 (precio de la noche) sube del 52% al 71% y C01 del 62% al 94%. Inmobiliaria baja y queda para revisar caso por caso. El probe tras desplegar D1q mostró que la frase «mínimo 1 y máximo 10 personas» ya no se borra.

## Consecuencias

- Los ensayos, Agent Test y evaluaciones ahora reflejan el turno vivo en lo que sabe el agente. Las cifras de E1 subestiman al agente vivo en la parte que dependía del bloque.
- Una foto sellada antes de D1a sigue corriendo igual (sin bloque).
