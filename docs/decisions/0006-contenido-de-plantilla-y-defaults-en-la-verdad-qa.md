# 0006 — Contenido de plantilla y valores por defecto en la verdad QA (R1.1)

- Estado: aprobada (decidida con la autorización autónoma del dueño del 30-oct-2026; se revisa con él a su regreso)
- Fecha: 2026-10-30 · Decide: dueño · Autor: Claude (R1.1)
- Ámbito: `packages/business-spec` (`fromLegacyRows`, `qaTruth`), revisión humana de los casos QA. No toca tablas ni el runtime del agente.

## Contexto

La medición R1 (criterio 6) dio 67,5 % de acuerdo entre qaTruth y la revisión humana. Sus arreglos F1–F7 y F10 están hechos en R1.1, y el dueño ya decidió F8: una FAQ **sembrada** por la plantilla no es verdad QA (D5, ADR 0002); si la revisión aceptó una respuesta tomada de ella, la revisión está mal.

Al implementar F1 («capturar `business_hours`») apareció que esa tabla no existe. El horario que el agente dice en el dental y en el salón («L-V 8-18, sáb 8-13», «lun-sáb 9-19») sale de la agenda (`availability_slots`), que el runtime usa como tercer origen informativo (`informational-hours.ts`). Esas filas las crea `VerticalsService.seedAvailability` desde `definition.businessHours` de la plantilla, en la ventana del alta, y nunca se editaron: por la regla L3 (§7.5) son **sembradas**. Lo mismo pasa con `real_estate_listings.financing_available = false`, que es el default de la columna (L4). La especificación ya prohíbe «asumir horario estándar» (`CORE.HOURS.REGULAR.when_missing.never`) y «negar un atributo sin vacío confirmado» (§8).

## Decisión

1. **La agenda se captura** como tercer origen de `CORE.HOURS.REGULAR`, con la misma precedencia que el runtime (horario del negocio > horario de la persona > agenda), y con el estado de sus filas. La agenda que sembró la plantilla queda **sembrada**: qaTruth espera NC+AV y prohíbe ese horario como hecho. Una agenda cargada después del alta es confirmada y se afirma.
2. **El contenido de plantilla y los defaults de columna no son verdad QA**, igual que las FAQs sembradas (D5 / F8): si la revisión humana aceptó la agenda de la plantilla o un `false` por defecto como dato, la revisión está mal. `financing_available = false` y las listas `'[]'` por defecto son «no consta».
3. **El contrato del motor sí es verdad QA aunque sea el default.** `services.required_fields` es lo que la reserva va a pedir; para «¿qué datos necesito para agendar?» la esperada es esa lista exacta (lo dice `OBJ.*.CUSTOMER_REQUIREMENTS.when_missing`). L4 sigue valiendo para la preparación: el `WRITE_MODE` no se da por confirmado.
4. **Un marcador explícito manda sobre la ventana del alta** (F6, ya ordenado): si la fila trae `price_status`, solo el precio queda «por confirmar» y el resto de la ficha se afirma. Sin marcador, una fila sembrada sigue entera «por confirmar».

## Consecuencias

- Con F8 tal como se decidió (solo FAQs y el check-in/out por defecto), el acuerdo de R1.1 es **93,9 %** (184/196). Con los puntos 1 y 2 aplicados a la revisión, es **100 %** (196/196). Los 12 casos que separan las dos cifras son 10 de horario (agenda de plantilla) y 2 de financiación (`false` por defecto).
- El runtime hoy afirma la agenda de plantilla como horario de apertura. Con esta decisión, esos casos pasan a ser `fail_product`: es trabajo del agente (no contestar un horario de plantilla como si fuera del negocio), no de qaTruth.
- En la preparación, el dental y el salón ven «El horario cargado es de ejemplo del alta: confírmalo o cámbialo» en vez de «Confirma tu horario de cada día» (D-12).

## Alternativas descartadas

- **Tratar la agenda como confirmada.** Subía el acuerdo sin la decisión 2, pero contradice L3 y la prohibición de «asumir horario estándar», y haría que el agente de cualquier tenant nuevo afirmara el horario de la plantilla de su vertical.
- **Aplicar L4 también a `required_fields` en la verdad QA.** El agente tendría que decir «no consta qué datos necesito» y, acto seguido, el motor le pediría nombre y teléfono.
