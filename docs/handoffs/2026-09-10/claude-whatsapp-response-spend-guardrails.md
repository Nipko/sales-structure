# Adenda: controlar el gasto de respuestas WhatsApp por destino

## Mandato y alcance

Incorpora **R0–R6** al cierre existente y a M1–M3/L2. La prioridad expresamente aclarada es el nuevo cobro de **respuestas de WhatsApp**, especialmente en países de tarifa alta. Conserva los controles IA existentes; no conviertas esta adenda en otro rediseño del presupuesto de modelos. Las referencias IA en la auditoría son contexto y no sustituyen la protección de entregas Meta.

Fuente principal: [Protección del gasto en respuestas de WhatsApp](../../research/2026-09-10/whatsapp-response-spend-guardrails-plan.md). Evidencias: [Jelou/respond.io](../../research/2026-09-10/competitor-jelou-respond-agent-controls.md), [otros referentes](../../research/2026-09-10/competitor-agent-guardrails-evidence.md), [auditoría de código y emisores](../../research/2026-09-10/parallly-conversation-abuse-code-audit.md), [escenarios por país](../../research/2026-09-10/whatsapp-response-cost-scenarios.json).

El resultado debe impedir un envío no autorizado por presupuesto, reducir entregas innecesarias y conservar tareas legítimas. No basta un prompt de concisión, un límite de iteraciones, saldo leído sin reserva o un conteo de conversaciones. El costo pertenece a los mensajes reales entregados, con estimación/reserva antes de transmitirlos.

Mantén commits incrementales, cambios concurrentes intactos y las directivas de release. Implementa y prueba localmente con proveedores sintéticos. Esta adenda no aporta tarjetas, destinatarios ni presupuesto para llamadas reales; deja el piloto concreto preparado para la autorización correspondiente.

## R0 — inventario y contrato único de salida

Revalida los 14 emisores de la auditoría contra HEAD. Deriva la cobertura desde rutas alcanzables: agente legacy y outbox, consola humana, REST WhatsApp, herramientas, media/enlaces, campañas, plantillas, reglas, drips, nurturing, recordatorios y Flow. Distingue código sin caller de productor activo; CSAT no se declara emisor activo sin demostrarlo.

Identifica la frontera más baja compartida o adapta los carriles directos para exigir la misma autorización. El flag `dispatch.normalOutbox` no puede dejar el presupuesto apagado para los otros caminos. No duplicar tabla de saldo, guard o contador que una ruta pueda ignorar. Probar ausencia de permiso en transporte real simulado, no sólo retorno negativo del guard.

La autorización fija tenant, conexión, cuenta pagadora, destinatario tarifario, categoría, productor, objetivo, efectos y reserva. No hay fallback a otra cuenta o token; un reintento conserva su efecto e incertidumbre. La configuración del tenant o un argumento del LLM no puede fabricar el permiso de gasto.

## R1 — minimizar efectos de transporte

Audita `dispatch-items.ts` y los emisores legacy. Usa caption nativo de WhatsApp cuando contenido/límites lo permiten; conserva las necesidades diferentes de Messenger/otros canales. Un link puede ir en el texto si mantiene semántica, seguridad y límite. No fragmentar saludos, precio, enlace y cierre por diseño visual.

Cuenta mensajes después de formar los efectos. La misma respuesta con tres fotos y captions puede convertirse en varios cargos. Antes de encolar, muestra/reserva el número y precio de los efectos reales. Agrupar no puede omitir condiciones, consentimiento, fechas, identidad de operación o confirmación de pago.

Al incorporar links en texto, el servidor inserta la URL canónica validada; el modelo no la reconstruye. Mantén procedencia, redacción y controles de destino.

Conserva recibos, orden, procedencia y recuperación al compactar. No reescribir lotes ya comprometidos con una forma nueva ni invalidar sus IDs. Los cambios aplican a nuevas composiciones/versiones de política; lo anterior se recupera según su contrato.

Corrige la clave de debounce para incluir la conexión operativa y conserva cada ingreso en orden. Ensaya mensajes fragmentados, correcciones/consentimientos, dos números del mismo tenant, reinicios y latencia. El silencio nunca descarta una entrada que contiene un dato nuevo.

