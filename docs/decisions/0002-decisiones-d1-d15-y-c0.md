# 0002 — Decisiones D1–D15 y respuestas C0 §7

- Estado: aprobada
- Fecha: 2026-10-30 · Decide: dueño · Autor: agente (registro en R1)
- Ámbito: especificación (`packages/business-spec/spec/`) y diseño de preparación del negocio (rebanadas R1–R7)

## Contexto
La especificación B2 v0.1 dejó 15 decisiones con un valor por defecto propuesto, y el diseño C0 dejó 7 preguntas abiertas. El dueño las aprobó el 30-oct-2026. Este ADR las deja en el repositorio para que cualquier cambio posterior sea otro ADR.

## Decisión
**D1–D15 (valores por defecto aprobados; especificación v0.2):**

| # | Decisión aprobada |
|---|---|
| D1 | 28 perfiles más el genérico, como en B1 (comercial en P07, autoescuela en P14, psicología separada). |
| D2 | Escritura directa en cita, pedido de comida, pedido de catálogo y clases; solicitud en el resto. |
| D3 | Medios de pago es bloqueante. |
| D4 | Política de cancelación bloqueante solo con escritura habilitada; en P06, siempre. |
| D5 | Las FAQs de plantilla no cuentan y se despublican tras avisar al dueño. |
| D6 | Frases obligatorias: «desde X», «se cotiza según…», «está por confirmar». |
| D7 | Aceptar un valor por defecto de la plataforma cuenta como confirmado si el dueño lo vio. |
| D8 | Festivos: regla general del negocio más excepciones; sin confirmar, «normalmente abrimos X» + NC+AV. |
| D9 | `not_offered` se pide en el alta (puede quedar vacío y confirmado). |
| D10 | Pendientes y traspaso: panel + WhatsApp del dueño, 4 h, se avisa al cliente; la IA retoma a los 10 min con un único aviso. |
| D11 | Ticket de queja común; ninguna compensación por defecto. |
| D12 | Identidad para leer la cuenta: canal; OTP en salud, seguros, finanzas y legal. |
| D13 | Los contactos de emergencia los mantiene la plataforma en el pack de país; el negocio solo agrega su línea. |
| D14 | ES/EN/PT/FR con traducción de fichas; no convertir moneda; memoria solo en la conversación; acudiente por debajo de la edad del pack. |
| D15 | R4 = demanda ≥ 1 % o fallo ≥ 30 % en B1 §D; se revisa con demanda real. |

**Respuestas a C0 §6 (aprobación de C0 §7):**
1. Tenant no publicado: mensaje fijo («estamos preparando la atención automática, una persona te responde») y bandeja humana, sin IA.
2. Tenants QA: se completan con datos para que sirvan de referencia; mientras tanto, lista blanca temporal de pruebas.
3. `policies` y la identidad en `companies`: migrar → verificar → borrar más adelante, con aprobación explícita del dueño en ese momento.
4. Avisos: panel y correo primero; plantillas de WhatsApp en una segunda etapa.
5. El `WRITE_MODE` que declara el negocio reemplaza `canBook`/`canCancel`.
6. Copiloto v1: lee web, documentos, FAQs y catálogo; modelo económico y tope de costo por tenant.
7. Ensayo obligatorio antes de la primera publicación; 14 días de gracia (aviso) cuando una versión de la especificación sube un requisito a bloqueante.

## Consecuencias
- D1–D15 están escritas en `packages/business-spec/spec/*.yaml` (criticidad, `when_missing`, valores por defecto) y se leen en `docs/domain/business-requirements.md`.
- Las respuestas de C0 §7 guían R2–R7; ninguna cambia el runtime en R1.
- Pendiente de confirmación del dueño (marcado `[decisión]` en `profiles.yaml`): el perfil de 7 subtipos que B1 no nombraba (`event_planning/weddings` → P00, `retail/marketplace` → P03, `inmobiliaria/promotora` → P07, `construccion/contratista_general` → P16, `seguros/aseguradora` → P21, `technology/soporte_ti_msp` → P24, `finanzas/pagos_recaudos` → P25).

## Alternativas descartadas
Las opciones no elegidas de cada pregunta están en B2-requisitos §5 y C0 §6 (documentos de trabajo fuera del repositorio).
