# Ola 0 — resolución de persona desde onboarding

Estado: política determinista v1 implementada el 2026-08-08.

## Contrato

`resolveOnboardingPersonaTemplate()` es puro y selecciona únicamente el `templateId`
del agente **inicial** usando `(vertical, subtype, goals)`. No mezcla configuración ni
actualiza agentes existentes. `createDefaultAgentFromGoals()` conserva su guarda
idempotente: si existe cualquier `agent_personas`, el retry retorna antes de resolver o
escribir. El setup wizard y el editor siguen siendo las superficies explícitas donde el
usuario puede escoger o modificar una plantilla.

Cuando se marcan varios objetivos, v1 conserva la precedencia que ya tenía la rama
genérica: `appointments > support > faq > lead_qualification > sales > reminders >
promotions > response_time`. Si dos objetivos apuntan a personas distintas, la salida
incluye `multiple_goal_templates` para hacer visible que la precedencia es heredada y no
una nueva decisión de producto.

## Cobertura determinista

| Vertical | Default / reservas-ventas | Variante inequívoca por objetivo |
|---|---|---|
| salud | recepción médica; dental conserva recepción odontológica | `support/reminders` → seguimiento |
| veterinaria | clínica veterinaria | única plantilla existente |
| gimnasios | membresías | `appointments` → clases |
| seguros | cotizador | `support/reminders` → servicio al asegurado |
| moda_belleza | reservas | `sales` → productos |
| inmobiliaria | ventas/listings según subtipo | `support` → postventa cuando no hay preferencia de subtipo |
| restaurantes | reservas/delivery según subtipo | `sales` → delivery cuando no hay preferencia de subtipo |
| automotriz | ventas; taller conserva servicio | `support` → servicio cuando no hay preferencia de subtipo |
| turismo | ventas; tours/agencia conservan su especialista | `support` → soporte para hotel/alquiler vacacional |
| education | inscripciones | única plantilla existente |
| finanzas | pre-calificador y agenda | `support/reminders` → renovaciones/postventa |
| servicios_profesionales | consulta inicial | `support` → seguimiento cuando no hay preferencia de subtipo |
| retail | ventas | `support` → postventa/devoluciones |
| technology | ventas B2B | `support` → soporte técnico N1 |
| pet_services | atención de servicios | `sales` → pet shop |
| servicios_hogar | cotización/agenda | `support` → seguimiento/garantía |
| fotografia | cotización/reservas | `support` → entrega/postventa cuando no hay preferencia de subtipo |
| otro | ventas | `support` → soporte |

La matriz automatizada recorre las 18 verticales, sus 75 subtipos más `otro`, los ocho
objetivos conocidos y los cuatro idiomas. Cada resolución debe devolver un ID que exista
en el catálogo localizado.

## Decisiones pendientes registradas

1. **Subtipo versus objetivo.** v1 conserva las selecciones por subtipo ya desplegadas
   (dental, restaurante por modalidad, listings inmobiliarios, taller, tours/agencia,
   clases de gimnasio, broker/aseguradora, abogados y bodas). Si el objetivo pediría otra
   persona, retorna `subtype_goal_conflict`; no cambia silenciosamente el producto.
2. **Objetivos sin plantilla dedicada.** `promotions` y `response_time` no tienen persona
   dedicada. `reminders` solo cambia de persona cuando hay una variante inequívoca de
   seguimiento/renovación. Se retorna `goal_template_missing` y se conserva el default.
3. **Alta administrativa.** `POST /tenants` no captura objetivos y hoy llama al resolver
   con `[]`; recibe el default por vertical/subtipo. Añadir objetivos al contrato/UI de
   super-admin es una decisión de producto, no una corrección implícita.
4. **Múltiples objetivos.** La precedencia existente evita no-determinismo, pero decidir
   si el producto debe crear varios agentes, preguntar por un objetivo principal o usar
   una persona híbrida queda fuera de v1.

## Rutas verificadas

- Autoservicio: persiste `settings.chatReasons` y pasa los objetivos al crear el agente.
- Retry: vuelve a leer `settings.chatReasons`, no depende de que el navegador reenvíe el
  payload y no toca un agente ya creado.
- Alta administrativa/retry administrativo: la etapa `agent` es idempotente y usa
  `(vertical, subtype, [])`; las etapas completadas no se repiten.
- Setup wizard/editor: una elección o configuración explícita del usuario sigue ganando;
  este resolver no participa en updates.