## R2 — progreso, espera y pausa

Reutiliza autoridad del turno y estado de operaciones para registrar qué objetivo sigue abierto, qué dato se pidió, qué cambió y cuál es la próxima acción válida. Una pregunta adicional no acredita progreso. La regla actual de una pregunta máxima debe permitir cero preguntas cuando ya se respondió.

Implementa un resultado explícito y durable de esperar/suprimir sin mensaje, distinto de error, resolución y handoff. Ningún catch o fallback debe convertirlo en un texto cobrable. No permitir que el modelo cierre como resuelta una operación que no se ejecutó.

Valores iniciales para pruebas, no una aprobación productiva: pregunta y una reformulación del mismo dato sin cambio; revisión después de tres turnos sin progreso; hasta un aviso de pausa por episodio. Revalidar por tarea/idioma/accesibilidad. Un nuevo objetivo válido puede continuar dentro de los presupuestos acumulados; reiniciar conversación no reinicia el gasto del contacto.

Pausa los productores automáticos pertinentes con estado compartido. No contestar a cada “gracias”, reacción, ataque repetido o confirmación ya atendida. No clasificar como abuso un reclamo, dificultad de comprensión, negativa, idioma distinto o petición de persona. El humano puede revisar y reanudar con permisos, sin aumento monetario silencioso.

## R3 — dinero por cuenta, contacto, tarea y mercado

Implementa sobre la autoridad económica de M3: límites diarios/mensuales de cuenta y negocio, límite por contacto/atención y límite por lote/efecto. Usa tarifa M2 según fecha, categoría, mercado destinatario y moneda Meta. No usar idioma o país de la empresa como mercado del receptor. No redondear cada tarifa a cero ni convertir monedas sin contrato explícito.

Reserva de manera transaccional antes de emitir. Contabiliza gasto confirmado, reservas y exposición de resultados inciertos. No basta verificar saldo y descontarlo después. Cada reserva/liquidación debe ser idempotente y auditable. Prueba dos workers peleando por el último importe y entrega de mensajes con categorías mixtas.

Las 1.000 entregas de servicio gratuitas son por número/mes y con vigencia de octubre; no por país/contacto ni para utility. Con datos inciertos o envíos de terceros, no prometer uso gratuito: reservar una cota verificable y conciliar. FEP requiere evidencia y no implica que el tráfico orgánico sea gratuito. El presupuesto no es un wallet bancario ni requiere que Parallly financie Meta.

Un destino desconocido no tiene tarifa cero. Define alternativa conservadora por mercados admitidos o revisión; no pedir datos personales innecesarios sólo para abaratar la reserva. Si la tarifa cambia mientras espera la cola, recalcula exposición antes de transmitir y exige capacidad autorizada.

La política de mercados caros debe ofrecer tareas completas con presupuesto suficiente, mensaje compacto o formulario/canal opcional. No bloquear extranjeros automáticamente ni aumentar presupuesto porque se detectó un país caro. Techo por mensajes y por dinero se aplican juntos para proteger también la cuota gratuita.

Implementa además máximo de tarifa unitaria autorizada por categoría/mercado y prueba un cambio de tarifa o plantilla que lo exceda aun con saldo agregado suficiente. La moneda corresponde a la cuenta; no confundir ese máximo con una constante global de precio por país.

Todo límite comunica alcance: controlamos lo enviado por Parallly. No garantizar un techo absoluto sobre cargos de otras apps en la misma cuenta, sobre incertidumbre del proveedor o sobre obligaciones anteriores. Las discrepancias se registran; no se maquillan para conservar el verde.

## R4 — productores y obligaciones

Corrige `nurturing.executeAttempt2`: el flujo actual encola texto y evita los controles comunes. Debe usar cuenta exacta, tipo de mensaje permitido, consentimiento, ventana, frecuencia y presupuesto. Verifica los demás intentos y recordatorios; no llamar plantilla preaprobada a un texto libre.

La consola humana, APIs y productores de campañas también necesitan la autorización. Handoff puede detener IA pero las respuestas humanas siguen generando cargos WhatsApp. Alertas y avisos internos deben estar acotados y no emitir automáticamente por el mismo canal agotado.

