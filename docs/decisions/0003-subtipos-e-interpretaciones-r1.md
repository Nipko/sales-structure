# 0003 — Asignación de subtipos sin perfil e interpretaciones fijadas en R1

- Estado: aprobada
- Fecha: 2026-10-30 · Decide: dueño · Autor: agente (registro tras R1)
- Ámbito: `packages/business-spec/spec/profiles.yaml` (mapeo de subtipos) y criterios de criticidad de la especificación

## Contexto
Al construir R1 aparecieron siete subtipos canónicos que el catálogo B1 no asignaba a ningún perfil efectivo, y tres frases de la especificación que admitían más de una lectura al convertirlas en predicados deterministas. El dueño aceptó las propuestas el 30-oct-2026.

## Decisión
**Subtipos asignados:**

| Subtipo | Perfil |
|---|---|
| `event_planning/weddings` | P00 (genérico) |
| `retail/marketplace` | P03 (catálogo / tienda) |
| `inmobiliaria/promotora` | P07 (inmobiliaria) |
| `construccion/contratista_general` | P16 (servicios del hogar) |
| `seguros/aseguradora` | P21 (seguros) |
| `technology/soporte_ti_msp` | P24 (servicios técnicos) |
| `finanzas/pagos_recaudos` | P25 (finanzas) |

**Interpretaciones fijadas:**
1. Sin escritura directa sobre algo reservable, la política de cancelación es **necesaria (R4)**, no bloqueante.
2. Sin escritura directa de mesa, `TABLE_RULES` baja a **necesaria (R4)**.
3. Las instrucciones del agente que vienen de plantilla y el dueño no revisó cuentan como hueco (`CORE.KNOWLEDGE.AGENT_INSTRUCTIONS` falla hasta que se revisen).

## Consecuencias
- Se retiran las marcas `[decisión]` de `profiles.yaml`.
- Cualquier cambio posterior a estas asignaciones o lecturas se registra en un ADR nuevo que reemplace a este.
- Quedan para rebanadas posteriores, como trabajo de plataforma: el registro de seguimiento de pendientes (`CORE.PROC.FOLLOW_UP_STATE`) y los derechos del consumidor por país.
