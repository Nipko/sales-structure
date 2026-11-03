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

## Consecuencias

- Los ensayos, Agent Test y evaluaciones ahora reflejan el turno vivo en lo que sabe el agente. Las cifras de E1 subestiman al agente vivo en la parte que dependía del bloque.
- Una foto sellada antes de D1a sigue corriendo igual (sin bloque).
