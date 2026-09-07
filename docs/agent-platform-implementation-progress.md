# Ejecución del plan de plataforma y agente

Inicio: 6 de septiembre de 2026. Base auditada: `b1e87c71`.

Alcance autorizado: ejecutar íntegramente los planes `assist-agent-experience-audit-2026-09-05.md` y `agent-runtime-learning-plan-2026-09-05.md`, con commits incrementales; reservar decisiones de producto pendientes para el cierre. Este registro conserva requisitos y evidencia sin reducir el alcance a los cambios ya hechos.

## Estado por requisito

| ID | Requisito y evidencia de aceptación | Estado |
|---|---|---|
| A1 | Consentimiento contextual, consultas/rechazos sin escritura, propuesta vigente; pruebas multilingües | Implementado y probado localmente; falta CAS de precio en el comando y casos con DB real |
| A2 | Citas por comando canónico: anticipo, retención, referencia, settlement único y respuesta fiel | Comando, retención y settlement implementados; entrega durable y piloto pendientes |
| A3 | Borrador antes de reserva, cobro, handoff, media y mensajes externos; aprobación explícita de efectos | Efectos bloqueados en borrador; aprobación de propuestas de acciones pendiente |
| A4 | Matrículas/cupos y gimnasio atómicos ante errores/reintentos/concurrencia; espera accesible | Transacciones y lectores implementados; concurrencia con DB real pendiente |
| B1 | Runtime común para mensajería y Web Chat, con aislamiento, idempotencia y outbox | Runtime Web Chat compartido; validación de entrega/handoff real pendiente |
| B2 | Prueba/simulación con las mismas reglas de dominio y adaptadores sin efectos externos | Core compartido y adaptadores implementados; writers en sandbox aislado en ejecución |
| C1 | Slots tipados; preguntas, pausas, correcciones y cambio de intención sin perder misión | Slots, pausa y persistencia implementados; misiones paralelas y ciclos completos pendientes |
| C2 | Ciclos completos de cita, pedido, matrícula/gimnasio; recuperar objetos propios y operaciones inciertas | En ejecución; faltan cierres, recuperación y pruebas por dominio |
| C3 | Dependencias de herramientas, contrato MCP revisado y selección por tarea completa | Contratos MCP revisados y dependencias base implementados; cobertura completa por tarea pendiente |
| D1 | Recuperación común, procedencia/autoridad/vigencia/scope preservados; precios solo de fuentes válidas | Procedencia, scope y autoridad de precios implementados; muestreo de contradicciones pendiente |
| D2 | Indexación por versiones con recuperación; memoria corregible y borrado de derivados | Versionado, CAS, memoria corregible y borrado atómico implementados; validación DB real pendiente |
| D3 | Diagnósticos de conocimiento correctos y atribución que distingue relevancia de uso real | Diagnósticos corregidos; atribución observable en ejecución |
| E1 | Packs positivos/negativos y verificadores de resultados, incluido taller; cobertura explícita | Pendiente: recorridos positivos completos, taller y matriz de cobertura |
| E2 | Revisiones congeladas, canal real y errores contados en regresión/simulación | Snapshot de agente, canal y denominadores implementados; congelación integral de dependencias pendiente |
| E3 | Presupuesto y cola recuperables; candidato/piloto/publicado; promoción, invalidación y rollback | Cola durable y presupuesto técnico implementados; promoción integral de agente y pilotos pendientes |
| F1 | Misión por plantilla y assessment común con evidencia, dependencias, acciones y pruebas | Assessment común implementado en revisión; validación de tareas reales pendiente |
| F2 | Assist ejecuta acciones tipadas con diff, permisos, versión, idempotencia, auditoría y relectura | Comandos de persona y misión + CAS implementados en revisión; herramientas y cuenta en ejecución |
| F3 | Onboarding y tours por tareas verificadas; continuidad, accesibilidad, móvil e i18n en 4 idiomas | Tours por tareas verificadas implementados; prueba con usuarios nuevos pendiente |
| F4 | Tarjeta/editor/Salud/Assist coherentes; desconocido distinto de ausente; rutas recuperables | Superficies alineadas en revisión; verificación visual integral pendiente |
| G1 | Importar/segmentar chats con linaje, privacidad, deduplicación y separación de fuentes/memoria/estilo | Importación, linaje, privacidad y separación implementados; calibración sobre datos reales pendiente |
| G2 | Curación multidimensional, revisión humana, ejemplos contextualizados y retiro de derivados | Curación y revisión en cuatro idiomas implementadas; revisión humana de muestra pendiente |
| G3 | Dataset reservado sin contaminación; comparar candidato, publicar gradualmente y revertir | Comparación real, publicación gradual y retiro implementados; piloto y sandbox de acciones pendientes |
| H1 | Matriz capacidad/tarea/datos/comando/verificador/canal por perfil; sin certificación heredada | Pendiente: matriz explícita por perfil con evidencia vigente |
| H2 | Fallos reales a regresiones; métricas con denominadores por misión, idioma, canal y dificultad | Pendiente: regresiones desde fallos reales y métricas completas por misión |
| H3 | Pilotos completos con tenant/backend/proveedores, usuarios nuevos y comparación de desempeño | Pendiente: entorno aislado en preparación; proveedores, usuarios y benchmark sin ejecutar |

