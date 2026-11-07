# 0024 — Correcciones de calidad tras E2v

- Estado: aprobada
- Fecha: 2026-11-07 · Decide: Claude con la delegación del dueño (hacer lo recomendado) · Autor: Claude
- Ámbito:
  - la calificación de la medición (`packages/business-spec` rehearsal, `apps/api/src/modules/rehearsal`);
  - la reparación de la respuesta (`runtime/evidence-verifier.ts`, `runtime/fact-renderer.ts`, `informational-hours.ts`, `conversations.service.ts`);
  - el motor de reservas (`booking-engine.service.ts`, `informational-detour.ts`).

## Contexto

E2v dio 92 % de aciertos por intento y 87 % pass^3. Los 68 fallos de producto se analizaron uno por uno:
- **Calificación:** en 11 intentos el agente tenía razón y la calificación estaba mal.
- **Juez:** el juez LLM calificó distinto respuestas iguales entre intentos.
- **Reparación de la respuesta:** cuando el verificador de evidencia borraba una frase, dejaba respuestas incoherentes (solo un upsell, o un «no consta» genérico sobre algo confirmado).
- **Datos sembrados:** el catálogo y el horario sembrados por la plataforma se presentaban como datos reales.
- **Motor de reservas:** afirmaba disponibilidad sin una fuente confirmada y se apoderaba de preguntas de requisitos.

## Decisión

1. **Calificación:**
   - Una cifra que también viene de un campo confirmado del mismo ítem ya no se trata como prohibida.
   - El juez recibe la descripción confirmada del catálogo y las FAQ confirmadas que cubren el caso.
   - C26 responde por `CORE.POLICY.WARRANTY` antes que por `CONSUMER_RIGHTS`.
2. **Juez determinista por (caso, respuesta normalizada):** su veredicto se guarda y se reutiliza dentro de una corrida y entre los intentos del mismo banco, guardado en `rehearsal_results.judge`. Los chequeos deterministas siguen sin poder ser anulados.
3. **Reparación con el tema preguntado:**
   - el aviso de lo que no consta habla del tema que preguntó el cliente;
   - no se agrega cuando ese tema está confirmado;
   - una respuesta nunca queda solo con un cierre comercial.
   - No hay llamada nueva al LLM.
4. **Datos sembrados fuera de la evidencia:**
   - Los servicios sembrados o de ejemplo no cuentan como respaldo.
   - Abierto o cerrado es «desconocido» si el horario regular no está confirmado.
   - Un dato de disponibilidad no puede ocupar el lugar de un precio o un total.
5. **Motor de reservas:**
   - Si la fuente de disponibilidad (`OBJ.APPOINTMENT.AVAILABILITY_SOURCE`) no está confirmada, no afirma horarios ni la falta de horarios: avisa y pasa con una persona.
   - Las preguntas de requisitos («¿qué datos necesitan?») sin una reserva abierta las responde el agente, no el motor.

## Consecuencias

- **Agenda en línea:** un tenant que no declaró su fuente de disponibilidad deja de ofrecer horarios en línea; cada consulta de horario pasa a una persona. Es lo que pide la especificación (requisito bloqueante para citas) y hoy no hay tenants con clientes reales.
- **Bancos de prueba:** los arreglos de la calificación aplican a bancos generados desde este cambio. E2w no es comparable 1:1 con E2v en los casos C07, C08, C06 y C26.
- **Juez:** un veredicto equivocado del juez se repite para respuestas idénticas. Un cambio de prompt o de modelo genera claves nuevas.
- **Fuera de este cambio:**
  - C16, la reserva sin `WRITE_MODE` declarado, depende de `readiness.writeModeCapability`, apagada por decisión del dueño (ADR 0016). Queda para su decisión.
  - El triage de urgencias dental sigue apagado hasta la revisión clínica.

## Reversión

Cada parte se revierte por separado. El juez sin caché vuelve a llamar al modelo en cada intento.
