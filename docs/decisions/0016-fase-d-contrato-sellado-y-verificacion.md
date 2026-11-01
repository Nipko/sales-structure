# 0016 — Fase D: el turno sellado ve el contrato de conocimiento (D1a), y verificación con evidencia antes de enviar (D1b)

- Estado: D1a aprobada; D1b propuesta (decidida con la autorización autónoma del dueño del 30-oct-2026; se revisa con él a su regreso)
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

**Riesgo de medición:** si el verificador del producto y el juez del ensayo comparten modelo y criterio, el ensayo mediría su propio sesgo. Para mitigarlo:

- el verificador usa otro modelo y su propio prompt, centrado en el contrato;
- el resultado de D1b se valida con etiquetas humanas a ciegas, no solo con el juez.

## Medición

Cada rebanada se mide sola, con el mismo banco congelado de E1 (semilla `e1`, k = 3, 7 tenants) y el juez de ADR 0015:

- **E2a** = agente actual + D1a. Es la línea base real de la arquitectura actual: el agente ya ve lo que vería en vivo.
- **E2b** = E2a + D1b.

## Consecuencias

- Los ensayos, Agent Test y evaluaciones ahora reflejan el turno vivo en lo que sabe el agente. Las cifras de E1 subestiman al agente vivo en la parte que dependía del bloque.
- Una foto sellada antes de D1a sigue corriendo igual (sin bloque).
