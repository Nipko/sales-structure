# 0028 — El piso de herramientas respeta el plan, salvo cuando hay una escritura en juego

- Estado: aprobada (decidida con la autorización autónoma del dueño; se revisa con él a su regreso)
- Fecha: 2026-11-09 · Decide: dueño · Autor: Claude
- Ámbito: `apps/api` (`llm-router.service.ts`, `conversations.service.ts`).
- Relacionada: [0027](0027-costo-llm-cache-y-rechazos.md).

## Contexto

El análisis de costos frente a planes del 9-nov encontró que Emprendedor (solo tier_4) y Starter (tier_3 + tier_4) llamaban a gpt-4o-mini y gpt-4.1-mini, modelos de tier_2. Pasaba por tres caminos del router:

1. `buildCandidates` deja los modelos de fuera del plan al final de la cadena como escalada. Esto es correcto: solo se usan si el plan falla.
2. **El piso de herramientas** (commit 86264566, 19-ago) reordena TODOS los candidatos y pone tier_1/2 primero en cualquier turno con herramientas. Su motivo era real: un «sí» de dos caracteres puntuaba 19 y mandaba la reserva al modelo más débil. Pero para un agente con herramientas casi todo turno es `tool_calling`, también las búsquedas y las preguntas. En la práctica, los planes baratos corrían sobre tier_2 contra topes de $3 y $8.
3. **La afinidad**: después de una escalada, la conversación quedaba pegada al modelo de fuera del plan.

## Decisión

1. Después de todos los reordenamientos (valor, piso y afinidad), y antes del modelo fijado del turno, una partición estable (`partitionByPlan`) pone primero los modelos a los que el turno puede subir. Los demás quedan detrás, solo como último recurso ante un fallo.
2. Por defecto, un turno puede subir solo a los tiers de su plan. Un turno con una **escritura en juego** puede subir además a tier_1/2. «Escritura en juego» es `writeInPlay`, el mismo criterio con el que el servidor decide que un turno conserva el piso por encima del presupuesto (`BUDGET_KEEPS_TOOL_FLOOR_FOR_WRITES`): una propuesta que espera su «sí», un pedido, una reserva en curso, una cancelación o una reprogramación. También cuenta un turno que vocea una escritura ya cometida (`voicedWrite`).
3. Dentro del plan no cambia nada: Pro y Enterprise siguen liderando con tier_2/1 en todo turno con herramientas.
4. El corte por presupuesto (`budgetConstrained`) sigue apagando el piso, como antes.

## Consecuencias

- En Emprendedor y Starter, los turnos con herramientas sin escritura (buscar, consultar disponibilidad, preguntar) van a deepseek. El «sí» que cierra la venta sigue yendo a un modelo bueno.
- Starter no tiene un modelo de herramientas propio en tier_3, porque gemini-2.5-flash no las tiene habilitadas en el catálogo. Sus turnos con herramientas usan su tier_4.
- Si la calidad de herramientas de deepseek en búsquedas resulta insuficiente, la palanca es el catálogo del plan, no el piso.
- La investigación de modelos del 9-nov encontró sustitutos baratos que superan a gpt-4.1-mini en herramientas. Esto puede cambiar qué modelo ocupa cada tier, pero no esta regla.

## Alternativas descartadas

- **Respetar el plan siempre, también en el «sí»**: reabre el defecto del 19-ago (ninguna orden en diez confirmaciones, producción del 9-oct).
- **Mantener el piso por encima del plan en todo turno con herramientas**: los planes baratos pagan tier_2 en casi todos los turnos, y el tope se agota antes que la cuota.
- **Quitar la escalada fuera del plan**: un fallo del único modelo del plan dejaría al agente sin respuesta.
