# Ejecución del plan de plataforma y agente

Inicio: 6 de septiembre de 2026. Base auditada: `b1e87c71`.

Alcance autorizado: ejecutar íntegramente los planes `assist-agent-experience-audit-2026-09-05.md` y `agent-runtime-learning-plan-2026-09-05.md`, con commits incrementales; reservar decisiones de producto pendientes para el cierre. Este registro conserva requisitos y evidencia sin reducir el alcance a los cambios ya hechos.

## Estado por requisito

| ID | Requisito y evidencia de aceptación | Estado |
|---|---|---|
| A1 | Consentimiento contextual, consultas/rechazos sin escritura, propuesta vigente; pruebas multilingües | En ejecución |
| A2 | Citas por comando canónico: anticipo, retención, referencia, settlement único y respuesta fiel | En ejecución |
| A3 | Borrador antes de reserva, cobro, handoff, media y mensajes externos; aprobación explícita de efectos | En ejecución |
| A4 | Matrículas/cupos y gimnasio atómicos ante errores/reintentos/concurrencia; espera accesible | En ejecución |
| B1 | Runtime común para mensajería y Web Chat, con aislamiento, idempotencia y outbox | En ejecución |
| B2 | Prueba/simulación con las mismas reglas de dominio y adaptadores sin efectos externos | Pendiente |
| C1 | Slots tipados; preguntas, pausas, correcciones y cambio de intención sin perder misión | En ejecución |
| C2 | Ciclos completos de cita, pedido, matrícula/gimnasio; recuperar objetos propios y operaciones inciertas | Pendiente |
| C3 | Dependencias de herramientas, contrato MCP revisado y selección por tarea completa | Pendiente |
| D1 | Recuperación común, procedencia/autoridad/vigencia/scope preservados; precios solo de fuentes válidas | En ejecución |
| D2 | Indexación por versiones con recuperación; memoria corregible y borrado de derivados | En ejecución |
| D3 | Diagnósticos de conocimiento correctos y atribución que distingue relevancia de uso real | En ejecución |
| E1 | Packs positivos/negativos y verificadores de resultados, incluido taller; cobertura explícita | Pendiente |
| E2 | Revisiones congeladas, canal real y errores contados en regresión/simulación | Pendiente |
| E3 | Presupuesto y cola recuperables; candidato/piloto/publicado; promoción, invalidación y rollback | Pendiente |
| F1 | Misión por plantilla y assessment común con evidencia, dependencias, acciones y pruebas | Pendiente |
| F2 | Assist ejecuta acciones tipadas con diff, permisos, versión, idempotencia, auditoría y relectura | Pendiente |
| F3 | Onboarding y tours por tareas verificadas; continuidad, accesibilidad, móvil e i18n en 4 idiomas | Pendiente |
| F4 | Tarjeta/editor/Salud/Assist coherentes; desconocido distinto de ausente; rutas recuperables | Pendiente |
| G1 | Importar/segmentar chats con linaje, privacidad, deduplicación y separación de fuentes/memoria/estilo | Pendiente |
| G2 | Curación multidimensional, revisión humana, ejemplos contextualizados y retiro de derivados | Pendiente |
| G3 | Dataset reservado sin contaminación; comparar candidato, publicar gradualmente y revertir | Pendiente |
| H1 | Matriz capacidad/tarea/datos/comando/verificador/canal por perfil; sin certificación heredada | Pendiente |
| H2 | Fallos reales a regresiones; métricas con denominadores por misión, idioma, canal y dificultad | Pendiente |
| H3 | Pilotos completos con tenant/backend/proveedores, usuarios nuevos y comparación de desempeño | Pendiente de ejecución y acceso a entornos/personas |

## Verificación y commits

Cada entrada registrará archivos, comportamiento comprobado, comandos ejecutados y límites. Un test unitario no certifica por sí solo una vertical ni un proveedor real. La finalización del programa exige revisar cada requisito de esta tabla contra evidencia vigente.

### Primera tanda de integridad

- `ae84eec2`: conserva auditoría, reproducciones y alcance completo de aceptación.
- `13dfedd6`: contratos de borrador, campos de procedimientos y reporte de conocimiento tipados.
- `9ad42aee`: consentimiento de mensaje completo; referencias canónicas firmadas con la propuesta; rechazo de cambios de términos y de reutilizar el mismo mensaje para autorizar; slots tipados y preguntas/pausa/cancelación; fechas civiles independientes del TZ del proceso. 11 suites focalizadas / 194 pruebas locales pasan.
- `fc60a721`: herramienta de citas usa comando canónico; anticipo/retención/referencia; settlement con pago persistido, capacidad y outbox bajo transacción; recuperación de pago tardío; aislamiento de notificaciones/calendario de evaluación. Matrícula y gimnasio usan transacciones, espera accesible y lector de reservas propias. 13 suites / 101 casos locales; bootstrap NestJS pasa.
- En revisión: Web Chat ejecuta `generateResponse`, igual que mensajería; preserva contacto/canal/inbound, cuota, lock y respuesta reutilizable; transporte persiste antes de emitir. Borrador consulta lectores auditados y bloquea motores/escrituras/handoff/media externos. Los precios se validan exclusivamente con conocimiento recuperado y campos monetarios del dominio, excluyendo historial del cliente/modelo. Pruebas focalizadas de integración, precios, widget y selección de herramientas pasan; TypeScript API y dashboard verificados durante la tanda.

Los siguientes puntos continúan pendientes incluso después de esta tanda: aprobación humana de propuestas de acciones desde un borrador; notificación durable tras confirmar un pago/promover lista de espera; reparación explícita de registros históricos ya inconsistentes; pruebas con DB real y concurrencia real; paridad completa de Agent Test/evaluación; estado de tarea durable; verificación de entrega humana de Web Chat. Los casos locales usan servicios reales y dependencias simuladas y no certifican proveedores externos.

## Decisiones reservadas para el cierre

Se documentarán aquí únicamente decisiones que no puedan resolverse con el plan, las reglas actuales del negocio o una implementación reversible. La ausencia de una decisión opcional no detiene los demás frentes.