Reserva la confirmación mínima antes de una escritura que genera obligación de avisar. Una escritura ya comprometida conserva historial, recibo y aviso pendiente. La pausa por presupuesto no cancela pedidos ni borra respuestas. Mantén recepción de mensajes, webhooks y conciliación durante la pausa; recuperar no equivale a vaciar todo backlog.

## R5 — producto y pruebas

Añade “Control de gasto de WhatsApp” en canal, Assist y activación: mercados, costo orientativo por tarea, presupuesto autorizado, comportamiento al alcanzar límite y alcance sobre envíos externos. Propuestas de presupuesto deben mostrar qué tareas permiten, sin importes universales inventados. No reprecifiques planes ni autorices gasto con los 1.000 COP ilustrativos del informe.

Incluye protección básica en todos los planes. Distingue ampliación de capacidad de pérdida de protecciones. Actualiza es/en/pt/fr, tours y landing sólo con capacidades ya operativas. Describe ahorro potencial con alcance; porcentaje de ahorro exige comparación de tareas resueltas y no sólo menos mensajes.

Matriz mínima de aceptación:

| Caso | Evidencia que debe producir |
|---|---|
| Mismas 20 respuestas, Colombia/Perú/Alemania | Reserva según mercado y moneda; cifras consistentes con tarjeta versionada |
| Tres fotos con captions y un link | Efectos reales contados, semántica/recibos preservados |
| Dos workers, último saldo | Sólo gasto autorizado; ninguna doble asignación |
| Cuota 999/1000/1001 y varios países | Cuota por número, no multiplicada por mercado |
| Varios números/cuentas | Cuotas, pagador y pausa correctos, sin contaminación de debounce |
| Destino o estado de cuota desconocidos | Sin costo cero supuesto ni éxito falso |
| Cambio septiembre/octubre en cola | Revalidación y política correspondiente a la entrega/contrato |
| Timeout, reinicio y entrega tardía | Reserva incierta retenida y cero reenvíos por reintento ciego |
| Cuenta con otro proveedor | Alcance y beneficio incierto explícitos |
| Pregunta resuelta y cinco “gracias” | Sin cadena nueva de respuestas automáticas |
| Cliente confundido o reclamando | Reparación/atención legítima; no etiqueta automática de abuso |
| Misma pregunta requerida sin progreso | Reformulación limitada y vía alternativa, sin loop |
| Nueva necesidad después de pausa | Revisión de intención sin reiniciar límites financieros |
| Bot contra bot y ráfaga de contactos | Pausa/contacto y techo agregado; avisos acotados |
| Humano, REST, campaña y recordatorio | Todos atraviesan admisión; nadie evita el control por origen |
| Nurturing fuera de ventana/baja/cap | Cero efecto no permitido; no fallback más permisivo |
| Operación ejecutada antes de pausa | Conserva resultado y obligación de confirmación recuperable |
| Flow/formulario/Web Chat | El inicio y confirmaciones WA cuentan; continuidad segura y opcional |

Comprueba resolución de tarea, consentimiento y contenido completo junto con costo. Incluye estado de herramienta inexistente/obsoleto y reintento para evitar que “ahorrar” termine en acciones falsas. No replicar el guard en el fake para después probarlo contra sí mismo.

## R6 — cierre y puesta en marcha

Usa modo de observación sin prometer bloqueo antes de activar; conserva defensa previa y fija fecha de paso a enforcement. Compara entrega por tarea, costo por resolución verificada, repetición, falsos bloqueos y exposición monetaria. La observación no es la protección terminada.

Prepara canario por cuenta/mercado con techo explícito, rollback que detenga nuevo gasto sin borrar reservas o recibos y reanudación revisable. No desactivar controles existentes ni activar funciones apagadas por el solo hecho de tener tests nuevos.

Entrega: mapa de emisores→admisión, cambios por bloque, escenarios/resultado, diferencias de tarifas, UI revisable, métricas y gates externos concretos. Conserva build/tests pertinentes sobre HEAD y los controles del cierre previo. No declarar listo por comprobar sólo el modelo o el prompt: el criterio principal es que **ningún productor de WhatsApp pueda generar una entrega fuera de la autorización aplicable**.
