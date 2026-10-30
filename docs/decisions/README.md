# Decisiones (ADR)

Registro de decisiones aprobadas del proyecto (frente K1). Una decisión por archivo `NNNN-titulo.md`, con la plantilla de abajo. Lo que no está aprobado no entra aquí: es borrador y vive fuera de `docs/`.

| ADR | Decisión | Estado | Fecha |
|---|---|---|---|
| [0001](0001-especificacion-unica.md) | Especificación de requisitos del negocio como fuente única | aprobada | 2026-10-30 |
| [0002](0002-decisiones-d1-d15-y-c0.md) | Decisiones D1–D15 y respuestas C0 §7 | aprobada | 2026-10-30 |
| [0003](0003-subtipos-e-interpretaciones-r1.md) | Subtipos sin perfil e interpretaciones fijadas en R1 | aprobada | 2026-10-30 |

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
