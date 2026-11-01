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

## Consecuencias

- Los ensayos, Agent Test y evaluaciones ahora reflejan el turno vivo en lo que sabe el agente. Las cifras de E1 subestiman al agente vivo en la parte que dependía del bloque.
- Una foto sellada antes de D1a sigue corriendo igual (sin bloque).