## Verificación y commits

Cada entrada registrará archivos, comportamiento comprobado, comandos ejecutados y límites. Un test unitario no certifica por sí solo una vertical ni un proveedor real. La finalización del programa exige revisar cada requisito de esta tabla contra evidencia vigente.

### Primera tanda de integridad

- `ae84eec2`: conserva auditoría, reproducciones y alcance completo de aceptación.
- `13dfedd6`: contratos de borrador, campos de procedimientos y reporte de conocimiento tipados.
- `9ad42aee`: consentimiento de mensaje completo; referencias canónicas firmadas con la propuesta; rechazo de cambios de términos y de reutilizar el mismo mensaje para autorizar; slots tipados y preguntas/pausa/cancelación; fechas civiles independientes del TZ del proceso. 11 suites focalizadas / 194 pruebas locales pasan.
- `fc60a721`: herramienta de citas usa comando canónico; anticipo/retención/referencia; settlement con pago persistido, capacidad y outbox bajo transacción; recuperación de pago tardío; aislamiento de notificaciones/calendario de evaluación. Matrícula y gimnasio usan transacciones, espera accesible y lector de reservas propias. 13 suites / 101 casos locales; bootstrap NestJS pasa.
- `5f7ceed2`: Web Chat ejecuta `generateResponse`, igual que mensajería; preserva contacto/canal/inbound, cuota, lock y respuesta reutilizable; transporte persiste antes de emitir. Borrador consulta lectores auditados y bloquea motores/escrituras/handoff/media externos. Los precios se validan exclusivamente con conocimiento recuperado y campos monetarios del dominio, excluyendo historial del cliente/modelo. Pruebas focalizadas de integración, precios, widget y selección de herramientas pasan; TypeScript API y dashboard verificados durante la tanda.

### Runtime, conocimiento, evaluación y aprendizaje

