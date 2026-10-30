# Decisiones (ADR)

Registro de decisiones aprobadas del proyecto (frente K1). Una decisión por archivo `NNNN-titulo.md`, con la plantilla de abajo. Lo que no está aprobado no entra aquí: es borrador y vive fuera de `docs/`.

| ADR | Decisión | Estado | Fecha |
|---|---|---|---|
| [0001](0001-especificacion-unica.md) | Especificación de requisitos del negocio como fuente única | aprobada | 2026-10-30 |
| [0002](0002-decisiones-d1-d15-y-c0.md) | Decisiones D1–D15 y respuestas C0 §7 | aprobada | 2026-10-30 |
| [0003](0003-subtipos-e-interpretaciones-r1.md) | Subtipos sin perfil e interpretaciones fijadas en R1 | aprobada | 2026-10-30 |
| [0004](0004-panel-de-preparacion-r2.md) | Panel de preparación de solo lectura: historial, caché, enlaces y retiros (R2) | aprobada | 2026-10-30 |
| [0005](0005-base-de-conocimiento-y-limpieza-k3.md) | Estructura de la base de conocimiento aprobado y limpieza K3 | aprobada | 2026-10-30 |
| [0006](0006-contenido-de-plantilla-y-defaults-en-la-verdad-qa.md) | Contenido de plantilla y valores por defecto en la verdad QA (R1.1) | aprobada | 2026-10-30 |

**Registros previos al formato ADR** ([`previas/`](previas/)): retiro de Mercado Pago como PSP de plataforma, Email fuera del self-service, ledger de decisiones de producto (24-ago-2026), registro de decisiones de verticales y decisiones de onboarding (D1–D26). Siguen vigentes salvo que un ADR los reemplace; se convertirán a ADR numerados cuando se toquen.

**Plantilla**

```markdown
# NNNN — <decisión en una frase>

- Estado: propuesta | aprobada | reemplazada por NNNN | retirada
- Fecha: AAAA-MM-DD · Decide: <dueño> · Autor: <persona/agente>
- Ámbito: <módulos / tablas / superficies afectadas>

## Contexto
## Decisión
## Consecuencias
## Alternativas descartadas
```

Bajar la criticidad de un requisito de la especificación exige un ADR que el override cite en `adr` (la CI lo comprueba: `OVERRIDE_LOWERS_WITHOUT_ADR`).
