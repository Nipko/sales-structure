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
| [0007](0007-procedencia-y-valores-del-negocio-r3.md) | Procedencia y valores del negocio: lo que C0 no fijaba (R3) | aprobada | 2026-10-30 |
| [0008](0008-formularios-del-panel-r3.md) | Formularios del panel de preparación: lo que C0 no fijaba (R3, interfaz) | aprobada | 2026-10-30 |
| [0009](0009-unificacion-horario-politicas-identidad-r3b.md) | Unificación de horario, políticas, not_offered e identidad: lo que C0 no fijaba (R3b) | aprobada | 2026-10-30 |
| [0010](0010-control-de-salida-y-contrato-del-turno-r4.md) | Control de salida, contrato del turno y `WRITE_MODE` como autoridad de escritura (R4) | aprobada | 2026-10-30 |
| [0011](0011-bucle-de-conocimiento-pendiente-r5.md) | Bucle de conocimiento pendiente: «lo averiguo» como herramienta, bandeja del dueño y aviso al cliente por la salida durable (R5) | aprobada | 2026-10-30 |
| [0012](0012-copiloto-de-onboarding-r6.md) | Copiloto de onboarding: el LLM propone con cita verificada, el código decide y una persona aprueba (R6) | aprobada | 2026-10-30 |
| [0013](0013-ensayo-antes-de-salir-r7.md) | Ensayo antes de salir: banco determinista desde la especificación, verdad de `qaTruth`, Agent Test sin efectos y calificación determinista primero (R7) | aprobada | 2026-10-30 |
| [0014](0014-calibracion-del-instrumento-del-ensayo-e11.md) | Calibración del instrumento del ensayo: el requisito que responde la pregunta, marcadores con guardas, juez con los hechos y recalificación sin agente (E1.1) | aprobada | 2026-10-31 |
| [0015](0015-juez-del-ensayo-errores-graves-e11b.md) | Juez del ensayo: solo errores graves, hechos completos y `deepseek-chat` (E1.1b) | aprobada a prueba | 2026-10-31 |
| [0016](0016-fase-d-contrato-sellado-y-verificacion.md) | Fase D: el turno sellado ve el contrato de conocimiento y la respuesta se verifica con evidencia antes de enviarse | aprobada | 2026-10-31 |
| [0017](0017-limpieza-k3-segunda-pasada.md) | Limpieza K3, segunda pasada: código muerto, textos huérfanos y documentos sin lector | aprobada | 2026-11-04 |
| [0018](0018-decisiones-pendientes-del-dueno-nov-2026.md) | Decisiones pendientes del dueño: valores automáticos (opción B), catálogo sembrado, puerta de salida, ensayo concurrente y limpieza K3 | aprobada | 2026-11-05 |
| [0019](0019-tablas-sin-uso-k3c.md) | Tablas sin uso: dejar de crearlas (fase 1) y borrarlas después del respaldo (fase 2) | aprobada (fase 1) | 2026-11-05 |
| [0020](0020-retiro-sms.md) | Retiro completo de SMS: código, rutas, pantallas e interruptor; las tablas `sms_package_orders`, `sms_credit_ledger` y `sms_credit_balances` esperan un DROP de fase 2 | aprobada | 2026-11-05 |
| [0021](0021-ventana-de-vigencia-de-la-evaluacion.md) | Ventana de vigencia de 2 s para las verificaciones de la evaluación: una verificación reutiliza una captura que empezó hace 2 s o menos | aprobada | 2026-11-06 |
| [0024](0024-correcciones-de-calidad-e2v.md) | Correcciones de calidad tras E2v: calificación, juez determinista, reparación con el tema preguntado, datos sembrados fuera de la evidencia y disponibilidad sin fuente | aprobada | 2026-11-07 |
| [0022](0022-control-de-herramientas-en-superadmin.md) | Control de las herramientas del agente en el superadmin: registro de cada uso, agregado por día, y vistas de catálogo, matriz por tenant y salud | aprobada | 2026-11-07 |
| [0023](0023-familias-de-herramientas-por-plan.md) | Los planes deciden qué familias de herramientas recibe cada tenant (sin lista = todas), con puerta en la ejecución y caché de 30 s; crear y archivar planes | aprobada | 2026-11-07 |
| [0027](0027-costo-llm-cache-y-rechazos.md) | Costo LLM: la caché de prompts se cobra a su tarifa y los rechazos sin cobro (sin créditos, clave, 402, límite de tasa) se liquidan en 0 | aprobada | 2026-11-09 |
| [0028](0028-piso-de-herramientas-dentro-del-plan.md) | El piso de herramientas respeta los tiers del plan; solo un turno con una escritura en juego puede subir a tier_1/2, y la afinidad ya no fija modelos de fuera del plan | aprobada | 2026-11-09 |

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