- `ca76f15f`: indexación por versiones con compare-and-swap; filtros de agente/audiencia/jurisdicción; memoria con procedencia y corrección atómica; borrado y tombstones; diagnóstico de huecos de conocimiento en cuatro idiomas. 5 suites / 35 pruebas focalizadas pasan.
- `a1f0c1cb`: contratos MCP revisados ligados a definición, endpoint y credencial; alcance de contacto/tenant ligado por el servidor; confirmación e identidad por efecto; timeout de escritura como resultado incierto sin repetición automática. Las herramientas leídas no justifican afirmar una escritura. No hay certificación de un proveedor MCP externo.
- `a9a32c65`: snapshot inmutable de configuración; ejecución por canal; errores en el denominador; checkpoints, recuperación de trabajos y presupuesto durable por tenant. 8 suites / 61 pruebas pasan. El presupuesto usa unidades conservadoras de llamadas de modelo; no representa un importe en dólares.
- `75fe01c3`: tareas de inicio verificadas contra backend; tours interactivos que preparan pantalla/formulario y vuelven a comprobar el resultado; revisión MCP visible. Backend focalizado: 2 suites / 65 pruebas; dashboard focalizado: 4 suites / 52 pruebas. Una ejecución previa del dashboard completo pasó 33 suites / 325 pruebas.
- `afe7c009`: estado de procedimiento persistido antes de actuar, PostgreSQL como autoridad y Redis como caché; pausa/retomar; misión de reserva recuperable; botones ligados a la propuesta y sus términos vigentes. No confundir duración de misión con vigencia de consentimiento.
- `353dd0f2`: resolución de capacidades de MCP, vertical, país, plan y pagos respeta contexto de prueba sin reparar/escribir caches, credenciales ni tablas. 3 suites / 11 pruebas específicas pasan; batería combinada de continuidad/consentimiento/pagos/MCP: 12 suites / 148 pruebas pasan.
- `9fafa46a`: contratos compartidos de misión, assessment, cambios revisables y trazas por turno.
- `876723d7`: Agent Test deja de tener un pipeline propio y utiliza el runtime operativo con adaptadores de sesión, estado, transporte, herramientas y trazas. Aprendizaje con importación, privacidad, separación por cliente, deduplicación semántica, revisión, snapshots, comparación A/B por runtime real, publicación gradual y retiro. El borrado bloquea claims/finalizers concurrentes e invalida snapshots y outbox identificables. Runtime: 15 suites / 104 pruebas; aprendizaje/privacidad: 9 suites / 106 pruebas pasan. API TypeScript y bootstrap de AppModule pasan.
- `d07d158e`: pantalla para importar desde bandeja o texto, revisar calidad y evidencia, seleccionar ejemplos, comparar, publicar gradualmente y retirar versiones. Traducciones es/en/pt/fr; el original cargado permanece solo en la visita del navegador. El conjunto reservado no se expone en la API de revisión. 2 suites / 19 pruebas de parser, aprobación y render en cuatro idiomas pasan; dashboard TypeScript pasa.

Los números de suites anteriores se solapan: no deben sumarse como si fueran casos independientes. Los tests usan servicios reales con dependencias aisladas; no certifican proveedores externos ni resultados de mercado.

### Frentes abiertos al 7 de septiembre

- Assist y editor: assessment compartido, propuestas revisables y versión optimista global están en revisión; se amplían los comandos a configuraciones seguras de capacidades y horarios.
- Evaluación: se localizó PostgreSQL/Docker en Ubuntu mediante WSL. Se prepara una instancia efímera separada de los datos y volúmenes existentes para probar namespaces, transacciones y comandos. Hasta validar el aislamiento, los writers de Agent Test permanecen bloqueados: no se acepta una respuesta simulada como resultado canónico.
- Conocimiento: se implementa atribución observable sobre la respuesta final, separada de relevancia y de veracidad.
- Continúan dentro del alcance: propuestas de efectos desde borrador; notificación durable de settlement y promociones de espera; recuperación/reparación histórica; ciclos completos por dominio; precio/propuesta validado dentro del comando; packs positivos y verificador de taller; matriz de todos los perfiles; fallos reales a regresiones; revisión visual y pruebas con usuarios; pilotos externos y comparación de desempeño.

No se ha hecho push, despliegue ni migración sobre tenants existentes. La meta de ser el mejor agente requiere resultados medidos y comparación externa; no se declara conseguida por pasar pruebas locales.

## Decisiones reservadas para el cierre

Se documentarán aquí únicamente decisiones que no puedan resolverse con el plan, las reglas actuales del negocio o una implementación reversible. La ausencia de una decisión opcional no detiene los demás frentes.
